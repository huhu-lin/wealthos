// ============================================================
// strategy/KChart.jsx — 單檔 K 線圖（candles + KDJ）+ 訊號面板
// 從 Strategy.jsx 抽出，附帶 calcMonitorPerformance（僅 KChart 使用）。
// ============================================================

import { useEffect, useRef, useMemo } from "react";
import { createChart } from "lightweight-charts";
import { C } from "../constants/theme";
import { useIsMobile } from "../utils/useBreakpoint";
import { computeIndicators } from "../utils/strategyIndicators";
import { Card, Badge, fmt } from "./ui";

// ─── 監控策略績效模擬 ─────────────────────────────────────────
// 從進場日起，模擬嚴格執行策略的績效，用來與實際庫存比較
// 幣別說明：amount 跟 closes 都是同一幣別（美股=USD，台股=TWD），不需匯率轉換
export function calcMonitorPerformance(klineData, { amount, target, j_entry, j_exit, strategy_mode, gate_pct, entry_date }) {
  if (!amount || !entry_date || !klineData?.length) return null;
  const data = klineData.filter(d => d.date >= entry_date);
  if (data.length < 20) return null; // 資料不足（< 20根K棒），無法穩定計算指標

  const { closes, signals } = computeIndicators(data, {
    jEntry: j_entry, jExit: j_exit, strategyMode: strategy_mode,
  });
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
export default function KChart({ data, ticker, isUS, assets, target=0.5, jEntry=10, jExit=90, strategyMode='signal', driftPct=25, gatePct=13, tickerConfig=null, currentDrift=0 }) {
  const chartRef = useRef(null);
  const kdjRef = useRef(null);
  const chartInstance = useRef(null);
  const kdjInstance = useRef(null);
  const isMobile = useIsMobile();
  const chartH = isMobile ? 220 : 320;
  const kdjH   = isMobile ? 120 : 160;

  // 指標只算一次：給 useEffect（畫圖）與 render（狀態判斷面板）共用
  const ind = useMemo(
    () => computeIndicators(data, { jEntry, jExit, strategyMode }),
    [data, jEntry, jExit, strategyMode]
  );

  useEffect(() => {
    if (!data.length || !chartRef.current || !kdjRef.current) return;
    if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; }
    if (kdjInstance.current) { kdjInstance.current.remove(); kdjInstance.current = null; }

    const { bb, kdj, signals } = ind;

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

    // P-007：最後一根 K 棒用真實持倉的偏離判斷是否補金圈
    // 回測 rebalEvents 與真實持倉可能不同步，改用 currentDrift prop 直接判斷
    if (strategyMode === 'p007' && currentDrift >= gatePct) {
      const lastIdx = data.length - 1;
      const lastSig = signals.find(s => s.index === lastIdx);
      if (lastSig) {
        const alreadyMarked = allMarkers.some(m => m.time === data[lastIdx].date && m.shape === 'circle');
        if (!alreadyMarked) {
          allMarkers.push({
            time:     data[lastIdx].date,
            position: lastSig.type === 'BUY' ? 'belowBar' : 'aboveBar',
            color:    '#FFD700',
            shape:    'circle',
            text:     lastSig.type === 'BUY' ? '✓買' : '✓賣',
          });
        }
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
  }, [data, jEntry, jExit, chartH, kdjH, tickerConfig, currentDrift]);

  const { closes, bb, kdj, signals: _signals } = ind;
  const lastBB = bb[bb.length-1];
  const lastKDJ = kdj[kdj.length-1];
  const lastClose = closes[closes.length-1];

  // ── 兩步驟訊號集合（用於 P-007 signalActive 判斷，對齊 checkSignals 邏輯）
  const _buySigs  = useMemo(() => new Set(_signals.filter(s => s.type === 'BUY').map(s => s.index)), [_signals]);
  const _sellSigs = useMemo(() => new Set(_signals.filter(s => s.type === 'SELL').map(s => s.index)), [_signals]);
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
