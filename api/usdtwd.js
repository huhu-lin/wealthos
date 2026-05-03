/**
 * /api/usdtwd — Vercel Edge Function
 *
 * Server-side proxy for USD/TWD exchange rate from Yahoo Finance.
 * Eliminates browser CORS issues.
 *
 * Usage: GET /api/usdtwd
 */

export default async function handler(req) {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = "https://query1.finance.yahoo.com/v8/finance/chart/USDTWD=X?interval=1d&range=5d";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      const json = await res.json();

      return new Response(JSON.stringify(json), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300, stale-while-revalidate=60", // 5 分鐘快取
        },
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch USDTWD", detail: err.message }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}

export const config = { runtime: "edge" };
