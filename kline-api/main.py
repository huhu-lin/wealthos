from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta, timezone
from supabase import create_client
import os, json, math

# ── 時區常數 ─────────────────────────────────────────────────
TWN = timezone(timedelta(hours=8))   # UTC+8 台灣時區

def twn_today() -> str:
    """取得台灣時區今日日期字串（YYYY-MM-DD）"""
    return datetime.now(TWN).strftime("%Y-%m-%d")

app = FastAPI()

# ── CORS（只允許 Vercel 前端呼叫）───────────────────────────
# 從環境變數讀取，Railway 部署請在環境變數設定 ALLOWED_ORIGINS
# 格式：逗號分隔，例如 "https://wealthos.vercel.app,https://wealthos-git-main.vercel.app"
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = (
    [o.strip() for o in _raw_origins.split(",") if o.strip()]
    if _raw_origins
    else ["http://localhost:5173"]   # 本機開發 fallback
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],           # kline API 只需要 GET
    allow_headers=["Content-Type"],
)

# ── Supabase 快取 ────────────────────────────────────────────
# 優先使用 SERVICE_KEY：kline_cache 表有 RLS，anon key 無寫入權限
# 若 SERVICE_KEY 未設，退回 ANON_KEY（只能讀，寫入會靜默失敗）
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_KEY") or
    os.environ.get("SUPABASE_ANON_KEY", "")
)
if not os.environ.get("SUPABASE_SERVICE_KEY"):
    print("⚠️  SUPABASE_SERVICE_KEY 未設，kline_cache 寫入可能因 RLS 失敗")
sb = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL else None

CACHE_TABLE = "kline_cache"

def get_cache(ticker: str, days: int):
    """
    從 Supabase 讀快取。
    日期 key 使用台灣時區（UTC+8），與用戶瀏覽器日期一致，
    解決 daily-precache 在 UTC 22:00 寫入但用戶在台灣次日使用時 key 不吻合的問題。

    Stale 判斷邏輯（按市場分類）：
      台股：收盤 TWN 13:30 = UTC 05:30，加 buffer → UTC 06:00
      美股：收盤 ET 16:00 = UTC 20:00（夏令），加 buffer → UTC 21:00

    Bug 修復（2026-05-06）：
      原本所有標的都用台股 UTC 06:00 判斷。
      US 股在 UTC 15:31 寫入（美股開盤中），stale check 為 15:31 < 06:00 → False，
      永遠不過期 → precache 跑了也拿到舊快取直接回傳，yfinance 不重抓。
      修復：is_tw 分支用不同 close 時間。

    額外防護：快取資料最新日期若超過 7 天，強制更新（防長假期陳舊資料）。
    """
    if not sb:
        return None
    try:
        today = twn_today()
        res = sb.table(CACHE_TABLE).select("*") \
            .eq("ticker", ticker) \
            .eq("days", days) \
            .eq("cached_date", today) \
            .execute()
        if not res.data:
            return None

        now_utc = datetime.utcnow()
        entry = res.data[0]
        created_str = entry.get("created_at", "")
        try:
            created_at = datetime.fromisoformat(created_str.replace("+00:00", ""))
        except Exception:
            created_at = now_utc  # 解析失敗當作新鮮的

        # 依市場決定收盤時間（UTC）
        is_tw = ticker.endswith("_TW")
        if is_tw:
            # 台股 13:30 TWN = UTC 05:30，加 30min buffer → UTC 06:00
            close_h, close_m = 6, 0
        else:
            # 美股 16:00 ET（夏令）= UTC 20:00，加 60min buffer → UTC 21:00
            close_h, close_m = 21, 0

        market_close_utc = now_utc.replace(hour=close_h, minute=close_m, second=0, microsecond=0)

        if created_at < market_close_utc and now_utc >= market_close_utc:
            mkt = "TW" if is_tw else "US"
            print(f"[cache stale] {ticker} cached before {mkt} market close "
                  f"({created_at.strftime('%H:%M')} UTC), refreshing")
            return None

        # 額外防護：資料最新日期 > 7 天則強制重抓（長假期 / 資料異常保護）
        try:
            cached_data = json.loads(entry["data"])
            if cached_data:
                last_date = datetime.strptime(cached_data[-1]["date"], "%Y-%m-%d")
                age_days = (now_utc - last_date).days
                if age_days > 7:
                    print(f"[cache stale] {ticker} last data {cached_data[-1]['date']} "
                          f"is {age_days}d old (>7), refreshing")
                    return None
            return cached_data
        except Exception:
            return json.loads(entry["data"])

    except Exception as e:
        print(f"[cache get] {e}")
    return None

def set_cache(ticker: str, days: int, data: list) -> bool:
    """
    寫入 Supabase 快取。
    日期 key 使用台灣時區（UTC+8），與 get_cache 一致。
    回傳 True=成功 / False=失敗（讓呼叫端可偵測）
    """
    if not sb:
        return False
    try:
        today = twn_today()   # ← 台灣時區日期
        data_json = json.dumps(data, allow_nan=False)   # NaN 殘留時明確 raise ValueError，不再靜默失敗
        sb.table(CACHE_TABLE).upsert({
            "ticker": ticker,
            "days": days,
            "cached_date": today,
            "data": data_json
        }, on_conflict="ticker,days,cached_date").execute()
        print(f"[cache set ✅] {ticker} days={days} cached_date={today}")
        return True
    except Exception as e:
        # 不吞掉：印出完整錯誤讓 Render log 可見（anon key 無寫入權限時會顯示在這）
        print(f"[cache set ❌] {ticker}: {e}")
        return False

