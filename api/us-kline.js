export default async function handler(req) {
  const { ticker, range = '2y' } = Object.fromEntries(new URL(req.url).searchParams);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${range}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const json = await res.json();
  return new Response(JSON.stringify(json), {
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export const config = { runtime: 'edge' };