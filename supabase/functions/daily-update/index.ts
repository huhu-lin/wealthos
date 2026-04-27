import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FINMIND_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoiaHVodSIsImVtYWlsIjoiZXIwMDU2Nzg5MEBnbWFpbC5jb20ifQ.QJ3r5o23EqtdPJM_elCOMwjPKg4ivYyaGQNvYadejvs";

async function fetchTWPrice(ticker: string) {
  try {
    const end = new Date().toISOString().slice(0,10);
    const start = new Date(Date.now()-7*86400000).toISOString().slice(0,10);
    const res = await fetch(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${ticker}&start_date=${start}&end_date=${end}&token=${FINMIND_TOKEN}`);
    const json = await res.json();
    if(json.data?.length>0) return json.data[json.data.length-1].close;
  } catch {}
  return null;
}

async function fetchUSPrice(ticker: string) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`);
    const json = await res.json();
    const closes = json.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if(closes?.length>0) return closes.filter(Boolean).pop();
  } catch {}
  return null;
}

async function fetchCryptoPrice(coinId: string) {
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=twd`);
    const json = await res.json();
    return json[coinId]?.twd || null;
  } catch {}
  return null;
}

async function fetchUSDTWD() {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/USDTWD=X?interval=1d&range=5d`);
    const json = await res.json();
    const closes = json.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if(closes?.length>0) return closes.filter(Boolean).pop();
  } catch {}
  return 31.5;
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: assets } = await supabase.from("assets").select("*");
  const usdRate = await fetchUSDTWD();

  for (const asset of assets || []) {
    if (asset.account === "tw" && asset.type === "etf" && asset.ticker) {
      const price = await fetchTWPrice(asset.ticker);
      if (price) await supabase.from("assets").update({ price, value_twd: price * asset.shares }).eq("id", asset.id);
    }
    if (asset.account === "us" && asset.type === "etf" && asset.ticker) {
      const price = await fetchUSPrice(asset.ticker);
      if (price) await supabase.from("assets").update({ price_usd: price, value_usd: price * asset.shares, value_twd: price * asset.shares * usdRate }).eq("id", asset.id);
    }
    if (asset.account === "crypto" && asset.coin_id) {
      const price = await fetchCryptoPrice(asset.coin_id);
      if (price) await supabase.from("assets").update({ price_twd: price, value_twd: price * asset.shares }).eq("id", asset.id);
    }
    if (asset.account === "us" && asset.type === "cash") {
      await supabase.from("assets").update({ value_twd: (asset.value_usd || 0) * usdRate }).eq("id", asset.id);
    }
  }

  const { data: updatedAssets } = await supabase.from("assets").select("*");
  const { data: liabilities } = await supabase.from("liabilities").select("*");

  const totalAssets = (updatedAssets || []).reduce((s, x) => s + (x.value_twd || 0), 0);
  const totalLiab = (liabilities || []).reduce((s, x) => s + x.value, 0);
  const net = totalAssets - totalLiab;
  const leverage = net > 0 ? totalAssets / net : 0;
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await supabase.from("monthly_snapshots").select("id").eq("date", today);
  if (!existing?.length) {
    await supabase.from("monthly_snapshots").insert({ date: today, assets: totalAssets, liabilities: totalLiab, net, leverage });
  }

  return new Response(JSON.stringify({ ok: true, date: today, net }), { headers: { "Content-Type": "application/json" } });
});
