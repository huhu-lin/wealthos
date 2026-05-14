import { useState, useEffect, useRef } from "react";

// ─── RWD Hook：監聽視窗寬度，回傳數字供各元件判斷 breakpoint ──
function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}
import { createChart } from "lightweight-charts";
import { supabase } from "./supabase";

const C = {
  bg:"#080C14", surface:"#0F1623", surface2:"#162030",
  border:"#1C2E45", accent:"#00C896", accentDim:"#00C89618",
  red:"#FF4D6D", redDim:"#FF4D6D18", gold:"#F5A623",
  blue:"#4D9EFF", orange:"#FF8C42",
  text:"#E2EAF4", textMuted:"#5A7399",
};

const fmt = (n, d=0) => Math.abs(n).toLocaleString("zh-TW", {maximumFractionDigits:d});

function Card({children, style={}}) {
  return <div style={{background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, ...style}}>{children}</div>;
}

function Badge({text, color=C.accent}) {
  return <span style={{background:color+"20", color, border:`1px solid ${color}40`, borderRadius:5, padding:"2px 8px", fontSize:11, fontWeight:600}}>{text}</span>;
}

function Btn({children, onClick, color=C.accent, style={}}) {
  return (
    <button onClick={onClick} style={{
      background:color+"18", color, border:`1px solid ${color}40`,
      borderRadius:8, padding:"7px 14px", fontSize:12, fontWeight:600,
      cursor:"pointer", ...style
    }}>{children}</button>
  );
}

function Input({value, onChange, placeholder, style={}, type="text"}) {
  return (
    <input
      type={type} value={value} onChange={onChange} placeholder={placeholder}
      style={{
        background:C.surface2, border:`1px solid ${C.border}`, color:C.text,
        borderRadius:8, padding:"7px 10px", fontSize:12, outline:"none", ...style
      }}
    />
  );
}

