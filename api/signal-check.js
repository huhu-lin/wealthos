import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const FINMIND_TOKEN = process.env.FINMIND_TOKEN;

async function fetchKline(ticker, isUS = false) {
  try {
    const end = new Date().toISOString().slice(0,10);
    if (isUS) {
      const start = new Date(Date.now()-60*86400000).toISOString().slice(0,10);
      const res = await fetch(`https://api.finmindtrade.com/api/v4/data?dataset=USStockPrice&data_id=${ticker}&start_date=${start}&end_date=${end}&token=${FINMIND_TOKEN}`);
      const json = await res.json();
      return (json.data||[]).map(d => d.Close);
    } else {
      const start = new Date(Date.now()-60*86400000).toISOString().slice(0,10);
      const res = await fetch(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${ticker}&start_date=${start}&end_date=${end}&token=${FINMIND_TOKEN}`);
      const json = await res.json();
      return (json.data||[]).map(d => d.close);
    }
  } catch { return []; }
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
    const low = Math.min(...slice);
    const rsv = high===low ? 50 : (closes[i]-low)/(high-low)*100;
    k = k*2/3 + rsv/3;
    d = d*2/3 + k/3;
  }
  const j = 3*k - 2*d;
  return { k, d, j };
}

function checkSignal(closes, jThresholdEntry=10, jThresholdExit=90) {
  const bb = calcBB(closes);
  const kdj = calcKDJ(closes);
  if (!bb || !kdj) return null;
  const price = closes[closes.length-1];
  const prevCloses = closes.slice(0,-1);
  const prevBB = calcBB(prevCloses);
  const prevKDJ = calcKDJ(prevCloses);
  if (!prevBB || !prevKDJ) return null;

  let signal = null;
  if (prevCloses[prevCloses.length-1] < prevBB.lower && prevKDJ.j < jThresholdEntry && kdj.j > jThresholdEntry) {
    signal = 'BUY';
  }
  if (prevCloses[prevCloses.length-1] > prevBB.upper && prevKDJ.j > jThresholdExit && kdj.j < jThresholdExit) {
    signal = 'SELL';
  }
  return { signal, price, bb, kdj };
}

async function sendTelegram(msg) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' })
  });
}

export default async function handler(req) {
  const tickers = [
    { ticker: '00675L', isUS: false },
    { ticker: 'QLD', isUS: true },
  ];

  const { data: assets } = await supabase.from('assets').select('*');
  const total = assets?.reduce((s,x)=>s+(x.value_twd||0),0) || 0;

  for (const { ticker, isUS } of tickers) {
    const closes = await fetchKline(ticker, isUS);
    const result = checkSignal(closes);
    if (!result || !result.signal) continue;

    const { signal, price, bb, kdj } = result;
    const signalText = signal === 'BUY' ? '📈 反轉向上訊號' : '📉 反轉向下訊號';
    const action = signal === 'BUY' ? '市場可能反彈，建議檢視資產比例' : '市場可能回落，建議檢視資產比例';

    const holding = assets?.filter(a=>a.ticker===ticker) || [];
    const holdingValue = holding.reduce((s,x)=>s+(x.value_twd||0),0);
    const actualPct = total>0 ? (holdingValue/total*100).toFixed(1) : 0;
    const targetPct = holding[0]?.target ? (holding[0].target*100).toFixed(1) : '-';
    const diffAmt = total>0 && holding[0]?.target ? Math.round((holding[0].target - holdingValue/total)*total) : '-';

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

    await sendTelegram(msg);
  }

  return new Response('ok', { status: 200 });
}

export const config = { runtime: 'edge' };