"""
Pre-market Telegram Brief
台灣時間週一至週五 08:00（開盤前一小時）執行
抓取美股收盤、國際股市、台指期夜盤、總經指標 + 鉅亨網新聞，
用 Gemini 生成盤前重點分析，透過 Telegram 推播。
"""

import os
import sys
import json
from datetime import datetime, timezone, timedelta

import yfinance as yf
import requests

# ── 時區常數 ──────────────────────────────────────────────────
TWN = timezone(timedelta(hours=8))

def twn_now():
    return datetime.now(TWN)

# ── 環境變數 ──────────────────────────────────────────────────
GEMINI_API_KEY     = os.environ.get("GEMINI_API_KEY")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID")
FINMIND_TOKEN      = os.environ.get("FINMIND_TOKEN", "")

if not all([GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID]):
    print("❌ 缺少環境變數：GEMINI_API_KEY / TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID")
    sys.exit(1)

today = twn_now().strftime("%Y-%m-%d")
print(f"📅 台灣時間：{twn_now().strftime('%Y-%m-%d %H:%M')}")

# ── 抓取總經與市場指標 ────────────────────────────────────────
def get_market_data():
    """抓取美股收盤、國際股市、總經指標"""
    symbols = {
        # 美股三大指數
        "sp500":  "^GSPC",
        "nasdaq": "^IXIC",
        "dow":    "^DJI",
        # 國際股市
        "nikkei": "^N225",   # 日經
        "hsi":    "^HSI",    # 恆生（TWN 09:30 才開盤，可能無當日資料）
        "kospi":  "^KS11",   # 韓股
        # 商品（24h 交易）
        "gold":   "GC=F",
        "oil":    "CL=F",
        # 總經
        "vix":    "^VIX",
        "us10y":  "^TNX",
        "dxy":    "DX-Y.NYB",
        # 台股加權（前日收盤）
        "twii":   "^TWII",
    }
    today_dt    = twn_now().date()
    hist_start  = str(today_dt - timedelta(days=10))
    hist_end    = str(today_dt + timedelta(days=1))
    result = {}
    for key, sym in symbols.items():
        try:
            hist = yf.Ticker(sym).history(start=hist_start, end=hist_end).dropna()
            if len(hist) >= 2:
                curr = float(hist["Close"].iloc[-1])
                prev = float(hist["Close"].iloc[-2])
                chg  = (curr - prev) / prev * 100
                curr_date = hist.index[-1].strftime("%Y-%m-%d")
                result[key] = {"value": round(curr, 2), "chg": round(chg, 2), "date": curr_date}
                print(f"  ✅ {key} ({sym}): {curr:.2f} ({chg:+.2f}%) [{curr_date}]")
            else:
                print(f"  ⚠️  {key} ({sym}): 資料不足（{len(hist)} 筆）")
        except Exception as e:
            print(f"  ❌ {key} ({sym}): {e}")
    return result

# ── 台指期夜盤（FinMind）──────────────────────────────────────
def get_tx_futures():
    """抓台指期昨日夜盤收盤（FinMind TaiwanFuturesDaily, trading_session=after_market）
    FinMind 沒有 token 時匿名也可呼叫，但配額較低。
    """
    today_dt = twn_now().date()
    start    = str(today_dt - timedelta(days=7))
    end      = str(today_dt)
    url = (
        "https://api.finmindtrade.com/api/v4/data"
        f"?dataset=TaiwanFuturesDaily&data_id=TX&start_date={start}&end_date={end}"
    )
    if FINMIND_TOKEN:
        url += f"&token={FINMIND_TOKEN}"
    try:
        r = requests.get(url, timeout=15)
        data = r.json().get("data", [])
        # 只取夜盤、近月（spread 較小代表近月，但簡化用前兩筆抓最新）
        nights = [d for d in data if d.get("trading_session") == "after_market"]
        if not nights:
            print("  ⚠️  台指期夜盤：無資料")
            return None
        # 依日期排序取最新兩筆
        nights.sort(key=lambda x: x.get("date", ""))
        # 取每日 close 加權平均近似（FinMind 同日有多個合約），用最後一筆即可
        latest = nights[-1]
        prev   = nights[-2] if len(nights) >= 2 else None
        close  = latest.get("close")
        chg = None
        if prev and prev.get("close"):
            chg = (close - prev["close"]) / prev["close"] * 100
        print(f"  ✅ 台指期夜盤 [{latest.get('date')}]: {close} ({chg:+.2f}%)" if chg is not None else f"  ✅ 台指期夜盤 [{latest.get('date')}]: {close}")
        return {"value": close, "chg": round(chg, 2) if chg is not None else None, "date": latest.get("date")}
    except Exception as e:
        print(f"  ❌ 台指期夜盤：{e}")
        return None

