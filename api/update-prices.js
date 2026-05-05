import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 統一走自有 kline-api（Render/yfinance），捨棄 FinMind 依賴
const KLINE_API = process.env.KLINE_API_URL || "https://wealthos-kline.onrender.com";

// ── 透過 kline-api 取最新收盤價（台股 or 美股）────────────
// 抓最近 10 天還原K線，取最後一根 close
// timeout 60 秒：Render 冷啟動最長約 50 秒
async function fetchLatestPrice(ticker, isUS) {
  try {
    const endpoint = isUS
      ? `${KLINE_API}/kline/us?ticker=${encodeURIComponent(ticker)}&days=10`
      : `${KLINE_API}/kline/tw?ticker=${encodeURIComponent(ticker)}&days=10`;
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) {
      console.warn(`[fetchLatestPrice] ${ticker} HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const data = json.data || [];
    if (data.length > 0) {
      const price = data[data.length - 1].close;
      console.log(`[fetchLatestPrice] ${ticker} → ${isUS ? '$' : 'NT$'}${price}`);
      return price;
    }
    console.warn(`[fetchLatestPrice] ${ticker}: 回傳空資料`);
  } catch(e) {
    console.error(`[fetchLatestPrice] ${ticker} error:`, e.message);
  }
  return null;
}

// ── 加密貨幣現價（CoinGecko，無 FinMind 替代）─────────────
async function fetchCryptoPrice(coinId) {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=twd`,
      { signal: AbortSignal.timeout(10000) }
    );
    const json = await res.json();
    return json[coinId]?.twd || null;
  } catch(e) {
    console.error(`[fetchCryptoPrice] ${coinId} error:`, e.message);
  }
  return null;
}

// ── USD/TWD 匯率（Yahoo Finance）──────────────────────────
async function fetchUSDTWD() {
  try {
    const res = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/USDTWD=X?interval=1d&range=5d',
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) }
    );
    const json = await res.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    return closes.filter(v => v != null).at(-1) ?? 31.5;
  } catch {}
  return 31.5;
}

export default async function handler(req) {
  // 允許 GET 和 POST（GitHub Actions 用 POST，前端按鈕也用 POST）
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  console.log('[update-prices] 開始更新資產現價（資料源：kline-api/yfinance）...');

  const { data: assets } = await supabase.from('assets').select('*');
  if (!assets?.length) {
    console.log('[update-prices] 沒有資產，結束');
    return new Response(JSON.stringify({ ok: true, results: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  const usdRate = await fetchUSDTWD();
  console.log(`[update-prices] USD/TWD: ${usdRate.toFixed(2)}`);

  const results = [];

  // ── 更新 assets 表 ────────────────────────────────────────
  for (const a of assets) {
    if (a.type === 'cash' || a.type === 'other') continue;

    let price = null;
    let value_twd = null;

    if (a.account === 'tw' && a.ticker) {
      price = await fetchLatestPrice(a.ticker, false);
      if (price) {
        value_twd = price * (a.shares || 0);
        await supabase.from('assets').update({ price, value_twd }).eq('id', a.id);
        console.log(`[assets/tw] ${a.ticker}: NT$${price} → 市值 NT$${Math.round(value_twd)}`);
      } else {
        console.warn(`[assets/tw] ${a.ticker}: 無法取得股價，跳過`);
      }
    } else if (a.account === 'us' && a.ticker) {
      price = await fetchLatestPrice(a.ticker, true);
      if (price) {
        const value_usd = price * (a.shares || 0);
        value_twd = value_usd * usdRate;
        await supabase.from('assets').update({
          price_usd: price, value_usd, value_twd
        }).eq('id', a.id);
        console.log(`[assets/us] ${a.ticker}: $${price} → NT$${Math.round(value_twd)}`);
      } else {
        console.warn(`[assets/us] ${a.ticker}: 無法取得股價，跳過`);
      }
    } else if (a.account === 'crypto' && a.coin_id) {
      price = await fetchCryptoPrice(a.coin_id);
      if (price) {
        value_twd = price * (a.shares || 0);
        await supabase.from('assets').update({
          price_twd: price, value_twd
        }).eq('id', a.id);
        console.log(`[assets/crypto] ${a.coin_id}: NT$${Math.round(price)} → NT$${Math.round(value_twd)}`);
      }
    }

    results.push({
      account: a.account,
      ticker: a.ticker || a.coin_id,
      price,
      value_twd,
      ok: price !== null,
    });
  }

  // ── 更新 pledges 表（質押股票現價）────────────────────────
  const { data: pledges } = await supabase.from('pledges').select('*');
  const pledgeResults = [];
  for (const p of pledges || []) {
    if (!p.ticker) continue;
    const price = await fetchLatestPrice(p.ticker, false); // 質押目前只支援台股
    if (price) {
      const market_value = price * (p.shares || 0);
      await supabase.from('pledges').update({ price, market_value }).eq('id', p.id);
      console.log(`[pledges] ${p.ticker}: NT$${price} → NT$${Math.round(market_value)}`);
      pledgeResults.push({ ticker: p.ticker, price, ok: true });
    } else {
      console.warn(`[pledges] ${p.ticker}: 無法取得股價，跳過`);
      pledgeResults.push({ ticker: p.ticker, price: null, ok: false });
    }
  }

  const successCount = results.filter(r => r.ok).length;
  const failCount    = results.filter(r => !r.ok).length;
  console.log(`[update-prices] assets 完成：成功 ${successCount} / 失敗 ${failCount}`);

  // ── 存每日淨值快照 ────────────────────────────────────────
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: existing } = await supabase
      .from('monthly_snapshots').select('id').eq('date', today).single();

    if (!existing) {
      const { data: latestAssets } = await supabase.from('assets').select('*');
      const { data: liabilities }  = await supabase.from('liabilities').select('*');
      const totalAssets = (latestAssets || []).reduce((s, x) => s + (x.value_twd || 0), 0);
      const totalLiab   = (liabilities  || []).reduce((s, x) => s + x.value, 0);
      const net         = totalAssets - totalLiab;
      const leverage    = net > 0 ? totalAssets / net : 0;
      await supabase.from('monthly_snapshots').insert({
        date: today, assets: totalAssets, liabilities: totalLiab, net, leverage
      });
      console.log(`[update-prices] 快照已存：${today}, 淨值 NT$${Math.round(net)}`);
    } else {
      console.log(`[update-prices] 今日快照已存在，跳過`);
    }
  } catch(e) {
    console.error('[update-prices] 存快照失敗:', e.message);
  }

  return new Response(JSON.stringify({
    ok: true,
    usdRate,
    successCount,
    failCount,
    results,
    pledgeResults,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export const config = { runtime: 'edge' };
