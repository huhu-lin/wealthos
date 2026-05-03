import { useState, useEffect, useRef } from "react";
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
      console.log(`[cache hit] ${cacheKey} date=${data[0].cached_date} cached=${data[0].days}d needed=${days}d`);
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

async function fetchTWKline(ticker, days=720) {
  const bd = bucketDays(days);           // 用大 bucket 查快取（命中率高）
  const cacheKey = `${ticker.toUpperCase()}_TW`;
  const cached = await getKlineFromCache(cacheKey, bd);
  if (cached) return filterByDays(cached, days); // 命中後精準切出所需天數

  try {
    const data = await fetchFromProxy(`/api/kline-tw?ticker=${encodeURIComponent(ticker)}&days=${bd}`);
    return filterByDays(data, days);
  } catch(e) {
    console.error(`[fetchTWKline] 失敗:`, e);
    return [];
  }
}

async function fetchUSKline(ticker, days=720) {
  const bd = bucketDays(days);
  const cached = await getKlineFromCache(ticker.toUpperCase(), bd);
  if (cached) return filterByDays(cached, days);

  try {
    const data = await fetchFromProxy(`/api/kline-us?ticker=${encodeURIComponent(ticker)}&days=${bd}`);
    return filterByDays(data, days);
  } catch(e) {
    console.error(`[fetchUSKline] 失敗:`, e);
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

function calcKDJ(closes, period=9) {
  let k = 50, d = 50;
  return closes.map((_, i) => {
    if (i < period-1) return null;
    const slice = closes.slice(i-period+1, i+1);
    const high = Math.max(...slice);
    const low = Math.min(...slice);
    const rsv = high===low ? 50 : (closes[i]-low)/(high-low)*100;
    k = k*2/3 + rsv/3;
    d = d*2/3 + k/3;
    return { k, d, j: 3*k - 2*d };
  });
}

function checkSignals(closes, bb, kdj, jEntry=10, jExit=90) {
  const signals = [];
  let jBelowFlag = false, jAboveFlag = false;
  for (let i = 1; i < closes.length; i++) {
    if (!bb[i] || !kdj[i] || !bb[i-1] || !kdj[i-1]) continue;
    if (closes[i-1] < bb[i-1].lower && kdj[i-1].j < jEntry) jBelowFlag = true;
    if (closes[i-1] > bb[i-1].upper && kdj[i-1].j > jExit) jAboveFlag = true;
    if (jBelowFlag && kdj[i].j > jEntry) { signals.push({ index:i, type:'BUY' }); jBelowFlag = false; }
    if (jAboveFlag && kdj[i].j < jExit) { signals.push({ index:i, type:'SELL' }); jAboveFlag = false; }
  }
  return signals;
}

// ─── 圖表元件 ────────────────────────────────────────────────
function KChart({ data, ticker, isUS, assets, target=0.5, jEntry=10, jExit=90 }) {
  const chartRef = useRef(null);
  const kdjRef = useRef(null);
  const chartInstance = useRef(null);
  const kdjInstance = useRef(null);

  useEffect(() => {
    if (!data.length || !chartRef.current || !kdjRef.current) return;
    if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; }
    if (kdjInstance.current) { kdjInstance.current.remove(); kdjInstance.current = null; }

    const closes = data.map(d => d.close);
    const bb = calcBB(closes);
    const kdj = calcKDJ(closes);
    const signals = checkSignals(closes, bb, kdj, jEntry, jExit);

    const chartOpts = {
      layout: { background: { color: C.surface2 }, textColor: C.textMuted },
      grid: { vertLines: { color: C.border }, horzLines: { color: C.border } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: C.border },
      timeScale: { borderColor: C.border, timeVisible: true },
      width: chartRef.current.clientWidth,
      height: 320,
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

    candleSeries.setMarkers(signals.map(s => ({
      time: data[s.index].date,
      position: s.type==='BUY' ? 'belowBar' : 'aboveBar',
      color: s.type==='BUY' ? C.accent : C.red,
      shape: s.type==='BUY' ? 'arrowUp' : 'arrowDown',
      text: s.type==='BUY' ? '再平衡↑' : '再平衡↓',
    })));

    const kdjChart = createChart(kdjRef.current, { ...chartOpts, height:160, timeScale:{ visible:false } });
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
  }, [data, jEntry, jExit]);

  const closes = data.map(d => d.close);
  const bb = calcBB(closes);
  const kdj = calcKDJ(closes);
  const lastBB = bb[bb.length-1];
  const lastKDJ = kdj[kdj.length-1];
  const lastClose = closes[closes.length-1];

  let status = '正常', statusColor = C.textMuted;
  if (lastBB && lastKDJ) {
    if (lastClose < lastBB.lower && lastKDJ.j < jEntry) { status='蓄力中 ⚡'; statusColor=C.accent; }
    else if (lastClose > lastBB.upper && lastKDJ.j > jExit) { status='過熱中 🔥'; statusColor=C.red; }
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
    <Card style={{padding:16, marginBottom:14}}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12}}>
        <div style={{display:"flex", gap:8, alignItems:"center"}}>
          <span style={{fontWeight:700, fontSize:16}}>{ticker}</span>
          {lastClose>0 && <span style={{color:C.textMuted, fontSize:13}}>{isUS?'$':'NT$'}{lastClose?.toFixed(2)}</span>}
          <Badge text={status} color={statusColor}/>
          <Badge text="還原股價" color={C.blue}/>
        </div>
        {lastKDJ && <span style={{color:C.textMuted, fontSize:12}}>J值 <span style={{color:lastKDJ.j>jExit?C.red:lastKDJ.j<jEntry?C.accent:C.textMuted, fontWeight:600}}>{lastKDJ.j.toFixed(1)}</span></span>}
      </div>
      {total > 0 && (
        <div style={{display:"flex", gap:16, marginBottom:12, padding:"10px 14px", background:C.surface, borderRadius:8, border:`1px solid ${C.border}`, fontSize:12}}>
          <span style={{color:C.textMuted}}>實際佔比 <span style={{color:C.text, fontWeight:600}}>{actualPct.toFixed(1)}%</span></span>
          <span style={{color:C.textMuted}}>目標佔比 <span style={{color:C.text, fontWeight:600}}>{targetPct.toFixed(1)}%</span></span>
          <span style={{color:C.textMuted}}>建議<span style={{color:diffAmt>0?C.accent:C.red, fontWeight:600}}>{diffAmt>0?' 買入':' 賣出'} NT${fmt(Math.abs(diffAmt))}</span></span>
        </div>
      )}
      <div ref={chartRef} style={{width:"100%", borderRadius:8, overflow:"hidden"}}/>
      <div style={{display:"flex", gap:12, padding:"6px 0", fontSize:11}}>
        {[["K",C.blue],["D",C.gold],["J",C.accent],["超買/超賣",C.red+"90"]].map(([l,c])=>(
          <div key={l} style={{display:"flex", alignItems:"center", gap:4}}>
            <div style={{width:12, height:2, background:c}}/><span style={{color:C.textMuted}}>{l}</span>
          </div>
        ))}
      </div>
      <div ref={kdjRef} style={{width:"100%", borderRadius:8, overflow:"hidden"}}/>
    </Card>
  );
}

