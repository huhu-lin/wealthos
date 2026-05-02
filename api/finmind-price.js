/**
 * /api/finmind-price — Vercel Edge Function
 *
 * Server-side proxy for FinMind API.
 * Keeps FINMIND_TOKEN out of the frontend bundle entirely.
 *
 * Usage (from frontend):
 *   GET /api/finmind-price?dataset=TaiwanStockPrice&data_id=0050&start=2024-01-01&end=2024-12-31
 *   GET /api/finmind-price?dataset=USStockPrice&data_id=QQQ&start=2024-01-01&end=2024-12-31
 */

const ALLOWED_DATASETS = new Set([
  "TaiwanStockPrice",
  "USStockPrice",
]);

export default async function handler(req) {
  // ── 只允許 GET ────────────────────────────────────────────
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { searchParams } = new URL(req.url);
  const dataset = searchParams.get("dataset");
  const data_id = searchParams.get("data_id");
  const start   = searchParams.get("start");
  const end     = searchParams.get("end");

  // ── 參數驗證 ──────────────────────────────────────────────
  if (!dataset || !data_id || !start || !end) {
    return new Response(
      JSON.stringify({ error: "Missing required params: dataset, data_id, start, end" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Whitelist dataset，防止 SSRF ──────────────────────────
  if (!ALLOWED_DATASETS.has(dataset)) {
    return new Response(
      JSON.stringify({ error: `Dataset not allowed: ${dataset}` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── 日期格式簡單驗證 (YYYY-MM-DD) ────────────────────────
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(start) || !dateRe.test(end)) {
    return new Response(
      JSON.stringify({ error: "Invalid date format, expected YYYY-MM-DD" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const token = process.env.FINMIND_TOKEN;
  if (!token) {
    console.error("[finmind-price] FINMIND_TOKEN env var not set");
    return new Response(
      JSON.stringify({ error: "Server configuration error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── 呼叫 FinMind（token 在伺服器端，不暴露給前端）────────
  const upstreamUrl =
    `https://api.finmindtrade.com/api/v4/data` +
    `?dataset=${encodeURIComponent(dataset)}` +
    `&data_id=${encodeURIComponent(data_id)}` +
    `&start_date=${encodeURIComponent(start)}` +
    `&end_date=${encodeURIComponent(end)}` +
    `&token=${token}`;

  try {
    const upstream = await fetch(upstreamUrl);
    const json = await upstream.json();

    return new Response(JSON.stringify(json), {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        // 短暫快取：10 分鐘 stale-while-revalidate，降低對 FinMind 的請求次數
        "Cache-Control": "public, max-age=600, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    console.error("[finmind-price] upstream fetch error:", err);
    return new Response(
      JSON.stringify({ error: "Failed to fetch from FinMind" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}

export const config = { runtime: "edge" };
