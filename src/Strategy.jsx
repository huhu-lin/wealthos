import { useState, useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";

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

async function fetchTWKline(ticker) {
  try {
    const end = new Date().toISOString().slice(0,10);
    const start = new Date(Date.now()-720*86400000).toISOString().slice(0,10);
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${ticker}&start_date=${start}&end_date=${end}&token=${FINMIND_TOKEN}`;
    const res = await fetch(url);
    const json = await res.json();
    return json.data || [];
  } catch { return []; }
}

async function fetchUSKline(ticker) {
  try {
    const end = new Date().toISOString().slice(0,10);
    const start = new Date(Date.now()-720*86400000).toISOString().slice(0,10);
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=USStockPrice&data_id=${ticker}&start_date=${start}&end_date=${end}&token=${FINMIND_TOKEN}`;
    const res = await fetch(url);
    const json = await res.json();
    return (json.data||[]).map(d=>({
  date: d.date, open: d.Open, high: d.High, low: d.Low, close: d.Close
}));
  } catch { return []; }
}

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
    const j = 3*k - 2*d;
    return { k, d, j };
  });
}

function checkSignals(closes, bb, kdj) {
  const signals = [];
  let jBelowFlag = false;
  let jAboveFlag = false;
  for (let i = 1; i < closes.length; i++) {
    if (!bb[i] || !kdj[i] || !bb[i-1] || !kdj[i-1]) continue;
    if (closes[i-1] < bb[i-1].lower && kdj[i-1].j < 20) jBelowFlag = true;
    if (closes[i-1] > bb[i-1].upper && kdj[i-1].j > 80) jAboveFlag = true;
    if (jBelowFlag && kdj[i].j > 20) {
      signals.push({ index: i, type: 'BUY' });
      jBelowFlag = false;
    }
    if (jAboveFlag && kdj[i].j < 80) {
      signals.push({ index: i, type: 'SELL' });
      jAboveFlag = false;
    }
  }
  return signals;
}