// ─── 監控 Tab ────────────────────────────────────────────────
function MonitorTab({ allAssets }) {
  const [tickers, setTickers] = useState([]);
  const [klineMap, setKlineMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingTicker, setLoadingTicker] = useState(""); // 顯示正在抓哪支
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ ticker:"", is_us:false, target:0.5, j_entry:10, j_exit:90, amount:0 });

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
      map[t.ticker] = t.is_us ? await fetchUSKline(t.ticker) : await fetchTWKline(t.ticker);
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
    setForm({ ticker:"", is_us:false, target:0.5, j_entry:10, j_exit:90, amount:0 });
    const list = await loadTickers();
    await loadKlines(list);
  }

  async function handleDelete(id) {
    await supabase.from("strategy_tickers").delete().eq("id", id);
    const list = await loadTickers();
    await loadKlines(list);
  }

  function handleEdit(t) {
    setForm({ ticker:t.ticker, is_us:t.is_us, target:t.target, j_entry:t.j_entry, j_exit:t.j_exit, amount:t.amount });
    setEditId(t.id);
    setShowAdd(true);
  }

  return (
    <div>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16}}>
        <div>
          <div style={{fontWeight:700, fontSize:15, color:C.text}}>再平衡訊號監控</div>
          <div style={{color:C.textMuted, fontSize:12, marginTop:2}}>布林通道 (20,2) + KDJ (9,3,3)｜還原股價｜箭頭標記為訊號觸發點</div>
        </div>
        <Btn onClick={()=>{ setShowAdd(!showAdd); setEditId(null); setForm({ticker:"",is_us:false,target:0.5,j_entry:10,j_exit:90,amount:0}); }}>
          {showAdd ? "✕ 取消" : "+ 新增股票"}
        </Btn>
      </div>

      {showAdd && (
        <Card style={{padding:16, marginBottom:16}}>
          <div style={{fontWeight:600, fontSize:13, marginBottom:12, color:C.accent}}>{editId?"編輯股票":"新增監控股票"}</div>
          <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:12}}>
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>股票代號</div>
              <Input value={form.ticker} onChange={e=>setForm({...form, ticker:e.target.value.toUpperCase()})} placeholder="如 00675L / QLD" style={{width:"100%"}}/>
            </div>
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>市場</div>
              <select value={form.is_us} onChange={e=>setForm({...form, is_us:e.target.value==="true"})}
                style={{background:C.surface2, border:`1px solid ${C.border}`, color:C.text, borderRadius:8, padding:"7px 10px", fontSize:12, width:"100%"}}>
                <option value="false">台股</option>
                <option value="true">美股</option>
              </select>
            </div>
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>目標佔比</div>
              <Input type="number" value={form.target} onChange={e=>setForm({...form, target:parseFloat(e.target.value)})} placeholder="0.5 = 50%" style={{width:"100%"}}/>
            </div>
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>J值進場閾值</div>
              <Input type="number" value={form.j_entry} onChange={e=>setForm({...form, j_entry:parseFloat(e.target.value)})} style={{width:"100%"}}/>
            </div>
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>J值出場閾值</div>
              <Input type="number" value={form.j_exit} onChange={e=>setForm({...form, j_exit:parseFloat(e.target.value)})} style={{width:"100%"}}/>
            </div>
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>進場金額 (NT$)</div>
              <Input type="number" value={form.amount} onChange={e=>setForm({...form, amount:parseFloat(e.target.value)})} style={{width:"100%"}}/>
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
        tickers.map(t => (
          <KChart
            key={t.id}
            data={klineMap[t.ticker]||[]}
            ticker={t.ticker}
            isUS={t.is_us}
            assets={allAssets}
            target={t.target}
            jEntry={t.j_entry}
            jExit={t.j_exit}
          />
        ))
      )}
    </div>
  );
}

