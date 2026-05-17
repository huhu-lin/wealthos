"""
Post-market Telegram Brief
台灣時間週一至週五 15:30（台股 13:30 收盤後）執行
抓取台股收盤、三大法人、漲跌家數 + 鉅亨網盤後新聞，
用 Gemini 生成盤後總結，透過 Telegram 推播。
"""

import os
import sys
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

today    = twn_now().strftime("%Y-%m-%d")
today_dt = twn_now().date()
print(f"📅 台灣時間：{twn_now().strftime('%Y-%m-%d %H:%M')}")

# ── 台股加權收盤 + 國際 ──────────────────────────────────────
def get_market_data():
    symbols = {
        "twii":   "^TWII",
        "tx_otc": "^TWO",      # 櫃買指數
        "nikkei": "^N225",
        "hsi":    "^HSI",
        "kospi":  "^KS11",
        "sse":    "000001.SS", # 上證
        "usdtwd": "TWD=X",
    }
    hist_start = str(today_dt - timedelta(days=10))
    hist_end   = str(today_dt + timedelta(days=1))
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
                print(f"  ⚠️  {key} ({sym}): 資料不足")
        except Exception as e:
            print(f"  ❌ {key} ({sym}): {e}")
    return result

# ── 大盤成交量（FinMind TaiwanStockPrice with TAIEX）─────────
def get_taiex_volume():
    """抓加權指數當日成交量（FinMind TaiwanStockPrice data_id=TAIEX）"""
    start = str(today_dt - timedelta(days=5))
    end   = str(today_dt)
    url = (
        "https://api.finmindtrade.com/api/v4/data"
        f"?dataset=TaiwanStockPrice&data_id=TAIEX&start_date={start}&end_date={end}"
    )
    if FINMIND_TOKEN:
        url += f"&token={FINMIND_TOKEN}"
    try:
        r = requests.get(url, timeout=15)
        data = r.json().get("data", [])
        if not data:
            print("  ⚠️  TAIEX 成交量：無資料")
            return None
        data.sort(key=lambda x: x.get("date", ""))
        latest = data[-1]
        # FinMind 的 Trading_money 單位為新台幣元，轉億元
        money = latest.get("Trading_money") or latest.get("trading_money")
        vol_yi = round(money / 1e8, 1) if money else None
        print(f"  ✅ TAIEX 成交額 [{latest.get('date')}]: {vol_yi} 億")
        return {"value": vol_yi, "date": latest.get("date")}
    except Exception as e:
        print(f"  ❌ TAIEX 成交量：{e}")
        return None

# ── 三大法人買賣超（FinMind）─────────────────────────────────
def get_institutional():
    """抓三大法人對加權指數的買賣超
    FinMind dataset: TaiwanStockInstitutionalInvestorsBuySell
    name 欄位包含 Foreign_Investor / Investment_Trust / Dealer_Self / Dealer_Hedging
    取得最新交易日的總計（買-賣，單位：張或股，需依據實際格式判斷）
    """
    start = str(today_dt - timedelta(days=5))
    end   = str(today_dt)
    # 使用 TaiwanStockTotalInstitutionalInvestors（整體市場買賣超總計，單位：新台幣元）
    url = (
        "https://api.finmindtrade.com/api/v4/data"
        f"?dataset=TaiwanStockTotalInstitutionalInvestors&start_date={start}&end_date={end}"
    )
    if FINMIND_TOKEN:
        url += f"&token={FINMIND_TOKEN}"
    try:
        r = requests.get(url, timeout=15)
        rows = r.json().get("data", [])
        if not rows:
            print("  ⚠️  三大法人：無資料")
            return None
        rows.sort(key=lambda x: x.get("date", ""))
        latest_date = rows[-1].get("date")
        latest = [r for r in rows if r.get("date") == latest_date]
        result = {"date": latest_date, "foreign": None, "trust": None, "dealer": None, "total": 0}
        for r0 in latest:
            name = r0.get("name", "")
            buy  = r0.get("buy", 0) or 0
            sell = r0.get("sell", 0) or 0
            net  = (buy - sell) / 1e8  # 元 → 億
            if "Foreign_Investor" in name and "Dealer" not in name:
                result["foreign"] = round(net, 1)
            elif "Investment_Trust" in name:
                result["trust"]   = round(net, 1)
            elif "Dealer" in name:
                result["dealer"] = round((result.get("dealer") or 0) + net, 1)
            result["total"] = round(result.get("total", 0) + net, 1)
        print(f"  ✅ 三大法人 [{latest_date}]: 外資={result['foreign']} 投信={result['trust']} 自營={result['dealer']} 合計={result['total']}")
        return result
    except Exception as e:
        print(f"  ❌ 三大法人：{e}")
        return None

# ── Gemini 生成摘要 ──────────────────────────────────────────
def fmt_pair(d, unit=""):
    if not d or d.get("value") is None: return "N/A"
    chg = d.get("chg")
    chg_str = f" ({chg:+.2f}%)" if chg is not None else ""
    return f"{d['value']}{unit}{chg_str}"

