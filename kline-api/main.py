from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
from supabase import create_client
import os, json

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
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
sb = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL else None

CACHE_TABLE = "kline_cache"

def get_cache(ticker: str, days: int):
    """從 Supabase 讀快取，若今天已抓過就直接回傳"""
    if not sb:
        return None
    try:
        today = datetime.utcnow().strftime("%Y-%m-%d")
        res = sb.table(CACHE_TABLE).select("*") \
            .eq("ticker", ticker) \
            .eq("days", days) \
            .eq("cached_date", today) \
            .execute()
        if res.data:
            return json.loads(res.data[0]["data"])
    except Exception as e:
        print(f"[cache get] {e}")
    return None

def set_cache(ticker: str, days: int, data: list):
    """寫入 Supabase 快取"""
    if not sb:
        return
    try:
        today = datetime.utcnow().strftime("%Y-%m-%d")
        # upsert：同 ticker+days+date 就更新
        sb.table(CACHE_TABLE).upsert({
            "ticker": ticker,
            "days": days,
            "cached_date": today,
            "data": json.dumps(data)
        }, on_conflict="ticker,days,cached_date").execute()
    except Exception as e:
        print(f"[cache set] {e}")

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
    end = datetime.utcnow()
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
        set_cache(ticker.upper(), days, data)
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
        set_cache(cache_key, days, data)
    return {"source": "yfinance", "ticker": ticker, "data": data}


@app.get("/health")
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}
