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

from news_sources import fetch_market_news, format_news_block, top_news_links

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

# ── Gemini 生成摘要 ──────────────────────────────────────────
def fmt_pair(d, unit=""):
    if not d or d.get("value") is None: return "N/A"
    chg = d.get("chg")
    chg_str = f" ({chg:+.2f}%)" if chg is not None else ""
    return f"{d['value']}{unit}{chg_str}"

def generate_summary(mkt, tx, news_grouped):
    last_td = "上週五" if twn_now().weekday() == 0 else "昨日"

    tx_line = f"- 台指期夜盤：{fmt_pair(tx)}" if tx else "- 台指期夜盤：N/A"
    news_block = format_news_block(news_grouped)

    prompt = f"""你是一位台灣資深財經分析師，請根據以下數據，以條列式整理今日「盤前必看重點」，繁體中文。

【使用者投資偏好】市值型/大盤 ETF。分析重心：大盤、ETF、權值股（台積電/鴻海/聯發科/台達電/廣達/富邦金/中信金 等）；個股新聞只在對加權指數有顯著影響時提及。CNBC 英文內容翻譯後納入。

格式（嚴格遵守）：
• 每條以「• 」開頭，每條不超過 30 字
• 第 1 條：今日台股開盤方向（偏多／偏空／震盪）+ 關鍵推力
• 第 2～4 條：最重要的市場訊號，從美股、台指期、國際、商品、新聞中擇重
• 最後 1 條：今日最需關注的風險或事件，以「⚠️ 」開頭
• 直接輸出 5 條條列，不需前言、標題或其他文字
• 只分析市場環境，不得建議具體買賣標的

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

{news_block}"""

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

def compact(d, unit=""):
    if not d or d.get("value") is None: return "N/A"
    chg = d.get("chg")
    chg_str = f"（{chg:+.2f}%）" if chg is not None else ""
    return f"{d['value']}{unit}{chg_str}"

# ── 主流程 ────────────────────────────────────────────────────
print("\n【步驟 1】抓取市場數據")
mkt = get_market_data()

print("\n【步驟 2】抓取台指期夜盤")
tx = get_tx_futures()

print("\n【步驟 3】抓取多來源新聞（24h 內，鉅亨網 + UDN money + CNBC）")
news_grouped = fetch_market_news("premarket")

print("\n【步驟 4】Gemini 生成盤前分析")
summary = generate_summary(mkt, tx, news_grouped)

print("\n【步驟 5】組合 Telegram 訊息")
last_td = "上週五" if twn_now().weekday() == 0 else "昨日"

tx_compact = compact(tx) if tx and tx.get("value") is not None else "N/A"
lines = [
    f"🌅 <b>WealthOS 盤前 — {today}</b>",
    "",
    f"📊 <b>{last_td}美股</b>  S&amp;P500 {compact(mkt.get('sp500'))}｜NASDAQ {compact(mkt.get('nasdaq'))}｜道瓊 {compact(mkt.get('dow'))}",
    f"🇹🇼 <b>台股</b>  加權 {compact(mkt.get('twii'))}｜台指期夜盤 {tx_compact}",
    f"🌏 <b>亞股</b>  日經 {compact(mkt.get('nikkei'))}｜恆生 {compact(mkt.get('hsi'))}｜韓股 {compact(mkt.get('kospi'))}",
    f"💱 <b>商品</b>  黃金 {compact(mkt.get('gold'))}｜原油 {compact(mkt.get('oil'))}｜VIX {compact(mkt.get('vix'))}｜US10Y {compact(mkt.get('us10y'), '%')}｜DXY {compact(mkt.get('dxy'))}",
]

if summary:
    lines += ["", "<b>📌 今日重點</b>", summary]
else:
    lines += ["", "<i>⚠️  AI 摘要生成失敗，僅推送原始數據</i>"]

top_links = top_news_links(news_grouped, n=5)
if top_links:
    lines += ["", "<b>📰 重點新聞</b>"]
    for n in top_links:
        title = (n.get("title") or "").replace("<", "&lt;").replace(">", "&gt;")
        url   = n.get("url") or ""
        src   = n.get("source") or ""
        if url:
            lines.append(f"• <a href=\"{url}\">[{src}] {title}</a>")
        else:
            lines.append(f"• [{src}] {title}")

lines += ["", "<i>資料來源：yfinance / FinMind / 鉅亨網 / 經濟日報 / CNBC</i>"]

message = "\n".join(lines)
# Telegram 單則訊息上限 4096 字元
if len(message) > 4000:
    message = message[:3990] + "\n…(已截斷)"

print(f"\n訊息長度: {len(message)} 字元")
ok = send_telegram(message)
if not ok:
    sys.exit(1)
print("\n✅ 盤前 Telegram 推播完成")
