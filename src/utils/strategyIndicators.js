// ============================================================
// strategyIndicators.js — KDJ + Bollinger Bands 純函式
// 從 Strategy.jsx 抽出，方便 KChart / PreMarketSummary / BacktestTab
// 與未來 signal-check.js 共用。所有函式皆為 pure，無副作用。
// ============================================================

// 布林通道（20 期，±2σ）
export function calcBB(closes, period = 20, mult = 2) {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    return { upper: mean + mult * std, lower: mean - mult * std, basis: mean };
  });
}

// KDJ（9 期），RSV 使用實際 High/Low，與 TradingView 標準一致
export function calcKDJ(closes, highs, lows, period = 9) {
  let k = 50, d = 50;
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    const high = Math.max(...highs.slice(i - period + 1, i + 1));
    const low = Math.min(...lows.slice(i - period + 1, i + 1));
    const rsv = high === low ? 50 : (closes[i] - low) / (high - low) * 100;
    k = k * 2 / 3 + rsv / 3;
    d = d * 2 / 3 + k / 3;
    return { k, d, j: 3 * k - 2 * d };
  });
}

// 跨 K 棒兩步驟訊號（過閾值→回歸）
// strategyMode='asymmetric'（P002）：賣出靠偏移閾值，不靠 KDJ
export function checkSignals(closes, bb, kdj, jEntry = 10, jExit = 90, strategyMode = 'signal') {
  const signals = [];
  let jBelowFlag = false, jAboveFlag = false;
  for (let i = 1; i < closes.length; i++) {
    if (!bb[i] || !kdj[i] || !bb[i - 1] || !kdj[i - 1]) continue;
    if (closes[i - 1] < bb[i - 1].lower && kdj[i - 1].j < jEntry) jBelowFlag = true;
    if (strategyMode !== 'asymmetric' && closes[i - 1] > bb[i - 1].upper && kdj[i - 1].j > jExit) jAboveFlag = true;
    if (jBelowFlag && kdj[i].j > jEntry) { signals.push({ index: i, type: 'BUY' }); jBelowFlag = false; }
    if (jAboveFlag && kdj[i].j < jExit) { signals.push({ index: i, type: 'SELL' }); jAboveFlag = false; }
  }
  return signals;
}

// 一次算出 closes/highs/lows/bb/kdj，避免散落各處重複的解構
// 注意：highs/lows 在缺值時 fallback close（與舊行為一致）
export function computeIndicators(data, { jEntry = 10, jExit = 90, strategyMode = 'signal' } = {}) {
  const closes = data.map(d => d.close);
  const highs = data.map(d => d.high || d.close);
  const lows = data.map(d => d.low || d.close);
  const bb = calcBB(closes);
  const kdj = calcKDJ(closes, highs, lows);
  const signals = checkSignals(closes, bb, kdj, jEntry, jExit, strategyMode);
  return { closes, highs, lows, bb, kdj, signals };
}
