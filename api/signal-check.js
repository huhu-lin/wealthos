import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const FINMIND_TOKEN = process.env.FINMIND_TOKEN;

async function fetchKline(ticker, isUS = false) {
  try {
    const end = new Date().toISOString().slice(0,10);
    // 抓 60 天確保有足夠 K 棒計算 BB(20)
    const start = new Date(Date.now()-60*86400000).toISOString().slice(0,10);
    if (isUS) {
      const res = await fetch(`https://api.finmindtrade.com/api/v4/data?dataset=USStockPrice&data_id=${ticker}&start_date=${start}&end_date=${end}&token=${FINMIND_TOKEN}`);
      const json = await res.json();
      console.log(`[${ticker}] FinMind US raw count: ${json.data?.length ?? 0}`);
      return (json.data||[]).map(d => d.Close);
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

  const { data: assets } = await supabase.from('assets').select('*');
  const total = assets?.reduce((s,x)=>s+(x.value_twd||0),0) || 0;
  console.log(`[signal-check] 總資產 NT$${total}, 股票數 ${assets?.length ?? 0}`);

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