function KChart({ data, ticker, isUS, assets }) {
  const chartRef = useRef(null);
  const kdjRef = useRef(null);
  const chartInstance = useRef(null);
  const kdjInstance = useRef(null);

  useEffect(() => {
    if (!data.length || !chartRef.current || !kdjRef.current) return;

    // cleanup
    if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; }
    if (kdjInstance.current) { kdjInstance.current.remove(); kdjInstance.current = null; }

    const closes = data.map(d => d.close);
    const bb = calcBB(closes);
    const kdj = calcKDJ(closes);
    const signals = checkSignals(closes, bb, kdj);

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

    // K線
    const candleSeries = chart.addCandlestickSeries({
      upColor: C.accent, downColor: C.red,
      borderUpColor: C.accent, borderDownColor: C.red,
      wickUpColor: C.accent, wickDownColor: C.red,
    });
    candleSeries.setData(data.map(d => ({
      time: d.date, open: d.open, high: d.high, low: d.low, close: d.close
    })));

    // 布林通道
    const upperSeries = chart.addLineSeries({ color: C.orange, lineWidth: 1, lineStyle: 2, title: '上軌' });
    const lowerSeries = chart.addLineSeries({ color: C.orange, lineWidth: 1, lineStyle: 2, title: '下軌' });
    const basisSeries = chart.addLineSeries({ color: C.gold, lineWidth: 1, lineStyle: 0, title: 'MA20' });

    upperSeries.setData(data.map((d,i) => bb[i] ? { time: d.date, value: bb[i].upper } : null).filter(Boolean));
    lowerSeries.setData(data.map((d,i) => bb[i] ? { time: d.date, value: bb[i].lower } : null).filter(Boolean));
    basisSeries.setData(data.map((d,i) => bb[i] ? { time: d.date, value: bb[i].basis } : null).filter(Boolean));

    // 訊號標記
    const markers = signals.map(s => ({
      time: data[s.index].date,
      position: s.type === 'BUY' ? 'belowBar' : 'aboveBar',
      color: s.type === 'BUY' ? C.accent : C.red,
      shape: s.type === 'BUY' ? 'arrowUp' : 'arrowDown',
      text: s.type === 'BUY' ? '再平衡↑' : '再平衡↓',
    }));
    candleSeries.setMarkers(markers);

    // KDJ 圖
    const kdjChart = createChart(kdjRef.current, {
      ...chartOpts,
      height: 160,
      timeScale: { visible: false },
    });
    kdjInstance.current = kdjChart;

    const kSeries = kdjChart.addLineSeries({ color: C.blue, lineWidth: 1, title: 'K' });
    const dSeries = kdjChart.addLineSeries({ color: C.gold, lineWidth: 1, title: 'D' });
    const jSeries = kdjChart.addLineSeries({ color: C.accent, lineWidth: 1, title: 'J' });

    kSeries.setData(data.map((d,i) => kdj[i] ? { time: d.date, value: kdj[i].k } : null).filter(Boolean));
    dSeries.setData(data.map((d,i) => kdj[i] ? { time: d.date, value: kdj[i].d } : null).filter(Boolean));
    jSeries.setData(data.map((d,i) => kdj[i] ? { time: d.date, value: kdj[i].j } : null).filter(Boolean));

    // 超買超賣線
    const ob = kdjChart.addLineSeries({ color: C.red+"80", lineWidth: 1, lineStyle: 2 });
    const os = kdjChart.addLineSeries({ color: C.accent+"80", lineWidth: 1, lineStyle: 2 });
    ob.setData(data.map(d => ({ time: d.date, value: 80 })));
    os.setData(data.map(d => ({ time: d.date, value: 20 })));

    // 同步時間軸
    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (range) kdjChart.timeScale().setVisibleLogicalRange(range);
    });
    kdjChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (range) chart.timeScale().setVisibleLogicalRange(range);
    });

    chart.timeScale().fitContent();
    kdjChart.timeScale().fitContent();

    return () => {
      if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; }
      if (kdjInstance.current) { kdjInstance.current.remove(); kdjInstance.current = null; }
    };
  }, [data]);

  // 計算目前狀態
  const closes = data.map(d => d.close);
  const bb = calcBB(closes);
  const kdj = calcKDJ(closes);
  const lastBB = bb[bb.length-1];
  const lastKDJ = kdj[kdj.length-1];
  const lastClose = closes[closes.length-1];

  let status = '正常';
  let statusColor = C.textMuted;
  if (lastBB && lastKDJ) {
    if (lastClose < lastBB.lower && lastKDJ.j < 20) { status = '蓄力中 ⚡'; statusColor = C.accent; }
    else if (lastClose > lastBB.upper && lastKDJ.j > 80) { status = '過熱中 🔥'; statusColor = C.red; }
    else if (lastKDJ.j < 20) { status = 'J值低位'; statusColor = C.blue; }
    else if (lastKDJ.j > 80) { status = 'J值高位'; statusColor = C.gold; }
  }

  // 計算佔比
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
        {lastKDJ && <span style={{color:C.textMuted, fontSize:12}}>J值 <span style={{color:lastKDJ.j>80?C.red:lastKDJ.j<20?C.accent:C.textMuted, fontWeight:600}}>{lastKDJ.j.toFixed(1)}</span></span>}
      </div>

      {targetPct!=null && (
        <div style={{display:"flex", gap:16, marginBottom:12, padding:"10px 14px", background:C.surface, borderRadius:8, border:`1px solid ${C.border}`, fontSize:12}}>
          <span style={{color:C.textMuted}}>實際佔比 <span style={{color:C.text, fontWeight:600}}>{actualPct.toFixed(1)}%</span></span>
          <span style={{color:C.textMuted}}>目標佔比 <span style={{color:C.text, fontWeight:600}}>{targetPct.toFixed(1)}%</span></span>
          <span style={{color:C.textMuted}}>建議
            <span style={{color:diffAmt>0?C.accent:C.red, fontWeight:600}}>
              {diffAmt>0?' 買入':' 賣出'} NT${fmt(Math.abs(diffAmt))}
            </span>
          </span>
        </div>
      )}

      <div ref={chartRef} style={{width:"100%", borderRadius:8, overflow:"hidden"}}/>
      <div style={{display:"flex", gap:12, padding:"6px 0", fontSize:11}}>
        {[["K",C.blue],["D",C.gold],["J",C.accent],["超買/超賣",C.red+"80"]].map(([l,c])=>(
          <div key={l} style={{display:"flex", alignItems:"center", gap:4}}>
            <div style={{width:12, height:2, background:c}}/><span style={{color:C.textMuted}}>{l}</span>
          </div>
        ))}
      </div>
      <div ref={kdjRef} style={{width:"100%", borderRadius:8, overflow:"hidden"}}/>
    </Card>
  );
}

export default function Strategy({ allAssets }) {
  const [twData, setTwData] = useState([]);
  const [usData, setUsData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [tw, us] = await Promise.all([
        fetchTWKline("00675L"),
        fetchUSKline("QLD"),
      ]);
      setTwData(tw.map(d => ({ date: d.date, open: d.open, high: d.max, low: d.min, close: d.close })));
      setUsData(us);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return (
    <div style={{textAlign:"center", padding:40, color:C.accent}}>抓取K線資料中...</div>
  );

  return (
    <div style={{display:"flex", flexDirection:"column", gap:14}}>
      <div style={{fontWeight:700, fontSize:15, color:C.text}}>再平衡訊號監控</div>
      <div style={{color:C.textMuted, fontSize:12, marginTop:-8}}>
        布林通道 (20,2) + KDJ (9,3,3)｜箭頭標記為訊號觸發點
      </div>
      <KChart data={twData} ticker="00675L" isUS={false} assets={allAssets.filter(a=>a.account==="tw")}/>
      <KChart data={usData} ticker="QLD" isUS={true} assets={allAssets.filter(a=>a.account==="us")}/>
    </div>
  );
}