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
from datetime import datetime, timezone, timedelta

from supabase import create_client

# ── 時區常數 ──────────────────────────────────────────────────
TWN = timezone(timedelta(hours=8))  # UTC+8 台灣時區

def twn_today() -> str:
    """取得台灣時區今日日期（YYYY-MM-DD）
    重要：GitHub Action 在 UTC 22:30 執行（= TWN 06:30 次日）
    若用 date.today() 會拿到 UTC 日期（前一天），導致 brief_date 存錯
    必須使用 TWN 時區確保日期與用戶看到的一致
    """
    return datetime.now(TWN).strftime("%Y-%m-%d")

# ── 初始化 ────────────────────────────────────────────────────
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
SUPABASE_URL   = os.environ.get("SUPABASE_URL")
SUPABASE_KEY   = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_ANON_KEY")

if not all([GEMINI_API_KEY, SUPABASE_URL, SUPABASE_KEY]):
    print("❌ 缺少環境變數：GEMINI_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_KEY")
    sys.exit(1)

sb    = create_client(SUPABASE_URL, SUPABASE_KEY)
today = twn_today()  # ✅ 台灣時區日期（修正 UTC 22:30 執行時日期差一天的問題）
print(f"  台灣時間：{datetime.now(TWN).strftime('%Y-%m-%d %H:%M')} → brief_date={today}")

# ── 防重複執行（手動觸發時跳過） ──────────────────────────────
force = os.environ.get("FORCE_REGENERATE", "false").lower() == "true"
if not force:
    existing = sb.table("morning_brief").select("id").eq("brief_date", today).execute()
    if existing.data:
        print(f"✅ {today} 的盤前摘要已存在，跳過（設 FORCE_REGENERATE=true 強制重生成）")
        sys.exit(0)

# ── 抓取總經指標 ──────────────────────────────────────────────
def get_macro():
    symbols = {
        "vix":    "^VIX",
        "us10y":  "^TNX",
        "dxy":    "DX-Y.NYB",
        "sp500":  "^GSPC",
        "nasdaq": "^IXIC",
        "twii":   "^TWII",
    }
    result = {}
    for key, sym in symbols.items():
        try:
            hist = yf.Ticker(sym).history(period="5d")  # 多抓幾天避免假日空資料
            hist = hist.dropna()
            if len(hist) >= 2:
                curr      = float(hist["Close"].iloc[-1])
                prev      = float(hist["Close"].iloc[-2])
                chg       = (curr - prev) / prev * 100
                # 記錄實際使用的日期，方便驗證 ^TWII 是否抓到正確日期
                curr_date = hist.index[-1].strftime("%Y-%m-%d")
                prev_date = hist.index[-2].strftime("%Y-%m-%d")
                result[key] = {"value": round(curr, 2), "chg": round(chg, 2)}
                print(f"  ✅ {key} ({sym}): {curr:.2f} ({chg:+.2f}%)  [{prev_date}→{curr_date}]")
            else:
                print(f"  ⚠️  {key} ({sym}): 資料不足（{len(hist)} 筆）")
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
        return [{"title": d.get("title", ""), "url": f"https://news.cnyes.com/news/id/{d.get('newsId', '')}"} for d in items]
    except Exception as e:
        print(f"  ❌ 新聞 {category}: {e}")
        return []

