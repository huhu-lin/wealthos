// ============================================================
// strategy/BacktestTab.jsx — 多組合並排回測
// P-007 為主策略，含 BB/KDJ 訊號模式、偏移、週期、年度等
// ============================================================

import { useState, useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";
import { C } from "../constants/theme";
import { useIsMobile } from "../utils/useBreakpoint";
import { computeIndicators } from "../utils/strategyIndicators";
import { Card, Btn, Input, fmt } from "./ui";
import { fetchTWKline, fetchUSKline, pollKlineCache, bucketDays } from "./klineApi";

// 共用常數（年化計算 / 風險調整）
const TRADING_DAYS_PER_YEAR = 252;
const RISK_FREE_RATE = 0.02;

export default function BacktestTab() {
  const isMobile = useIsMobile();

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
    const annReturn = Math.pow(1 + totalReturn, TRADING_DAYS_PER_YEAR / tradingDays) - 1;
    const dailyReturns = [];
    for (let i = 1; i < equityValues.length; i++) {
      dailyReturns.push((equityValues[i] - equityValues[i-1]) / equityValues[i-1]);
    }
    const avgDailyRet = dailyReturns.reduce((a,b)=>a+b,0) / dailyReturns.length;
    const variance = dailyReturns.reduce((a,b)=>a+Math.pow(b-avgDailyRet,2),0) / dailyReturns.length;
    const annVol = Math.sqrt(variance * TRADING_DAYS_PER_YEAR);
    const sharpe = annVol > 0 ? (annReturn - RISK_FREE_RATE) / annVol : 0;
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

      const { closes, signals } = computeIndicators(alignedRaw, {
        jEntry: cp.j_entry, jExit: cp.j_exit,
      });
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
      const annualR = sel.annual ? sr((i) => i % TRADING_DAYS_PER_YEAR === 0) : null;
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
        isDataShort: (cp.days - Math.round(tradingDays * 365 / TRADING_DAYS_PER_YEAR)) > 90,
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
