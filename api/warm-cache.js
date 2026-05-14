import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const KLINE_API = process.env.KLINE_API_URL || "https://wealthos-kline.onrender.com";

export default async function handler(req) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  console.log('[warm-cache] 開始預熱 K 線快取...');

  // 讀取所有監控中的股票
  const { data: tickers } = await supabase
    .from('strategy_tickers')
    .select('ticker, is_us');

  if (!tickers?.length) {
    console.log('[warm-cache] 沒有監控股票，結束');
    return new Response('ok', { status: 200 });
  }

  const results = [];

  for (const t of tickers) {
    const endpoint = t.is_us
      ? `${KLINE_API}/kline/us?ticker=${t.ticker}&days=720`
      : `${KLINE_API}/kline/tw?ticker=${t.ticker}&days=720`;

    try {
      console.log(`[warm-cache] 預熱 ${t.ticker}...`);
      const res = await fetch(endpoint);
      const json = await res.json();
      const count = json.data?.length || 0;
      console.log(`[warm-cache] ${t.ticker} 完成，${count} 筆資料，來源：${json.source}`);
      results.push({ ticker: t.ticker, count, source: json.source });
    } catch(e) {
      console.error(`[warm-cache] ${t.ticker} 失敗：`, e.message);
      results.push({ ticker: t.ticker, error: e.message });
    }
  }

  console.log('[warm-cache] 全部完成！', JSON.stringify(results));
  return new Response(JSON.stringify({ ok: true, results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export const config = { runtime: 'edge' };
