// ============================================================
// strategy/PreMarketSummary.jsx — 策略訊號監控摘要
// 總經指標 + AI 摘要已移至 Overview 的 MarketBrief 元件
// ============================================================

import { C } from "../constants/theme";
import { computeIndicators } from "../utils/strategyIndicators";
import Card from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";

export default function PreMarketSummary({ tickers, klineMap, allAssets }) {

  if (!tickers.length) return null;

  const today = new Date().toLocaleDateString('zh-TW', { month:'numeric', day:'numeric', weekday:'short' });

  const rows = tickers.map(t => {
    const data = klineMap[t.ticker] || [];
    if (data.length < 21) return null; // 至少需要 20 根才能算 BB

    const { closes, bb, kdj, signals: _sigs } = computeIndicators(data, {
      jEntry: t.j_entry, jExit: t.j_exit, strategyMode: t.strategy_mode || 'signal',
    });
    // 兩步驟訊號集合（P-007 signalActive 與 signal mode advice 使用）
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
