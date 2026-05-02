// ============================================================
// priceApi.js — 外部價格抓取工具
// 集中管理所有對外部 API 的價格請求
// Token 已移到 server-side proxy（/api/finmind-price），
// 這裡只需呼叫自己的後端，不會洩漏任何金鑰
// ============================================================

// ── 通用 timeout wrapper ───────────────────────────────────────
// 防止網路慢或 API 無回應時 UI 凍結
function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timeout));
}

// ── 重試邏輯（用於不穩定的外部 API）──────────────────────────
async function fetchWithRetry(fetchFn, maxRetries = 3, delayMs = 100) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetchFn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      // 指數退避：100ms → 200ms → 400ms
      await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
    }
  }
}

// ── 台股現價 ─────────────────────────────────────────────────
// 透過 Vercel Edge Function proxy 呼叫 FinMind API
// 回傳最近一個交易日的收盤價（NT$），查不到回傳 null
// 新增：5秒 timeout 防止 UI 凍結
export async function fetchTWPrice(stockId) {
  try {
    const end   = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const url   = `/api/finmind-price?dataset=TaiwanStockPrice&data_id=${stockId}&start=${start}&end=${end}`;
    const res   = await fetchWithTimeout(url, {}, 5000);
    const json  = await res.json();
    if (json.data?.length > 0) return json.data[json.data.length - 1].close;
  } catch (err) {
    console.warn(`[fetchTWPrice] ${stockId} error:`, err.message);
  }
  return null;
}

// ── 美股現價 ─────────────────────────────────────────────────
// 透過 Vercel Edge Function proxy 呼叫 FinMind API
// 回傳最近一個交易日的收盤價（USD），查不到回傳 null
// 新增：5秒 timeout 防止 UI 凍結
export async function fetchUSPrice(ticker) {
  try {
    const end   = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const url   = `/api/finmind-price?dataset=USStockPrice&data_id=${ticker}&start=${start}&end=${end}`;
    const res   = await fetchWithTimeout(url, {}, 5000);
    const json  = await res.json();
    if (json.data?.length > 0) return json.data[json.data.length - 1].Close;
  } catch (err) {
    console.warn(`[fetchUSPrice] ${ticker} error:`, err.message);
  }
  return null;
}

// ── 加密貨幣現價 ──────────────────────────────────────────────
// 呼叫 CoinGecko 公開 API（不需 token）
// coinId：例如 "bitcoin"、"ethereum"
// 回傳台幣計價（TWD），查不到回傳 null
// 新增：5秒 timeout + 3次重試機制（因 CoinGecko 偶爾不穩定）
export async function fetchCryptoPrice(coinId) {
  try {
    const fetchFn = async () => {
      const url  = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=twd`;
      const res  = await fetchWithTimeout(url, {}, 5000);
      const json = await res.json();
      return json[coinId]?.twd || null;
    };

    return await fetchWithRetry(fetchFn, 3, 100);
  } catch (err) {
    console.warn(`[fetchCryptoPrice] ${coinId} error after retries:`, err.message);
  }
  return null;
}

// ── USD/TWD 即時匯率 ─────────────────────────────────────────
// 呼叫 Yahoo Finance 公開 API，取最近 5 個交易日最新值
// 抓不到時 fallback 31.5（大約近期匯率區間中值）
// 新增：5秒 timeout + User-Agent header（Yahoo Finance 要求）
export async function fetchUSDTWD() {
  try {
    const url    = `https://query1.finance.yahoo.com/v8/finance/chart/USDTWD=X?interval=1d&range=5d`;
    const res    = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    }, 5000);
    const json   = await res.json();
    const closes = json.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (closes?.length > 0) return closes.filter(Boolean).pop();
  } catch (err) {
    console.warn(`[fetchUSDTWD] error:`, err.message);
  }
  return 31.5; // fallback 匯率
}
