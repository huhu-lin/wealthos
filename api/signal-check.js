import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const FINMIND_TOKEN = process.env.FINMIND_TOKEN;

async function fetchKlineUS(ticker) {
  try {
    // Yahoo Finance v8 — 不需要 token，60 天日K
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=3mo`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const json = await res.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const filtered = closes.filter(v => v != null);
    console.log(`[${ticker}] Yahoo Finance raw count: ${filtered.length}`);
    return filtered;
  } catch(e) {
    console.error(`[fetchKlineUS] ${ticker} error:`, e.message);
    return [];
  }
}

async function fetchKline(ticker, isUS = false) {
  try {
    const end = new Date().toISOString().slice(0,10);
    // 抓 60 天確保有足夠 K 棒計算 BB(20)
    const start = new Date(Date.now()-60*86400000).toISOString().slice(0,10);
    if (isUS) {
      return await fetchKlineUS(ticker);
    } else {
      const res = await fetch(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${ticker}&start_date=${start}&end_date=${end}&token=${FINMIND_TOKEN}`);
      const json = await res.json();
      console.log(`[${ticker}] FinMind TW raw count: ${json.data?.length ?? 0}`);
      return (json.data||[]).map(d => d.close);
    }
  } catch(e) {
    console.error(`[fetchKline] ${ticker} error:`, e.message);
    return [];
  }
}

function calcBB(closes, period=20, mult=2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a,b)=>a+b,0)/period;
  const std = Math.sqrt(slice.reduce((a,b)=>a+(b-mean)**2,0)/period);
  return { upper: mean+mult*std, lower: mean-mult*std, basis: mean };
}

function calcKDJ(closes, period=9) {
  if (closes.length < period) return null;
  let k = 50, d = 50;
  for (let i = period-1; i < closes.length; i++) {
    const slice = closes.slice(i-period+1, i+1);
    const high = Math.max(...slice);
    const low  = Math.min(...slice);
    const rsv  = high===low ? 50 : (closes[i]-low)/(high-low)*100;
    k = k*2/3 + rsv/3;
    d = d*2/3 + k/3;
  }
  const j = 3*k - 2*d;
  return { k, d, j };
}

/**
 * 修正版：掃描整個 closes 陣列，用旗標跨K棒記憶，與 TradingView Pine 邏輯一致
 * 只回傳「最新一根 K 棒」是否觸發訊號
 */
function checkSignal(closes, jThresholdEntry=10, jThresholdExit=90) {
  if (closes.length < 22) return { signal: null, reason: 'K線資料不足' };

  let jBelowFlag = false;
  let jAboveFlag = false;
  let signal = null;

  for (let i = 1; i < closes.length; i++) {
    const bb    = calcBB(closes.slice(0, i+1));
    const kdj   = calcKDJ(closes.slice(0, i+1));
    const prevBB  = calcBB(closes.slice(0, i));
    const prevKDJ = calcKDJ(closes.slice(0, i));
    if (!bb || !kdj || !prevBB || !prevKDJ) continue;

    const price     = closes[i];
    const prevPrice = closes[i-1];

    // 設旗標：前一根低於下軌且 J 低於進場閾值
    if (prevPrice < prevBB.lower && prevKDJ.j < jThresholdEntry) jBelowFlag = true;
    // 設旗標：前一根高於上軌且 J 高於出場閾值
    if (prevPrice > prevBB.upper && prevKDJ.j > jThresholdExit)  jAboveFlag = true;

    // 進場：旗標成立 + J 值反彈突破進場閾值
    if (jBelowFlag && kdj.j > jThresholdEntry) {
      signal = i === closes.length-1 ? 'BUY' : null; // 只在最後一根觸發才算「今日訊號」
      jBelowFlag = false;
    }
    // 出場：旗標成立 + J 值跌破出場閾值
    if (jAboveFlag && kdj.j < jThresholdExit) {
      signal = i === closes.length-1 ? 'SELL' : null;
      jAboveFlag = false;
    }
  }

  const bb  = calcBB(closes);
  const kdj = calcKDJ(closes);
  const price = closes[closes.length-1];

  return { signal, price, bb, kdj, jBelowFlag, jAboveFlag };
}

// 抓 USD/TWD 即時匯率
async function fetchUSDTWD() {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/USDTWD=X?interval=1d&range=5d';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const json = await res.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const rate = closes.filter(v => v != null).slice(-1)[0] ?? 31.5;
    console.log(`[USDTWD] 匯率: ${rate.toFixed(2)}`);
    return rate;
  } catch(e) {
    console.error('[fetchUSDTWD] error:', e.message);
    return 31.5; // fallback
  }
}

// 抓美股最新收盤價（單一 ticker）
async function fetchLatestPriceUS(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const json = await res.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    return closes.filter(v => v != null).slice(-1)[0] ?? 0;
  } catch { return 0; }
}

