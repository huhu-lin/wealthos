import { createClient } from '@supabase/supabase-js';

// 前端呼叫時帶 Authorization: Bearer <user_jwt>
// 用 ANON_KEY + user JWT 建立有身份的 client，auth.uid() 正確 → RLS 正常運作
// 不需要 SERVICE_KEY，也不需要在 Vercel 加新的環境變數
function getSupabase(req) {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}
  );
}

// ── 直接從 Yahoo Finance 抓最新收盤價（不經 Render/kline-api）─────────
// 優點：無冷啟動、<5 秒、Edge Function 30s 上限輕鬆應對
// 台股 ticker 格式：006208.TW、00675L.TW
// 美股 ticker 格式：QLD、SPY（直接用）
async function fetchLatestPrice(ticker, isUS) {
  try {
    const symbol = isUS ? ticker.toUpperCase() : `${ticker.toUpperCase()}.TW`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn(`[fetchLatestPrice] ${symbol} HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const price = closes.filter(v => v != null).at(-1) ?? null;
    if (price) console.log(`[fetchLatestPrice] ${symbol} → ${isUS ? '$' : 'NT$'}${price}`);
    else console.warn(`[fetchLatestPrice] ${symbol}: 無收盤價`);
    return price;
  } catch(e) {
    console.error(`[fetchLatestPrice] ${ticker}:`, e.message);
    return null;
  }
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

  const supabase = getSupabase(req);
  const [{ data: assets }, { data: pledges }] = await Promise.all([
    supabase.from('assets').select('*'),
    supabase.from('pledges').select('*'),
  ]);

  if (!assets?.length) {
    console.log('[update-prices] 沒有資產，結束');
    return new Response(JSON.stringify({ ok: true, results: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  const usdRate = await fetchUSDTWD();
  console.log(`[update-prices] USD/TWD: ${usdRate.toFixed(2)}`);

  // ── 並行更新 assets（所有股票同時發請求，Render 只需冷啟動一次）────────
  const updateAsset = async (a) => {
    if (a.type === 'cash' || a.type === 'other') return { account: a.account, ticker: a.ticker, price: null, value_twd: null, ok: false, skipped: true };

    let price = null;
    let value_twd = null;

    if (a.account === 'tw' && a.ticker) {
      price = await fetchLatestPrice(a.ticker, false);
      if (price) {
        value_twd = price * (a.shares || 0);
        await supabase.from('assets').update({ price, value_twd }).eq('id', a.id);
        console.log(`[assets/tw] ${a.ticker}: NT$${price} → NT$${Math.round(value_twd)}`);
      } else {
        console.warn(`[assets/tw] ${a.ticker}: 無法取得股價`);
      }
    } else if (a.account === 'us' && a.ticker) {
      price = await fetchLatestPrice(a.ticker, true);
      if (price) {
        const value_usd = price * (a.shares || 0);
        value_twd = value_usd * usdRate;
        await supabase.from('assets').update({ price_usd: price, value_usd, value_twd }).eq('id', a.id);
        console.log(`[assets/us] ${a.ticker}: $${price} → NT$${Math.round(value_twd)}`);
      } else {
        console.warn(`[assets/us] ${a.ticker}: 無法取得股價`);
      }
    } else if (a.account === 'crypto' && a.coin_id) {
      price = await fetchCryptoPrice(a.coin_id);
      if (price) {
        value_twd = price * (a.shares || 0);
        await supabase.from('assets').update({ price_twd: price, value_twd }).eq('id', a.id);
        console.log(`[assets/crypto] ${a.coin_id}: NT$${Math.round(price)} → NT$${Math.round(value_twd)}`);
      }
    }
    return { account: a.account, ticker: a.ticker || a.coin_id, price, value_twd, ok: price !== null };
  };

  // ── 並行更新 pledges ────────────────────────────────────────
  const updatePledge = async (p) => {
    if (!p.ticker) return null;
    const price = await fetchLatestPrice(p.ticker, false);
    if (price) {
      const market_value = price * (p.shares || 0);
      await supabase.from('pledges').update({ price, market_value }).eq('id', p.id);
      console.log(`[pledges] ${p.ticker}: NT$${price} → NT$${Math.round(market_value)}`);
      return { ticker: p.ticker, price, ok: true };
    }
    console.warn(`[pledges] ${p.ticker}: 無法取得股價`);
    return { ticker: p.ticker, price: null, ok: false };
  };

  // 全部同時跑，不管哪個失敗都繼續
  const [assetSettled, pledgeSettled] = await Promise.all([
    Promise.allSettled(assets.map(updateAsset)),
    Promise.allSettled((pledges || []).map(updatePledge)),
  ]);

  const results      = assetSettled.map(r => r.status === 'fulfilled' ? r.value : { ok: false }).filter(r => !r.skipped);
  const pledgeResults = pledgeSettled.map(r => r.status === 'fulfilled' ? r.value : { ok: false }).filter(Boolean);

  const successCount = results.filter(r => r.ok).length;
  const failCount    = results.filter(r => !r.ok).length;
  console.log(`[update-prices] 完成：成功 ${successCount} / 失敗 ${failCount}`);

  // ── 存每日淨值快照（upsert，更新股價後同步刷新圖表資料點）──────────
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: latestAssets } = await supabase.from('assets').select('*');
    const { data: liabilities }  = await supabase.from('liabilities').select('*');
    const totalAssets = (latestAssets || []).reduce((s, x) => s + (x.value_twd || 0), 0);
    const totalLiab   = (liabilities  || []).reduce((s, x) => s + x.value, 0);
    const net         = totalAssets - totalLiab;
    const leverage    = net > 0 ? totalAssets / net : 0;
    await supabase.from('monthly_snapshots').upsert(
      { date: today, assets: totalAssets, liabilities: totalLiab, net, leverage },
      { onConflict: 'date' }
    );
    console.log(`[update-prices] 快照 upsert：${today}, 淨值 NT$${Math.round(net)}`);
  } catch(e) {
    console.error('[update-prices] 存快照失敗:', e.message);
  }

  return new Response(JSON.stringify({
    ok: true, usdRate, successCount, failCount, results, pledgeResults,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Edge Function：Yahoo Finance 直連 <5s，30s 上限完全夠用
// 不再依賴 Render/kline-api（冷啟動 30-50s，是之前 504 的根因）
export const config = { runtime: 'edge' };
