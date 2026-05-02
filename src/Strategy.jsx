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
async function getKlineFromCache(cacheKey, days) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from("kline_cache")
      .select("data")
      .eq("ticker", cacheKey)
      .eq("days", days)
      .eq("cached_date", today)
      .single();
    if (data?.data) {
      console.log(`[cache hit] ${cacheKey}`);
      return JSON.parse(data.data);
    }
  } catch {}
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

async function fetchTWKline(ticker, days=720) {
  // 1. 先查 Supabase 快取（今日有快取直接用，不打 Render）
  const cacheKey = `${ticker.toUpperCase()}_TW`;
  const cached = await getKlineFromCache(cacheKey, days);
  if (cached) return cached;

  // 2. 沒有快取 → 走 Vercel proxy（同源，無 CORS 問題）→ Render
  try {
    return await fetchFromProxy(`/api/kline-tw?ticker=${encodeURIComponent(ticker)}&days=${days}`);
  } catch(e) {
    console.error(`[fetchTWKline] 失敗:`, e);
    return [];
  }
}

async function fetchUSKline(ticker, days=720) {
  // 1. 先查 Supabase 快取
  const cached = await getKlineFromCache(ticker.toUpperCase(), days);
  if (cached) return cached;

  // 2. 沒有快取 → 走 Vercel proxy（同源，無 CORS 問題）→ Render
  try {
    return await fetchFromProxy(`/api/kline-us?ticker=${encodeURIComponent(ticker)}&days=${days}`);
  } catch(e) {
    console.error(`[fetchUSKline] 失敗:`, e);
    return [];
  }
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
    j_entry:10, j_exit:90, days:720, period_days:30, drift_pct:5
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

  async function runBacktest() {
    setLoading(true); setResult(null);
    const fetchFn = params.is_us ? fetchUSKline : fetchTWKline;

    setLoadingMsg(`抓取 ${params.ticker} K線資料...`);
    let raw = await fetchFn(params.ticker, params.days);

    // Render 冷啟動：Vercel proxy 第一次請求可能 timeout（504）→ 喚醒 Render 後自動重試
    if (!raw.length) {
      setLoadingMsg("⏳ 伺服器喚醒中，5 秒後自動重試...");
      await sleep(5000);
      setLoadingMsg(`重試抓取 ${params.ticker} K線資料...`);
      raw = await fetchFn(params.ticker, params.days);
    }

    if (!raw.length) {
      setLoading(false);
      setLoadingMsg("❌ 無法取得資料，請確認股票代號是否正確");
      return;
    }

    let bmRaw = [];
    if (params.benchmark?.trim()) {
      setLoadingMsg(`抓取 ${params.benchmark} 比較基準...`);
      bmRaw = await fetchFn(params.benchmark, params.days);

      // benchmark 也可能需要喚醒
      if (!bmRaw.length) {
        setLoadingMsg("⏳ 等待比較基準資料...");
        await sleep(3000);
        bmRaw = await fetchFn(params.benchmark, params.days);
      }
    }

    setLoadingMsg("計算指標與回測...");

    const closes = raw.map(d=>d.close);
    const bb = calcBB(closes);
    const kdj = calcKDJ(closes);
    const signals = checkSignals(closes, bb, kdj, params.j_entry, params.j_exit);

    const { equity: signalEquity, markers: signalMarkers } = simRebalance(closes, raw, (i) => signals.some(s=>s.index===i));
    const { equity: periodEquity, markers: periodMarkers } = simRebalance(closes, raw, (i) => i % params.period_days === 0);
    const { equity: driftEquity, markers: driftMarkers } = simRebalance(closes, raw, (i, total, shares, price) => {
      const actualPct = (shares * price) / total * 100;
      return Math.abs(actualPct - params.target*100) >= params.drift_pct;
    });

    const signalReturn = (signalEquity[signalEquity.length-1].value - params.amount) / params.amount * 100;
    const periodReturn = (periodEquity[periodEquity.length-1].value - params.amount) / params.amount * 100;
    const driftReturn  = (driftEquity[driftEquity.length-1].value - params.amount) / params.amount * 100;
    const bmReturn = bmRaw.length ? (bmRaw[bmRaw.length-1].close - bmRaw[0].close) / bmRaw[0].close * 100 : null;
    const maxDD = calcMaxDrawdown(signalEquity.map(e=>e.value));

    setResult({ signalEquity, periodEquity, driftEquity, signalMarkers, periodMarkers, driftMarkers, signalReturn, periodReturn, driftReturn, bmReturn, signals, raw, bmRaw, maxDD });
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

      <Card style={{padding:16, marginBottom:16}}>
        <div style={{fontSize:12, color:C.accent, fontWeight:600, marginBottom:10}}>基本設定</div>
        <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:14}}>
          {p("ticker","槓桿ETF代號","text",{placeholder:"如 QLD / 00675L"})}
          {p("is_us","市場","select")}
          {p("benchmark","對比原型ETF","text",{placeholder:"如 QQQ / 0050"})}
          {p("amount","初始資金 (NT$)")}
          {p("target","股票佔比（0.5=50%）")}
          {p("days","回測天數")}
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
          <div style={{display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10, marginBottom:16}}>
            {[
              {
                label:"📡 訊號再平衡",
                pct:`${result.signalReturn>=0?"+":""}${result.signalReturn.toFixed(1)}%`,
                amt: result.signalReturn/100*params.amount,
                color:C.accent,
                sub:`${result.signalMarkers.length} 次再平衡`
              },
              {
                label:"🔄 週期再平衡",
                pct:`${result.periodReturn>=0?"+":""}${result.periodReturn.toFixed(1)}%`,
                amt: result.periodReturn/100*params.amount,
                color:C.orange,
                sub:`${result.periodMarkers.length} 次再平衡`
              },
              {
                label:"📊 比例偏移再平衡",
                pct:`${result.driftReturn>=0?"+":""}${result.driftReturn.toFixed(1)}%`,
                amt: result.driftReturn/100*params.amount,
                color:"#9B6DFF",
                sub:`${result.driftMarkers.length} 次再平衡`
              },
              {
                label:"📈 原型ETF買進持有",
                pct: result.bmReturn!=null?`${result.bmReturn>=0?"+":""}${result.bmReturn.toFixed(1)}%`:"-",
                amt: result.bmReturn!=null ? result.bmReturn/100*params.amount : null,
                color:C.blue,
                sub:""
              },
              {
                label:"最大回撤(訊號)",
                pct:`-${result.maxDD.toFixed(1)}%`,
                amt: -result.maxDD/100*params.amount,
                color:C.gold,
                sub:""
              },
            ].map(({label, pct, amt, color, sub})=>(
              <Card key={label} style={{padding:"12px 14px", textAlign:"center"}}>
                <div style={{color:C.textMuted, fontSize:11, marginBottom:6}}>{label}</div>
                <div style={{color, fontWeight:700, fontSize:16}}>{pct}</div>
                {amt!=null && (
                  <div style={{color, fontSize:12, marginTop:3, fontFamily:"monospace"}}>
                    {amt>=0?"+":"-"}NT${fmt(Math.abs(amt))}
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