// 抓台股最新收盤價（單一 ticker）
async function fetchLatestPriceTW(ticker) {
  try {
    const end   = new Date().toISOString().slice(0,10);
    const start = new Date(Date.now()-10*86400000).toISOString().slice(0,10);
    const res   = await fetch(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${ticker}&start_date=${start}&end_date=${end}&token=${FINMIND_TOKEN}`);
    const json  = await res.json();
    const arr   = json.data ?? [];
    return arr[arr.length-1]?.close ?? 0;
  } catch { return 0; }
}

// US tickers（用來判斷是否乘匯率）
const US_TICKERS = ['QLD','VT'];
const TW_TICKERS = ['006208','00675L'];

// 計算各資產即時 value_twd
async function calcLiveValues(assets, usdtwd) {
  const result = [];
  for (const a of assets) {
    let valueTwd = 0;
    const shares = a.shares ?? 0;
    if (shares === 0) {
      // 現金類：直接用 value 欄位（如果有）或 price
      if (a.name === 'USD') {
        // USD 現金：shares 存的是美元金額
        valueTwd = (a.shares || 0) * usdtwd;
      } else {
        // 台幣現金：price 欄位存台幣金額
        valueTwd = a.price ?? 0;
      }
    } else if (US_TICKERS.includes(a.name)) {
      const price = await fetchLatestPriceUS(a.name);
      valueTwd = shares * price * usdtwd;
      console.log(`[liveValue] ${a.name}: ${shares} 股 × $${price.toFixed(2)} × ${usdtwd.toFixed(2)} = NT$${Math.round(valueTwd)}`);
    } else {
      const price = await fetchLatestPriceTW(a.name);
      valueTwd = shares * price;
      console.log(`[liveValue] ${a.name}: ${shares} 股 × NT$${price.toFixed(2)} = NT$${Math.round(valueTwd)}`);
    }
    result.push({ ...a, value_twd: valueTwd });
  }
  return result;
}

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

export default async function handler(req) {
  const tickers = [
    { ticker: '00675L', isUS: false },
    { ticker: 'QLD',    isUS: true  },
  ];

  const { data: rawAssets } = await supabase.from('assets').select('*');
  const usdtwd = await fetchUSDTWD();
  const assets = await calcLiveValues(rawAssets ?? [], usdtwd);
  const total  = assets.reduce((s,x)=>s+(x.value_twd||0),0);
  console.log(`[signal-check] 即時總資產 NT$${Math.round(total)}, 股票數 ${assets.length}`);

  for (const { ticker, isUS } of tickers) {
    const closes = await fetchKline(ticker, isUS);
    console.log(`[${ticker}] K線筆數: ${closes.length}, 最新收盤: ${closes[closes.length-1]?.toFixed(2)}`);

    const result = checkSignal(closes);
    const { signal, price, bb, kdj, jBelowFlag, jAboveFlag } = result;

    console.log(`[${ticker}] signal=${signal ?? 'null'}, J=${kdj?.j?.toFixed(1)}, 蓄力旗標=${jBelowFlag}, 過熱旗標=${jAboveFlag}`);
    if (bb) {
      console.log(`[${ticker}] BB上軌=${bb.upper?.toFixed(2)}, BB下軌=${bb.lower?.toFixed(2)}, 收盤=${price?.toFixed(2)}`);
    }

    if (!signal) continue;

    const signalText = signal === 'BUY' ? '📈 反轉向上訊號' : '📉 反轉向下訊號';
    const action     = signal === 'BUY' ? '市場可能反彈，建議檢視資產比例' : '市場可能回落，建議檢視資產比例';

    const holding      = assets?.filter(a=>a.ticker===ticker) || [];
    const holdingValue = holding.reduce((s,x)=>s+(x.value_twd||0),0);
    const actualPct    = total>0 ? (holdingValue/total*100).toFixed(1) : 0;
    const targetPct    = holding[0]?.target ? (holding[0].target*100).toFixed(1) : '-';
    const diffAmt      = total>0 && holding[0]?.target
      ? Math.round((holding[0].target - holdingValue/total)*total) : '-';

    const msg = [
      '🔔 <b>WealthOS 再平衡通知</b>',
      '',
      '<b>' + ticker + '</b> ' + signalText,
      '現價：' + (isUS ? '$' : 'NT$') + price.toFixed(2),
      'J值：' + kdj.j.toFixed(1),
      '',
      action,
      '',
      '目前佔比：' + actualPct + '%',
      '目標佔比：' + targetPct + '%',
      '建議調整：NT$' + (diffAmt > 0 ? '+' : '') + diffAmt,
    ].join('\n');

    console.log(`[${ticker}] 發送 Telegram...`);
    await sendTelegram(msg);
  }

  return new Response('ok', { status: 200 });
}

export const config = { runtime: 'edge' };