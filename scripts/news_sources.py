"""
多來源新聞抓取（鉅亨網 / 經濟日報 UDN money / CNBC World Business）

統一輸出 schema：
    {
      "title":      str,
      "summary":    str,        # 短摘要，~120 字
      "content":    str,        # 前 300 字內文（已去 HTML tag）
      "url":        str,
      "publishAt":  int | None, # Unix timestamp（秒）
      "source":     str,        # "鉅亨網" / "經濟日報" / "CNBC"
      "category":   str,        # "market" / "stock" / "intl"
    }

設計重點：
- 24 小時新聞過濾；若某類別 24h 內筆數 < min_keep，自動放寬到 48h 補足
- HTML 清洗用 stdlib `html.parser`，避免新增 BeautifulSoup 依賴
- 單一來源失敗印 warning 即可，不丟例外（避免整個推播流程因新聞失敗中斷）
"""

import re
import time
import html
from html.parser import HTMLParser
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import requests
import feedparser

UA = {"User-Agent": "Mozilla/5.0"}
TIMEOUT = 10
WINDOW_24H = 24 * 3600
WINDOW_48H = 48 * 3600

# ── HTML 清洗（stdlib） ───────────────────────────────────────
class _HTMLStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
    def handle_data(self, data):
        self.parts.append(data)
    def get_text(self):
        return "".join(self.parts)

def strip_html(s):
    if not s:
        return ""
    # 先做 HTML entity 解碼
    s = html.unescape(s)
    p = _HTMLStripper()
    try:
        p.feed(s)
        text = p.get_text()
    except Exception:
        # 退回 regex 暴力法
        text = re.sub(r"<[^>]+>", "", s)
    # 收斂多餘空白
    text = re.sub(r"\s+", " ", text).strip()
    return text

# ── 時間判斷 ──────────────────────────────────────────────────
def _within(pub_ts, window):
    if not pub_ts:
        return False  # 沒有時間戳記 → 視為不在窗內，安全起見丟掉
    return (int(time.time()) - pub_ts) <= window

