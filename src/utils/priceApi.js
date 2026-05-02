// ============================================================
// priceApi.js — 外部價格抓取工具
// 集中管理所有對外部 API 的價格請求
// Token 已移到 server-side proxy（/api/finmind-price），
// 這裡只需呼叫自己的後端，不會洩漏任何金鑰
// ============================================================

// ── 台股現價 ─────────────────────────────────────────────────
// 透過 Vercel Edge Function proxy 呼叫 FinMind API
// 回傳最近一個交易日的收盤價（NT$），查不到回傳 null
export async function fetchTWPrice(stockId) {
  try {
    const end   = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const url   = `/api/finmind-price?dataset=TaiwanStockPrice&data_id=${stockId}&start=${start}&end=${end}`;
    const res   = await fetch(url);
    const json  = await res.json();
    if (json.data?.length > 0) return json.data[json.data.length - 1].close;
  } catch { }
  return null;
}

// ── 美股現價 ─────────────────────────────────────────────────
// 透過 Vercel Edge Function proxy 呼叫 FinMind API
// 回傳最近一個交易日的收盤價（USD），查不到回傳 null
export async function fetchUSPrice(ticker) {
  try {
    const end   = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const url   = `/api/finmind-price?dataset=USStockPrice&data_id=${ticker}&start=${start}&end=${end}`;
    const res   = await fetch(url);
    const json  = await res.json();
    if (json.data?.length > 0) return json.data[json.data.length - 1].Close;
  } catch { }
  return null;
}

// ── 加密貨幣現價 ──────────────────────────────────────────────
// 呼叫 CoinGecko 公開 API（不需 token）
// coinId：例如 "bitcoin"、"ethereum"
// 回傳台幣計價（TWD），查不到回傳 null
export async function fetchCryptoPrice(coinId) {
  try {
    const url  = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=twd`;
    const res  = await fetch(url);
    const json = await res.json();
    return json[coinId]?.twd || null;
  } catch { }
  return null;
}

// ── USD/TWD 即時匯率 ─────────────────────────────────────────
// 呼叫 Yahoo Finance 公開 API，取最近 5 個交易日均值
// 抓不到時 fallback 31.5（大約近期匯率區間中值）
export async function fetchUSDTWD() {
  try {
    const url    = `https://query1.finance.yahoo.com/v8/finance/chart/USDTWD=X?interval=1d&range=5d`;
    const res    = await fetch(url);
    const json   = await res.json();
    const closes = json.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (closes?.length > 0) return closes.filter(Boolean).pop();
  } catch { }
  return 31.5; // fallback 匯率
}
