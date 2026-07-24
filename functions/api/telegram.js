// /api/telegram — يبني رسالة الطلب على السيرفر ويبعتها، بدل ما يبعتها الفرونت جاهزة
export async function onRequestPost({ request, env }) {
  const TG_TOKEN = env.TG_TOKEN;
  const TG_CHAT_ID = env.TG_CHAT_ID;
  if (!TG_TOKEN || !TG_CHAT_ID) return json({ ok: false, error: 'server_not_configured' }, 500);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.RATE_LIMIT) {
    const key = `rate:${ip}`;
    const current = parseInt((await env.RATE_LIMIT.get(key)) || '0');
    if (current >= 5) return json({ ok: false, error: 'rate_limited' }, 429);
    await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: 60 });
  }

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  if (env.TURNSTILE_SECRET) {
    const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: body?.turnstileToken, remoteip: ip })
    });
    if (!(await verify.json()).success) return json({ ok: false, error: 'turnstile_failed' }, 403);
  }

  const { orderNum, fname, lname, phone, city, district, address, notes, items, total } = body || {};
  if (!orderNum || !Array.isArray(items) || !items.length) {
    return json({ ok: false, error: 'invalid_order' }, 400);
  }

  const itemsText = items.slice(0, 50).map(i =>
    `• ${esc(i.emoji || '🛍️')} ${esc(cap(i.name, 100))} ×${Number(i.qty) || 0} — ${(Number(i.price) || 0).toLocaleString('ar-EG')} ج.م`
  ).join('\n');

  const msg = `🛒 <b>طلب جديد — LUXE</b>\n\n`
    + `🔢 رقم الطلب: <code>${esc(orderNum)}</code>\n`
    + `👤 الاسم: ${esc(cap(fname, 60))} ${esc(cap(lname, 60))}\n`
    + `📞 الهاتف: ${esc(cap(phone, 30))}\n`
    + `📍 العنوان: ${esc(cap(city, 60))}، ${esc(cap(district, 60))}\n${esc(cap(address, 200))}\n`
    + `\n📦 <b>المنتجات:</b>\n${itemsText}\n`
    + `\n💰 <b>الإجمالي: ${(Number(total) || 0).toLocaleString('ar-EG')} ج.م</b>`
    + (notes ? `\n📝 ملاحظات: ${esc(cap(notes, 300))}` : '');

  const tgRes = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg, parse_mode: 'HTML' })
  });

  if (!tgRes.ok) return json({ ok: false, error: 'telegram_error' }, 502);
  return json({ ok: true }, 200);
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function cap(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function json(data, status) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

