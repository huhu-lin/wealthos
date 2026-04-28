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

const FINMIND_TOKEN = "REDACTED_FINMIND_TOKEN";

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

// ─── 資料抓取 ───────────────────────────────────────────────
async function fetchTWKline(ticker, days=720) {
  try {
    const end = new Date().toISOString().slice(0,10);
    const start = new Date(Date.now()-days*86400000).toISOString().slice(0,10);
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${ticker}&start_date=${start}&end_date=${end}&token=${FINMIND_TOKEN}`;
    const res = await fetch(url);
    const json = await res.json();
    return (json.data||[]).map(d=>({date:d.date, open:d.open, high:d.max, low:d.min, close:d.close}));
  } catch { return []; }
}

async function fetchUSKline(ticker, days=720) {
  try {
    const end = new Date().toISOString().slice(0,10);
    const start = new Date(Date.now()-days*86400000).toISOString().slice(0,10);
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=USStockPrice&data_id=${ticker}&start_date=${start}&end_date=${end}&token=${FINMIND_TOKEN}`;
    const res = await fetch(url);
    const json = await res.json();
    return (json.data||[]).map(d=>({
      date: d.date, open: d.Open, high: d.High, low: d.Low, close: d.Close
    }));
  } catch { return []; }
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
function KChart({ data, ticker, isUS, assets, jEntry=10, jExit=90 }) {
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

  const total = assets.reduce((s,x)=>s+(x.value_twd||0),0);
  const holding = assets.filter(a=>a.ticker===ticker);
  const holdingValue = holding.reduce((s,x)=>s+(x.value_twd||0),0);
  const actualPct = total>0 ? holdingValue/total*100 : 0;
  const targetPct = holding[0]?.target ? holding[0].target*100 : null;
  const diffAmt = targetPct!=null ? Math.round((holding[0].target - holdingValue/total)*total) : null;

  return (
    <Card style={{padding:16, marginBottom:14}}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12}}>
        <div style={{display:"flex", gap:8, alignItems:"center"}}>
          <span style={{fontWeight:700, fontSize:16}}>{ticker}</span>
          {lastClose>0 && <span style={{color:C.textMuted, fontSize:13}}>{isUS?'$':'NT$'}{lastClose?.toFixed(2)}</span>}
          <Badge text={status} color={statusColor}/>
        </div>
        {lastKDJ && <span style={{color:C.textMuted, fontSize:12}}>J值 <span style={{color:lastKDJ.j>jExit?C.red:lastKDJ.j<jEntry?C.accent:C.textMuted, fontWeight:600}}>{lastKDJ.j.toFixed(1)}</span></span>}
      </div>
      {targetPct!=null && (
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
    await Promise.all(list.map(async t => {
      map[t.ticker] = t.is_us ? await fetchUSKline(t.ticker) : await fetchTWKline(t.ticker);
    }));
    setKlineMap(map);
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
      {/* 標題列 */}
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16}}>
        <div>
          <div style={{fontWeight:700, fontSize:15, color:C.text}}>再平衡訊號監控</div>
          <div style={{color:C.textMuted, fontSize:12, marginTop:2}}>布林通道 (20,2) + KDJ (9,3,3)｜箭頭標記為訊號觸發點</div>
        </div>
        <Btn onClick={()=>{ setShowAdd(!showAdd); setEditId(null); setForm({ticker:"",is_us:false,target:0.5,j_entry:10,j_exit:90,amount:0}); }}>
          {showAdd ? "✕ 取消" : "+ 新增股票"}
        </Btn>
      </div>

      {/* 新增/編輯表單 */}
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

      {/* 股票清單管理 */}
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

      {/* 圖表 */}
      {loading ? (
        <div style={{textAlign:"center", padding:40, color:C.accent}}>抓取K線資料中...</div>
      ) : (
        tickers.map(t => (
          <KChart
            key={t.id}
            data={klineMap[t.ticker]||[]}
            ticker={t.ticker}
            isUS={t.is_us}
            assets={allAssets}
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
    ticker:"QLD", is_us:true, amount:1000000, target:0.5, j_entry:10, j_exit:90, days:720
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  async function runBacktest() {
    setLoading(true); setResult(null);
    const raw = params.is_us ? await fetchUSKline(params.ticker, params.days) : await fetchTWKline(params.ticker, params.days);
    if (!raw.length) { setLoading(false); return; }

    const closes = raw.map(d=>d.close);
    const bb = calcBB(closes);
    const kdj = calcKDJ(closes);
    const signals = checkSignals(closes, bb, kdj, params.j_entry, params.j_exit);

    // 模擬再平衡
    let cash = params.amount * (1 - params.target);
    let shares = (params.amount * params.target) / closes[0];
    const equity = [{ date:raw[0].date, value:params.amount }];

    for (let i=1; i<closes.length; i++) {
      const totalNow = cash + shares * closes[i];
      const sig = signals.find(s=>s.index===i);
      if (sig) {
        const targetVal = totalNow * params.target;
        shares = targetVal / closes[i];
        cash = totalNow - targetVal;
      }
      equity.push({ date:raw[i].date, value:cash + shares*closes[i] });
    }

    const finalVal = equity[equity.length-1].value;
    const totalReturn = (finalVal - params.amount) / params.amount * 100;
    const maxDD = calcMaxDrawdown(equity.map(e=>e.value));
    const buyHoldReturn = (closes[closes.length-1] - closes[0]) / closes[0] * 100;

    setResult({ equity, finalVal, totalReturn, maxDD, buyHoldReturn, signals, raw });
    setLoading(false);
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

  useEffect(() => {
    if (!result || !chartRef.current) return;
    if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; }

    const chart = createChart(chartRef.current, {
      layout: { background:{ color:C.surface2 }, textColor:C.textMuted },
      grid: { vertLines:{ color:C.border }, horzLines:{ color:C.border } },
      rightPriceScale: { borderColor:C.border },
      timeScale: { borderColor:C.border },
      width: chartRef.current.clientWidth,
      height: 300,
    });
    chartInstance.current = chart;

    const stratLine = chart.addLineSeries({ color:C.accent, lineWidth:2, title:"策略" });
    stratLine.setData(result.equity.map(e=>({ time:e.date, value:e.value })));

    // 買進持有線
    const initShares = params.amount / result.raw[0].close;
    const bhLine = chart.addLineSeries({ color:C.blue, lineWidth:1, lineStyle:2, title:"買進持有" });
    bhLine.setData(result.raw.map(d=>({ time:d.date, value:initShares*d.close })));

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
      <div style={{color:C.textMuted, fontSize:12, marginBottom:16}}>布林 (20,2) + KDJ (9,3,3) 再平衡策略歷史模擬</div>

      <Card style={{padding:16, marginBottom:16}}>
        <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:14}}>
          {p("ticker","股票代號","text",{placeholder:"如 QLD / 00675L"})}
          {p("is_us","市場","select")}
          {p("amount","初始資金 (NT$)")}
          {p("target","股票佔比（0.5=50%）")}
          {p("j_entry","J值進場閾值")}
          {p("j_exit","J值出場閾值")}
          {p("days","回測天數")}
        </div>
        <Btn onClick={runBacktest} color={loading?C.textMuted:C.accent}>{loading?"計算中...":"▶ 執行回測"}</Btn>
      </Card>

      {result && (
        <>
          {/* 績效指標 */}
          <div style={{display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:16}}>
            {[
              ["策略報酬", `${result.totalReturn>=0?"+":""}${result.totalReturn.toFixed(1)}%`, result.totalReturn>=0?C.accent:C.red],
              ["買進持有", `${result.buyHoldReturn>=0?"+":""}${result.buyHoldReturn.toFixed(1)}%`, result.buyHoldReturn>=0?C.blue:C.red],
              ["最大回撤", `-${result.maxDD.toFixed(1)}%`, C.gold],
              ["訊號次數", `${result.signals.length} 次`, C.textMuted],
            ].map(([label, val, color])=>(
              <Card key={label} style={{padding:"12px 14px", textAlign:"center"}}>
                <div style={{color:C.textMuted, fontSize:11, marginBottom:6}}>{label}</div>
                <div style={{color, fontWeight:700, fontSize:18}}>{val}</div>
              </Card>
            ))}
          </div>
          <Card style={{padding:12, marginBottom:16}}>
            <div style={{color:C.textMuted, fontSize:11, marginBottom:8}}>資產曲線（青綠=策略，藍虛線=買進持有）</div>
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
      {/* Tab 切換 */}
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