// ─── 回測 Tab ────────────────────────────────────────────────
function BacktestTab() {
  const [params, setParams] = useState({
    ticker:"QLD", is_us:true, benchmark:"QQQ", amount:1000000, target:0.5,
    j_entry:10, j_exit:90, days:3650, period_days:30, drift_pct:5
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const chartRef = useRef(null);
  const chartInstance = useRef(null);


  function simRebalance(closes, raw, triggerFn) {
    let cash = params.amount * (1 - params.target);
    let shares = (params.amount * params.target) / closes[0];
    const equity = [{ date:raw[0].date, value:params.amount }];
    const markers = [];
    for (let i=1; i<closes.length; i++) {
      const totalNow = cash + shares * closes[i];
      if (triggerFn(i, totalNow, shares, closes[i])) {
        const targetVal = totalNow * params.target;
        shares = targetVal / closes[i];
        cash = totalNow - targetVal;
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

  function calcAnnualizedStats(equityValues, tradingDays) {
    if (tradingDays < 2) return { annReturn: 0, annVol: 0, sharpe: 0, winRate: 0 };

    const startVal = equityValues[0];
    const endVal = equityValues[equityValues.length - 1];
    const totalReturn = (endVal - startVal) / startVal;
    const annReturn = Math.pow(1 + totalReturn, 252 / tradingDays) - 1;

    // 計算日報酬與波動率
    const dailyReturns = [];
    for (let i = 1; i < equityValues.length; i++) {
      const ret = (equityValues[i] - equityValues[i-1]) / equityValues[i-1];
      dailyReturns.push(ret);
    }

    const avgDailyRet = dailyReturns.reduce((a,b)=>a+b,0) / dailyReturns.length;
    const variance = dailyReturns.reduce((a,b)=>a+Math.pow(b-avgDailyRet,2),0) / dailyReturns.length;
    const annVol = Math.sqrt(variance * 252);

    // 夏普比率（假設無風險利率 2% 年化）
    const riskFreeRate = 0.02;
    const sharpe = annVol > 0 ? (annReturn - riskFreeRate) / annVol : 0;

    // 勝率：正報酬日數 / 總日數
    const winDays = dailyReturns.filter(r => r > 0).length;
    const winRate = winDays / dailyReturns.length * 100;

    return { annReturn, annVol, sharpe, winRate };
  }

  async function runBacktest() {
    if (loading) return;
    setLoading(true); setResult(null);
    const fetchFn = params.is_us ? fetchUSKline : fetchTWKline;
    const getCacheKey = (ticker) => params.is_us ? ticker.toUpperCase() : `${ticker.toUpperCase()}_TW`;
    const hasBenchmark = !!params.benchmark?.trim();

    // ─── 並行觸發主資產 + benchmark（同時喚醒 Render，縮短等待）───
    setLoadingMsg("抓取資料中...");
    const [rawInit, bmRawInit] = await Promise.all([
      fetchFn(params.ticker, params.days),
      hasBenchmark ? fetchFn(params.benchmark, params.days) : Promise.resolve([]),
    ]);

    // ─── 若任一失敗（Render 冷啟動 504）→ 並行 poll 兩者 ───
    const needPollMain = !rawInit.length;
    const needPollBm   = hasBenchmark && !bmRawInit.length;

    if (needPollMain || needPollBm) {
      setLoadingMsg("⏳ Render 首次抓取中，自動等待...");
    }

    const bd = bucketDays(params.days);
    const [raw, bmRaw] = await Promise.all([
      needPollMain
        ? pollKlineCache(getCacheKey(params.ticker), bd, params.days, setLoadingMsg).then(r => r || [])
        : Promise.resolve(rawInit),
      needPollBm
        ? pollKlineCache(getCacheKey(params.benchmark), bd, params.days, () => {}).then(r => r || [])
        : Promise.resolve(bmRawInit),
    ]);

    if (!raw.length) {
      setLoading(false);
      setLoadingMsg("❌ 無法取得資料，請確認股票代號是否正確");
      return;
    }

    setLoadingMsg("計算指標與回測...");

    // ── 對齊起始日期：取兩支 ETF 中較晚上市的那天為共同起點 ──────────────
    // 確保圖表上所有線從同一天出發，比較才有意義
    const alignStart = bmRaw.length
      ? (raw[0].date > bmRaw[0].date ? raw[0].date : bmRaw[0].date)
      : raw[0].date;
    const rawAligned  = raw.filter(d => d.date >= alignStart);
    const bmRawAligned = bmRaw.filter(d => d.date >= alignStart);

    // 用對齊後的資料取代原始資料
    // 用對齊後的資料取代原始資料
    const alignedRaw   = rawAligned.length  ? rawAligned  : raw;
    const alignedBmRaw = bmRawAligned.length ? bmRawAligned : bmRaw;

    // 實際回測資訊（ETF 上市時間可能短於使用者設定的天數）
    const tradingDays    = alignedRaw.length;
    const actualStart    = alignedRaw[0].date;
    const actualEnd      = alignedRaw[alignedRaw.length - 1].date;
    const requestedDays  = params.days;
    const dataShortfall  = requestedDays - Math.round(tradingDays * 365 / 252); // 換算成約略日曆天
    const isDataShort    = dataShortfall > 90; // 差超過 90 天才警告

    const closes = alignedRaw.map(d=>d.close);
    const bb = calcBB(closes);
    const kdj = calcKDJ(closes);
    const signals = checkSignals(closes, bb, kdj, params.j_entry, params.j_exit);

    const { equity: signalEquity, markers: signalMarkers } = simRebalance(closes, alignedRaw, (i) => signals.some(s=>s.index===i));
    const { equity: periodEquity, markers: periodMarkers } = simRebalance(closes, alignedRaw, (i) => i % params.period_days === 0);
    const { equity: driftEquity, markers: driftMarkers } = simRebalance(closes, alignedRaw, (i, total, shares, price) => {
      const actualPct = (shares * price) / total * 100;
      return Math.abs(actualPct - params.target*100) >= params.drift_pct;
    });

    const signalReturn = (signalEquity[signalEquity.length-1].value - params.amount) / params.amount * 100;
    const periodReturn = (periodEquity[periodEquity.length-1].value - params.amount) / params.amount * 100;
    const driftReturn  = (driftEquity[driftEquity.length-1].value - params.amount) / params.amount * 100;
    const bmReturn = alignedBmRaw.length ? (alignedBmRaw[alignedBmRaw.length-1].close - alignedBmRaw[0].close) / alignedBmRaw[0].close * 100 : null;
    const maxDD = calcMaxDrawdown(signalEquity.map(e=>e.value));

    // 計算統計指標
    const signalVals = signalEquity.map(e=>e.value);
    const signalStats = calcAnnualizedStats(signalVals, tradingDays);
    const periodVals = periodEquity.map(e=>e.value);
    const periodStats = calcAnnualizedStats(periodVals, tradingDays);
    const driftVals = driftEquity.map(e=>e.value);
    const driftStats = calcAnnualizedStats(driftVals, tradingDays);

    setResult({ signalEquity, periodEquity, driftEquity, signalMarkers, periodMarkers, driftMarkers, signalReturn, periodReturn, driftReturn, bmReturn, signals, raw: alignedRaw, bmRaw: alignedBmRaw, maxDD, actualStart, actualEnd, tradingDays, requestedDays, isDataShort, signalStats, periodStats, driftStats });
    setLoadingMsg("");
    setLoading(false);
  }

  useEffect(() => {
    if (!result || !chartRef.current) return;
    if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; }

    const chart = createChart(chartRef.current, {
      layout: { background:{ color:C.surface2 }, textColor:C.textMuted },
      grid: { vertLines:{ color:C.border }, horzLines:{ color:C.border } },
      rightPriceScale: { borderColor:C.border },
      timeScale: { borderColor:C.border },
      width: chartRef.current.clientWidth,
      height: 350,
    });
    chartInstance.current = chart;

    const s1 = chart.addLineSeries({ color:C.accent,  lineWidth:2, title:"訊號再平衡" });
    const s2 = chart.addLineSeries({ color:C.orange,  lineWidth:2, lineStyle:0, title:`週期(${params.period_days}天)` });
    const s3 = chart.addLineSeries({ color:"#9B6DFF", lineWidth:2, lineStyle:0, title:`比例偏移(${params.drift_pct}%)` });
    s1.setData(result.signalEquity.map(e=>({ time:e.date, value:e.value })));
    s2.setData(result.periodEquity.map(e=>({ time:e.date, value:e.value })));
    s3.setData(result.driftEquity.map(e=>({ time:e.date, value:e.value })));

    s1.setMarkers(result.signalMarkers.map(date=>({ time:date, position:'aboveBar', color:C.accent, shape:'circle', text:'' })));
    s2.setMarkers(result.periodMarkers.map(date=>({ time:date, position:'aboveBar', color:C.orange, shape:'circle', text:'' })));
    s3.setMarkers(result.driftMarkers.map(date=>({ time:date, position:'belowBar', color:'#9B6DFF', shape:'circle', text:'' })));

    if (result.bmRaw?.length) {
      const bmInitShares = params.amount / result.bmRaw[0].close;
      const bmLine = chart.addLineSeries({ color:C.blue, lineWidth:1, lineStyle:2, title:params.benchmark });
      bmLine.setData(result.bmRaw.map(d=>({ time:d.date, value:bmInitShares*d.close })));
    }

    chart.timeScale().fitContent();
    return () => { if(chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; } };
  }, [result]);

  const p = (key, label, type="number", extra={}) => (
    <div>
      <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>{label}</div>
      {type==="select" ? (
        <select value={params[key]} onChange={e=>setParams({...params, [key]: e.target.value==="true"})}
          style={{background:C.surface2, border:`1px solid ${C.border}`, color:C.text, borderRadius:8, padding:"7px 10px", fontSize:12, width:"100%"}}>
          <option value="false">台股</option>
          <option value="true">美股</option>
        </select>
      ) : (
        <Input type={type} value={params[key]} onChange={e=>setParams({...params, [key]:type==="number"?parseFloat(e.target.value):e.target.value})} style={{width:"100%"}} {...extra}/>
      )}
    </div>
  );

  return (
    <div>
      <div style={{fontWeight:700, fontSize:15, color:C.text, marginBottom:4}}>策略回測</div>
      <div style={{color:C.textMuted, fontSize:12, marginBottom:16}}>三種再平衡策略比較｜布林+KDJ訊號 vs 週期 vs 比例偏移｜<span style={{color:C.blue}}>還原股價（除息/分割調整）</span></div>

      <Card style={{padding:12, marginBottom:16, background:C.surface, fontSize:11, color:C.textMuted, lineHeight:"1.5"}}>
        <strong style={{color:C.text}}>📌 指標說明：</strong> 年化報酬率 = 策略報酬 ^(252/交易日數) - 1｜夏普比率 = (年化報酬 - 2%無風險率) / 年化波動率｜波動率 = 年化標準差｜勝率 = 正報酬日數%。<strong style={{color:C.gold}}>注意：</strong> KDJ 計算採收盤價高低（非完整燭台），回測不含交易成本與滑點。
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
          <span style={{color:C.accent, fontWeight:600}}>⚡ 預載標的（秒出）｜美股：</span>
          <span style={{color:C.text}}>SPY、QQQ、IWM、VOO、VTI、QLD、TQQQ、SSO、UPRO、SOXL、TECL、FNGU</span>
        </div>
        <div style={{color:C.textMuted}}>
          ⏳ <strong style={{color:C.gold}}>非預載標的</strong> 首次查詢需等待 30～90 秒（系統即時抓取），之後當日再查即秒出。
        </div>
      </Card>

      <Card style={{padding:16, marginBottom:16, background:C.red+"08", border:`1px solid ${C.red}40`}}>
        <div style={{fontSize:11, color:C.red, marginBottom:10}}>
          ⚠️ <strong>槓桿ETF風險警示：</strong> 槓桿ETF因日重平衡機制，長期持有會因波動衰減而跑輸原型ETF。本回測假設無交易成本與無滑點，實際績效會低於模擬結果。再平衡策略可緩解但無法完全消除此風險。
        </div>
      </Card>

      <Card style={{padding:16, marginBottom:16}}>
        <div style={{fontSize:12, color:C.accent, fontWeight:600, marginBottom:10}}>基本設定</div>
        <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:14}}>
          {p("ticker","槓桿ETF代號","text",{placeholder:"如 QLD / 00675L"})}
          {p("is_us","市場","select")}
          {p("benchmark","對比原型ETF","text",{placeholder:"如 QQQ / 0050"})}
          {p("amount","初始資金 (NT$)")}
          {p("target","股票佔比（0.5=50%）")}
          <div>
            <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>回測天數</div>
            <Input
              value={params.days}
              onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v > 0) setParams(p=>({...p, days: v})); }}
              style={{width:"100%", boxSizing:"border-box"}}
            />
            <div style={{display:"flex", flexWrap:"wrap", gap:4, marginTop:6}}>
              {[
                {label:"1年", days:365},
                {label:"3年", days:1095},
                {label:"5年", days:1825},
                {label:"10年", days:3650},
                {label:"20年", days:7300},
              ].map(({label, days}) => (
                <button
                  key={label}
                  onClick={() => setParams(v=>({...v, days}))}
                  style={{
                    background: params.days===days ? C.accent+"30" : C.surface,
                    color: params.days===days ? C.accent : C.textMuted,
                    border: `1px solid ${params.days===days ? C.accent+"60" : C.border}`,
                    borderRadius:5, padding:"2px 8px", fontSize:10,
                    fontWeight:600, cursor:"pointer",
                  }}
                >{label}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{fontSize:12, color:C.accent, fontWeight:600, marginBottom:10}}>訊號再平衡參數</div>
        <div style={{display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10, marginBottom:14}}>
          {p("j_entry","J值進場閾值")}
          {p("j_exit","J值出場閾值")}
        </div>
        <div style={{fontSize:12, color:C.orange, fontWeight:600, marginBottom:10}}>週期再平衡參數</div>
        <div style={{display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10, marginBottom:14}}>
          {p("period_days","再平衡週期（天）")}
        </div>
        <div style={{fontSize:12, color:"#9B6DFF", fontWeight:600, marginBottom:10}}>比例偏移再平衡參數</div>
        <div style={{display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10, marginBottom:14}}>
          {p("drift_pct","偏離觸發閾值（%）")}
        </div>
        <div style={{display:"flex", alignItems:"center", gap:12}}>
          <Btn onClick={runBacktest} color={loading?C.textMuted:C.accent}>{loading?"計算中...":"▶ 執行回測"}</Btn>
          {loadingMsg && <span style={{color:C.accent, fontSize:12}}>{loadingMsg}</span>}
        </div>
      </Card>

      {result && (
        <>
          {/* ── 實際回測期間 ── */}
          <div style={{
            background: C.surface, border:`1px solid ${C.border}`,
            borderRadius:10, padding:"10px 14px", marginBottom:12,
            display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8,
          }}>
            <div style={{fontSize:12, color:C.textMuted}}>
              <span style={{color:C.text, fontWeight:600}}>實際回測期間</span>
              {"　"}{result.actualStart} ～ {result.actualEnd}
              {"　"}
              <span style={{color:C.accent}}>({result.tradingDays.toLocaleString()} 個交易日)</span>
            </div>
            {result.isDataShort && (
              <div style={{
                background: C.gold+"18", border:`1px solid ${C.gold}40`,
                borderRadius:6, padding:"6px 10px", fontSize:11, color:C.gold, lineHeight:1.6,
              }}>
                ⚠️ 資料來源（Yahoo Finance）僅提供至 <strong>{result.actualStart}</strong> 的歷史資料，
                早於此日期的資料不存在（ETF 上市初期或換名後可能有資料缺口）。
                實際回測 {result.tradingDays.toLocaleString()} 個交易日，
                少於設定的 {result.requestedDays.toLocaleString()} 天，回測結果仍有效。
              </div>
            )}
          </div>

          <div style={{display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10, marginBottom:16}}>
            {[
              {
                label:"📡 訊號再平衡",
                pct:`${result.signalReturn>=0?"+":""}${result.signalReturn.toFixed(1)}%`,
                amt: result.signalReturn/100*params.amount,
                color:C.accent,
                sub:`${result.signalMarkers.length} 次再平衡`,
                stats: result.signalStats
              },
              {
                label:"🔄 週期再平衡",
                pct:`${result.periodReturn>=0?"+":""}${result.periodReturn.toFixed(1)}%`,
                amt: result.periodReturn/100*params.amount,
                color:C.orange,
                sub:`${result.periodMarkers.length} 次再平衡`,
                stats: result.periodStats
              },
              {
                label:"📊 比例偏移再平衡",
                pct:`${result.driftReturn>=0?"+":""}${result.driftReturn.toFixed(1)}%`,
                amt: result.driftReturn/100*params.amount,
                color:"#9B6DFF",
                sub:`${result.driftMarkers.length} 次再平衡`,
                stats: result.driftStats
              },
              {
                label:"📈 原型ETF買進持有",
                pct: result.bmReturn!=null?`${result.bmReturn>=0?"+":""}${result.bmReturn.toFixed(1)}%`:"-",
                amt: result.bmReturn!=null ? result.bmReturn/100*params.amount : null,
                color:C.blue,
                sub:"",
                stats: null
              },
              {
                label:"最大回撤(訊號)",
                pct:`-${result.maxDD.toFixed(1)}%`,
                amt: -result.maxDD/100*params.amount,
                color:C.gold,
                sub:"",
                stats: null
              },
            ].map(({label, pct, amt, color, sub, stats})=>(
              <Card key={label} style={{padding:"12px 14px", textAlign:"center"}}>
                <div style={{color:C.textMuted, fontSize:11, marginBottom:6}}>{label}</div>
                <div style={{color, fontWeight:700, fontSize:16}}>{pct}</div>
                {amt!=null && (
                  <div style={{color, fontSize:12, marginTop:3, fontFamily:"monospace"}}>
                    {amt>=0?"+":"-"}NT${fmt(Math.abs(amt))}
                  </div>
                )}
                {stats && (
                  <div style={{fontSize:10, color:C.textMuted, marginTop:6, lineHeight:"1.4"}}>
                    <div>年化: {(stats.annReturn*100).toFixed(1)}%</div>
                    <div>夏普: {stats.sharpe.toFixed(2)}</div>
                    <div>波動: {(stats.annVol*100).toFixed(1)}%</div>
                    <div>勝率: {stats.winRate.toFixed(0)}%</div>
                  </div>
                )}
                {sub && <div style={{color:C.textMuted, fontSize:11, marginTop:4}}>{sub}</div>}
              </Card>
            ))}
          </div>
          <Card style={{padding:12, marginBottom:16}}>
            <div style={{display:"flex", gap:16, marginBottom:8}}>
              {[["訊號再平衡",C.accent],["週期再平衡",C.orange],["比例偏移","#9B6DFF"],["原型ETF",C.blue]].map(([l,c])=>(
                <div key={l} style={{display:"flex", alignItems:"center", gap:4}}>
                  <div style={{width:14, height:2, background:c}}/><span style={{color:C.textMuted, fontSize:11}}>{l}</span>
                </div>
              ))}
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