// ─── 資料抓取（先查 Supabase 快取，沒有才打 Render）────────
// 查詢邏輯：找「今天已快取、且 days >= 所需 bucket」的最小一筆
// 例：已快取 3650 天，用戶改查 730 天 → 直接回傳 3650 天資料，再由 filterByDays 精準切
async function getKlineFromCache(cacheKey, days) {
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
async function getKlineFromCacheStale(cacheKey, days) {
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
function bucketDays(days) {
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

async function fetchTWKline(ticker, days=720, bypassCache=false) {
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

async function fetchUSKline(ticker, days=720, bypassCache=false) {
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
async function pollKlineCache(cacheKey, bucketedDays, actualDays, onProgress) {
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

// ─── 指標計算 ────────────────────────────────────────────────
function calcBB(closes, period=20, mult=2) {
  return closes.map((_, i) => {
    if (i < period-1) return null;
    const slice = closes.slice(i-period+1, i+1);
    const mean = slice.reduce((a,b)=>a+b,0)/period;
    const std = Math.sqrt(slice.reduce((a,b)=>a+(b-mean)**2,0)/period);
    return { upper: mean+mult*std, lower: mean-mult*std, basis: mean };
  });
}

// ✅ 修復版：RSV 使用實際 K 線 High/Low，非收盤價序列極值
// 舊版用 closes.slice() 的 max/min 會壓縮波動幅度，導致 RSV 偏低、J 值訊號偏差
function calcKDJ(closes, highs, lows, period=9) {
  let k = 50, d = 50;
  return closes.map((_, i) => {
    if (i < period-1) return null;
    const high = Math.max(...highs.slice(i-period+1, i+1));
    const low  = Math.min(...lows.slice(i-period+1, i+1));
    const rsv = high===low ? 50 : (closes[i]-low)/(high-low)*100;
    k = k*2/3 + rsv/3;
    d = d*2/3 + k/3;
    return { k, d, j: 3*k - 2*d };
  });
}

function checkSignals(closes, bb, kdj, jEntry=10, jExit=90, strategyMode='signal') {
  const signals = [];
  let jBelowFlag = false, jAboveFlag = false;
  for (let i = 1; i < closes.length; i++) {
    if (!bb[i] || !kdj[i] || !bb[i-1] || !kdj[i-1]) continue;
    if (closes[i-1] < bb[i-1].lower && kdj[i-1].j < jEntry) jBelowFlag = true;
    // P002 非對稱：賣出靠偏移閾值，不靠 KDJ，跳過 jAboveFlag
    if (strategyMode !== 'asymmetric' && closes[i-1] > bb[i-1].upper && kdj[i-1].j > jExit) jAboveFlag = true;
    if (jBelowFlag && kdj[i].j > jEntry) { signals.push({ index:i, type:'BUY' }); jBelowFlag = false; }
    if (jAboveFlag && kdj[i].j < jExit) { signals.push({ index:i, type:'SELL' }); jAboveFlag = false; }
  }
  return signals;
}

// ─── 監控策略績效模擬 ─────────────────────────────────────────
// 從進場日起，模擬嚴格執行策略的績效，用來與實際庫存比較
// 幣別說明：amount 跟 closes 都是同一幣別（美股=USD，台股=TWD），不需匯率轉換
function calcMonitorPerformance(klineData, { amount, target, j_entry, j_exit, strategy_mode, gate_pct, entry_date }) {
  if (!amount || !entry_date || !klineData?.length) return null;
  const data = klineData.filter(d => d.date >= entry_date);
  if (data.length < 20) return null; // 資料不足（< 20根K棒），無法穩定計算指標

  const closes = data.map(d => d.close);
  const highs  = data.map(d => d.high  || d.close);
  const lows   = data.map(d => d.low   || d.close);

  const bb      = calcBB(closes);
  const kdj     = calcKDJ(closes, highs, lows);
  const signals = checkSignals(closes, bb, kdj, j_entry, j_exit, strategy_mode);
  const buySigs  = new Set(signals.filter(s => s.type === 'BUY').map(s => s.index));
  const sellSigs = new Set(signals.filter(s => s.type === 'SELL').map(s => s.index));

  // 初始組合：target 比例買入 ETF，其餘為現金
  let cash   = amount * (1 - target);
  let shares = (amount * target) / closes[0];
  let rebalCount = 0;
  const rebalEvents = []; // 記錄每次再平衡的日期與方向，供圖表標記用
  const ASYM_DRIFT = 0.25; // P-002 非對稱賣出偏移閾值（與 BacktestTab 一致）

  for (let i = 1; i < closes.length; i++) {
    const total     = shares * closes[i] + cash;
    const actualPct = (shares * closes[i]) / total; // 0~1

    let shouldRebal = false;

    if (strategy_mode === 'signal') {
      if (buySigs.has(i) || sellSigs.has(i)) shouldRebal = true;
    } else if (strategy_mode === 'asymmetric') {
      // P-002：KDJ 訊號買入，持倉偏移 ≥ 25% 賣出
      if (buySigs.has(i)) shouldRebal = true;
      else if (Math.abs(actualPct - target) >= ASYM_DRIFT) shouldRebal = true;
    } else if (strategy_mode === 'p007') {
      // P-007：訊號 AND 偏離同時達標
      if (buySigs.has(i)  && actualPct * 100 < target * 100 - gate_pct) shouldRebal = true;
      if (sellSigs.has(i) && actualPct * 100 > target * 100 + gate_pct) shouldRebal = true;
    }

    if (shouldRebal) {
      const rebalType = actualPct < target ? 'BUY' : 'SELL'; // 買不足 → 買入，超標 → 賣出
      rebalEvents.push({ date: data[i].date, type: rebalType });
      const t = shares * closes[i] + cash;
      shares = (t * target) / closes[i];
      cash   = t * (1 - target);
      rebalCount++;
    }
  }

  const lastClose = closes[closes.length - 1];
  const simValue  = shares * lastClose + cash;
  const simReturn = (simValue - amount) / amount * 100;

  // 買進持有對比（全額投入，不留現金，公平比較）
  const bhShares = amount / closes[0];
  const bhValue  = bhShares * lastClose;
  const bhReturn = (bhValue  - amount) / amount * 100;

  return { simValue, simReturn, bhValue, bhReturn, rebalCount, rebalEvents };
}

// ─── 圖表元件 ────────────────────────────────────────────────
function KChart({ data, ticker, isUS, assets, target=0.5, jEntry=10, jExit=90, strategyMode='signal', driftPct=25, gatePct=13, tickerConfig=null }) {
  const chartRef = useRef(null);
  const kdjRef = useRef(null);
  const chartInstance = useRef(null);
  const kdjInstance = useRef(null);
  const winWidth = useWindowWidth();
  const isMobile = winWidth <= 480;
  const chartH = isMobile ? 220 : 320;
  const kdjH   = isMobile ? 120 : 160;

  useEffect(() => {
    if (!data.length || !chartRef.current || !kdjRef.current) return;
    if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; }
    if (kdjInstance.current) { kdjInstance.current.remove(); kdjInstance.current = null; }

    const closes = data.map(d => d.close);
    const highs  = data.map(d => d.high);
    const lows   = data.map(d => d.low);
    const bb = calcBB(closes);
    const kdj = calcKDJ(closes, highs, lows);
    const signals = checkSignals(closes, bb, kdj, jEntry, jExit, strategyMode);

    const chartOpts = {
      layout: { background: { color: C.surface2 }, textColor: C.textMuted },
      grid: { vertLines: { color: C.border }, horzLines: { color: C.border } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: C.border },
      timeScale: { borderColor: C.border, timeVisible: true },
      width: chartRef.current.clientWidth,
      height: chartH,
    };

    const chart = createChart(chartRef.current, chartOpts);
    chartInstance.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: C.accent, downColor: C.red,
      borderUpColor: C.accent, borderDownColor: C.red,
      wickUpColor: C.accent, wickDownColor: C.red,
    });
    candleSeries.setData(data.map(d => ({ time:d.date, open:d.open, high:d.high, low:d.low, close:d.close })));

    const upperSeries = chart.addLineSeries({ color: C.orange, lineWidth:1, lineStyle:2, title:'上軌' });
    const lowerSeries = chart.addLineSeries({ color: C.orange, lineWidth:1, lineStyle:2, title:'下軌' });
    const basisSeries = chart.addLineSeries({ color: C.gold,   lineWidth:1, lineStyle:0, title:'MA20' });
    upperSeries.setData(data.map((d,i) => bb[i] ? { time:d.date, value:bb[i].upper } : null).filter(Boolean));
    lowerSeries.setData(data.map((d,i) => bb[i] ? { time:d.date, value:bb[i].lower } : null).filter(Boolean));
    basisSeries.setData(data.map((d,i) => bb[i] ? { time:d.date, value:bb[i].basis } : null).filter(Boolean));

    // P-007：箭頭標記只是基礎 KDJ+布林訊號，不代表已達雙重確認條件
    const isP007 = strategyMode === 'p007';
    let allMarkers = signals.map(s => ({
      time: data[s.index].date,
      position: s.type==='BUY' ? 'belowBar' : 'aboveBar',
      color: s.type==='BUY' ? C.accent : C.red,
      shape: s.type==='BUY' ? 'arrowUp' : 'arrowDown',
      text: isP007
        ? (s.type==='BUY' ? '訊號↑' : '訊號↓')
        : (s.type==='BUY' ? '再平衡↑' : '再平衡↓'),
    }));

    // ── 進場日後的再平衡執行標記（金色圓圈，與訊號箭頭區分）──
    // 有填入進場日期 + 進場金額時，從 calcMonitorPerformance 取回每次實際執行的再平衡日期
    // P-007：訊號箭頭 ≠ 執行點（雙重確認才執行），金圈能清楚標示哪幾次真的打了
    // 其他模式：金圈與訊號箭頭重疊，強化視覺確認「這根K棒確實執行了再平衡」
    if (tickerConfig?.entry_date && tickerConfig?.amount) {
      const execPerf = calcMonitorPerformance(data, {
        amount:        tickerConfig.amount,
        target:        tickerConfig.target        ?? target,
        j_entry:       tickerConfig.j_entry       ?? jEntry,
        j_exit:        tickerConfig.j_exit         ?? jExit,
        strategy_mode: tickerConfig.strategy_mode ?? strategyMode,
        gate_pct:      tickerConfig.gate_pct       ?? gatePct,
        entry_date:    tickerConfig.entry_date,
      });
      if (execPerf?.rebalEvents?.length) {
        const execMarkers = execPerf.rebalEvents.map(e => ({
          time:     e.date,
          position: e.type === 'BUY' ? 'belowBar' : 'aboveBar',
          color:    '#FFD700',
          shape:    'circle',
          text:     e.type === 'BUY' ? '✓買' : '✓賣',
        }));
        allMarkers = [...allMarkers, ...execMarkers];
      }
    }

    // lightweight-charts 要求 markers 按時間升序排列
    allMarkers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    candleSeries.setMarkers(allMarkers);

    const kdjChart = createChart(kdjRef.current, { ...chartOpts, height:kdjH, timeScale:{ visible:false } });
    kdjInstance.current = kdjChart;

    const kS = kdjChart.addLineSeries({ color:C.blue,   lineWidth:1, title:'K' });
    const dS = kdjChart.addLineSeries({ color:C.gold,   lineWidth:1, title:'D' });
    const jS = kdjChart.addLineSeries({ color:C.accent, lineWidth:1, title:'J' });
    kS.setData(data.map((d,i) => kdj[i] ? { time:d.date, value:kdj[i].k } : null).filter(Boolean));
    dS.setData(data.map((d,i) => kdj[i] ? { time:d.date, value:kdj[i].d } : null).filter(Boolean));
    jS.setData(data.map((d,i) => kdj[i] ? { time:d.date, value:kdj[i].j } : null).filter(Boolean));

    const ob = kdjChart.addLineSeries({ color:C.red+"90",    lineWidth:1, lineStyle:2 });
    const os = kdjChart.addLineSeries({ color:C.accent+"90", lineWidth:1, lineStyle:2 });
    ob.setData(data.map(d => ({ time:d.date, value:jExit })));
    os.setData(data.map(d => ({ time:d.date, value:jEntry })));

    chart.timeScale().subscribeVisibleLogicalRangeChange(r => { if(r) kdjChart.timeScale().setVisibleLogicalRange(r); });
    kdjChart.timeScale().subscribeVisibleLogicalRangeChange(r => { if(r) chart.timeScale().setVisibleLogicalRange(r); });
    chart.timeScale().fitContent();
    kdjChart.timeScale().fitContent();

    return () => {
      if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; }
      if (kdjInstance.current) { kdjInstance.current.remove(); kdjInstance.current = null; }
    };
  // winWidth 變化時重建圖表以套用新高度；tickerConfig 變化時重繪再平衡執行標記
  }, [data, jEntry, jExit, chartH, kdjH, tickerConfig]);

  const closes = data.map(d => d.close);
  const highs  = data.map(d => d.high);
  const lows   = data.map(d => d.low);
  const bb = calcBB(closes);
  const kdj = calcKDJ(closes, highs, lows);
  const lastBB = bb[bb.length-1];
  const lastKDJ = kdj[kdj.length-1];
  const lastClose = closes[closes.length-1];

  // ── 兩步驟訊號集合（用於 P-007 signalActive 判斷，對齊 checkSignals 邏輯）
  const _signals  = checkSignals(closes, bb, kdj, jEntry, jExit, strategyMode);
  const _buySigs  = new Set(_signals.filter(s => s.type === 'BUY').map(s => s.index));
  const _sellSigs = new Set(_signals.filter(s => s.type === 'SELL').map(s => s.index));
  const _lastIdx  = closes.length - 1;

  let status = '正常', statusColor = C.textMuted;
  if (lastBB && lastKDJ) {
    if (lastClose < lastBB.lower && lastKDJ.j < jEntry) { status='蓄力中 ⚡'; statusColor=C.accent; }
    else if (strategyMode !== 'asymmetric' && lastClose > lastBB.upper && lastKDJ.j > jExit) { status='過熱中 🔥'; statusColor=C.red; }
    else if (lastKDJ.j < jEntry) { status='J值低位'; statusColor=C.blue; }
    else if (lastKDJ.j > jExit) { status='J值高位'; statusColor=C.gold; }
  }

  const cashName = isUS ? 'USD' : '現金';
  const holdingAsset = assets.find(a => a.name === ticker);
  const cashAsset = assets.find(a => a.name === cashName);
  const holdingValue = holdingAsset?.value_twd || 0;
  const cashValue = cashAsset?.value_twd || 0;
  const total = holdingValue + cashValue;
  const actualPct = total > 0 ? holdingValue / total * 100 : 0;
  const targetPct = target * 100;
  const diffAmt = Math.round(total * target - holdingValue);

  return (
    <Card style={{padding:isMobile?12:16, marginBottom:14}}>
      <div className="wos-kchart-header" style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12}}>
        <div className="wos-kchart-badges" style={{display:"flex", gap:8, alignItems:"center", flexWrap:"wrap"}}>
          <span style={{fontWeight:700, fontSize:isMobile?14:16}}>{ticker}</span>
          {lastClose>0 && <span style={{color:C.textMuted, fontSize:13}}>{isUS?'$':'NT$'}{lastClose?.toFixed(2)}</span>}
          <Badge text={status} color={statusColor}/>
          <Badge text="還原股價" color={C.blue}/>
          {strategyMode === 'asymmetric' && <Badge text="⚡ P-002 非對稱" color={C.orange}/>}
          {strategyMode === 'p007' && <Badge text="🔒 P-007 雙重確認" color="#FFD700"/>}
        </div>
        {lastKDJ && <span style={{color:C.textMuted, fontSize:12, whiteSpace:"nowrap"}}>J值 <span style={{color:lastKDJ.j>jExit?C.red:lastKDJ.j<jEntry?C.accent:C.textMuted, fontWeight:600}}>{lastKDJ.j.toFixed(1)}</span></span>}
      </div>
      {strategyMode === 'p007' && (
        <div style={{fontSize:11, color:C.textMuted, marginBottom:8, paddingLeft:2}}>
          圖表箭頭（訊號↑↓）為 KDJ+布林訊號，僅供參考｜P-007 邏輯：偏離 ≥ {gatePct}% 為「待觸發」狀態，此時訊號出現才執行再平衡；偏離不足時訊號無效
        </div>
      )}
      {total > 0 && (() => {
        const driftNow = Math.abs(actualPct - targetPct);

        // ── P-007 雙重確認：訊號 + 偏離同時達標才觸發 ──
        if (strategyMode === 'p007') {
          const signalActive = _buySigs.has(_lastIdx) || _sellSigs.has(_lastIdx);
          const driftMet = driftNow >= gatePct;
          const bothMet  = signalActive && driftMet;
          const borderCol = bothMet ? C.accent+"60" : (signalActive || driftMet) ? "#FFD70060" : C.border;
          const gapDrift  = Math.max(0, gatePct - driftNow);
          return (
            <div style={{display:"flex", gap:12, flexWrap:"wrap", marginBottom:12, padding:"10px 14px", background:C.surface, borderRadius:8, border:`1px solid ${borderCol}`, fontSize:12}}>
              <span style={{color:C.textMuted}}>實際佔比 <span style={{color:C.text, fontWeight:600}}>{actualPct.toFixed(1)}%</span></span>
              <span style={{color:C.textMuted}}>目標佔比 <span style={{color:C.text, fontWeight:600}}>{targetPct.toFixed(1)}%</span></span>
              <span style={{color:C.textMuted}}>訊號 <span style={{color:signalActive?C.accent:C.textMuted, fontWeight:600}}>{signalActive?'✅ 成立':'⏳ 等待'}</span></span>
              <span style={{color:C.textMuted}}>偏離 <span style={{color:driftMet?"#FFD700":C.textMuted, fontWeight:600}}>{driftNow.toFixed(1)}%</span> / gate <span style={{fontWeight:600}}>{gatePct}%</span></span>
              {bothMet ? (
                <span style={{color:C.accent, fontWeight:700}}>🎯 P-007 觸發！<span style={{color:diffAmt>0?C.accent:C.red}}>{diffAmt>0?' 買入':' 賣出'} NT${fmt(Math.abs(diffAmt))}</span></span>
              ) : signalActive ? (
                <span style={{color:C.red}}>⚠️ 今日訊號成立，但偏離僅 {driftNow.toFixed(1)}%（未達 gate {gatePct}%），本次訊號失效</span>
              ) : driftMet ? (
                <span style={{color:C.blue}}>📊 偏離達標，等待訊號</span>
              ) : (
                <span style={{color:C.textMuted}}>等雙重確認｜偏離 {driftNow.toFixed(1)}% / gate {gatePct}%</span>
              )}
            </div>
          );
        }

        // ── signal 模式：純 KDJ+布林兩步驟訊號觸發 ──
        if (strategyMode === 'signal') {
          const sigFired = _buySigs.has(_lastIdx) || _sellSigs.has(_lastIdx);
          return (
            <div style={{display:"flex", gap:12, flexWrap:"wrap", marginBottom:12, padding:"10px 14px", background:C.surface, borderRadius:8, border:`1px solid ${sigFired ? C.accent+"60" : C.border}`, fontSize:12}}>
              <span style={{color:C.textMuted}}>實際佔比 <span style={{color:C.text, fontWeight:600}}>{actualPct.toFixed(1)}%</span></span>
              <span style={{color:C.textMuted}}>目標佔比 <span style={{color:C.text, fontWeight:600}}>{targetPct.toFixed(1)}%</span></span>
              <span style={{color:C.textMuted}}>訊號 <span style={{color:sigFired?C.accent:C.textMuted, fontWeight:600}}>{sigFired?'✅ 成立':'⏳ 等待'}</span></span>
              {sigFired
                ? <span style={{color:C.accent, fontWeight:700}}>📈 訊號再平衡！<span style={{color:diffAmt>0?C.accent:C.red}}>{diffAmt>0?' 買入':' 賣出'} NT${fmt(Math.abs(diffAmt))}</span></span>
                : <span style={{color:C.textMuted}}>等待 KDJ+布林兩步驟確認（過閾值→回歸）</span>}
            </div>
          );
        }

        // ── asymmetric（P-002）：買入靠 KDJ 訊號，賣出靠偏移 ──
        if (strategyMode === 'asymmetric') {
          const buySignal  = _buySigs.has(_lastIdx);
          const sellDrift  = driftNow >= driftPct && actualPct > targetPct;
          const doRebal    = buySignal || sellDrift;
          return (
            <div style={{display:"flex", gap:12, flexWrap:"wrap", marginBottom:12, padding:"10px 14px", background:C.surface, borderRadius:8, border:`1px solid ${doRebal ? C.accent+"60" : C.border}`, fontSize:12}}>
              <span style={{color:C.textMuted}}>實際佔比 <span style={{color:C.text, fontWeight:600}}>{actualPct.toFixed(1)}%</span></span>
              <span style={{color:C.textMuted}}>目標佔比 <span style={{color:C.text, fontWeight:600}}>{targetPct.toFixed(1)}%</span></span>
              <span style={{color:C.textMuted}}>買入訊號 <span style={{color:buySignal?C.accent:C.textMuted, fontWeight:600}}>{buySignal?'✅':'⏳'}</span></span>
              <span style={{color:C.textMuted}}>賣出偏離 <span style={{color:sellDrift?"#9B6DFF":C.textMuted, fontWeight:600}}>{driftNow.toFixed(1)}% / {driftPct}%</span></span>
              {doRebal
                ? <span style={{color:C.accent, fontWeight:700}}>⚡ 再平衡！<span style={{color:diffAmt>0?C.accent:C.red}}>{diffAmt>0?' 買入':' 賣出'} NT${fmt(Math.abs(diffAmt))}</span></span>
                : <span style={{color:C.textMuted}}>等觸發條件</span>}
            </div>
          );
        }

        // ── drift 模式（及其他 fallback）：純偏移觸發 ──
        const needsRebal = driftNow >= driftPct;
        const gapToTrigger = driftPct - driftNow;
        return (
          <div style={{display:"flex", gap:16, marginBottom:12, padding:"10px 14px", background:C.surface, borderRadius:8, border:`1px solid ${needsRebal ? C.red+"60" : C.border}`, fontSize:12}}>
            <span style={{color:C.textMuted}}>實際佔比 <span style={{color:C.text, fontWeight:600}}>{actualPct.toFixed(1)}%</span></span>
            <span style={{color:C.textMuted}}>目標佔比 <span style={{color:C.text, fontWeight:600}}>{targetPct.toFixed(1)}%</span></span>
            {needsRebal
              ? <span style={{color:C.textMuted}}>⚡ 建議再平衡<span style={{color:diffAmt>0?C.accent:C.red, fontWeight:700}}>{diffAmt>0?' 買入':' 賣出'} NT${fmt(Math.abs(diffAmt))}</span></span>
              : <span style={{color:C.textMuted}}>偏離 <span style={{fontWeight:600}}>{driftNow.toFixed(1)}%</span>｜距觸發差 <span style={{color:C.gold, fontWeight:600}}>{gapToTrigger.toFixed(1)}%</span>（閾值 {driftPct}%）</span>}
          </div>
        );
      })()}

      {/* ── 策略績效面板：進場金額 + 進場日期填寫後才顯示 ── */}
      {(() => {
        if (!tickerConfig?.amount || !tickerConfig?.entry_date) return null;
        const perf = calcMonitorPerformance(data, {
          amount:        tickerConfig.amount,
          target:        tickerConfig.target || target,
          j_entry:       tickerConfig.j_entry || jEntry,
          j_exit:        tickerConfig.j_exit  || jExit,
          strategy_mode: tickerConfig.strategy_mode || strategyMode,
          gate_pct:      tickerConfig.gate_pct || gatePct,
          entry_date:    tickerConfig.entry_date,
        });
        if (!perf) return (
          <div style={{padding:"10px 14px", background:C.surface, borderRadius:8, border:`1px solid ${C.border}`, fontSize:12, color:C.textMuted, marginBottom:12}}>
            📊 進場日期後資料不足（需至少 20 根K棒），無法計算策略模擬績效
          </div>
        );

        const currSymbol  = isUS ? "USD" : "NT$";
        const fmtVal = v => isUS ? `USD ${v.toLocaleString("en-US",{maximumFractionDigits:0})}` : `NT$${fmt(v)}`;
        const fmtPct = (v, showSign=true) => `${showSign && v>=0?"+":""}${v.toFixed(1)}%`;

        // 實際庫存現值（從 assets 讀，若無則顯示 —）
        const cashName   = isUS ? 'USD' : '現金';
        const holdA      = assets.find(a => a.name === ticker);
        const cashA      = assets.find(a => a.name === cashName);
        const actualNow  = (holdA?.value_twd || 0) + (cashA?.value_twd || 0);
        // 轉換為原始幣別（美股：除以匯率近似值，台股直接用 TWD）
        // 注意：這裡只做粗略換算，用 assets 表的 USD 欄位更精確
        const actualNowNative = isUS
          ? ((holdA?.value_usd || 0) + (cashA?.value_usd || holdA?.value_twd / 32 || 0))
          : actualNow;
        const hasActual = actualNow > 0;
        const actualReturn = hasActual ? (actualNowNative - tickerConfig.amount) / tickerConfig.amount * 100 : null;
        const execGap = (actualReturn !== null) ? (actualReturn - perf.simReturn) : null;

        return (
          <div style={{marginBottom:12, padding:"12px 14px", background:C.surface, borderRadius:8, border:`1px solid ${C.border}40`, fontSize:12}}>
            <div style={{fontWeight:600, color:C.textMuted, marginBottom:8, fontSize:11}}>
              📊 策略績效對比　進場：{tickerConfig.entry_date}　初始：{fmtVal(tickerConfig.amount)}
            </div>
            <div style={{display:"grid", gridTemplateColumns: hasActual ? "1fr 1fr" : "1fr", gap:8}}>
              {/* 策略模擬 */}
              <div style={{background:C.surface2, borderRadius:6, padding:"8px 10px"}}>
                <div style={{color:C.textMuted, fontSize:10, marginBottom:4}}>策略模擬（嚴格執行）</div>
                <div style={{color:C.accent, fontWeight:700, fontSize:14}}>{fmtPct(perf.simReturn)}</div>
                <div style={{color:C.text, fontSize:11}}>{fmtVal(perf.simValue)}</div>
                <div style={{color:C.textMuted, fontSize:10, marginTop:3}}>再平衡 {perf.rebalCount} 次｜圖表金色圓圈標記</div>
              </div>
              {/* 實際庫存（有資產資料才顯示） */}
              {hasActual && (
                <div style={{background:C.surface2, borderRadius:6, padding:"8px 10px", border:`1px solid ${execGap<-5?C.red+"60":execGap>0?C.accent+"60":C.border}`}}>
                  <div style={{color:C.textMuted, fontSize:10, marginBottom:4}}>實際庫存</div>
                  <div style={{color:actualReturn>=0?C.accent:C.red, fontWeight:700, fontSize:14}}>{fmtPct(actualReturn)}</div>
                  <div style={{color:C.text, fontSize:11}}>{fmtVal(actualNowNative)}</div>
                  {execGap !== null && (
                    <div style={{color:execGap<0?C.red:C.accent, fontSize:10, marginTop:3}}>
                      執行落差 {fmtPct(execGap)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <div ref={chartRef} style={{width:"100%", borderRadius:8, overflow:"hidden"}}/>
      <div style={{display:"flex", gap:12, padding:"6px 0", fontSize:11, flexWrap:"wrap"}}>
        {[["K",C.blue],["D",C.gold],["J",C.accent],["超買/超賣",C.red+"90"]].map(([l,c])=>(
          <div key={l} style={{display:"flex", alignItems:"center", gap:4}}>
            <div style={{width:12, height:2, background:c}}/><span style={{color:C.textMuted}}>{l}</span>
          </div>
        ))}
        {tickerConfig?.entry_date && tickerConfig?.amount && (
          <div style={{display:"flex", alignItems:"center", gap:4}}>
            <div style={{width:8, height:8, borderRadius:"50%", background:"#FFD700"}}/><span style={{color:C.textMuted}}>再平衡執行</span>
          </div>
        )}
      </div>
      <div ref={kdjRef} style={{width:"100%", borderRadius:8, overflow:"hidden"}}/>
    </Card>
  );
}

// ─── 策略訊號監控（原 T-3 盤前摘要的持倉/訊號區塊）──────────
// 總經指標 + AI 摘要已移至 Overview 的 MarketBrief 元件
function PreMarketSummary({ tickers, klineMap, allAssets }) {

  if (!tickers.length) return null;

  const today = new Date().toLocaleDateString('zh-TW', { month:'numeric', day:'numeric', weekday:'short' });

  const rows = tickers.map(t => {
    const data = klineMap[t.ticker] || [];
    if (data.length < 21) return null; // 至少需要 20 根才能算 BB

    const closes = data.map(d => d.close);
    const highs  = data.map(d => d.high);
    const lows   = data.map(d => d.low);
    const bb  = calcBB(closes);
    const kdj = calcKDJ(closes, highs, lows);
    // 兩步驟訊號集合（P-007 signalActive 與 signal mode advice 使用）
    const _sigs     = checkSignals(closes, bb, kdj, t.j_entry, t.j_exit, t.strategy_mode || 'signal');
    const _buySigs  = new Set(_sigs.filter(s => s.type === 'BUY').map(s => s.index));
    const _sellSigs = new Set(_sigs.filter(s => s.type === 'SELL').map(s => s.index));
    const _lastIdx  = closes.length - 1;

    const lastBB    = bb[bb.length - 1];
    const lastKDJ   = kdj[kdj.length - 1];
    const lastClose = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];
    const changePct = prevClose > 0 ? (lastClose - prevClose) / prevClose * 100 : 0;

    // ── 訊號狀態 ──
    let signalStatus = '觀察中', signalColor = C.textMuted, advice = '無特殊訊號，正常持倉';
    if (lastBB && lastKDJ) {
      const j = lastKDJ.j;
      if (lastClose < lastBB.lower && j < t.j_entry) {
        signalStatus = '蓄力中 ⚡'; signalColor = C.accent;
        advice = `等待 J 值反彈突破 ${t.j_entry}`;
      } else if ((t.strategy_mode || 'signal') !== 'asymmetric' && lastClose > lastBB.upper && j > t.j_exit) {
        signalStatus = '過熱中 🔥'; signalColor = C.red;
        advice = `等待 J 值回落至 ${t.j_exit}`;
      } else if (j < t.j_entry) {
        signalStatus = 'J值低位'; signalColor = C.blue;
        advice = '已進入超賣區，持續觀察布林下軌';
      } else if (j > t.j_exit) {
        signalStatus = 'J值高位'; signalColor = C.gold;
        advice = '已進入超買區，留意布林上軌';
      }
    }

    // ── P-007 雙重確認：覆蓋 advice 顯示雙條件狀態 ──
    const mode = t.strategy_mode || 'signal';
    if (mode === 'p007') {
      const cashName2 = t.is_us ? 'USD' : '現金';
      const hAsset = allAssets.find(a => a.name === t.ticker);
      const cAsset = allAssets.find(a => a.name === cashName2);
      const hVal = hAsset?.value_twd || 0;
      const cVal = cAsset?.value_twd || 0;
      const tot  = hVal + cVal;
      if (tot > 0) {
        const actPct  = hVal / tot * 100;
        const tgtPct  = t.target * 100;
        const driftAbs = Math.abs(actPct - tgtPct);
        const gPct = t.gate_pct || 13;
        const signalActive = _buySigs.has(_lastIdx) || _sellSigs.has(_lastIdx);
        const driftMet = driftAbs >= gPct;
        if (signalActive && driftMet) {
          signalStatus = '🎯 P-007 觸發'; signalColor = C.accent;
          advice = `🎯 雙重確認！立即再平衡（偏離 ${driftAbs.toFixed(1)}%）`;
        } else if (signalActive) {
          advice = `⚠️ 今日訊號成立，但偏離僅 ${driftAbs.toFixed(1)}%（未達 gate ${gPct}%），本次訊號失效`;
        } else if (driftMet) {
          signalStatus = '偏離達標 📊'; signalColor = C.blue;
          advice = `📊 偏離達標，等待訊號`;
        } else {
          advice = `等雙重確認｜偏離 ${driftAbs.toFixed(1)}% / gate ${gPct}%`;
        }
      }
    }

    // ── 昨日在布林通道的位置 ──
    let bbPos = '—', bbColor = C.textMuted;
    if (lastBB && lastBB.upper !== lastBB.lower) {
      if (lastClose >= lastBB.upper)      { bbPos = '上軌以上'; bbColor = C.red; }
      else if (lastClose <= lastBB.lower) { bbPos = '下軌以下'; bbColor = C.accent; }
      else {
        const pct = Math.round((lastClose - lastBB.lower) / (lastBB.upper - lastBB.lower) * 100);
        bbPos = `通道 ${pct}%`; bbColor = C.textMuted;
      }
    }

    // ── 持倉健康度 ──
    const cashName = t.is_us ? 'USD' : '現金';
    const holdingAsset = allAssets.find(a => a.name === t.ticker);
    const cashAsset    = allAssets.find(a => a.name === cashName);
    const holdingValue = holdingAsset?.value_twd || 0;
    const cashValue    = cashAsset?.value_twd    || 0;
    const total        = holdingValue + cashValue;
    const actualPct    = total > 0 ? holdingValue / total * 100 : 0;
    const targetPct    = t.target * 100;
    const drift        = actualPct - targetPct;
    let healthLabel = '平衡 ✓', healthColor = C.accent;
    if (Math.abs(drift) >= 15)     { healthLabel = `偏移 ${drift > 0 ? '+' : ''}${drift.toFixed(0)}%`; healthColor = C.red; }
    else if (Math.abs(drift) >= 5) { healthLabel = `輕偏 ${drift > 0 ? '+' : ''}${drift.toFixed(0)}%`; healthColor = C.gold; }

    return {
      ticker: t.ticker, isUS: t.is_us,
      lastClose, changePct, lastKDJ,
      signalStatus, signalColor, advice,
      bbPos, bbColor,
      actualPct, targetPct, drift, healthLabel, healthColor,
      hasAlloc: total > 0,
    };
  }).filter(Boolean);

  if (!rows.length) return null;

  return (
    <Card style={{ padding:16, marginBottom:16, border:`1px solid ${C.border}` }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div style={{ fontWeight:700, fontSize:13, color:C.text }}>📡 策略訊號監控</div>
        <div style={{ color:C.textMuted, fontSize:11 }}>{today}</div>
      </div>
      {rows.map(r => (
        <div key={r.ticker} style={{
          background:C.surface2, borderRadius:10, padding:'12px 14px', marginBottom:8,
          border:`1px solid ${C.border}`,
        }}>
          {/* 標題列 */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <span style={{ fontWeight:700, fontSize:14 }}>{r.ticker}</span>
              <span style={{ color:r.isUS ? C.blue : C.accent, fontSize:10, fontWeight:600 }}>
                {r.isUS ? '美股' : '台股'}
              </span>
              <Badge text={r.signalStatus} color={r.signalColor} />
            </div>
            <span style={{ color:r.changePct > 0 ? C.accent : C.red, fontWeight:600, fontSize:13 }}>
              {r.changePct > 0 ? '+' : ''}{r.changePct.toFixed(2)}%
            </span>
          </div>
          {/* 三欄資訊（桌機3欄 / 手機1欄，.wos-grid-signal 控制）*/}
          <div className="wos-grid-signal">
            {/* 昨日表現 */}
            <div style={{ background:C.bg, borderRadius:6, padding:'8px 10px' }}>
              <div style={{ color:C.textMuted, marginBottom:4, fontWeight:600 }}>昨日表現</div>
              <div style={{ color:C.text, fontWeight:600, fontSize:13 }}>
                {r.isUS ? '$' : 'NT$'}{r.lastClose?.toFixed(2)}
              </div>
              <div style={{ color:r.bbColor, fontSize:10, marginTop:3 }}>布林：{r.bbPos}</div>
              {r.lastKDJ && (
                <div style={{ color:C.textMuted, fontSize:10, marginTop:2 }}>
                  J值 <span style={{ color:r.signalColor, fontWeight:600 }}>{r.lastKDJ.j.toFixed(1)}</span>
                </div>
              )}
            </div>
            {/* 今日建議 */}
            <div style={{ background:C.bg, borderRadius:6, padding:'8px 10px' }}>
              <div style={{ color:C.textMuted, marginBottom:4, fontWeight:600 }}>今日建議</div>
              <div style={{ color:r.signalColor, fontWeight:600, lineHeight:1.4 }}>{r.advice}</div>
            </div>
            {/* 持倉健康度 */}
            <div style={{ background:C.bg, borderRadius:6, padding:'8px 10px' }}>
              <div style={{ color:C.textMuted, marginBottom:4, fontWeight:600 }}>持倉健康度</div>
              {r.hasAlloc ? (
                <>
                  <div style={{ color:r.healthColor, fontWeight:600 }}>{r.healthLabel}</div>
                  <div style={{ color:C.textMuted, fontSize:10, marginTop:3 }}>
                    實際 {r.actualPct.toFixed(1)}%　目標 {r.targetPct.toFixed(0)}%
                  </div>
                </>
              ) : (
                <div style={{ color:C.textMuted }}>未連結持倉</div>
              )}
            </div>
          </div>
        </div>
      ))}

    </Card>
  );
}

// ─── 監控 Tab ────────────────────────────────────────────────
// ─── 監控表單 sessionStorage 常數 ───────────────────────────────
// 頁面被瀏覽器回收（Page Discard）後重載，從 sessionStorage 還原填寫中的草稿
// 避免用戶切換視窗核對資料後回來發現表單清空
const MONITOR_FORM_DRAFT_KEY = 'wealthos_monitor_form_draft';
const MONITOR_FORM_DEFAULT = { ticker:"", is_us:false, target:0.5, j_entry:10, j_exit:90, amount:0, entry_date:"", strategy_mode:'signal', gate_pct:13 };

function MonitorTab({ allAssets }) {
  const [tickers, setTickers] = useState([]);
  const [klineMap, setKlineMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingTicker, setLoadingTicker] = useState(""); // 顯示正在抓哪支
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);

  // 初始化時從 sessionStorage 還原草稿（防止切換視窗後資料消失）
  const [form, setForm] = useState(() => {
    try {
      const saved = sessionStorage.getItem(MONITOR_FORM_DRAFT_KEY);
      if (saved) return { ...MONITOR_FORM_DEFAULT, ...JSON.parse(saved) };
    } catch {}
    return MONITOR_FORM_DEFAULT;
  });

  // 更新表單並同步寫入 sessionStorage
  function updateForm(patch) {
    setForm(prev => {
      const next = { ...prev, ...patch };
      try { sessionStorage.setItem(MONITOR_FORM_DRAFT_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // 清除草稿（儲存成功或取消後呼叫）
  function clearFormDraft() {
    try { sessionStorage.removeItem(MONITOR_FORM_DRAFT_KEY); } catch {}
    setForm(MONITOR_FORM_DEFAULT);
  }

  async function loadTickers() {
    const { data } = await supabase.from("strategy_tickers").select("*").order("id");
    setTickers(data||[]);
    return data||[];
  }

  async function loadKlines(list) {
    setLoading(true);
    const map = {};
    // 逐一抓，顯示進度（避免同時打太多 API）
    for (const t of list) {
      setLoadingTicker(t.ticker);
      // 優先用 Supabase 快取（快）；kline-api 已修正 US stale check（D-025）
      // getKlineFromCache 內建內容新鮮度驗證（>5天拒絕）；Render 失敗時走保底快取
      map[t.ticker] = t.is_us
        ? await fetchUSKline(t.ticker, 720)
        : await fetchTWKline(t.ticker, 720);
    }
    setKlineMap(map);
    setLoadingTicker("");
    setLoading(false);
  }

  useEffect(() => {
    loadTickers().then(list => loadKlines(list));
  }, []);

  async function handleSave() {
    if (!form.ticker.trim()) return;
    if (editId) {
      await supabase.from("strategy_tickers").update(form).eq("id", editId);
    } else {
      await supabase.from("strategy_tickers").insert(form);
    }
    setShowAdd(false); setEditId(null);
    clearFormDraft(); // 儲存成功後清除 sessionStorage 草稿
    const list = await loadTickers();
    await loadKlines(list);
  }

  async function handleDelete(id) {
    await supabase.from("strategy_tickers").delete().eq("id", id);
    const list = await loadTickers();
    await loadKlines(list);
  }

  function handleEdit(t) {
    const editForm = { ticker:t.ticker, is_us:t.is_us, target:t.target, j_entry:t.j_entry, j_exit:t.j_exit, amount:t.amount||0, entry_date:t.entry_date||"", strategy_mode:t.strategy_mode||'signal', gate_pct:t.gate_pct||13 };
    setForm(editForm);
    try { sessionStorage.setItem(MONITOR_FORM_DRAFT_KEY, JSON.stringify(editForm)); } catch {}
    setEditId(t.id);
    setShowAdd(true);
  }

  return (
    <div>
      <div className="wos-monitor-header" style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16}}>
        <div>
          <div style={{fontWeight:700, fontSize:15, color:C.text}}>再平衡訊號監控</div>
          <div style={{color:C.textMuted, fontSize:12, marginTop:2}}>布林通道 (20,2) + KDJ (9,3,3)｜還原股價｜箭頭標記為訊號觸發點</div>
        </div>
        <Btn onClick={()=>{
          if (showAdd) { clearFormDraft(); setEditId(null); } // 取消時清除草稿
          setShowAdd(!showAdd);
        }}>
          {showAdd ? "✕ 取消" : "+ 新增股票"}
        </Btn>
      </div>

      {showAdd && (
        <Card style={{padding:16, marginBottom:16}}>
          <div style={{fontWeight:600, fontSize:13, marginBottom:12, color:C.accent}}>{editId?"編輯股票":"新增監控股票"}</div>
          <div className="wos-grid-form">
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>股票代號</div>
              <Input value={form.ticker} onChange={e=>updateForm({ticker:e.target.value.toUpperCase()})} placeholder="如 00675L / QLD" style={{width:"100%"}}/>
            </div>
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>市場</div>
              <select value={form.is_us} onChange={e=>updateForm({is_us:e.target.value==="true"})}
                style={{background:C.surface2, border:`1px solid ${C.border}`, color:C.text, borderRadius:8, padding:"7px 10px", fontSize:12, width:"100%"}}>
                <option value="false">台股</option>
                <option value="true">美股</option>
              </select>
            </div>
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>目標佔比</div>
              <Input type="number" value={form.target} onChange={e=>updateForm({target:parseFloat(e.target.value)})} placeholder="0.5 = 50%" style={{width:"100%"}}/>
            </div>
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>J值進場閾值</div>
              <Input type="number" value={form.j_entry} onChange={e=>updateForm({j_entry:parseFloat(e.target.value)})} style={{width:"100%"}}/>
            </div>
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>J值出場閾值</div>
              <Input type="number" value={form.j_exit} onChange={e=>updateForm({j_exit:parseFloat(e.target.value)})} style={{width:"100%"}}/>
            </div>
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>策略模式</div>
              <select value={form.strategy_mode} onChange={e=>updateForm({strategy_mode:e.target.value})}
                style={{background:C.surface2, border:`1px solid ${C.border}`, color:C.text, borderRadius:8, padding:"7px 10px", fontSize:12, width:"100%"}}>
                <option value="signal">原訊號再平衡（KDJ+布林）</option>
                <option value="asymmetric">⚡ P-002 非對稱（KDJ買+偏移賣）</option>
                <option value="p007">🔒 P-007 雙重確認（訊號＋偏離≥gate）</option>
              </select>
            </div>
            {form.strategy_mode === 'p007' && (
              <div>
                <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>Gate 偏離門檻（%）</div>
                <Input type="number" value={form.gate_pct} onChange={e=>updateForm({gate_pct:parseInt(e.target.value)||13})} style={{width:"100%"}} placeholder="預設 13（美股建議 13，台股建議 20）"/>
              </div>
            )}
            <div>
              {/* 幣別跟著市場走：美股填 USD，台股填 NT$ — 與資產頁面一致 */}
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>
                進場金額 ({form.is_us ? "USD" : "NT$"})
              </div>
              <Input type="number" value={form.amount} onChange={e=>updateForm({amount:parseFloat(e.target.value)||0})} style={{width:"100%"}}
                placeholder={form.is_us ? "如 10000 (USD)" : "如 500000 (NT$)"}/>
            </div>
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>進場日期（策略模擬起算）</div>
              <Input type="date" value={form.entry_date||""} onChange={e=>updateForm({entry_date:e.target.value})} style={{width:"100%", colorScheme:"dark"}}/>
              <div style={{fontSize:10, color:C.textMuted, marginTop:3}}>填入後顯示策略模擬 vs 實際庫存對比</div>
            </div>
          </div>
          <Btn onClick={handleSave}>{editId?"儲存修改":"確認新增"}</Btn>
        </Card>
      )}

      {tickers.length > 0 && (
        <div style={{display:"flex", gap:8, flexWrap:"wrap", marginBottom:16}}>
          {tickers.map(t => (
            <div key={t.id} style={{display:"flex", alignItems:"center", gap:6, background:C.surface2, border:`1px solid ${C.border}`, borderRadius:8, padding:"6px 10px"}}>
              <span style={{fontWeight:600, fontSize:13}}>{t.ticker}</span>
              <span style={{color:C.textMuted, fontSize:11}}>{t.is_us?"美股":"台股"}</span>
              <span style={{color:C.textMuted, fontSize:11}}>J:{t.j_entry}/{t.j_exit}</span>
              {(t.strategy_mode||'signal')==='asymmetric' && <span style={{color:C.orange, fontSize:10, fontWeight:600}}>⚡非對稱</span>}
              {(t.strategy_mode||'signal')==='p007' && <span style={{color:"#FFD700", fontSize:10, fontWeight:600}}>🔒雙重(gate={t.gate_pct||13}%)</span>}
              <button onClick={()=>handleEdit(t)} style={{background:"none", border:"none", color:C.blue, cursor:"pointer", fontSize:11, padding:"0 2px"}}>編輯</button>
              <button onClick={()=>handleDelete(t.id)} style={{background:"none", border:"none", color:C.red, cursor:"pointer", fontSize:11, padding:"0 2px"}}>✕</button>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{textAlign:"center", padding:40, color:C.accent}}>
          <div style={{marginBottom:8}}>抓取還原K線資料中...</div>
          {loadingTicker && <div style={{color:C.textMuted, fontSize:13}}>{loadingTicker} 處理中</div>}
        </div>
      ) : (
        <>
          <PreMarketSummary tickers={tickers} klineMap={klineMap} allAssets={allAssets} />
          {tickers.map(t => (
            <KChart
              key={t.id}
              data={klineMap[t.ticker]||[]}
              ticker={t.ticker}
              isUS={t.is_us}
              assets={allAssets}
              target={t.target}
              jEntry={t.j_entry}
              jExit={t.j_exit}
              strategyMode={t.strategy_mode||'signal'}
              driftPct={25}
              gatePct={t.gate_pct||13}
              tickerConfig={t}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ─── 回測 Tab ────────────────────────────────────────────────
function BacktestTab() {
  const winWidth = useWindowWidth();
  const isMobile = winWidth <= 480;

  const MAX_COMBOS = 4;
  const COMBO_LABELS = ["A","B","C","D"];
  // 每個組合的線條樣式：A=實粗、B=虛粗、C=實細、D=虛細
  const COMBO_STYLES = [
    { lineWidth:2, lineStyle:0 },
    { lineWidth:2, lineStyle:2 },
    { lineWidth:1, lineStyle:0 },
    { lineWidth:1, lineStyle:2 },
  ];

  const STRATEGY_DEFS = [
    { key:"p007",   label:"🔒 P-007 雙重確認",  color:"#FFD700" },
    { key:"drift",  label:"📊 偏移再平衡",        color:"#9B6DFF" },
    { key:"period", label:"🔄 週期再平衡",        color:C.orange  },
    { key:"signal", label:"📈 訊號再平衡",        color:C.accent  },
    { key:"asym",   label:"↕️ KDJ買＋偏移賣",    color:C.red     },
    { key:"annual", label:"📅 年度再平衡",        color:"#00D9C0" },
  ];

  const DEFAULT_COMBO = {
    ticker:"00675L", is_us:false, amount:1000000, target:0.5,
    j_entry:10, j_exit:90, days:3650, period_days:90, drift_pct:25, gate_pct:13,
  };

  const [combos, setCombos] = useState([{ ...DEFAULT_COMBO }]);
  const [activeCombo, setActiveCombo] = useState(0);
  const [bmTicker, setBmTicker] = useState("006208");
  const [bmIsUS, setBmIsUS] = useState(false);
  const [selectedStrategies, setSelectedStrategies] = useState({
    p007:true, drift:true, period:true, signal:false, asym:false, annual:false,
  });
  const [withCost, setWithCost] = useState(false);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const seriesRefs = useRef({});
  const [visibleLines, setVisibleLines] = useState({});

  // P-003 交易成本（方向感知）
  const BUY_COST  = 0.001425;
  const SELL_COST = 0.004425;

  // simRebalance：接受 cp（combo params），不 close over 全局 params
  function simRebalance(closes, raw, triggerFn, cp, withCostFlag=false) {
    let cash = cp.amount * (1 - cp.target);
    let shares = (cp.amount * cp.target) / closes[0];
    const equity = [{ date:raw[0].date, value:cp.amount }];
    const markers = [];
    for (let i=1; i<closes.length; i++) {
      const totalNow = cash + shares * closes[i];
      if (triggerFn(i, totalNow, shares, closes[i])) {
        const targetVal = totalNow * cp.target;
        const isBuying = targetVal > shares * closes[i];
        const cost = withCostFlag ? (isBuying ? BUY_COST : SELL_COST) : 0;
        const txAmt = Math.abs(targetVal - shares * closes[i]);
        const netTotal = totalNow - txAmt * cost;
        const newTargetVal = netTotal * cp.target;
        shares = newTargetVal / closes[i];
        cash = netTotal - newTargetVal;
        markers.push(raw[i].date);
      }
      equity.push({ date:raw[i].date, value:cash + shares*closes[i] });
    }
    return { equity, markers };
  }

  function calcMaxDrawdown(values) {
    let peak = values[0], maxDD = 0;
    for (const v of values) {
      if (v > peak) peak = v;
      const dd = (peak - v) / peak * 100;
      if (dd > maxDD) maxDD = dd;
    }
    return maxDD;
  }

  function calcAnnualizedStats(equityValues, tradingDays, bmValues = null) {
    if (tradingDays < 2) return { annReturn: 0, annVol: 0, sharpe: 0, winRate: 0 };
    const startVal = equityValues[0];
    const endVal = equityValues[equityValues.length - 1];
    const totalReturn = (endVal - startVal) / startVal;
    const annReturn = Math.pow(1 + totalReturn, 252 / tradingDays) - 1;
    const dailyReturns = [];
    for (let i = 1; i < equityValues.length; i++) {
      dailyReturns.push((equityValues[i] - equityValues[i-1]) / equityValues[i-1]);
    }
    const avgDailyRet = dailyReturns.reduce((a,b)=>a+b,0) / dailyReturns.length;
    const variance = dailyReturns.reduce((a,b)=>a+Math.pow(b-avgDailyRet,2),0) / dailyReturns.length;
    const annVol = Math.sqrt(variance * 252);
    const riskFreeRate = 0.02;
    const sharpe = annVol > 0 ? (annReturn - riskFreeRate) / annVol : 0;
    let winRate;
    if (bmValues && bmValues.length === equityValues.length) {
      winRate = equityValues.filter((v, i) => v > bmValues[i]).length / equityValues.length * 100;
    } else {
      winRate = dailyReturns.filter(r => r > 0).length / dailyReturns.length * 100;
    }
    return { annReturn, annVol, sharpe, winRate };
  }

  async function runBacktest() {
    if (loading) return;
    setLoading(true); setResults(null); setLoadingMsg("抓取資料中...");
    const sel = selectedStrategies;

    // 1. 抓 benchmark（全局，取最長 combo 天數）
    const maxDays = Math.max(...combos.map(c => c.days));
    const bmFetchFn = bmIsUS ? fetchUSKline : fetchTWKline;
    const bmRawInit = bmTicker.trim()
      ? await bmFetchFn(bmTicker, maxDays).catch(() => [])
      : [];

    // 2. 並行抓所有 combo 的行情資料
    const comboRawInits = await Promise.all(
      combos.map(c => {
        const fetchFn = c.is_us ? fetchUSKline : fetchTWKline;
        return fetchFn(c.ticker, c.days).catch(() => []);
      })
    );

    // 3. 逐 combo 計算策略
    const comboResults = [];
    for (let ci = 0; ci < combos.length; ci++) {
      const cp = combos[ci];
      let raw = comboRawInits[ci];

      // 若抓取失敗，進行 poll
      if (!raw.length) {
        const bd = bucketDays(cp.days);
        const cacheKey = cp.is_us ? cp.ticker.toUpperCase() : `${cp.ticker.toUpperCase()}_TW`;
        setLoadingMsg(`⏳ 等待 組合${COMBO_LABELS[ci]}（${cp.ticker}）資料...`);
        raw = await pollKlineCache(cacheKey, bd, cp.days, setLoadingMsg).then(r => r || []);
      }
      if (!raw.length) { comboResults.push(null); continue; }

      // 對齊起始日期（與 benchmark 取較晚者）
      const alignStart = bmRawInit.length
        ? (raw[0].date > bmRawInit[0].date ? raw[0].date : bmRawInit[0].date)
        : raw[0].date;
      const alignedRaw    = raw.filter(d => d.date >= alignStart);
      const alignedBmRaw  = bmRawInit.filter(d => d.date >= alignStart);
      if (!alignedRaw.length) { comboResults.push(null); continue; }

      const closes = alignedRaw.map(d=>d.close);
      const highs  = alignedRaw.map(d=>d.high  || d.close);
      const lows   = alignedRaw.map(d=>d.low   || d.close);
      const bb = calcBB(closes);
      const kdj = calcKDJ(closes, highs, lows);
      const signals = checkSignals(closes, bb, kdj, cp.j_entry, cp.j_exit);
      const buySigs  = new Set(signals.filter(s=>s.type==='BUY').map(s=>s.index));
      const sellSigs = new Set(signals.filter(s=>s.type==='SELL').map(s=>s.index));

      const sr = (fn) => simRebalance(closes, alignedRaw, fn, cp, withCost);
      const signalR = sel.signal ? sr((i) => signals.some(s=>s.index===i)) : null;
      const periodR = sel.period ? sr((i) => i % cp.period_days === 0) : null;
      const driftR  = sel.drift  ? sr((i, total, shares, price) =>
        Math.abs((shares*price)/total*100 - cp.target*100) >= cp.drift_pct) : null;
      const asymR   = sel.asym   ? sr((i, total, shares, price) => {
        if (buySigs.has(i)) return true;
        return Math.abs((shares*price)/total*100 - cp.target*100) >= cp.drift_pct;
      }) : null;
      const annualR = sel.annual ? sr((i) => i % 252 === 0) : null;
      const p007R   = sel.p007   ? sr((i, total, shares, price) => {
        const actualPct = (shares*price)/total*100;
        const targetPct = cp.target*100;
        if (buySigs.has(i)  && actualPct < targetPct - cp.gate_pct) return true;
        if (sellSigs.has(i) && actualPct > targetPct + cp.gate_pct) return true;
        return false;
      }) : null;

      const tradingDays = alignedRaw.length;
      const actualStart = alignedRaw[0].date;
      const actualEnd   = alignedRaw[alignedRaw.length-1].date;

      // benchmark 對齊到此 combo 的起算日（以 combo 的 amount 為基準）
      const bmInitShares = alignedBmRaw.length ? cp.amount / alignedBmRaw[0].close : 0;
      const bmValueByDate = {};
      alignedBmRaw.forEach(d => { bmValueByDate[d.date] = bmInitShares * d.close; });
      function alignBm(equity) {
        if (!alignedBmRaw.length || !equity?.length) return null;
        let last = cp.amount;
        return equity.map(e => {
          if (bmValueByDate[e.date] !== undefined) last = bmValueByDate[e.date];
          return last;
        });
      }

      const calcRet = (r) => r?.equity?.length
        ? (r.equity[r.equity.length-1].value - cp.amount) / cp.amount * 100 : null;
      const calcDD  = (r) => r?.equity?.length
        ? calcMaxDrawdown(r.equity.map(e=>e.value)) : null;

      const signalStats = signalR ? calcAnnualizedStats(signalR.equity.map(e=>e.value), tradingDays, alignBm(signalR.equity)) : null;
      const periodStats = periodR ? calcAnnualizedStats(periodR.equity.map(e=>e.value), tradingDays, alignBm(periodR.equity)) : null;
      const driftStats  = driftR  ? calcAnnualizedStats(driftR.equity.map(e=>e.value),  tradingDays, alignBm(driftR.equity)) : null;
      const asymStats   = asymR   ? calcAnnualizedStats(asymR.equity.map(e=>e.value),   tradingDays, alignBm(asymR.equity)) : null;
      const annualStats = annualR ? calcAnnualizedStats(annualR.equity.map(e=>e.value), tradingDays, alignBm(annualR.equity)) : null;
      const p007Stats   = p007R   ? calcAnnualizedStats(p007R.equity.map(e=>e.value),   tradingDays, alignBm(p007R.equity)) : null;

      // 此 combo 期間的 benchmark 報酬
      const bmReturn = alignedBmRaw.length
        ? (alignedBmRaw[alignedBmRaw.length-1].close - alignedBmRaw[0].close) / alignedBmRaw[0].close * 100
        : null;

      // 找最佳策略（年化報酬最高）
      const stratAnnReturns = [
        { key:'p007',   val: p007Stats?.annReturn   },
        { key:'drift',  val: driftStats?.annReturn  },
        { key:'period', val: periodStats?.annReturn },
        { key:'signal', val: signalStats?.annReturn },
        { key:'asym',   val: asymStats?.annReturn   },
        { key:'annual', val: annualStats?.annReturn },
      ].filter(s => s.val != null);
      const bestKey = stratAnnReturns.length
        ? stratAnnReturns.reduce((a,b) => b.val > a.val ? b : a).key : null;

      comboResults.push({
        label: COMBO_LABELS[ci], comboIdx: ci, params: { ...cp },
        alignedRaw, alignedBmRaw,
        actualStart, actualEnd, tradingDays,
        isDataShort: (cp.days - Math.round(tradingDays * 365 / 252)) > 90,
        signalR, periodR, driftR, asymR, annualR, p007R,
        signalReturn: calcRet(signalR), periodReturn: calcRet(periodR),
        driftReturn:  calcRet(driftR),  asymReturn:   calcRet(asymR),
        annualReturn: calcRet(annualR), p007Return:   calcRet(p007R),
        signalMaxDD: calcDD(signalR),   periodMaxDD: calcDD(periodR),
        driftMaxDD:  calcDD(driftR),    asymMaxDD:   calcDD(asymR),
        annualMaxDD: calcDD(annualR),   p007MaxDD:   calcDD(p007R),
        signalStats, periodStats, driftStats, asymStats, annualStats, p007Stats,
        bmReturn, gate_pct: cp.gate_pct, bestKey,
      });
    }

    const validCombos = comboResults.filter(Boolean);

    // 4. 設定 visibleLines（預設：每個 combo 只顯示最佳策略 + benchmark）
    const newVisible = { bm: true, dd: false };
    for (const cr of validCombos) {
      for (const { key } of STRATEGY_DEFS) {
        newVisible[`${cr.label}_${key}`] = (key === cr.bestKey);
      }
    }
    setVisibleLines(newVisible);

    setResults({ combos: validCombos, selectedStrategies: { ...sel }, withCost });
    setLoadingMsg("");
    setLoading(false);
  }

  // ── 圖表建構 useEffect ────────────────────────────────────
  useEffect(() => {
    if (!results?.combos?.length || !chartRef.current) return;
    if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; }
    seriesRefs.current = {};

    const chart = createChart(chartRef.current, {
      layout: { background:{ color:C.surface2 }, textColor:C.textMuted },
      grid: { vertLines:{ color:C.border }, horzLines:{ color:C.border } },
      rightPriceScale: { borderColor:C.border },
      leftPriceScale: {
        visible: true,
        borderColor: C.border,
        scaleMargins: { top: 0.75, bottom: 0 },
      },
      timeScale: { borderColor:C.border },
      localization: {
        priceFormatter: (price) => {
          if (price >= 10000000) return (price / 10000).toFixed(0) + '萬';
          if (price >= 1000000)  return (price / 10000).toFixed(1) + '萬';
          if (price >= 10000)    return (price / 10000).toFixed(2) + '萬';
          if (price <= 0)        return price.toFixed(1) + '%';
          return price.toFixed(0);
        },
      },
      width: chartRef.current.clientWidth,
      height: isMobile ? 260 : 380,
    });
    chartInstance.current = chart;

    const refs = {};
    const sel = results.selectedStrategies;

    // 每個 combo 的策略線（線條樣式依 comboIdx 區分）
    for (const cr of results.combos) {
      const cs = COMBO_STYLES[cr.comboIdx];
      const addS = (stratKey, stratColor, r) => {
        if (!sel[stratKey] || !r?.equity?.length) return;
        const s = chart.addLineSeries({
          color: stratColor, ...cs,
          title: `${cr.label}-${stratKey}`,
        });
        s.setData(r.equity.map(e=>({ time:e.date, value:e.value })));
        refs[`${cr.label}_${stratKey}`] = s;
      };
      addS('signal', C.accent,  cr.signalR);
      addS('period', C.orange,  cr.periodR);
      addS('drift',  "#9B6DFF", cr.driftR);
      addS('asym',   C.red,     cr.asymR);
      addS('annual', "#00D9C0", cr.annualR);
      addS('p007',   "#FFD700", cr.p007R);
    }

    // Benchmark（用第一個 combo 的對齊 bmRaw）
    const firstCr = results.combos[0];
    if (firstCr?.alignedBmRaw?.length) {
      const initShares = firstCr.params.amount / firstCr.alignedBmRaw[0].close;
      const bm = chart.addLineSeries({
        color:C.blue, lineWidth:1, lineStyle:2, title:bmTicker||"原型ETF"
      });
      bm.setData(firstCr.alignedBmRaw.map(d=>({ time:d.date, value:initShares*d.close })));
      refs.bm = bm;
    }

    // Underwater 回撤曲線（Combo A 最佳策略）
    const ddBestKey = firstCr?.bestKey;
    const ddBase = ddBestKey ? firstCr?.[`${ddBestKey}R`]?.equity : null;
    if (ddBase?.length) {
      let peak = ddBase[0].value;
      const ddData = ddBase.map(e => {
        if (e.value > peak) peak = e.value;
        return { time:e.date, value:-((peak-e.value)/peak*100) };
      });
      const ddS = chart.addLineSeries({
        color: C.red+"99", lineWidth:1, lineStyle:0,
        priceScaleId: 'left',
        priceFormat: { type:'custom', formatter:(p)=>`${p.toFixed(1)}%` },
        title:"回撤%", lastValueVisible:true, priceLineVisible:false,
      });
      ddS.setData(ddData);
      refs.dd = ddS;
    }

    seriesRefs.current = refs;
    const vl = visibleLines;
    Object.entries(refs).forEach(([key, s]) => {
      if (s && vl[key] !== undefined) s.applyOptions({ visible: vl[key] });
    });
    chart.timeScale().fitContent();

    return () => {
      if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; }
      seriesRefs.current = {};
    };
  }, [results, isMobile]);

  // Toggle useEffect（只更新 visibility，不重建圖表）
  useEffect(() => {
    const r = seriesRefs.current;
    if (!Object.keys(r).length) return;
    Object.entries(visibleLines).forEach(([key, visible]) => {
      if (r[key]) r[key].applyOptions({ visible });
    });
  }, [visibleLines]);

  function updateCombo(idx, patch) {
    setCombos(prev => prev.map((c, i) => i===idx ? {...c, ...patch} : c));
  }

  const cp = combos[activeCombo];

  return (
    <div>
      <div style={{fontWeight:700, fontSize:15, color:C.text, marginBottom:4}}>策略回測</div>
      <div style={{color:C.textMuted, fontSize:12, marginBottom:16}}>
        多組合並排回測｜<span style={{color:"#FFD700", fontWeight:600}}>P-007 雙重確認</span>為主策略｜
        <span style={{color:C.blue}}>還原股價（含息調整）</span>｜固定對比原型ETF買進持有
      </div>

      <Card style={{padding:12, marginBottom:16, background:C.surface, fontSize:11, color:C.textMuted, lineHeight:"1.5"}}>
        <strong style={{color:C.text}}>📌 指標說明：</strong> 年化報酬率 = 策略報酬 ^(252/交易日數) - 1｜夏普比率 = (年化報酬 - 2%無風險率) / 年化波動率｜波動率 = 年化標準差｜勝率 = 策略資產 {'>'} 原型ETF買進持有的天數%。KDJ 計算採 OHLCV 實際最高/最低價（業界標準）。<strong style={{color:C.gold}}>注意：</strong> 還原股價已含息再投資，回測不含滑點；P-003 交易成本：買入 0.1425%、賣出 0.4425%（含證交稅），僅對交易金額計算。
      </Card>

      <Card style={{padding:12, marginBottom:16, background:C.surface2, border:`1px solid ${C.border}`, fontSize:11, lineHeight:"1.7"}}>
        <div style={{display:"flex", alignItems:"center", gap:6, marginBottom:8}}>
          <span style={{color:C.blue, fontWeight:700, fontSize:12}}>🗓 資料說明</span>
          <span style={{color:C.textMuted}}>—</span>
          <span style={{color:C.textMuted}}>使用各市場昨日收盤還原股價（除息/分割調整）</span>
        </div>
        <div style={{marginBottom:6}}>
          <span style={{color:C.accent, fontWeight:600}}>⚡ 預載標的（秒出）｜台股：</span>
          <span style={{color:C.text}}>0050、0056、006208、00878、00646、00631L、00692、00757</span>
        </div>
        <div style={{marginBottom:6}}>
          <span style={{color:C.accent, fontWeight:600}}>⚡ 預載標的（秒出）｜美股＋指數：</span>
          <span style={{color:C.text}}>SPY、QQQ、VOO、VTI、QLD、TQQQ、SSO、UPRO、VT</span>
        </div>
        <div style={{color:C.textMuted}}>
          ⏳ <strong style={{color:C.gold}}>非預載標的</strong> 首次查詢需等待 30～90 秒（系統即時抓取），之後當日再查即秒出。
        </div>
      </Card>

      <Card style={{padding:16, marginBottom:16, background:C.red+"08", border:`1px solid ${C.red}40`}}>
        <div style={{fontSize:11, color:C.red}}>
          ⚠️ <strong>槓桿ETF風險警示：</strong> 槓桿ETF因日重平衡機制，長期持有會因波動衰減而跑輸原型ETF。本回測假設無交易成本與無滑點，實際績效會低於模擬結果。再平衡策略可緩解但無法完全消除此風險。
        </div>
      </Card>

      {/* ── 策略選擇面板（所有組合共用）────────────────────── */}
      <Card style={{padding:16, marginBottom:16, border:`1px solid ${C.accent}30`}}>
        <div style={{fontSize:12, color:C.accent, fontWeight:700, marginBottom:12}}>📋 策略選擇（所有組合共用）</div>
        <div style={{display:"flex", flexWrap:"wrap", gap:10, marginBottom:12}}>
          {STRATEGY_DEFS.map(({key, label, color}) => {
            const on = selectedStrategies[key];
            return (
              <label key={key} style={{display:"flex", alignItems:"center", gap:6, cursor:"pointer", userSelect:"none"}}>
                <input
                  type="checkbox" checked={on}
                  onChange={() => setSelectedStrategies(v => ({...v, [key]: !v[key]}))}
                  style={{accentColor:color, width:14, height:14, cursor:"pointer"}}
                />
                <span style={{color: on ? color : C.textMuted, fontSize:12, fontWeight: on ? 600 : 400, transition:"color 0.15s"}}>
                  {label}
                </span>
              </label>
            );
          })}
        </div>
        <div style={{paddingTop:10, borderTop:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:8}}>
          <div style={{width:10, height:10, borderRadius:"50%", background:C.blue, flexShrink:0}}/>
          <span style={{color:C.blue, fontSize:12, fontWeight:600}}>
            📌 原型ETF 買進持有（固定基準，不可關閉）{bmTicker ? `｜${bmTicker}` : ""}
          </span>
        </div>
      </Card>

      {/* ── Benchmark 設定（全局唯一）──────────────────────── */}
      <Card style={{padding:14, marginBottom:16, border:`1px solid ${C.blue}30`}}>
        <div style={{fontSize:12, color:C.blue, fontWeight:700, marginBottom:10}}>📌 Benchmark 設定（全局唯一）</div>
        <div style={{display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end"}}>
          <div>
            <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>對比原型ETF</div>
            <Input value={bmTicker} onChange={e=>setBmTicker(e.target.value.toUpperCase())}
              placeholder="如 QQQ / 006208" style={{width:140}}/>
          </div>
          <div>
            <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>市場</div>
            <select value={bmIsUS} onChange={e=>setBmIsUS(e.target.value==="true")}
              style={{background:C.surface2, border:`1px solid ${C.border}`, color:C.text,
                borderRadius:8, padding:"7px 10px", fontSize:12}}>
              <option value="false">台股</option>
              <option value="true">美股</option>
            </select>
          </div>
        </div>
      </Card>

      {/* ── 組合 Tab 參數設定 ────────────────────────────── */}
      <Card style={{padding:16, marginBottom:16}}>
        {/* Tab 切換列 */}
        <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:16, flexWrap:"wrap"}}>
          {combos.map((_, i) => (
            <button key={i} onClick={()=>setActiveCombo(i)} style={{
              background: activeCombo===i ? C.accent+"25" : "transparent",
              color: activeCombo===i ? C.accent : C.textMuted,
              border:`1px solid ${activeCombo===i ? C.accent+"60" : C.border}`,
              borderRadius:8, padding:"5px 18px", fontSize:12, fontWeight:600, cursor:"pointer",
            }}>組合 {COMBO_LABELS[i]}</button>
          ))}
          {combos.length < MAX_COMBOS && (
            <button onClick={()=>{ setCombos(v=>[...v,{...DEFAULT_COMBO}]); setActiveCombo(combos.length); }}
              style={{background:"transparent", color:C.accent, border:`1px solid ${C.accent}40`,
                borderRadius:8, padding:"5px 12px", fontSize:12, cursor:"pointer"}}>+ 新增組合</button>
          )}
          {combos.length > 1 && (
            <button onClick={()=>{
              setCombos(v=>v.filter((_,i)=>i!==activeCombo));
              setActiveCombo(Math.max(0,activeCombo-1));
            }} style={{background:"transparent", color:C.red, border:`1px solid ${C.red}40`,
              borderRadius:8, padding:"5px 12px", fontSize:12, cursor:"pointer"}}>✕ 移除</button>
          )}
          <span style={{fontSize:10, color:C.textMuted, marginLeft:"auto"}}>
            線條識別：A=實粗｜B=虛粗｜C=實細｜D=虛細
          </span>
        </div>

        {/* 當前組合的參數 */}
        <div style={{fontSize:12, color:C.accent, fontWeight:600, marginBottom:10}}>
          組合 {COMBO_LABELS[activeCombo]} — 基本設定
        </div>
        <div className="wos-grid-3" style={{marginBottom:14}}>
          <div>
            <div style={{fontSize:11,color:C.textMuted,marginBottom:4}}>槓桿ETF代號</div>
            <Input value={cp.ticker}
              onChange={e=>updateCombo(activeCombo,{ticker:e.target.value.toUpperCase()})}
              placeholder="如 QLD / 00675L" style={{width:"100%"}}/>
          </div>
          <div>
            <div style={{fontSize:11,color:C.textMuted,marginBottom:4}}>市場</div>
            <select value={cp.is_us} onChange={e=>updateCombo(activeCombo,{is_us:e.target.value==="true"})}
              style={{background:C.surface2,border:`1px solid ${C.border}`,color:C.text,
                borderRadius:8,padding:"7px 10px",fontSize:12,width:"100%"}}>
              <option value="false">台股</option>
              <option value="true">美股</option>
            </select>
          </div>
          <div>
            <div style={{fontSize:11,color:C.textMuted,marginBottom:4}}>初始資金 (NT$)</div>
            <Input type="number" value={cp.amount}
              onChange={e=>updateCombo(activeCombo,{amount:parseFloat(e.target.value)||1000000})}
              style={{width:"100%"}}/>
          </div>
          <div>
            <div style={{fontSize:11,color:C.textMuted,marginBottom:4}}>股票佔比（%）</div>
            <Input type="number" value={Math.round(cp.target*100)}
              onChange={e=>{const v=parseFloat(e.target.value);if(!isNaN(v)&&v>0&&v<100)updateCombo(activeCombo,{target:v/100});}}
              placeholder="50" style={{width:"100%"}}/>
            <div style={{display:"flex", flexWrap:"wrap", gap:4, marginTop:6}}>
              {[30,40,50,60,70].map(pct=>(
                <button key={pct} onClick={()=>updateCombo(activeCombo,{target:pct/100})}
                  style={{
                    background:Math.round(cp.target*100)===pct?C.accent+"30":C.surface,
                    color:Math.round(cp.target*100)===pct?C.accent:C.textMuted,
                    border:`1px solid ${Math.round(cp.target*100)===pct?C.accent+"60":C.border}`,
                    borderRadius:5,padding:"2px 8px",fontSize:10,fontWeight:600,cursor:"pointer",
                  }}>{pct}%</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{fontSize:11,color:C.textMuted,marginBottom:4}}>回測天數</div>
            <Input value={cp.days}
              onChange={e=>{const v=parseInt(e.target.value,10);if(!isNaN(v)&&v>0)updateCombo(activeCombo,{days:v});}}
              style={{width:"100%",boxSizing:"border-box"}}/>
            <div style={{display:"flex", flexWrap:"wrap", gap:4, marginTop:6}}>
              {[{label:"1年",days:365},{label:"3年",days:1095},{label:"5年",days:1825},
                {label:"10年",days:3650},{label:"20年",days:7300}].map(({label,days})=>(
                <button key={label} onClick={()=>updateCombo(activeCombo,{days})}
                  style={{
                    background:cp.days===days?C.accent+"30":C.surface,
                    color:cp.days===days?C.accent:C.textMuted,
                    border:`1px solid ${cp.days===days?C.accent+"60":C.border}`,
                    borderRadius:5,padding:"2px 8px",fontSize:10,fontWeight:600,cursor:"pointer",
                  }}>{label}</button>
              ))}
            </div>
          </div>
        </div>

        <div style={{fontSize:12,color:C.accent,fontWeight:600,marginBottom:10}}>訊號再平衡參數</div>
        <div className="wos-grid-2" style={{marginBottom:14}}>
          <div>
            <div style={{fontSize:11,color:C.textMuted,marginBottom:4}}>J值進場閾值</div>
            <Input type="number" value={cp.j_entry}
              onChange={e=>updateCombo(activeCombo,{j_entry:parseFloat(e.target.value)})}
              style={{width:"100%"}}/>
          </div>
          <div>
            <div style={{fontSize:11,color:C.textMuted,marginBottom:4}}>J值出場閾值</div>
            <Input type="number" value={cp.j_exit}
              onChange={e=>updateCombo(activeCombo,{j_exit:parseFloat(e.target.value)})}
              style={{width:"100%"}}/>
          </div>
        </div>

        <div style={{fontSize:12,color:C.orange,fontWeight:600,marginBottom:10}}>週期再平衡參數</div>
        <div className="wos-grid-2" style={{marginBottom:8}}>
          <div>
            <div style={{fontSize:11,color:C.textMuted,marginBottom:4}}>再平衡週期（天）</div>
            <Input type="number" value={cp.period_days}
              onChange={e=>updateCombo(activeCombo,{period_days:parseInt(e.target.value)||90})}
              style={{width:"100%"}}/>
          </div>
        </div>
        <div style={{display:"flex", flexWrap:"wrap", gap:4, marginBottom:14}}>
          {[{label:"月(30天)",days:30},{label:"季(90天)",days:90},{label:"半年(180天)",days:180}].map(({label,days})=>(
            <button key={label} onClick={()=>updateCombo(activeCombo,{period_days:days})}
              style={{
                background:cp.period_days===days?C.orange+"30":C.surface,
                color:cp.period_days===days?C.orange:C.textMuted,
                border:`1px solid ${cp.period_days===days?C.orange+"60":C.border}`,
                borderRadius:5,padding:"2px 8px",fontSize:10,fontWeight:600,cursor:"pointer",
              }}>{label}</button>
          ))}
        </div>

        <div style={{fontSize:12,color:"#9B6DFF",fontWeight:600,marginBottom:10}}>比例偏移再平衡參數</div>
        <div className="wos-grid-2" style={{marginBottom:8}}>
          <div>
            <div style={{fontSize:11,color:C.textMuted,marginBottom:4}}>偏離觸發閾值（%）</div>
            <Input type="number" value={cp.drift_pct}
              onChange={e=>updateCombo(activeCombo,{drift_pct:parseFloat(e.target.value)})}
              style={{width:"100%"}}/>
          </div>
        </div>
        <div style={{display:"flex", flexWrap:"wrap", gap:4, marginBottom:14}}>
          {[{label:"5%（激進）",pct:5},{label:"10%",pct:10},{label:"20%",pct:20},{label:"25%（穩健）",pct:25}].map(({label,pct})=>(
            <button key={label} onClick={()=>updateCombo(activeCombo,{drift_pct:pct})}
              style={{
                background:cp.drift_pct===pct?"#9B6DFF30":C.surface,
                color:cp.drift_pct===pct?"#9B6DFF":C.textMuted,
                border:`1px solid ${cp.drift_pct===pct?"#9B6DFF60":C.border}`,
                borderRadius:5,padding:"2px 8px",fontSize:10,fontWeight:600,cursor:"pointer",
              }}>{label}</button>
          ))}
        </div>

        <div style={{fontSize:12,color:"#FFD700",fontWeight:600,marginBottom:10}}>⚡ P-007 雙重確認再平衡參數</div>
        <div style={{fontSize:11,color:C.textMuted,marginBottom:8,lineHeight:1.5}}>
          訊號觸發 AND 持倉偏離 ≥ gate% 時才再平衡｜最優 gate 因標的而異：
          高波動（QLD / TQQQ）建議 <span style={{color:"#FFD700"}}>10–15%</span>，
          低波動（SSO / DDM）建議 <span style={{color:"#FFD700"}}>20–30%</span>
        </div>
        <div className="wos-grid-2" style={{marginBottom:8}}>
          <div>
            <div style={{fontSize:11,color:C.textMuted,marginBottom:4}}>Gate 偏離門檻（%）</div>
            <Input type="number" value={cp.gate_pct}
              onChange={e=>updateCombo(activeCombo,{gate_pct:parseInt(e.target.value)||13})}
              style={{width:"100%"}}/>
          </div>
        </div>
        <div style={{display:"flex", flexWrap:"wrap", gap:4, marginBottom:14}}>
          {[{label:"5%",pct:5},{label:"10%",pct:10},{label:"13%",pct:13},
            {label:"20%",pct:20},{label:"25%",pct:25},{label:"30%",pct:30}].map(({label,pct})=>(
            <button key={label} onClick={()=>updateCombo(activeCombo,{gate_pct:pct})}
              style={{
                background:cp.gate_pct===pct?"#FFD70030":C.surface,
                color:cp.gate_pct===pct?"#FFD700":C.textMuted,
                border:`1px solid ${cp.gate_pct===pct?"#FFD70060":C.border}`,
                borderRadius:5,padding:"2px 8px",fontSize:10,fontWeight:600,cursor:"pointer",
              }}>{label}</button>
          ))}
        </div>

        <div className="wos-run-row" style={{display:"flex", alignItems:"center", gap:12, flexWrap:"wrap"}}>
          <Btn onClick={runBacktest} color={loading?C.textMuted:C.accent}>
            {loading?"計算中...":"▶ 執行回測"}
          </Btn>
          <label style={{display:"flex", alignItems:"center", gap:6, cursor:"pointer"}}>
            <input type="checkbox" checked={withCost} onChange={e=>setWithCost(e.target.checked)}
              style={{accentColor:C.gold, width:14, height:14, cursor:"pointer"}}/>
            <span style={{color:withCost?C.gold:C.textMuted, fontSize:12, fontWeight:withCost?600:400}}>
              📉 P-003 含交易成本（買入 0.1425%｜賣出 0.4425% = 手續費 + 證交稅）
            </span>
          </label>
          {loadingMsg && <span style={{color:C.accent, fontSize:12}}>{loadingMsg}</span>}
        </div>
      </Card>

      {/* ── 回測結果 ──────────────────────────────────────── */}
      {results && (
        <>
          {results.withCost && (
            <div style={{background:C.gold+"12",border:`1px solid ${C.gold}40`,borderRadius:8,
              padding:"8px 14px",marginBottom:12,fontSize:11,color:C.gold}}>
              📉 <strong>P-003 交易成本模式</strong>：買入再平衡扣 0.1425%，賣出再平衡扣 0.4425%，僅對實際交易金額計算。
            </div>
          )}

          {/* ── 固定基準橫排（各 combo 對應期間的 BM 報酬）────── */}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:12, color:C.blue, fontWeight:700, marginBottom:8}}>
              📌 固定基準 — {bmTicker||"原型ETF"} 買進持有（各組合對應期間）
            </div>
            <div className="wos-result-grid">
              {results.combos.map(cr => (
                <Card key={cr.label} style={{padding:"12px 14px", textAlign:"center", border:`1px solid ${C.blue}30`}}>
                  <div style={{color:C.textMuted, fontSize:10, marginBottom:2}}>組合 {cr.label} 期間基準</div>
                  <div style={{color:C.textMuted, fontSize:10, marginBottom:6}}>
                    {cr.actualStart} ～ {cr.actualEnd}
                  </div>
                  <div style={{color:C.blue, fontWeight:700, fontSize:16}}>
                    {cr.bmReturn!=null ? `${cr.bmReturn>=0?"+":""}${cr.bmReturn.toFixed(1)}%` : "—"}
                  </div>
                  <div style={{color:C.textMuted, fontSize:11, marginTop:4}}>還原股價（含息再投資）</div>
                </Card>
              ))}
            </div>
          </div>

          {/* ── 各組合策略結果 ─────────────────────────────── */}
          {results.combos.map(cr => (
            <div key={cr.label} style={{marginBottom:20}}>
              <div style={{
                display:"flex", alignItems:"center", gap:8, marginBottom:8,
                padding:"8px 14px", background:C.surface2, borderRadius:8,
                border:`1px solid ${C.border}`, flexWrap:"wrap",
              }}>
                <span style={{color:C.accent, fontWeight:700, fontSize:13}}>
                  組合 {cr.label}：{cr.params.ticker}
                </span>
                <span style={{color:cr.params.is_us?C.blue:C.accent, fontSize:10, fontWeight:600}}>
                  {cr.params.is_us?"美股":"台股"}
                </span>
                <span style={{color:C.textMuted, fontSize:11}}>
                  {Math.round(cr.params.target*100)}% 持倉｜{cr.params.days} 天設定
                </span>
                <span style={{color:C.textMuted, fontSize:11, marginLeft:"auto"}}>
                  {cr.actualStart} ～ {cr.actualEnd}（{cr.tradingDays.toLocaleString()} 交易日）
                </span>
              </div>
              {cr.isDataShort && (
                <div style={{background:C.gold+"18",border:`1px solid ${C.gold}40`,borderRadius:6,
                  padding:"6px 10px",fontSize:11,color:C.gold,marginBottom:8,lineHeight:1.6}}>
                  ⚠️ 實際可用資料自 {cr.actualStart} 起，少於設定天數，回測結果仍有效。
                </div>
              )}
              <div className="wos-result-grid">
                {[
                  results.selectedStrategies?.p007 && cr.p007Return!=null && {
                    key:"p007",
                    label:`🔒 P-007 雙重確認 (gate=${cr.gate_pct}%)`,
                    pct:`${cr.p007Return>=0?"+":""}${cr.p007Return.toFixed(1)}%`,
                    amt:cr.p007Return/100*cr.params.amount, color:"#FFD700",
                    sub:`${cr.p007R.markers.length} 次｜訊號+偏離同時達標`,
                    stats:cr.p007Stats, maxDD:cr.p007MaxDD,
                  },
                  results.selectedStrategies?.drift && cr.driftReturn!=null && {
                    key:"drift", label:"📊 偏移再平衡",
                    pct:`${cr.driftReturn>=0?"+":""}${cr.driftReturn.toFixed(1)}%`,
                    amt:cr.driftReturn/100*cr.params.amount, color:"#9B6DFF",
                    sub:`${cr.driftR.markers.length} 次再平衡`,
                    stats:cr.driftStats, maxDD:cr.driftMaxDD,
                  },
                  results.selectedStrategies?.period && cr.periodReturn!=null && {
                    key:"period", label:"🔄 週期再平衡",
                    pct:`${cr.periodReturn>=0?"+":""}${cr.periodReturn.toFixed(1)}%`,
                    amt:cr.periodReturn/100*cr.params.amount, color:C.orange,
                    sub:`${cr.periodR.markers.length} 次再平衡`,
                    stats:cr.periodStats, maxDD:cr.periodMaxDD,
                  },
                  results.selectedStrategies?.signal && cr.signalReturn!=null && {
                    key:"signal", label:"📈 訊號再平衡",
                    pct:`${cr.signalReturn>=0?"+":""}${cr.signalReturn.toFixed(1)}%`,
                    amt:cr.signalReturn/100*cr.params.amount, color:C.accent,
                    sub:`${cr.signalR.markers.length} 次再平衡`,
                    stats:cr.signalStats, maxDD:cr.signalMaxDD,
                  },
                  results.selectedStrategies?.asym && cr.asymReturn!=null && {
                    key:"asym", label:"↕️ KDJ買+偏移賣 (P-002)",
                    pct:`${cr.asymReturn>=0?"+":""}${cr.asymReturn.toFixed(1)}%`,
                    amt:cr.asymReturn/100*cr.params.amount, color:C.red,
                    sub:`${cr.asymR.markers.length} 次再平衡`,
                    stats:cr.asymStats, maxDD:cr.asymMaxDD,
                  },
                  results.selectedStrategies?.annual && cr.annualReturn!=null && {
                    key:"annual", label:"📅 年度再平衡 (P-001)",
                    pct:`${cr.annualReturn>=0?"+":""}${cr.annualReturn.toFixed(1)}%`,
                    amt:cr.annualReturn/100*cr.params.amount, color:"#00D9C0",
                    sub:`${cr.annualR.markers.length} 次｜每252交易日`,
                    stats:cr.annualStats, maxDD:cr.annualMaxDD,
                  },
                ].filter(Boolean).map(({key, label, pct, amt, color, sub, stats, maxDD}) => (
                  <Card key={key} style={{padding:"12px 14px", textAlign:"center",
                    border: cr.bestKey===key ? `1px solid ${color}70` : `1px solid ${C.border}`}}>
                    <div style={{color:C.textMuted, fontSize:11, marginBottom:6}}>{label}</div>
                    {cr.bestKey===key && (
                      <div style={{color, fontSize:9, fontWeight:700, marginBottom:3}}>★ 最佳策略</div>
                    )}
                    <div style={{color, fontWeight:700, fontSize:16}}>{pct}</div>
                    {amt!=null && (
                      <div style={{color, fontSize:12, marginTop:3, fontFamily:"monospace"}}>
                        {amt>=0?"+":"-"}NT${fmt(Math.abs(amt))}
                      </div>
                    )}
                    {stats && (
                      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", fontSize:10,
                        color:C.textMuted, marginTop:6, gap:"2px 8px", textAlign:"left"}}>
                        <div>年化: {(stats.annReturn*100).toFixed(1)}%</div>
                        <div>夏普: {stats.sharpe.toFixed(2)}</div>
                        <div>波動: {(stats.annVol*100).toFixed(1)}%</div>
                        <div>勝率: {stats.winRate.toFixed(0)}%</div>
                        {maxDD!=null && <div style={{color:C.red}}>回撤: -{maxDD.toFixed(1)}%</div>}
                      </div>
                    )}
                    {sub && <div style={{color:C.textMuted, fontSize:11, marginTop:4}}>{sub}</div>}
                  </Card>
                ))}
              </div>
            </div>
          ))}

          {/* ── 線圖 Toggle + 圖表 ────────────────────────── */}
          <Card style={{padding:12, marginBottom:16}}>
            <div style={{fontSize:11, color:C.textMuted, marginBottom:8}}>
              線條識別：<strong style={{color:C.text}}>A=實粗｜B=虛粗｜C=實細｜D=虛細</strong>
              　預設只顯示各組合最佳策略，可 Toggle 顯示其他
            </div>
            <div style={{display:"flex", flexWrap:"wrap", gap:6, marginBottom:10}}>
              {results.combos.map(cr =>
                STRATEGY_DEFS
                  .filter(s => results.selectedStrategies?.[s.key] && cr[`${s.key}R`]?.equity?.length)
                  .map(({key, label, color}) => {
                    const vk = `${cr.label}_${key}`;
                    const on = visibleLines[vk];
                    const shortLabel = label.replace(/^[^\s]+\s/,"");
                    return (
                      <button key={vk}
                        onClick={()=>setVisibleLines(v=>({...v,[vk]:!v[vk]}))}
                        style={{
                          background:on?color+"22":"transparent",
                          border:`1px solid ${on?color+"99":C.border}`,
                          color:on?color:C.textMuted,
                          borderRadius:6, padding:"3px 9px", fontSize:11, cursor:"pointer",
                          display:"flex", alignItems:"center", gap:5, transition:"all 0.15s",
                        }}>
                        <div style={{
                          width:14, height:2, borderRadius:1,
                          background: on ? color : C.border,
                          opacity: COMBO_STYLES[cr.comboIdx].lineStyle===2 ? 0.55 : 1,
                        }}/>
                        {cr.label}-{shortLabel}
                      </button>
                    );
                  })
              )}
              {(()=>{
                const on = visibleLines.bm;
                return (
                  <button onClick={()=>setVisibleLines(v=>({...v,bm:!v.bm}))}
                    style={{background:on?C.blue+"22":"transparent",
                      border:`1px solid ${on?C.blue+"99":C.border}`,
                      color:on?C.blue:C.textMuted, borderRadius:6, padding:"3px 9px",
                      fontSize:11, cursor:"pointer", display:"flex", alignItems:"center", gap:5}}>
                    <div style={{width:14,height:2,background:on?C.blue:C.border,borderRadius:1}}/>
                    {bmTicker||"原型ETF"}
                  </button>
                );
              })()}
              {(()=>{
                const on = visibleLines.dd;
                return (
                  <button onClick={()=>setVisibleLines(v=>({...v,dd:!v.dd}))}
                    style={{background:on?C.red+"22":"transparent",
                      border:`1px solid ${on?C.red+"99":C.border}`,
                      color:on?C.red:C.textMuted, borderRadius:6, padding:"3px 9px",
                      fontSize:11, cursor:"pointer", display:"flex", alignItems:"center", gap:5}}>
                    <div style={{width:14,height:2,background:on?C.red:C.border,borderRadius:1}}/>
                    回撤曲線（組合A）
                  </button>
                );
              })()}
            </div>
            <div ref={chartRef} style={{width:"100%", borderRadius:8, overflow:"hidden"}}/>
          </Card>
        </>
      )}
    </div>
  );
}


// ─── 主元件 ─────────────────────────────────────────────────
export default function Strategy({ allAssets }) {
  const [tab, setTab] = useState("monitor");

  return (
    <div style={{display:"flex", flexDirection:"column", gap:0}}>
      <div style={{display:"flex", gap:8, marginBottom:20}}>
        {[["monitor","📡 監控"],["backtest","📊 回測"]].map(([key,label])=>(
          <button key={key} onClick={()=>setTab(key)} style={{
            background: tab===key ? C.accent+"18" : "transparent",
            color: tab===key ? C.accent : C.textMuted,
            border: `1px solid ${tab===key ? C.accent+"60" : C.border}`,
            borderRadius:8, padding:"8px 18px", fontSize:13, fontWeight:600, cursor:"pointer"
          }}>{label}</button>
        ))}
      </div>

      {tab==="monitor" && <MonitorTab allAssets={allAssets}/>}
      {tab==="backtest" && <BacktestTab/>}
    </div>
  );
}