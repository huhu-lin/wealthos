"""
Morning Brief Generator
每天 08:00 TWN 自動執行，抓取總經指標 + 財經新聞，用 Gemini 生成盤前摘要
結果存入 Supabase morning_brief 表，前端監控分頁直接讀取
"""

import yfinance as yf
import requests
import json
import os
import sys
from datetime import date, datetime

import google.generativeai as genai
from supabase import create_client

# ── 初始化 ────────────────────────────────────────────────────
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
SUPABASE_URL   = os.environ.get("SUPABASE_URL")
SUPABASE_KEY   = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_ANON_KEY")

if not all([GEMINI_API_KEY, SUPABASE_URL, SUPABASE_KEY]):
    print("❌ 缺少環境變數：GEMINI_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_KEY")
    sys.exit(1)

genai.configure(api_key=GEMINI_API_KEY)
sb = create_client(SUPABASE_URL, SUPABASE_KEY)
today = date.today().isoformat()

# ── 防重複執行 ────────────────────────────────────────────────
existing = sb.table("morning_brief").select("id").eq("brief_date", today).execute()
if existing.data:
    print(f"✅ {today} 的盤前摘要已存在，跳過")
    sys.exit(0)

# ── 抓取總經指標 ──────────────────────────────────────────────
def get_macro():
    symbols = {
        "vix":    "^VIX",
        "us10y":  "^TNX",
        "dxy":    "DX-Y.NYB",
        "sp500":  "^GSPC",
        "nasdaq": "^IXIC",
        "twii":   "^TWII",   # 台灣加權指數（替代台指期夜盤）
    }
    result = {}
    for key, sym in symbols.items():
        try:
            hist = yf.Ticker(sym).history(period="2d")
            if len(hist) >= 2:
                curr = float(hist["Close"].iloc[-1])
                prev = float(hist["Close"].iloc[-2])
                chg  = (curr - prev) / prev * 100
                result[key] = {"value": round(curr, 2), "chg": round(chg, 2)}
                print(f"  ✅ {key} ({sym}): {curr:.2f} ({chg:+.2f}%)")
            else:
                print(f"  ⚠️  {key} ({sym}): 資料不足")
        except Exception as e:
            print(f"  ❌ {key} ({sym}): {e}")
    return result

# ── 抓取鉅亨網新聞 ────────────────────────────────────────────
def get_news(category, limit=4):
    url = f"https://news.cnyes.com/api/v3/news/category/{category}?limit={limit}"
    try:
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
        data = r.json()
        items = data.get("items", {}).get("data", [])
        return [
            {
                "title": d.get("title", ""),
                "url": f"https://news.cnyes.com/news/id/{d.get('newsId', '')}",
            }
            for d in items
        ]
    except Exception as e:
        print(f"  ❌ 新聞 {category}: {e}")
        return []

# ── 生成 Gemini 摘要 ──────────────────────────────────────────
def generate_summary(macro, tw_news, us_news):
    sp500  = macro.get("sp500",  {})
    nasdaq = macro.get("nasdaq", {})
    twii   = macro.get("twii",   {})
    vix    = macro.get("vix",    {})
    us10y  = macro.get("us10y",  {})
    dxy    = macro.get("dxy",    {})

    def fmt(d, unit=""):
        if not d:
            return "N/A"
        return f"{d['value']}{unit} ({d['chg']:+.2f}%)"

    tw_titles = "\n".join([f"- {n['title']}" for n in tw_news[:4]])
    us_titles = "\n".join([f"- {n['title']}" for n in us_news[:3]])

    prompt = f"""你是一位台灣資深財經分析師，請根據以下數據，用繁體中文撰寫約150字的今日開盤前重點摘要。
語氣專業簡潔，重點放在對台股今日走勢的影響研判。直接輸出摘要，不需標題或條列。

【昨日美股收盤】
- S&P500：{fmt(sp500)}
- NASDAQ：{fmt(nasdaq)}
- 台股加權指數：{fmt(twii)}

【總體指標】
- VIX 恐慌指數：{fmt(vix)}
- 美債10年殖利率：{fmt(us10y, '%')}
- 美元指數 DXY：{fmt(dxy)}

【今日台股重點新聞】
{tw_titles}

【昨日美股重點新聞】
{us_titles}"""

    # 依序嘗試可用的 Gemini 模型
    for model_name in ["gemini-1.5-flash", "gemini-1.5-flash-latest", "gemini-pro"]:
        try:
            model = genai.GenerativeModel(model_name)
            response = model.generate_content(prompt)
            print(f"  使用模型：{model_name}")
            return response.text.strip()
        except Exception as e:
            print(f"  ⚠️  {model_name} 失敗：{e}")
    raise Exception("所有 Gemini 模型均失敗")

# ── 主流程 ────────────────────────────────────────────────────
print(f"\n📋 開始生成 {today} 盤前摘要...\n")

print("【步驟 1】抓取總經指標")
macro = get_macro()

print("\n【步驟 2】抓取財經新聞")
tw_news = get_news("tw_stock", 4)
us_news = get_news("us_stock", 3)
print(f"  台股新聞：{len(tw_news)} 則，美股新聞：{len(us_news)} 則")

print("\n【步驟 3】Gemini 生成摘要")
try:
    summary = generate_summary(macro, tw_news, us_news)
    print(f"  摘要：{summary[:80]}...")
except Exception as e:
    print(f"  ❌ Gemini 生成失敗：{e}")
    summary = "今日盤前摘要生成失敗，請稍後重試。"

print("\n【步驟 4】存入 Supabase")
sp500  = macro.get("sp500",  {})
nasdaq = macro.get("nasdaq", {})
vix    = macro.get("vix",    {})
us10y  = macro.get("us10y",  {})
dxy    = macro.get("dxy",    {})

sb.table("morning_brief").upsert({
    "brief_date": today,
    "vix":        vix.get("value"),
    "us10y":      us10y.get("value"),
    "dxy":        dxy.get("value"),
    "sp500_chg":  sp500.get("chg"),
    "nasdaq_chg": nasdaq.get("chg"),
    "tw_news":    json.dumps(tw_news, ensure_ascii=False),
    "us_news":    json.dumps(us_news, ensure_ascii=False),
    "ai_summary": summary,
}, on_conflict="brief_date").execute()

print(f"\n✅ {today} 盤前摘要完成！")