def _parse_rss_date(s):
    if not s:
        return None
    try:
        dt = parsedate_to_datetime(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except Exception:
        return None

# ── 鉅亨網 cnyes ──────────────────────────────────────────────
def fetch_cnyes(category, limit=5, category_label="market", hours=24, min_keep=2):
    """list endpoint 同時回傳 title / summary / content / publishAt / newsId
    publishAt 為 Unix 秒
    """
    url = f"https://news.cnyes.com/api/v3/news/category/{category}?limit={limit*3}"
    try:
        r = requests.get(url, headers=UA, timeout=TIMEOUT)
        items = r.json().get("items", {}).get("data", [])
    except Exception as e:
        print(f"  ❌ cnyes/{category}: {e}")
        return []

    return _pick_window(
        items=items,
        to_item=lambda d: _cnyes_to_item(d, category_label),
        get_ts=lambda d: d.get("publishAt"),
        limit=limit,
        hours=hours,
        min_keep=min_keep,
        label=f"cnyes/{category}",
    )

def _cnyes_to_item(d, category_label):
    summary_raw = d.get("summary") or ""
    content_raw = d.get("content") or summary_raw
    summary = strip_html(summary_raw)[:120]
    content = strip_html(content_raw)[:300]
    if not summary and content:
        summary = content[:120]
    return {
        "title":     d.get("title", "").strip(),
        "summary":   summary,
        "content":   content,
        "url":       f"https://news.cnyes.com/news/id/{d.get('newsId','')}",
        "publishAt": d.get("publishAt"),
        "source":    "鉅亨網",
        "category":  category_label,
    }

# ── 經濟日報 UDN money（RSS） ─────────────────────────────────
UDN_FEEDS = {
    "headline":  "https://money.udn.com/rssfeed/news/1001/5590/5612?ch=money",   # 要聞頭條
    "tw_market": "https://money.udn.com/rssfeed/news/1001/5590/5613?ch=money",   # 集中市場
    "intl":      "https://money.udn.com/rssfeed/news/1001/5599/5641?ch=money",   # 國際財經
}

def fetch_udn_money(feed_key, limit=5, category_label="market", hours=24, min_keep=2):
    url = UDN_FEEDS.get(feed_key)
    if not url:
        print(f"  ❌ udn/{feed_key}: 未定義 feed")
        return []
    try:
        r = requests.get(url, headers=UA, timeout=TIMEOUT)
        feed = feedparser.parse(r.content)
        entries = feed.entries or []
    except Exception as e:
        print(f"  ❌ udn/{feed_key}: {e}")
        return []

    return _pick_window(
        items=entries,
        to_item=lambda e: _rss_entry_to_item(e, source="經濟日報", category_label=category_label),
        get_ts=lambda e: _parse_rss_date(e.get("published", "") or e.get("updated", "")),
        limit=limit,
        hours=hours,
        min_keep=min_keep,
        label=f"udn/{feed_key}",
    )

# ── CNBC World Business（RSS）─────────────────────────────────
CNBC_WORLD_BUSINESS_RSS = "https://www.cnbc.com/id/100727362/device/rss/rss.html"

def fetch_cnbc_world_business(limit=3, hours=24, min_keep=2):
    try:
        r = requests.get(CNBC_WORLD_BUSINESS_RSS, headers=UA, timeout=TIMEOUT)
        feed = feedparser.parse(r.content)
        entries = feed.entries or []
    except Exception as e:
        print(f"  ❌ cnbc: {e}")
        return []

    return _pick_window(
        items=entries,
        to_item=lambda e: _rss_entry_to_item(e, source="CNBC", category_label="intl"),
        get_ts=lambda e: _parse_rss_date(e.get("published", "") or e.get("updated", "")),
        limit=limit,
        hours=hours,
        min_keep=min_keep,
        label="cnbc",
    )

def _rss_entry_to_item(e, source, category_label):
    desc = strip_html(e.get("description", "") or e.get("summary", ""))
    content_raw = ""
    # feedparser 將 <content:encoded> 放在 e.content[0].value
    if e.get("content"):
        try:
            content_raw = e.content[0].get("value", "")
        except Exception:
            content_raw = ""
    content = strip_html(content_raw) or desc
    return {
        "title":     (e.get("title", "") or "").strip(),
        "summary":   (desc or content)[:120],
        "content":   content[:300],
        "url":       e.get("link", ""),
        "publishAt": _parse_rss_date(e.get("published", "") or e.get("updated", "")),
        "source":    source,
        "category":  category_label,
    }

# ── 共用：24h 過濾 + 48h fallback ──────────────────────────────
def _pick_window(items, to_item, get_ts, limit, hours, min_keep, label):
    """先過濾 hours 窗內，若不足 min_keep 放寬到 48h"""
    primary_window = hours * 3600
    fallback_window = WINDOW_48H

    now = int(time.time())
    inside, outside, undated = [], [], []
    for d in items:
        ts = get_ts(d)
        if not ts:
            undated.append(d)
            continue
        gap = now - ts
        if gap <= primary_window:
            inside.append(d)
        elif gap <= fallback_window:
            outside.append(d)

    picked = inside[:limit]
    if len(picked) < min_keep:
        need = min_keep - len(picked)
        extra = outside[:need]
        if extra:
            print(f"  ⚠️  {label}: 24h 內僅 {len(picked)} 筆，放寬至 48h 補 {len(extra)} 筆")
        picked = picked + extra

    print(f"  ✅ {label}: 取 {len(picked)}/{len(items)} 筆（24h 內 {len(inside)}，48h 內備援 {len(outside)}，未標時間 {len(undated)}）")
    return [to_item(d) for d in picked]

# ── 統合：依 profile 抓全部來源 ───────────────────────────────
def fetch_market_news(profile):
    """profile = "premarket" | "postmarket"
    回傳分組 dict：{"market": [...], "stock": [...], "intl": [...]}
    """
    out = {"market": [], "stock": [], "intl": []}

    if profile == "premarket":
        # 大盤/總經
        out["market"] += fetch_cnyes("headline",  limit=3, category_label="market")
        out["market"] += fetch_cnyes("tw_market", limit=2, category_label="market")
        out["market"] += fetch_cnyes("etf",       limit=2, category_label="market")
        out["market"] += fetch_udn_money("headline", limit=3, category_label="market")
        # 權值個股
        out["stock"]  += fetch_cnyes("tw_stock",  limit=2, category_label="stock")
        # 國際
        out["intl"]   += fetch_cnyes("wd_stock",  limit=2, category_label="intl")
        out["intl"]   += fetch_udn_money("intl",  limit=2, category_label="intl")
        out["intl"]   += fetch_cnbc_world_business(limit=3)

    elif profile == "postmarket":
        # 大盤
        out["market"] += fetch_cnyes("headline",  limit=3, category_label="market")
        out["market"] += fetch_cnyes("tw_market", limit=3, category_label="market")
        out["market"] += fetch_udn_money("headline",  limit=3, category_label="market")
        out["market"] += fetch_udn_money("tw_market", limit=3, category_label="market")
        # 權值個股
        out["stock"]  += fetch_cnyes("tw_stock",  limit=2, category_label="stock")

    else:
        raise ValueError(f"unknown profile: {profile}")

    # 同 URL 去重
    seen = set()
    for k in out:
        deduped = []
        for it in out[k]:
            u = it.get("url", "")
            if u and u in seen:
                continue
            seen.add(u)
            deduped.append(it)
        out[k] = deduped

    total = sum(len(v) for v in out.values())
    print(f"  📰 新聞總計：大盤 {len(out['market'])} / 權值股 {len(out['stock'])} / 國際 {len(out['intl'])} = {total} 篇")
    return out

# ── prompt 段落格式化 ───────────────────────────────────────
def format_news_block(grouped):
    """把分組新聞渲染成 Gemini prompt 用的純文字段落"""
    lines = ["【市場新聞（過去 24 小時）】", ""]
    sections = [
        ("market", "— 大盤/總經 —"),
        ("stock",  "— 權值個股動向 —"),
        ("intl",   "— 國際 —"),
    ]
    for key, header in sections:
        items = grouped.get(key, [])
        if not items:
            continue
        lines.append(header)
        for it in items:
            src   = it.get("source", "")
            title = it.get("title", "")
            snip  = it.get("content", "")[:200]
            lines.append(f"[{src}] {title}")
            if snip:
                lines.append(f"  摘要：{snip}")
        lines.append("")
    return "\n".join(lines).strip() or "（無）"

def top_news_links(grouped, n=5):
    """挑出最即時的 N 條（依 publishAt desc）給 Telegram 訊息附連結用"""
    all_items = []
    for items in grouped.values():
        all_items.extend(items)
    all_items.sort(key=lambda x: x.get("publishAt") or 0, reverse=True)
    return all_items[:n]
