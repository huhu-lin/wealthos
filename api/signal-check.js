import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const KLINE_API = process.env.KLINE_API_URL || "https://wealthos-kline.onrender.com";

// ─── fetchKline：回傳完整 OHLCV（含 high/low，供正確 KDJ 計算）
async function fetchKline(ticker, isUS = false) {
  try {
    const endpoint = isUS
      ? `${KLINE_API}/kline/us?ticker=${ticker}&days=90`
      : `${KLINE_API}/kline/tw?ticker=${ticker}&days=90`;

    const res  = await fetch(endpoint);
    const json = await res.json();
    const data = (json.data || []).filter(d => d.close != null);
    console.log(`[${ticker}] K線筆數: ${data.length}, 最新收盤: ${data.at(-1)?.close?.toFixed(2)}`);
    return data; // 完整 OHLCV，不只是 closes
  } catch(e) {
    console.error(`[fetchKline] ${ticker} error:`, e.message);
    return [];
  }
}

// ─── 現價抓取（資產估值用）
async function fetchLatestPriceUS(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const json = await res.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    return closes.filter(v => v != null).at(-1) ?? 0;
  } catch { return 0; }
}

async function fetchLatestPriceTW(ticker) {
  try {
    const end   = new Date().toISOString().slice(0,10);
    const start = new Date(Date.now()-10*86400000).toISOString().slice(0,10);
    const res   = await fetch(
      `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${ticker}&start_date=${start}&end_date=${end}&token=${process.env.FINMIND_TOKEN}`
    );
    const json  = await res.json();
    return json.data?.at(-1)?.close ?? 0;
  } catch { return 0; }
}

async function fetchUSDTWD() {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/USDTWD=X?interval=1d&range=5d';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const json = await res.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const rate = closes.filter(v => v != null).at(-1) ?? 31.5;
    console.log(`[USDTWD] 匯率: ${rate.toFixed(2)}`);
    return rate;
  } catch(e) {
    console.error('[fetchUSDTWD] error:', e.message);
    return 31.5;
  }
}

// ─── 指標計算 ────────────────────────────────────────────────

function calcBB(closes, period=20, mult=2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a,b)=>a+b,0)/period;
  const std = Math.sqrt(slice.reduce((a,b)=>a+(b-mean)**2,0)/period);
  return { upper: mean+mult*std, lower: mean-mult*std, basis: mean };
}

// ✅ 修復：KDJ 改用實際 High/Low（與 Strategy.jsx D-001 同步）
// 原本用 closes 的 max/min 當 High/Low，技術上不正確
// 現在用真實蠟燭的最高/最低價計算 RSV，與業界標準（TradingView / 台灣券商）一致
function calcKDJ(closes, highs, lows, period=9) {
  if (closes.length < period) return null;
  let k = 50, d = 50;
  for (let i = period-1; i < closes.length; i++) {
    const high = Math.max(...highs.slice(i-period+1, i+1));
    const low  = Math.min(...lows.slice(i-period+1, i+1));
    const rsv  = high===low ? 50 : (closes[i]-low)/(high-low)*100;
    k = k*2/3 + rsv/3;
    d = d*2/3 + k/3;
  }
  return { k, d, j: 3*k - 2*d };
}

/**
 * 掃描整段 OHLCV，旗標跨K棒記憶，回傳「最新一根」是否觸發訊號
 *
 * @param {Array}  data           - 完整 OHLCV 陣列 [{date, open, high, low, close}, ...]
 * @param {string} strategyMode   - 'signal'（預設）| 'asymmetric'（P002 KDJ買+偏移賣）
 * @param {number} jThresholdEntry - J值買進閾值（預設 10）
 * @param {number} jThresholdExit  - J值賣出閾值（預設 90）
 *
 * P002 asymmetric 邏輯：買入走 KDJ，賣出走偏移閾值（由前端/監控判斷）
 * → 此函式只負責 KDJ 訊號，所以 P002 永遠不設 jAboveFlag，不發 SELL 通知
 */
function checkSignal(data, strategyMode='signal', jThresholdEntry=10, jThresholdExit=90) {
  if (data.length < 22) return { signal: null, reason: 'K線資料不足' };

  const closes = data.map(d => d.close);
  const highs  = data.map(d => d.high);
  const lows   = data.map(d => d.low);

  let jBelowFlag = false;
  let jAboveFlag = false;
  let signal = null;

  for (let i = 1; i < data.length; i++) {
    const closesSlice     = closes.slice(0, i+1);
    const closesSlicePrev = closes.slice(0, i);
    const highsSlice      = highs.slice(0, i+1);
    const highsSlicePrev  = highs.slice(0, i);
    const lowsSlice       = lows.slice(0, i+1);
    const lowsSlicePrev   = lows.slice(0, i);

    const bb      = calcBB(closesSlice);
    const kdj     = calcKDJ(closesSlice, highsSlice, lowsSlice);
    const prevBB  = calcBB(closesSlicePrev);
    const prevKDJ = calcKDJ(closesSlicePrev, highsSlicePrev, lowsSlicePrev);
    if (!bb || !kdj || !prevBB || !prevKDJ) continue;

    const price     = closes[i];
    const prevPrice = closes[i-1];

    // 買入旗標：所有策略模式都有
    if (prevPrice < prevBB.lower && prevKDJ.j < jThresholdEntry) jBelowFlag = true;

    // 賣出旗標：P002 非對稱模式跳過（賣出靠偏移閾值，不靠 KDJ）
    if (strategyMode !== 'asymmetric' && prevPrice > prevBB.upper && prevKDJ.j > jThresholdExit) {
      jAboveFlag = true;
    }

    if (jBelowFlag && kdj.j > jThresholdEntry) {
      signal = i === data.length-1 ? 'BUY' : null;
      jBelowFlag = false;
    }
    if (jAboveFlag && kdj.j < jThresholdExit) {
      signal = i === data.length-1 ? 'SELL' : null;
      jAboveFlag = false;
    }
  }

  const bb  = calcBB(closes);
  const kdj = calcKDJ(closes, highs, lows);
  const price = closes.at(-1);

  return { signal, price, bb, kdj, jBelowFlag, jAboveFlag };
}

