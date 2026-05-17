// ============================================================
// strategy/klineApi.js — Strategy 模組的 K 線資料抓取邏輯
// 抽自 Strategy.jsx，方便 KChart / MonitorTab / BacktestTab 共用。
// 架構：瀏覽器 → /api/kline-tw|us（Vercel proxy）→ Render(yfinance)
//       中間先查 Supabase 快取，失敗時走保底快取
// ============================================================

import { supabase } from "../supabase";

// ─── 資料抓取（先查 Supabase 快取，沒有才打 Render）────────
// 查詢邏輯：找「今天已快取、且 days >= 所需 bucket」的最小一筆
// 例：已快取 3650 天，用戶改查 730 天 → 直接回傳 3650 天資料，再由 filterByDays 精準切
export async function getKlineFromCache(cacheKey, days) {
  try {
    // 接受「今天或昨天 UTC」的快取：
    // 預載在台灣 06:00（UTC 前一天 22:00）存入，用戶白天使用時 UTC 已是隔天
    // 接受昨天快取確保 24 小時內都能命中，不受 UTC 日期邊界影響
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const todayStr = now.toISOString().slice(0, 10);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const { data } = await supabase
      .from("kline_cache")
      .select("data, days, cached_date")
      .eq("ticker", cacheKey)
      .in("cached_date", [todayStr, yesterdayStr])  // 今天或昨天都算有效
      .gte("days", days)
      .order("cached_date", { ascending: false })   // 優先用較新的
      .order("days", { ascending: true })
      .limit(1);
    if (data?.[0]?.data) {
      const parsed = JSON.parse(data[0].data);
      // ── 內容新鮮度驗證：最後K棒超過3天視為陳舊資料，強制重抓 ──
      // 3天門檻 = 涵蓋週末（最長空窗：週五收盤到週一查詢 = 3天）
      // 超過3天代表不是正常週末，是真的資料問題（yfinance 寫入延遲等）
      if (parsed?.length > 0) {
        const lastBarDate = new Date(parsed[parsed.length - 1].date + 'T00:00:00Z');
        const daysSinceLastBar = Math.floor((Date.now() - lastBarDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceLastBar > 3) {
          console.warn(`[cache stale content] ${cacheKey}: last bar=${parsed[parsed.length-1].date} (${daysSinceLastBar}d ago) → reject, force refetch`);
          return null;
        }
      }
      console.log(`[cache hit] ${cacheKey} date=${data[0].cached_date} cached=${data[0].days}d needed=${days}d`);
      return parsed;
    }
  } catch {}
  return null;
}

// ─── 保底快取查詢：不限 cached_date（Render 失敗時防止空圖表）────────────
// 只在 fetchFromProxy 失敗後呼叫，寧可顯示稍舊的資料也不顯示空圖表
export async function getKlineFromCacheStale(cacheKey, days) {
  try {
    const { data } = await supabase
      .from("kline_cache")
      .select("data, days, cached_date")
      .eq("ticker", cacheKey)
      .gte("days", days)
      .order("cached_date", { ascending: false })
      .order("days", { ascending: true })
      .limit(1);
    if (data?.[0]?.data) {
      console.warn(`[stale fallback] ${cacheKey} cached_date=${data[0].cached_date} (Render 失敗保底)`);
      return JSON.parse(data[0].data);
    }
  } catch {}
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Days Bucket：把天數對應到最近的 cache bucket ────────────
// 相同 bucket 內的不同天數共用同一份快取，只需抓一次
// e.g. 4900/5000/5100 → 全部對應 5200，抓過一次後都秒出
// Bucket 涵蓋 1 天～全部可用歷史（9999 = 抓所有 yfinance 有的資料）
const DAY_BUCKETS = [365, 730, 1095, 1460, 2190, 2920, 3650, 5200, 7300, 9999];
export function bucketDays(days) {
  return DAY_BUCKETS.find(b => b >= days) ?? 9999;
}

// ─── K 線資料抓取（走 Vercel proxy，避免瀏覽器 CORS 問題）───────────────
// 架構：瀏覽器 → /api/kline-tw|us（Vercel, 同源）→ Render（server-to-server）
// Vercel Edge Function 有 30s 硬上限，Render 冷啟動超過時會回 504
// 504 表示「請求已送達並喚醒 Render，但超時」→ 等 5 秒再打一次就能成功
async function fetchFromProxy(proxyUrl) {
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
  const json = await res.json();
  return json.data || [];
}

// 按日期過濾資料，保留最近 N 個日曆天（回測精準用實際日期判斷）
function filterByDays(data, days) {
  if (!data?.length) return data || [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const y = cutoff.getFullYear();
  const m = String(cutoff.getMonth() + 1).padStart(2, '0');
  const d = String(cutoff.getDate()).padStart(2, '0');
  const cutoffStr = `${y}-${m}-${d}`;
  return data.filter(d => d.date >= cutoffStr);
}

// 從 FinMind 補台股缺漏的 OHLCV（afterDate 的隔天到 upToDate）
// 用於快取少了昨天或更多天時，一次撈回所有缺漏 K 棒（最多 3 天 gap 防止過度請求）
async function fetchMissingTWCandles(ticker, afterDate, upToDate) {
  try {
    const after = new Date(afterDate + 'T00:00:00Z');
    after.setUTCDate(after.getUTCDate() + 1);
    const start = after.toISOString().slice(0, 10);
    if (start > upToDate) return [];
    const url = `/api/finmind-price?dataset=TaiwanStockPrice&data_id=${encodeURIComponent(ticker)}&start=${start}&end=${upToDate}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    if (!json.data?.length) return [];
    return json.data
      .filter(d => d.close)
      .map(d => ({ date: d.date, open: d.open, high: d.max, low: d.min, close: d.close }));
  } catch(e) {
    return [];
  }
}

export async function fetchTWKline(ticker, days=720, bypassCache=false) {
  const bd = bucketDays(days);           // 用大 bucket 查快取（命中率高）
  const cacheKey = `${ticker.toUpperCase()}_TW`;
  const cached = bypassCache ? null : await getKlineFromCache(cacheKey, bd);

  let result;
  if (cached) {
    result = filterByDays(cached, days); // 命中後精準切出所需天數
  } else {
    try {
      const data = await fetchFromProxy(`/api/kline-tw?ticker=${encodeURIComponent(ticker)}&days=${bd}`);
      result = filterByDays(data, days);
    } catch(e) {
      console.error(`[fetchTWKline] Render 失敗，嘗試保底快取:`, e);
      // Render 冷啟動超時時：用任意日期的舊快取顯示圖表，避免空圖/破圖
      const stale = await getKlineFromCacheStale(cacheKey, bd);
      if (stale) return filterByDays(stale, days);
      return [];
    }
  }

  // ── 補缺漏 K 棒（快取或 Render 可能因 yfinance end exclusive 少了近期幾天）──
  // fetchMissingTWCandles 從 FinMind 一次補齊 lastDate 到今天之間所有缺漏日期
  const todayUTC = new Date().toISOString().slice(0, 10);
  const lastDate = result.length > 0 ? result[result.length - 1].date : null;
  if (lastDate && lastDate < todayUTC) {
    const missing = await fetchMissingTWCandles(ticker, lastDate, todayUTC);
    if (missing.length > 0) {
      const existing = new Set(result.map(d => d.date));
      const toAdd = missing.filter(d => !existing.has(d.date));
      if (toAdd.length > 0) result = [...result, ...toAdd];
    }
  }

  return result;
}

export async function fetchUSKline(ticker, days=720, bypassCache=false) {
  const bd = bucketDays(days);
  const cached = bypassCache ? null : await getKlineFromCache(ticker.toUpperCase(), bd);
  if (cached) return filterByDays(cached, days);

  try {
    const data = await fetchFromProxy(`/api/kline-us?ticker=${encodeURIComponent(ticker)}&days=${bd}`);
    return filterByDays(data, days);
  } catch(e) {
    console.error(`[fetchUSKline] Render 失敗，嘗試保底快取:`, e);
    // Render 冷啟動超時時：用任意日期的舊快取顯示圖表，避免空圖/破圖
    const stale = await getKlineFromCacheStale(ticker.toUpperCase(), bd);
    if (stale) return filterByDays(stale, days);
    return [];
  }
}

// ─── Trigger-and-Poll：當 proxy 失敗時，輪詢 Supabase 等待 Render 寫入快取 ──
// bucketedDays: 查 Supabase 用的 key（bucket 值）
// actualDays:   回傳給回測的精準天數（按日期過濾）
export async function pollKlineCache(cacheKey, bucketedDays, actualDays, onProgress) {
  const maxMs = 180000;
  const intervalMs = 5000;
  const start = Date.now();

  while (Date.now() - start < maxMs) {
    await sleep(intervalMs);
    const elapsed = Math.round((Date.now() - start) / 1000);
    onProgress(`⏳ 等待 Render 準備資料... ${elapsed}s / ${Math.round(maxMs/1000)}s`);

    const cached = await getKlineFromCache(cacheKey, bucketedDays);
    if (cached) {
      console.log(`[poll success] ${cacheKey} 在 ${elapsed}s 後寫入快取`);
      return filterByDays(cached, actualDays); // 精準切出所需天數
    }
  }

  console.warn(`[poll timeout] ${cacheKey} ${Math.round(maxMs/1000)} 秒內未取得資料`);
  return null;
}