# ── 台股 ticker 轉換 ─────────────────────────────────────────
def tw_to_yf(ticker: str) -> str:
    """台股代號轉 yfinance 格式，如 006208 → 006208.TW"""
    t = ticker.strip().upper()
    if t.endswith(".TW") or t.endswith(".TWO"):
        return t
    # 上市 ETF / 股票一律加 .TW
    return f"{t}.TW"

# ── K 線抓取核心 ─────────────────────────────────────────────
def fetch_kline(ticker_yf: str, days: int) -> list:
    """用 yfinance 抓還原股價（auto_adjust=True 預設還原）"""
    # yfinance end 參數為 exclusive（不含該日），+1 天確保當日資料被包含
    end = datetime.utcnow() + timedelta(days=1)
    start = end - timedelta(days=days + 10)   # 多抓幾天避免假日缺口
    try:
        df = yf.download(
            ticker_yf,
            start=start.strftime("%Y-%m-%d"),
            end=end.strftime("%Y-%m-%d"),
            auto_adjust=True,       # ← 還原股價（除息/分割全調整）
            progress=False,
        )
        if df.empty:
            return []
        df = df.dropna()
        result = []
        for idx, row in df.iterrows():
            result.append({
                "date": idx.strftime("%Y-%m-%d"),
                "open":  round(float(row["Open"].iloc[0] if hasattr(row["Open"], 'iloc') else row["Open"]), 4),
                "high":  round(float(row["High"].iloc[0] if hasattr(row["High"], 'iloc') else row["High"]), 4),
                "low":   round(float(row["Low"].iloc[0] if hasattr(row["Low"], 'iloc') else row["Low"]), 4),
                "close": round(float(row["Close"].iloc[0] if hasattr(row["Close"], 'iloc') else row["Close"]), 4),
            })
        # 偵測價格尺度不連續（>80% 單日跌幅）：如 00631L 在 2015-01-05 因 yfinance
        # 錯誤除息記錄，導致 2014 年資料（~21 TWD）與 2015 年後（~1 TWD）尺度不符。
        # 做法：從不連續點開始保留，丟棄之前不相容的資料，確保整段價格序列一致。
        if len(result) > 1:
            for i in range(1, len(result)):
                prev = result[i-1]["close"]
                curr = result[i]["close"]
                if prev > 0 and (curr - prev) / prev < -0.80:
                    print(f"[sanitize] 價格不連續 {result[i]['date']}: {prev}→{curr}，截取後段資料")
                    result = result[i:]
                    break

        # NaN 二次清洗：移除任何 OHLC 含 NaN 的 row（老 ETF 如 0050 早期資料）
        # df.dropna() 已處理大多數，但 float() 轉換後仍可能殘留 Python NaN。
        # NaN 在 json.dumps 預設 allow_nan=True 下會輸出非標準 "NaN"，PostgREST 拒絕寫入。
        # 過濾整列（而非替換 null）確保前端 calcKDJ / calcBB 不會收到 null 價格。
        before = len(result)
        result = [
            row for row in result
            if not any(isinstance(row[k], float) and math.isnan(row[k])
                       for k in ('open', 'high', 'low', 'close'))
        ]
        removed = before - len(result)
        if removed:
            print(f"[sanitize] 移除 {removed} 筆 NaN row（老資料異常，不影響近期回測）")

        return result
    except Exception as e:
        print(f"[fetch_kline] {ticker_yf} error: {e}")
        return []

# ── API 端點 ─────────────────────────────────────────────────

@app.get("/kline/us")
def kline_us(ticker: str = Query(...), days: int = Query(720)):
    """
    美股還原K線
    GET /kline/us?ticker=QLD&days=720
    """
    # 先查快取
    cached = get_cache(ticker.upper(), days)
    if cached:
        return {"source": "cache", "ticker": ticker, "data": cached}

    data = fetch_kline(ticker.upper(), days)
    if data:
        ok = set_cache(ticker.upper(), days, data)
        if not ok:
            print(f"[kline/us ⚠️] {ticker}: 資料已取得但快取寫入失敗（確認 SUPABASE_SERVICE_KEY）")
    return {"source": "yfinance", "ticker": ticker, "data": data}


@app.get("/kline/tw")
def kline_tw(ticker: str = Query(...), days: int = Query(720)):
    """
    台股還原K線
    GET /kline/tw?ticker=006208&days=720
    """
    ticker_yf = tw_to_yf(ticker)
    cache_key = f"{ticker.upper()}_TW"

    cached = get_cache(cache_key, days)
    if cached:
        return {"source": "cache", "ticker": ticker, "data": cached}

    data = fetch_kline(ticker_yf, days)
    if data:
        ok = set_cache(cache_key, days, data)
        if not ok:
            print(f"[kline/tw ⚠️] {ticker}: 資料已取得但快取寫入失敗（確認 SUPABASE_SERVICE_KEY）")
    return {"source": "yfinance", "ticker": ticker, "data": data}


@app.get("/health")
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}