def generate_summary(mkt, vol, inst, news_grouped):
    inst_text = "N/A"
    if inst:
        inst_text = (
            f"外資 {inst.get('foreign')} 億 / "
            f"投信 {inst.get('trust')} 億 / "
            f"自營 {inst.get('dealer')} 億 / "
            f"合計 {inst.get('total')} 億"
        )
    vol_text = f"{vol['value']} 億" if vol and vol.get("value") is not None else "N/A"
    news_block = format_news_block(news_grouped)

    prompt = f"""你是一位台灣資深財經分析師，請根據以下今日台股盤後數據撰寫「盤後總結」，繁體中文約 200 字。

【使用者投資偏好】市值型/大盤 ETF。請以「大盤、ETF、權值股（台積電/鴻海/聯發科/台達電/廣達/富邦金/中信金 等）動向」為分析重心；個股新聞僅在判斷其對加權指數有顯著拉抬或拖累時提及，否則略過。

要求：
1. 第一句點出今日台股漲跌方向與關鍵驅動力（成交量、法人態度、產業）。
2. 用 2~3 句連貫敘述：法人買賣超意涵、成交量解讀、與國際盤面對照，並結合新聞中與大盤/權值股相關的訊息。
3. 最後一句點出明日盤前需特別觀察的事件或風險。
語氣專業簡潔、直接輸出內文，不需標題或條列。
【注意】只分析市場環境，不得建議具體買賣標的。

【今日台股收盤】
- 加權指數：{fmt_pair(mkt.get('twii'))}
- 櫃買指數：{fmt_pair(mkt.get('tx_otc'))}
- 加權成交額：{vol_text}

【三大法人買賣超】
{inst_text}

【國際盤同日】
- 日經：{fmt_pair(mkt.get('nikkei'))}
- 恆生：{fmt_pair(mkt.get('hsi'))}
- 韓股 KOSPI：{fmt_pair(mkt.get('kospi'))}
- 上證：{fmt_pair(mkt.get('sse'))}

【匯率】
- USD/TWD：{fmt_pair(mkt.get('usdtwd'))}

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

def fmt_signed(v, unit="億"):
    if v is None: return "N/A"
    sign = "+" if v > 0 else ""
    return f"{sign}{v}{unit}"

# ── 主流程 ────────────────────────────────────────────────────
print("\n【步驟 1】抓取市場數據")
mkt = get_market_data()

print("\n【步驟 2】抓取加權成交量")
vol = get_taiex_volume()

print("\n【步驟 3】抓取三大法人")
inst = get_institutional()

print("\n【步驟 4】抓取多來源新聞（24h 內，鉅亨網 + UDN money）")
news_grouped = fetch_market_news("postmarket")

print("\n【步驟 5】Gemini 生成盤後總結")
summary = generate_summary(mkt, vol, inst, news_grouped)

print("\n【步驟 6】組合 Telegram 訊息")
lines = [
    f"🌇 <b>WealthOS 盤後總結 — {today}</b>",
    "",
    "<b>🇹🇼 台股收盤</b>",
    fmt_line("  加權", mkt.get("twii")),
    fmt_line("  櫃買", mkt.get("tx_otc")),
    f"  成交額: {vol['value']} 億" if vol and vol.get("value") is not None else "  成交額: N/A",
    "",
    "<b>💰 三大法人買賣超</b>",
    f"  外資: {fmt_signed(inst.get('foreign')) if inst else 'N/A'}",
    f"  投信: {fmt_signed(inst.get('trust'))  if inst else 'N/A'}",
    f"  自營: {fmt_signed(inst.get('dealer')) if inst else 'N/A'}",
    f"  合計: {fmt_signed(inst.get('total'))  if inst else 'N/A'}",
    "",
    "<b>🌏 國際盤</b>",
    fmt_line("  日經", mkt.get("nikkei")),
    fmt_line("  恆生", mkt.get("hsi")),
    fmt_line("  韓股", mkt.get("kospi")),
    fmt_line("  上證", mkt.get("sse")),
    "",
    "<b>💱 匯率</b>",
    fmt_line("  USD/TWD", mkt.get("usdtwd")),
]

if summary:
    lines += ["", "<b>📝 盤後分析</b>", summary]
else:
    lines += ["", "<i>⚠️  AI 摘要生成失敗，僅推送原始數據</i>"]

top_links = top_news_links(news_grouped, n=5)
if top_links:
    lines += ["", "<b>📰 重點新聞（24h 內最新）</b>"]
    for n in top_links:
        title = (n.get("title") or "").replace("<", "&lt;").replace(">", "&gt;")
        url   = n.get("url") or ""
        src   = n.get("source") or ""
        if url:
            lines.append(f"• <a href=\"{url}\">[{src}] {title}</a>")
        else:
            lines.append(f"• [{src}] {title}")

lines += ["", "<i>資料來源：yfinance / FinMind / 鉅亨網 / 經濟日報</i>"]

message = "\n".join(lines)
if len(message) > 4000:
    message = message[:3990] + "\n…(已截斷)"

print(f"\n訊息長度: {len(message)} 字元")
ok = send_telegram(message)
if not ok:
    sys.exit(1)
print("\n✅ 盤後 Telegram 推播完成")