# ── Gemini REST API 生成摘要（不用 SDK，直接打 HTTP）─────────
def generate_summary(macro, tw_news, us_news):
    sp500  = macro.get("sp500",  {})
    nasdaq = macro.get("nasdaq", {})
    twii   = macro.get("twii",   {})
    vix    = macro.get("vix",    {})
    us10y  = macro.get("us10y",  {})
    dxy    = macro.get("dxy",    {})

    def fmt(d, unit=""):
        if not d: return "N/A"
        return f"{d['value']}{unit} ({d['chg']:+.2f}%)"

    tw_titles = "\n".join([f"- {n['title']}" for n in tw_news[:4]])
    us_titles = "\n".join([f"- {n['title']}" for n in us_news[:3]])

    prompt = f"""你是一位台灣資深財經分析師，請根據以下數據，用繁體中文撰寫約150字的今日開盤前重點摘要。
語氣專業簡潔，重點放在對台股今日走勢的影響研判。直接輸出摘要，不需標題或條列。
【注意】只分析市場環境因素，不得建議具體買賣操作或推薦特定投資標的。

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

    # 依序嘗試不同模型（從 /v1beta/models 確認可用清單）
    # Log 確認可用：gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash, gemini-2.0-flash-001
    models = [
        "gemini-2.5-flash",           # 最新最快，免費有配額
        "gemini-2.0-flash-lite-001",  # 輕量版，配額最寬鬆
        "gemini-2.0-flash-001",
        "gemini-2.0-flash",
        "gemini-2.5-pro",             # Pro，備用
    ]

    # 先測試 API Key 是否有效
    test_url = f"https://generativelanguage.googleapis.com/v1beta/models?key={GEMINI_API_KEY}"
    try:
        test_r = requests.get(test_url, timeout=10)
        if test_r.status_code == 200:
            available = [m.get("name","") for m in test_r.json().get("models", [])]
            print(f"  API Key 有效，可用模型數：{len(available)}")
            available_names = [n.split("/")[-1] for n in available]
            print(f"  前5個可用：{available_names[:5]}")
        else:
            print(f"  ⚠️  API Key 測試失敗：HTTP {test_r.status_code} — {test_r.text[:300]}")
    except Exception as e:
        print(f"  ⚠️  API Key 測試例外：{e}")

    for model in models:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.7,
                    "maxOutputTokens": 1024,
                    "thinkingConfig": {"thinkingBudget": 0}  # 關閉思考模式，token 全給答案
                }
            }
            r = requests.post(url, json=payload, timeout=30)
            print(f"  [{model}] HTTP {r.status_code}")
            if r.status_code == 200:
                data = r.json()
                parts = data["candidates"][0]["content"]["parts"]
                # Gemini 2.5 思考模型：parts 可能含 thought=True 的推理段，
                # 只取非思考部分（實際回應）
                answer_parts = [p.get("text","") for p in parts if not p.get("thought", False)]
                text = "".join(answer_parts).strip()
                if not text:
                    # fallback：直接取最後一段
                    text = parts[-1].get("text","").strip()
                print(f"  ✅ 摘要生成成功（{model}，{len(parts)}段）：{text[:60]}...")
                return text
            else:
                # 完整印出錯誤（幫助診斷）
                print(f"  ⚠️  {model} 錯誤：{r.text[:400]}")
        except Exception as e:
            print(f"  ❌ {model} 例外：{e}")

    raise Exception("所有 Gemini 模型均失敗")

# ── 主流程 ────────────────────────────────────────────────────
print(f"\n📋 開始生成 {today} 盤前摘要（force={force}）\n")

print("【步驟 1】抓取總經指標")
macro = get_macro()

print("\n【步驟 2】抓取財經新聞")
tw_news = get_news("tw_stock", 4)
us_news = get_news("us_stock", 3)
print(f"  台股新聞：{len(tw_news)} 則，美股新聞：{len(us_news)} 則")

print("\n【步驟 3】Gemini 生成摘要")
try:
    summary = generate_summary(macro, tw_news, us_news)
except Exception as e:
    print(f"  ❌ 最終失敗：{e}")
    summary = None  # 不存失敗訊息，保持 null 讓前端顯示「尚未就緒」

print("\n【步驟 4】存入 Supabase")
sp500  = macro.get("sp500",  {})
nasdaq = macro.get("nasdaq", {})
vix    = macro.get("vix",    {})
us10y  = macro.get("us10y",  {})
dxy    = macro.get("dxy",    {})
twii   = macro.get("twii",   {})

sb.table("morning_brief").upsert({
    "brief_date": today,
    "vix":        vix.get("value"),
    "us10y":      us10y.get("value"),
    "dxy":        dxy.get("value"),
    "sp500_chg":  sp500.get("chg"),
    "nasdaq_chg": nasdaq.get("chg"),
    "twii_chg":   twii.get("chg"),
    "twii_value": twii.get("value"),   # ✅ 新增：台股加權實際點位（供前端顯示與驗證）
    "tw_news":    json.dumps(tw_news, ensure_ascii=False),
    "us_news":    json.dumps(us_news, ensure_ascii=False),
    "ai_summary": summary,
}, on_conflict="brief_date").execute()

if summary:
    print(f"\n✅ {today} 盤前摘要完成！")
else:
    print(f"\n⚠️  {today} 總經數據已存，但 AI 摘要生成失敗")