// ─── 資產即時估值 ────────────────────────────────────────────
const US_TICKERS = ['QLD','VT'];

async function calcLiveValues(assets, usdtwd) {
  const result = [];
  for (const a of assets) {
    let valueTwd = 0;
    const shares = a.shares ?? 0;
    if (a.type === 'cash') {
      valueTwd = a.value_usd && a.value_usd > 0
        ? a.value_usd * usdtwd
        : (a.value_twd ?? 0);
    } else if (US_TICKERS.includes(a.name) || a.account === 'us') {
      const price = await fetchLatestPriceUS(a.ticker || a.name);
      valueTwd = shares * price * usdtwd;
    } else {
      const price = await fetchLatestPriceTW(a.ticker || a.name);
      valueTwd = shares * price;
    }
    result.push({ ...a, value_twd: valueTwd });
  }
  return result;
}

// ─── Telegram 推播 ───────────────────────────────────────────
async function sendTelegram(msg) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' })
  });
  const json = await res.json();
  console.log('[Telegram] response:', JSON.stringify(json));
  return json;
}

// ─── 主 Handler ──────────────────────────────────────────────
export default async function handler(req) {
  const { data: strategyTickers } = await supabase.from('strategy_tickers').select('*');
  if (!strategyTickers?.length) {
    console.log('[signal-check] 沒有策略設定，結束');
    return new Response('ok', { status: 200 });
  }

  const { data: rawAssets } = await supabase.from('assets').select('*');
  const usdtwd = await fetchUSDTWD();
  const assets = await calcLiveValues(rawAssets ?? [], usdtwd);
  const total  = assets.reduce((s,x)=>s+(x.value_twd||0),0);
  console.log(`[signal-check] 即時總資產 NT$${Math.round(total)}, 資產筆數 ${assets.length}`);

  for (const st of strategyTickers) {
    const {
      ticker,
      is_us: isUS,
      target,
      j_entry: jEntry,
      j_exit:  jExit,
      strategy_mode: strategyMode = 'signal',  // ✅ 新增：讀取策略模式
    } = st;

    // 取完整 OHLCV（供正確 KDJ 計算）
    const klineData = await fetchKline(ticker, isUS);
    if (!klineData.length) {
      console.warn(`[${ticker}] 無 K 線資料，跳過`);
      continue;
    }

    const result = checkSignal(klineData, strategyMode, jEntry, jExit);
    const { signal, price, bb, kdj, jBelowFlag, jAboveFlag } = result;

    const modeLabel = strategyMode === 'asymmetric' ? '⚡P002' : '訊號';
    console.log(`[${ticker}][${modeLabel}] signal=${signal ?? 'null'}, J=${kdj?.j?.toFixed(1)}, 蓄力=${jBelowFlag}, 過熱=${jAboveFlag}`);

    if (!signal) continue;

    const signalText = signal === 'BUY' ? '📈 反轉向上訊號' : '📉 反轉向下訊號';
    const action     = signal === 'BUY'
      ? '市場可能反彈，建議買入 ETF 恢復目標比例'
      : '市場可能回落，建議賣出 ETF 恢復目標比例';

    const holding      = assets.find(a => (a.ticker || a.name) === ticker);
    const holdingValue = holding?.value_twd ?? 0;
    const cashAsset    = isUS
      ? assets.find(a => a.name === 'USD')
      : assets.find(a => a.name === '現金');
    const cashValue  = cashAsset?.value_twd ?? 0;
    const poolTotal  = holdingValue + cashValue;

    const actualPct = poolTotal > 0 ? (holdingValue/poolTotal*100).toFixed(1) : '0.0';
    const targetPct = (target*100).toFixed(1);
    const diffAmt   = poolTotal > 0
      ? Math.round((target - holdingValue/poolTotal) * poolTotal) : '-';

    // 策略標籤（讓用戶知道哪個策略觸發）
    const strategyLabel = strategyMode === 'asymmetric'
      ? '⚡ P002 KDJ買+偏移賣（此為買入訊號）'
      : '📐 訊號再平衡（KDJ+布林雙確認）';

    const msg = [
      '🔔 <b>WealthOS 再平衡通知</b>',
      '',
      `<b>${ticker}</b> ${signalText}`,
      `現價：${isUS ? '$' : 'NT$'}${price?.toFixed(2)}`,
      `J值：${kdj?.j?.toFixed(1)}`,
      `策略：${strategyLabel}`,
      '',
      action,
      '',
      `目前佔比：${actualPct}%`,
      `目標佔比：${targetPct}%`,
      `建議調整：NT$${diffAmt > 0 ? '+' : ''}${diffAmt}`,
      '',
      '<i>資料來源：yfinance 還原股價</i>',
    ].join('\n');

    console.log(`[${ticker}] 發送 Telegram...`);
    await sendTelegram(msg);
  }

  return new Response('ok', { status: 200 });
}

export const config = { runtime: 'edge' };
