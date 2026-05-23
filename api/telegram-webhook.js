import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const USER_ID   = process.env.SUPABASE_USER_ID;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

// ─── 傳送 Telegram 訊息 ──────────────────────────────────────
async function reply(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

// ─── 數字格式化 ───────────────────────────────────────────────
function fmtNum(n) {
  return Math.round(n).toLocaleString('zh-TW');
}

// ─── 查找資產 ─────────────────────────────────────────────────
async function findAsset(account, ticker) {
  let query = supabase
    .from('assets')
    .select('id, name, ticker, coin_id, shares, cost, cost_total, value_twd, price, price_usd, account')
    .eq('user_id', USER_ID)
    .eq('account', account);

  if (account === 'crypto') {
    query = query.ilike('coin_id', ticker);
  } else {
    query = query.ilike('ticker', ticker);
  }

  const { data, error } = await query.single();
  if (error || !data) return null;
  return data;
}

// ─── /buy ─────────────────────────────────────────────────────
async function handleBuy(args, chatId) {
  const [account, ticker, sharesStr, costStr] = args;
  if (!account || !ticker || !sharesStr) {
    return reply(chatId, '⚠️ 語法錯誤\n用法：/buy tw|us|crypto &lt;代號&gt; &lt;股數&gt; [成本/單位]');
  }
  if (!['tw', 'us', 'crypto'].includes(account)) {
    return reply(chatId, '⚠️ 帳戶類型必須是 tw、us 或 crypto');
  }

  const delta = parseFloat(sharesStr);
  if (isNaN(delta) || delta <= 0) return reply(chatId, '⚠️ 股數必須是正數');

  const asset = await findAsset(account, ticker);
  if (!asset) {
    return reply(chatId, `⚠️ 找不到持倉：${account}/${ticker.toUpperCase()}\n請確認帳戶類型與代號是否正確`);
  }

  const newShares = (asset.shares || 0) + delta;
  const update = { shares: newShares };
  if (asset.price) update.value_twd = asset.price * newShares;

  if (costStr) {
    const cost = parseFloat(costStr);
    if (!isNaN(cost)) {
      update.cost = cost;
      update.cost_total = cost * newShares;
    }
  }

  const { error } = await supabase.from('assets').update(update).eq('id', asset.id);
  if (error) return reply(chatId, `❌ 更新失敗：${error.message}`);

  const acctLabel = { tw: '台股', us: '美股', crypto: '加密貨幣' }[account];
  let msg = `✅ 買入成功\n${asset.name}（${acctLabel}）\n+${delta} → 現持 ${newShares} 股`;
  if (costStr && !isNaN(parseFloat(costStr))) msg += `\n成本：${costStr} 元/股`;
  if (asset.price) msg += `\n市值：NT$${fmtNum(asset.price * newShares)}`;
  return reply(chatId, msg);
}

// ─── /sell ───────────────────────────────────────────────────
async function handleSell(args, chatId) {
  const [account, ticker, sharesStr] = args;
  if (!account || !ticker || !sharesStr) {
    return reply(chatId, '⚠️ 語法錯誤\n用法：/sell tw|us|crypto &lt;代號&gt; &lt;股數&gt;');
  }
  if (!['tw', 'us', 'crypto'].includes(account)) {
    return reply(chatId, '⚠️ 帳戶類型必須是 tw、us 或 crypto');
  }

  const delta = parseFloat(sharesStr);
  if (isNaN(delta) || delta <= 0) return reply(chatId, '⚠️ 股數必須是正數');

  const asset = await findAsset(account, ticker);
  if (!asset) {
    return reply(chatId, `⚠️ 找不到持倉：${account}/${ticker.toUpperCase()}\n請確認帳戶類型與代號是否正確`);
  }

  const newShares = (asset.shares || 0) - delta;
  if (newShares < 0) {
    return reply(chatId, `⚠️ 持股不足\n現有 ${asset.shares} 股，嘗試賣出 ${delta} 股`);
  }

  const update = { shares: newShares };
  if (asset.cost) update.cost_total = asset.cost * newShares;
  if (asset.price) update.value_twd = asset.price * newShares;

  const { error } = await supabase.from('assets').update(update).eq('id', asset.id);
  if (error) return reply(chatId, `❌ 更新失敗：${error.message}`);

  const acctLabel = { tw: '台股', us: '美股', crypto: '加密貨幣' }[account];
  let sellMsg = `✅ 賣出成功\n${asset.name}（${acctLabel}）\n-${delta} → 現持 ${newShares} 股`;
  if (asset.price) sellMsg += `\n市值：NT$${fmtNum(asset.price * newShares)}`;
  return reply(chatId, sellMsg);
}

// ─── /setshares ───────────────────────────────────────────────
async function handleSetShares(args, chatId) {
  const [account, ticker, sharesStr] = args;
  if (!account || !ticker || !sharesStr) {
    return reply(chatId, '⚠️ 語法錯誤\n用法：/setshares tw|us|crypto &lt;代號&gt; &lt;新股數&gt;');
  }
  if (!['tw', 'us', 'crypto'].includes(account)) {
    return reply(chatId, '⚠️ 帳戶類型必須是 tw、us 或 crypto');
  }

  const newShares = parseFloat(sharesStr);
  if (isNaN(newShares) || newShares < 0) return reply(chatId, '⚠️ 股數必須是非負數');

  const asset = await findAsset(account, ticker);
  if (!asset) {
    return reply(chatId, `⚠️ 找不到持倉：${account}/${ticker.toUpperCase()}\n請確認帳戶類型與代號是否正確`);
  }

  const update = { shares: newShares };
  if (asset.cost) update.cost_total = asset.cost * newShares;
  if (asset.price) update.value_twd = asset.price * newShares;

  const { error } = await supabase.from('assets').update(update).eq('id', asset.id);
  if (error) return reply(chatId, `❌ 更新失敗：${error.message}`);

  const acctLabel = { tw: '台股', us: '美股', crypto: '加密貨幣' }[account];
  let setMsg = `✅ 持倉更新\n${asset.name}（${acctLabel}）→ ${newShares} 股`;
  if (asset.price) setMsg += `\n市值：NT$${fmtNum(asset.price * newShares)}`;
  return reply(chatId, setMsg);
}

// ─── /cashflow ────────────────────────────────────────────────
async function handleCashflow(args, chatId) {
  const [monthStr, ...rest] = args;
  if (!monthStr) {
    return reply(chatId, '⚠️ 語法錯誤\n用法：/cashflow &lt;YYYY-MM&gt; [salary=X fixed=X cc_tsb=X cc_fub=X bonus=X]\n無參數時顯示該月記錄');
  }

  if (!/^\d{4}-\d{2}$/.test(monthStr)) {
    return reply(chatId, '⚠️ 月份格式錯誤，請使用 YYYY-MM（例如 2026-05）');
  }

  const month = `${monthStr}-01`;

  // 無後續參數 → 查詢顯示
  if (rest.length === 0) {
    const { data, error } = await supabase
      .from('cashflow')
      .select('salary, bonus, fixed, cc_tsb, cc_fub, note')
      .eq('user_id', USER_ID)
      .eq('month', month)
      .single();

    if (error || !data) return reply(chatId, `📭 ${monthStr} 尚無現金流記錄`);

    const ccTotal = (data.cc_tsb || 0) + (data.cc_fub || 0);
    const net = (data.salary || 0) + (data.bonus || 0) - (data.fixed || 0) - ccTotal;
    return reply(chatId,
      `📊 <b>現金流 ${monthStr}</b>\n\n` +
      `薪資：${fmtNum(data.salary || 0)}\n` +
      `獎金：${fmtNum(data.bonus || 0)}\n` +
      `固定支出：${fmtNum(data.fixed || 0)}\n` +
      `信用卡（台新）：${fmtNum(data.cc_tsb || 0)}\n` +
      `信用卡（富邦）：${fmtNum(data.cc_fub || 0)}\n` +
      `────────────\n` +
      `淨結餘：<b>${fmtNum(net)}</b>` +
      (data.note ? `\n備註：${data.note}` : '')
    );
  }

  // 有參數 → 更新
  const validKeys = ['salary', 'bonus', 'fixed', 'cc_tsb', 'cc_fub', 'note'];
  const payload = { user_id: USER_ID, month };

  for (const kv of rest) {
    const m = kv.match(/^(\w+)=(.+)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (!validKeys.includes(k)) continue;
    payload[k] = k === 'note' ? v : (parseFloat(v) || 0);
  }

  if (Object.keys(payload).length <= 2) {
    return reply(chatId, '⚠️ 未提供有效欄位\n可用欄位：salary, bonus, fixed, cc_tsb, cc_fub, note');
  }

  const { error } = await supabase
    .from('cashflow')
    .upsert(payload, { onConflict: 'month,user_id' });

  if (error) return reply(chatId, `❌ 更新失敗：${error.message}`);

  const lines = Object.entries(payload)
    .filter(([k]) => !['user_id', 'month'].includes(k))
    .map(([k, v]) => {
      const labels = { salary: '薪資', bonus: '獎金', fixed: '固定支出', cc_tsb: '信用卡（台新）', cc_fub: '信用卡（富邦）', note: '備註' };
      return `${labels[k] || k}：${typeof v === 'number' ? fmtNum(v) : v}`;
    });

  return reply(chatId, `✅ 現金流已更新 ${monthStr}\n${lines.join('\n')}`);
}

// ─── /status ─────────────────────────────────────────────────
async function handleStatus(chatId) {
  const [{ data: assets }, { data: liabs }] = await Promise.all([
    supabase.from('assets').select('value_twd, name, ticker, account').eq('user_id', USER_ID),
    supabase.from('liabilities').select('value').eq('user_id', USER_ID),
  ]);

  const totalAssets = (assets || []).reduce((s, x) => s + (x.value_twd || 0), 0);
  const totalLiab   = (liabs || []).reduce((s, x) => s + (x.value || 0), 0);
  const netWorth    = totalAssets - totalLiab;

  const top5 = [...(assets || [])]
    .sort((a, b) => (b.value_twd || 0) - (a.value_twd || 0))
    .slice(0, 5);

  const top5Lines = top5
    .map((a, i) => `${i + 1}. ${a.name || a.ticker}｜NT$${fmtNum(a.value_twd || 0)}`)
    .join('\n');

  return reply(chatId,
    `📊 <b>資產總覽</b>\n\n` +
    `總資產：NT$${fmtNum(totalAssets)}\n` +
    `負債：NT$${fmtNum(totalLiab)}\n` +
    `淨資產：<b>NT$${fmtNum(netWorth)}</b>\n\n` +
    `<b>前5大持倉</b>\n${top5Lines}\n\n` +
    `（股價以上次更新為準）`
  );
}

// ─── /holdings ───────────────────────────────────────────────
async function handleHoldings(args, chatId) {
  const account = args[0]?.toLowerCase() || 'all';
  const validAccounts = ['tw', 'us', 'crypto', 'other', 'all'];
  if (!validAccounts.includes(account)) {
    return reply(chatId, '⚠️ 帳戶類型必須是 tw、us、crypto、other 或 all');
  }

  let query = supabase
    .from('assets')
    .select('name, ticker, coin_id, shares, value_twd, account')
    .eq('user_id', USER_ID)
    .order('value_twd', { ascending: false });

  if (account !== 'all') query = query.eq('account', account);

  const { data, error } = await query;
  if (error) return reply(chatId, `❌ 查詢失敗：${error.message}`);
  if (!data?.length) return reply(chatId, `📭 無持倉資料${account !== 'all' ? `（${account}）` : ''}`);

  const acctLabels = { tw: '🇹🇼 台股', us: '🇺🇸 美股', crypto: '₿ 加密貨幣', other: '其他', all: '全部' };
  const lines = data.map(a => {
    const id = a.ticker || a.coin_id || a.name;
    return `${a.name}（${id}）  ${a.shares} 股  NT$${fmtNum(a.value_twd || 0)}`;
  });

  return reply(chatId,
    `<b>${acctLabels[account] || account} 持倉</b>\n\n` +
    lines.join('\n') +
    '\n\n（股價以上次更新為準）'
  );
}

// ─── /debt ───────────────────────────────────────────────────
async function handleDebt(args, chatId) {
  const [sub, ...rest] = args;

  if (!sub || sub === 'list') {
    const { data, error } = await supabase
      .from('liabilities')
      .select('id, name, value, rate, category')
      .eq('user_id', USER_ID)
      .order('value', { ascending: false });

    if (error) return reply(chatId, `❌ 查詢失敗：${error.message}`);
    if (!data?.length) return reply(chatId, '📭 無負債記錄');

    const total = data.reduce((s, x) => s + (x.value || 0), 0);
    const lines = data.map(d =>
      `• ${d.name}｜NT$${fmtNum(d.value)}${d.rate ? `（${d.rate}%/年）` : ''}`
    );

    return reply(chatId,
      `💳 <b>負債清單</b>\n\n` +
      lines.join('\n') +
      `\n────────────\n總計：NT$${fmtNum(total)}`
    );
  }

  if (sub === 'set') {
    // /debt set <name> value=X
    const namePart = rest.slice(0, -1).join(' ');
    const kvPart = rest[rest.length - 1];
    if (!namePart || !kvPart?.startsWith('value=')) {
      return reply(chatId, '⚠️ 語法錯誤\n用法：/debt set &lt;名稱&gt; value=&lt;新餘額&gt;');
    }

    const newValue = parseFloat(kvPart.replace('value=', ''));
    if (isNaN(newValue) || newValue < 0) return reply(chatId, '⚠️ 金額必須是非負數');

    const { data: found } = await supabase
      .from('liabilities')
      .select('id, name, value')
      .eq('user_id', USER_ID)
      .ilike('name', `%${namePart}%`);

    if (!found?.length) return reply(chatId, `⚠️ 找不到負債：「${namePart}」`);
    if (found.length > 1) {
      return reply(chatId,
        `⚠️ 找到多筆符合「${namePart}」的負債，請提供更精確的名稱：\n` +
        found.map(d => `• ${d.name}`).join('\n')
      );
    }

    const target = found[0];
    const { error } = await supabase
      .from('liabilities')
      .update({ value: newValue })
      .eq('id', target.id);

    if (error) return reply(chatId, `❌ 更新失敗：${error.message}`);
    return reply(chatId, `✅ 負債更新\n${target.name}\nNT$${fmtNum(target.value)} → NT$${fmtNum(newValue)}`);
  }

  return reply(chatId, '⚠️ 語法錯誤\n用法：/debt list 或 /debt set &lt;名稱&gt; value=&lt;金額&gt;');
}

// ─── /refreshprice ────────────────────────────────────────────
async function handleRefreshPrice(req, chatId) {
  await reply(chatId, '🔄 正在更新股價，請稍候…');
  const origin = new URL(req.url).origin;
  try {
    const res = await fetch(`${origin}/api/update-prices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const ok = res.ok;
    return reply(chatId, ok ? '✅ 股價已更新完成' : `⚠️ 更新股價時發生問題（HTTP ${res.status}）`);
  } catch (e) {
    return reply(chatId, `❌ 更新失敗：${e.message}`);
  }
}

// ─── /help ────────────────────────────────────────────────────
async function handleHelp(chatId) {
  return reply(chatId,
    `📋 <b>WealthOS 指令說明</b>\n\n` +
    `<b>持股管理</b>\n` +
    `/buy tw|us|crypto &lt;代號&gt; &lt;股數&gt; [成本]\n` +
    `/sell tw|us|crypto &lt;代號&gt; &lt;股數&gt;\n` +
    `/setshares tw|us|crypto &lt;代號&gt; &lt;新股數&gt;\n\n` +
    `<b>現金流</b>\n` +
    `/cashflow &lt;YYYY-MM&gt; — 查詢當月記錄\n` +
    `/cashflow &lt;YYYY-MM&gt; salary=X fixed=X cc_tsb=X cc_fub=X bonus=X\n\n` +
    `<b>負債</b>\n` +
    `/debt list — 列出所有負債\n` +
    `/debt set &lt;名稱&gt; value=&lt;新餘額&gt;\n\n` +
    `<b>查詢</b>\n` +
    `/status — 淨資產總覽\n` +
    `/holdings tw|us|crypto|all — 持倉列表\n\n` +
    `<b>系統</b>\n` +
    `/refreshprice — 更新所有股價`
  );
}

// ─── 主 Handler ───────────────────────────────────────────────
export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let update;
  try {
    update = await req.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const msg = update.message;
  if (!msg?.text) return new Response('OK', { status: 200 });

  // 驗證授權 chat（靜默忽略非授權來源）
  if (msg.chat?.id?.toString() !== CHAT_ID) {
    return new Response('OK', { status: 200 });
  }

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase().replace(/@\S+$/, ''); // 處理 /cmd@botname 格式
  const args = parts.slice(1);

  try {
    switch (cmd) {
      case '/buy':          await handleBuy(args, chatId); break;
      case '/sell':         await handleSell(args, chatId); break;
      case '/setshares':    await handleSetShares(args, chatId); break;
      case '/cashflow':     await handleCashflow(args, chatId); break;
      case '/status':       await handleStatus(chatId); break;
      case '/holdings':     await handleHoldings(args, chatId); break;
      case '/debt':         await handleDebt(args, chatId); break;
      case '/refreshprice': await handleRefreshPrice(req, chatId); break;
      case '/help':         await handleHelp(chatId); break;
      default:
        await reply(chatId, '❓ 未知指令，輸入 /help 查看說明');
    }
  } catch (e) {
    console.error('[telegram-webhook] error:', e);
    await reply(chatId, `❌ 系統錯誤：${e.message}`);
  }

  return new Response('OK', { status: 200 });
}
