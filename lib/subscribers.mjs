import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const cookieName = '__Host-loren_subscribers';
const origin = 'https://lorenbarnhart.vercel.app';
const digest = value => createHash('sha256').update(value).digest();
const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const validId = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
export function createHandler(getSql, env = process.env) {
  const secret = () => env.SUBSCRIBERS_ADMIN_PASSWORD || env.GUESTBOOK_ADMIN_PASSWORD;
  const sign = value => createHmac('sha256', secret()).update('session:' + value).digest('hex');
  const authorized = request => {
    const token = (request.headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!token || token.length > 200) return false;
    const [expires, nonce, signature, extra] = token.split('.');
    const payload = expires + '.' + nonce;
    return !extra && /^\d{13}$/.test(expires || '') && /^[a-f0-9]{32}$/.test(nonce || '') &&
      /^[a-f0-9]{64}$/.test(signature || '') && Number(expires) > Date.now() &&
      Number(expires) <= Date.now() + 86400000 && equal(signature, sign(payload));
  };
  let tablesReady = null;
  const ensureTables = sql => {
    if (!tablesReady) {
      tablesReady = (async () => {
        await sql`CREATE TABLE IF NOT EXISTS subscribers (
          id BIGSERIAL PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          name TEXT,
          source TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        await sql`CREATE TABLE IF NOT EXISTS subscribers_rate_limits (
          key TEXT PRIMARY KEY,
          attempts INTEGER NOT NULL DEFAULT 1,
          window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
      })().catch(error => { tablesReady = null; throw error; });
    }
    return tablesReady;
  };
  const rateLimit = async (sql, request, purpose, limit) => {
    const ip = (request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
    const key = createHmac('sha256', secret()).update('rate:' + purpose + ':' + ip).digest('hex');
    await sql`DELETE FROM subscribers_rate_limits WHERE window_start < NOW() - INTERVAL '2 days'`;
    const rows = await sql`INSERT INTO subscribers_rate_limits (key) VALUES (${key})
      ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN subscribers_rate_limits.window_start < NOW() - INTERVAL '15 minutes' THEN 1 ELSE LEAST(subscribers_rate_limits.attempts + 1, 1000) END,
      window_start = CASE WHEN subscribers_rate_limits.window_start < NOW() - INTERVAL '15 minutes' THEN NOW() ELSE subscribers_rate_limits.window_start END
      RETURNING attempts`;
    if (Number(rows[0].attempts) > limit) fail(429, 'Too many attempts. Please try again in 15 minutes.');
  };
  return async request => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const respond = (body, status = 200) => Response.json(body, { status, headers });
    try {
      if (!secret()) fail(503, 'Reader list is not configured yet.');
      const url = new URL(request.url);
      if (request.method === 'GET') {
        if (!authorized(request)) fail(401, 'Please sign in.');
        const cursor = url.searchParams.get('cursor') || '9223372036854775807';
        if (!validId(cursor)) fail(400, 'Invalid page.');
        const sql = await getSql();
        await ensureTables(sql);
        const rows = await sql`SELECT id::text AS id, email, name, source, created_at
          FROM subscribers WHERE id < ${cursor}::bigint
          ORDER BY id DESC LIMIT 51`;
        return respond({ subscribers: rows.slice(0, 50), next: rows.length > 50 ? rows[49].id : null });
      }
      if (request.method !== 'POST') { headers.Allow = 'GET, POST'; fail(405, 'Method not allowed.'); }
      if (request.headers.get('origin') !== origin) fail(403, 'Please use the form on Loren\u2019s website.');
      if (!(request.headers.get('content-type') || '').startsWith('application/json')) fail(415, 'JSON required.');
      if (Number(request.headers.get('content-length')) > 16000) fail(413, 'Request is too large.');
      const raw = await request.text();
      if (Buffer.byteLength(raw, 'utf8') > 16000) fail(413, 'Request is too large.');
      let body;
      try { body = JSON.parse(raw); } catch { fail(400, 'Invalid request.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid request.');
      const action = body.action || 'subscribe';
      const sql = await getSql();
      await ensureTables(sql);
      if (action === 'login') {
        await rateLimit(sql, request, 'login', 5);
        if (typeof body.password !== 'string' || !equal(body.password, secret())) fail(401, 'Incorrect password.');
        const payload = `${Date.now() + 86400000}.${randomBytes(16).toString('hex')}`;
        headers['Set-Cookie'] = `${cookieName}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`;
        return respond({ ok: true });
      }
      if (action === 'logout') {
        headers['Set-Cookie'] = `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
        return respond({ ok: true });
      }
      if (action === 'delete') {
        if (!authorized(request)) fail(401, 'Please sign in.');
        if (!validId(body.id)) fail(400, 'Invalid subscriber.');
        const rows = await sql`DELETE FROM subscribers WHERE id = ${body.id}::bigint RETURNING id`;
        if (!rows.length) fail(404, 'Subscriber no longer exists.');
        return respond({ ok: true });
      }
      if (action !== 'subscribe') fail(400, 'Invalid action.');
      if (body.website) return respond({ ok: true }, 202);
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const source = typeof body.source === 'string' ? body.source.trim().slice(0, 40) : '';
      if (!validEmail(email)) fail(400, 'Please enter a valid email address.');
      if ([...name].length > 60 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(name + source)) fail(400, 'Please check the name and try again.');
      await rateLimit(sql, request, 'subscribe', 3);
      await sql`INSERT INTO subscribers (email, name, source) VALUES (${email}, ${name || null}, ${source || null})
        ON CONFLICT (email) DO NOTHING`;
      return respond({ ok: true }, 201);
    } catch (error) {
      if (!error.status) console.error('Subscribers request failed:', error.code || error.name || 'Error');
      if (error.status === 429) headers['Retry-After'] = '900';
      return respond({ error: error.status ? error.message : 'Reader list is temporarily unavailable. Please try again later.' }, error.status || 503);
    }
  };
}