# ── 鉅亨網新聞 ────────────────────────────────────────────────
def get_news(category, limit=4):
    url = f"https://news.cnyes.com/api/v3/news/category/{category}?limit={limit}"
    try:
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
        items = r.json().get("items", {}).get("data", [])
        return [{"title": d.get("title", "")} for d in items]
    except Exception as e:
        print(f"  ❌ 新聞 {category}: {e}")
        return []

# ── Gemini 生成摘要 ──────────────────────────────────────────
def fmt_pair(d, unit=""):
    if not d or d.get("value") is None: return "N/A"
    chg = d.get("chg")
    chg_str = f" ({chg:+.2f}%)" if chg is not None else ""
    return f"{d['value']}{unit}{chg_str}"

def generate_summary(mkt, tx, tw_news, us_news, intl_news):
    last_td = "上週五" if twn_now().weekday() == 0 else "昨日"

    tw_titles   = "\n".join([f"- {n['title']}" for n in tw_news[:4]]) or "（無）"
    us_titles   = "\n".join([f"- {n['title']}" for n in us_news[:3]]) or "（無）"
    intl_titles = "\n".join([f"- {n['title']}" for n in intl_news[:3]]) or "（無）"

    tx_line = f"- 台指期夜盤：{fmt_pair(tx)}" if tx else "- 台指期夜盤：N/A"

    prompt = f"""你是一位台灣資深財經分析師，請根據以下數據撰寫今日「開盤前重點分析」，繁體中文約 200 字。
要求：
1. 開頭一句點出今日台股開盤可能走勢方向（偏多/偏空/震盪）並說明關鍵推力。
2. 接著用 2~3 句連貫敘述：美股動向、台指期夜盤暗示、國際股市與商品/匯率影響。
3. 最後一句點出今日需要關注的風險或事件。
語氣專業簡潔、直接輸出內文，不需標題或條列。
【注意】只分析市場環境，不得建議具體買賣標的。

【{last_td}美股收盤】
- S&P500：{fmt_pair(mkt.get('sp500'))}
- NASDAQ：{fmt_pair(mkt.get('nasdaq'))}
- 道瓊：{fmt_pair(mkt.get('dow'))}

【台指期 & 台股】
{tx_line}
- 台股加權（{last_td}收盤）：{fmt_pair(mkt.get('twii'))}

【國際股市】
- 日經：{fmt_pair(mkt.get('nikkei'))}
- 恆生：{fmt_pair(mkt.get('hsi'))}
- 韓股 KOSPI：{fmt_pair(mkt.get('kospi'))}

【商品 / 匯率 / 風險指標】
- 黃金：{fmt_pair(mkt.get('gold'))}
- 原油：{fmt_pair(mkt.get('oil'))}
- VIX：{fmt_pair(mkt.get('vix'))}
- 美10年期殖利率：{fmt_pair(mkt.get('us10y'), '%')}
- 美元指數 DXY：{fmt_pair(mkt.get('dxy'))}

【今日台股重點新聞】
{tw_titles}

【{last_td}美股重點新聞】
{us_titles}

【國際 / 總經重點新聞】
{intl_titles}"""

    models = [
        "gemini-2.5-flash",
        "gemini-2.0-flash-lite-001",
        "gemini-2.0-flash-001",
        "gemini-2.0-flash",
        "gemini-2.5-pro",
    ]
    for model in models:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.7,
                    "maxOutputTokens": 1024,
                    "thinkingConfig": {"thinkingBudget": 0},
                },
            }
            r = requests.post(url, json=payload, timeout=30)
            print(f"  [{model}] HTTP {r.status_code}")
            if r.status_code == 200:
                parts = r.json()["candidates"][0]["content"]["parts"]
                answer = "".join([p.get("text", "") for p in parts if not p.get("thought", False)]).strip()
                if not answer:
                    answer = parts[-1].get("text", "").strip()
                print(f"  ✅ 摘要生成成功（{model}）")
                return answer
            print(f"  ⚠️  {model} 錯誤：{r.text[:300]}")
        except Exception as e:
            print(f"  ❌ {model} 例外：{e}")
    return None

