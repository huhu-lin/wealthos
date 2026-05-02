import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const FINMIND_TOKEN = process.env.FINMIND_TOKEN;

// ── 台股現價 ──────────────────────────────────────────────
async function fetchTWPrice(ticker) {
  try {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const res = await fetch(
      `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${ticker}&start_date=${start}&end_date=${end}&token=${FINMIND_TOKEN}`
    );
    const json = await res.json();
    if (json.data?.length > 0) return json.data[json.data.length - 1].close;
  } catch {}
  return null;
}

// ── 美股現價 ──────────────────────────────────────────────
async function fetchUSPrice(ticker) {
  try {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const res = await fetch(
      `https://api.finmindtrade.com/api/v4/data?dataset=USStockPrice&data_id=${ticker}&start_date=${start}&end_date=${end}&token=${FINMIND_TOKEN}`
    );
    const json = await res.json();
    if (json.data?.length > 0) return json.data[json.data.length - 1].Close;
  } catch {}
  return null;
}

// ── 加密貨幣現價 ──────────────────────────────────────────
async function fetchCryptoPrice(coinId) {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=twd`
    );
    const json = await res.json();
    return json[coinId]?.twd || null;
  } catch {}
  return null;
}

// ── 匯率 ──────────────────────────────────────────────────
async function fetchUSDTWD() {
  try {
    const res = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/USDTWD=X?interval=1d&range=5d',
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const json = await res.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    return closes.filter(v => v != null).at(-1) ?? 31.5;
  } catch {}
  return 31.5;
}

export default async function handler(req) {
  console.log('[update-prices] 開始自動更新資產現價...');

  const { data: assets } = await supabase.from('assets').select('*');
  if (!assets?.length) {
    console.log('[update-prices] 沒有資產，結束');
    return new Response('ok', { status: 200 });
  }

  const usdRate = await fetchUSDTWD();
  console.log(`[update-prices] USD/TWD: ${usdRate.toFixed(2)}`);

  const results = [];

  for (const a of assets) {
    // 現金類不需要更新
    if (a.type === 'cash' || a.type === 'other') continue;

    let price = null;
    let value_twd = null;

    if (a.account === 'tw' && a.ticker) {
      price = await fetchTWPrice(a.ticker);
      if (price) {
        value_twd = price * (a.shares || 0);
        await supabase.from('assets').update({ price, value_twd }).eq('id', a.id);
        console.log(`[update-prices] ${a.ticker}: NT$${price} → NT$${Math.round(value_twd)}`);
      }
    } else if (a.account === 'us' && a.ticker) {
      price = await fetchUSPrice(a.ticker);
      if (price) {
        const value_usd = price * (a.shares || 0);
        value_twd = value_usd * usdRate;
        await supabase.from('assets').update({
          price_usd: price, value_usd, value_twd
        }).eq('id', a.id);
        console.log(`[update-prices] ${a.ticker}: $${price} → NT$${Math.round(value_twd)}`);
      }
    } else if (a.account === 'crypto' && a.coin_id) {
      price = await fetchCryptoPrice(a.coin_id);
      if (price) {
        value_twd = price * (a.shares || 0);
        await supabase.from('assets').update({
          price_twd: price, value_twd
        }).eq('id', a.id);
        console.log(`[update-prices] ${a.coin_id}: NT$${Math.round(price)} → NT$${Math.round(value_twd)}`);
      }
    }

    results.push({ ticker: a.ticker || a.coin_id, price, value_twd });
  }

  console.log(`[update-prices] 完成！更新 ${results.length} 筆資產`);
  return new Response(JSON.stringify({ ok: true, usdRate, results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export const config = { runtime: 'edge' };
