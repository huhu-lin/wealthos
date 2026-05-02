/**
 * /api/kline-tw — Vercel Edge Function
 *
 * Server-side proxy for Taiwan stock K-line data from Render.
 * Eliminates browser CORS issues: browser → Vercel (same-origin) → Render (server-to-server).
 *
 * Usage (from frontend):
 *   GET /api/kline-tw?ticker=006208&days=720
 */

export default async function handler(req) {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker");
  const days   = searchParams.get("days") || "720";

  if (!ticker) {
    return new Response(JSON.stringify({ error: "Missing required param: ticker" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 基本驗證：ticker 只允許英數字與點（防 SSRF）
  if (!/^[\w.]{1,20}$/.test(ticker)) {
    return new Response(JSON.stringify({ error: "Invalid ticker format" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const daysNum = parseInt(days, 10);
  if (isNaN(daysNum) || daysNum < 1 || daysNum > 9999) {
    return new Response(JSON.stringify({ error: "Invalid days param" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const KLINE_API = process.env.VITE_KLINE_API;
  if (!KLINE_API) {
    return new Response(JSON.stringify({ error: "Server configuration error: KLINE_API not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const upstreamUrl = `${KLINE_API}/kline/tw?ticker=${encodeURIComponent(ticker)}&days=${daysNum}`;

  // 最多重試 3 次（server-to-server 不受 CORS 限制，可以耐心等 Render 醒來）
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000); // 25s timeout

      try {
        const upstream = await fetch(upstreamUrl, { signal: controller.signal });
        if (!upstream.ok) throw new Error(`upstream HTTP ${upstream.status}`);
        const json = await upstream.json();

        return new Response(JSON.stringify(json), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600, stale-while-revalidate=600",
          },
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      console.warn(`[kline-tw] attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < 2) {
        // 等待 Render 冷啟動（server-to-server 不受瀏覽器 CORS 影響，可以重試）
        await new Promise(r => setTimeout(r, 5000));
      } else {
        console.error("[kline-tw] all retries failed:", err.message);
        return new Response(
          JSON.stringify({ error: "Failed to fetch kline data", detail: err.message }),
          { status: 502, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  }
}

export const config = { runtime: "edge" };