# ── Telegram 推播 ────────────────────────────────────────────
def send_telegram(text):
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id":    TELEGRAM_CHAT_ID,
        "text":       text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    r = requests.post(url, json=payload, timeout=15)
    print(f"[Telegram] HTTP {r.status_code} {r.text[:200]}")
    return r.status_code == 200

def fmt_line(label, d, unit=""):
    if not d or d.get("value") is None: return f"{label}: N/A"
    chg = d.get("chg")
    chg_str = f" ({chg:+.2f}%)" if chg is not None else ""
    return f"{label}: {d['value']}{unit}{chg_str}"

# ── 主流程 ────────────────────────────────────────────────────
print("\n【步驟 1】抓取市場數據")
mkt = get_market_data()

print("\n【步驟 2】抓取台指期夜盤")
tx = get_tx_futures()

print("\n【步驟 3】抓取新聞")
tw_news   = get_news("tw_stock", 4)
us_news   = get_news("us_stock", 3)
intl_news = get_news("wd_stock", 3)
print(f"  台股新聞：{len(tw_news)} 則 / 美股新聞：{len(us_news)} 則 / 國際新聞：{len(intl_news)} 則")

print("\n【步驟 4】Gemini 生成盤前分析")
summary = generate_summary(mkt, tx, tw_news, us_news, intl_news)

print("\n【步驟 5】組合 Telegram 訊息")
last_td = "上週五" if twn_now().weekday() == 0 else "昨日"

lines = [
    f"🌅 <b>WealthOS 盤前重點 — {today}</b>",
    "",
    f"<b>📊 {last_td}美股收盤</b>",
    fmt_line("  S&P500", mkt.get("sp500")),
    fmt_line("  NASDAQ", mkt.get("nasdaq")),
    fmt_line("  道瓊  ", mkt.get("dow")),
    "",
    "<b>🇹🇼 台股 / 台指期</b>",
    fmt_line(f"  加權({last_td})", mkt.get("twii")),
    f"  台指期夜盤: {tx['value']} ({tx['chg']:+.2f}%)" if tx and tx.get("value") is not None and tx.get("chg") is not None else "  台指期夜盤: N/A",
    "",
    "<b>🌏 國際股市</b>",
    fmt_line("  日經  ", mkt.get("nikkei")),
    fmt_line("  恆生  ", mkt.get("hsi")),
    fmt_line("  韓股  ", mkt.get("kospi")),
    "",
    "<b>💱 商品 / 風險指標</b>",
    fmt_line("  黃金", mkt.get("gold")),
    fmt_line("  原油", mkt.get("oil")),
    fmt_line("  VIX ", mkt.get("vix")),
    fmt_line("  US10Y", mkt.get("us10y"), "%"),
    fmt_line("  DXY  ", mkt.get("dxy")),
]

if summary:
    lines += ["", "<b>📝 盤前分析</b>", summary]
else:
    lines += ["", "<i>⚠️  AI 摘要生成失敗，僅推送原始數據</i>"]

lines += ["", "<i>資料來源：yfinance / FinMind / 鉅亨網</i>"]

message = "\n".join(lines)
# Telegram 單則訊息上限 4096 字元
if len(message) > 4000:
    message = message[:3990] + "\n…(已截斷)"

print(f"\n訊息長度: {len(message)} 字元")
ok = send_telegram(message)
if not ok:
    sys.exit(1)
print("\n✅ 盤前 Telegram 推播完成")
