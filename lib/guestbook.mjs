import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const cookieName = '__Host-loren_guestbook';
const origin = 'https://lorenbarnhart.vercel.app';
const digest = value => createHash('sha256').update(value).digest();
const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const validId = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
export function createHandler(getSql, env = process.env) {
  const sign = value => createHmac('sha256', env.GUESTBOOK_ADMIN_PASSWORD).update('session:' + value).digest('hex');
  const authorized = request => {
    const token = (request.headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!token || token.length > 200) return false;
    const [expires, nonce, signature, extra] = token.split('.');
    const payload = expires + '.' + nonce;
    return !extra && /^\d{13}$/.test(expires || '') && /^[a-f0-9]{32}$/.test(nonce || '') &&
      /^[a-f0-9]{64}$/.test(signature || '') && Number(expires) > Date.now() &&
      Number(expires) <= Date.now() + 86400000 && equal(signature, sign(payload));
  };
  const rateLimit = async (sql, request, purpose, limit) => {
    const ip = (request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
    const key = createHmac('sha256', env.GUESTBOOK_ADMIN_PASSWORD).update('rate:' + purpose + ':' + ip).digest('hex');
    await sql`DELETE FROM guestbook_rate_limits WHERE window_start < NOW() - INTERVAL '2 days'`;
    const rows = await sql`INSERT INTO guestbook_rate_limits (key) VALUES (${key})
      ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN guestbook_rate_limits.window_start < NOW() - INTERVAL '15 minutes' THEN 1 ELSE LEAST(guestbook_rate_limits.attempts + 1, 1000) END,
      window_start = CASE WHEN guestbook_rate_limits.window_start < NOW() - INTERVAL '15 minutes' THEN NOW() ELSE guestbook_rate_limits.window_start END
      RETURNING attempts`;
    if (Number(rows[0].attempts) > limit) fail(429, 'Too many attempts. Please try again in 15 minutes.');
  };
  return async request => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const respond = (body, status = 200) => Response.json(body, { status, headers });
    try {
      if (!env.GUESTBOOK_ADMIN_PASSWORD) fail(503, 'Guestbook is not configured yet.');
      const url = new URL(request.url);
      if (request.method === 'GET') {
        const scope = url.searchParams.get('scope') || 'public';
        if (!['public', 'pending', 'approved'].includes(scope)) fail(400, 'Invalid view.');
        if (scope !== 'public' && !authorized(request)) fail(401, 'Please sign in.');
        const cursor = url.searchParams.get('cursor') || '9223372036854775807';
        if (!validId(cursor)) fail(400, 'Invalid page.');
        const sql = await getSql();
        const approved = scope !== 'pending';
        const rows = await sql`SELECT id::text AS id, name, message, created_at, approved
          FROM guestbook_comments WHERE approved = ${approved} AND id < ${cursor}::bigint
          ORDER BY id DESC LIMIT 21`;
        return respond({ comments: rows.slice(0, 20), next: rows.length > 20 ? rows[19].id : null });
      }
      if (request.method !== 'POST') { headers.Allow = 'GET, POST'; fail(405, 'Method not allowed.'); }
      if (request.headers.get('origin') !== origin) fail(403, 'Please use the form on Loren’s website.');
      if (!(request.headers.get('content-type') || '').startsWith('application/json')) fail(415, 'JSON required.');
      if (Number(request.headers.get('content-length')) > 16000) fail(413, 'Message is too large.');
      const raw = await request.text();
      if (Buffer.byteLength(raw, 'utf8') > 16000) fail(413, 'Message is too large.');
      let body;
      try { body = JSON.parse(raw); } catch { fail(400, 'Invalid request.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid request.');
      const action = body.action || 'submit';
      if (action === 'login') {
        const sql = await getSql();
        await rateLimit(sql, request, 'login', 5);
        if (typeof body.password !== 'string' || !equal(body.password, env.GUESTBOOK_ADMIN_PASSWORD)) fail(401, 'Incorrect password.');
        const payload = `${Date.now() + 86400000}.${randomBytes(16).toString('hex')}`;
        headers['Set-Cookie'] = `${cookieName}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`;
        return respond({ ok: true });
      }
      if (action === 'logout') {
        headers['Set-Cookie'] = `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
        return respond({ ok: true });
      }
      if (['approve', 'hide', 'delete'].includes(action)) {
        if (!authorized(request)) fail(401, 'Please sign in.');
        if (!validId(body.id)) fail(400, 'Invalid message.');
        const sql = await getSql();
        const rows = action === 'delete'
          ? await sql`DELETE FROM guestbook_comments WHERE id = ${body.id}::bigint RETURNING id`
          : await sql`UPDATE guestbook_comments SET approved = ${action === 'approve'} WHERE id = ${body.id}::bigint RETURNING id`;
        if (!rows.length) fail(404, 'Message no longer exists.');
        return respond({ ok: true });
      }
      if (action !== 'submit') fail(400, 'Invalid action.');
      if (body.website) return respond({ ok: true }, 202);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if ([...name].length < 1 || [...name].length > 60 || [...message].length < 1 || [...message].length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(name + message)) fail(400, 'Use a name of 1–60 characters and a message of 1–2,000 characters.');
      if (body.consent !== true) fail(400, 'Please confirm that your message may be published.');
      const sql = await getSql();
      await rateLimit(sql, request, 'submit', 3);
      await sql`INSERT INTO guestbook_comments (name, message, approved) VALUES (${name}, ${message}, FALSE)`;
      return respond({ ok: true }, 201);
    } catch (error) {
      if (!error.status) console.error('Guestbook request failed:', error.code || error.name || 'Error');
      if (error.status === 429) headers['Retry-After'] = '900';
      return respond({ error: error.status ? error.message : 'Guestbook is temporarily unavailable. Please try again later.' }, error.status || 503);
    }
  };
}
