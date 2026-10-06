import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const cookieName = '__Host-loren_author_help';
const origin = 'https://lorenbarnhart.vercel.app';
const digest = value => createHash('sha256').update(value).digest();
const equal = (a,b) => timingSafeEqual(digest(a), digest(b));
const fail = (status,message) => { throw Object.assign(new Error(message), {status}); };
const validId = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;

export function createHandler(getSql, env = process.env) {
  const secret = env.AUTHOR_HELP_ADMIN_PASSWORD || env.GUESTBOOK_ADMIN_PASSWORD || '';
  const sign = value => createHmac('sha256', secret).update('author-help-session:' + value).digest('hex');
  const authorized = request => {
    if (!secret) return false;
    const token = (request.headers.get('cookie') || '').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    if (!token || token.length > 200) return false;
    const [expires,nonce,signature,extra] = token.split('.');
    const payload = expires + '.' + nonce;
    return !extra && /^\d{13}$/.test(expires||'') && /^[a-f0-9]{32}$/.test(nonce||'') && /^[a-f0-9]{64}$/.test(signature||'') && Number(expires) > Date.now() && Number(expires) <= Date.now()+86400000 && equal(signature, sign(payload));
  };
  const prepare = async sql => {
    await sql`CREATE TABLE IF NOT EXISTS author_inquiries (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      book_title TEXT NOT NULL,
      genre TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT '',
      platforms TEXT NOT NULL DEFAULT '',
      links TEXT NOT NULL DEFAULT '',
      concern TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS author_help_rate_limits (
      key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 1,
      window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  };
  const rateLimit = async (sql,request,purpose,limit) => {
    const ip = (request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
    const key = createHmac('sha256', secret).update('author-help-rate:' + purpose + ':' + ip).digest('hex');
    await sql`DELETE FROM author_help_rate_limits WHERE window_start < NOW() - INTERVAL '2 days'`;
    const rows = await sql`INSERT INTO author_help_rate_limits (key) VALUES (${key})
      ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN author_help_rate_limits.window_start < NOW() - INTERVAL '15 minutes' THEN 1 ELSE LEAST(author_help_rate_limits.attempts + 1, 1000) END,
      window_start = CASE WHEN author_help_rate_limits.window_start < NOW() - INTERVAL '15 minutes' THEN NOW() ELSE author_help_rate_limits.window_start END
      RETURNING attempts`;
    if (Number(rows[0].attempts) > limit) fail(429,'Too many attempts. Please try again in 15 minutes.');
  };
  return async request => {
    const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    const respond = (body,status=200) => Response.json(body,{status,headers});
    try {
      if (!secret) fail(503,'Author Help is not configured yet.');
      const url = new URL(request.url);
      if (request.method === 'GET') {
        if (!authorized(request)) fail(401,'Please sign in.');
        const status = url.searchParams.get('status') || 'new';
        if (!['new','closed','all'].includes(status)) fail(400,'Invalid view.');
        const cursor = url.searchParams.get('cursor') || '9223372036854775807';
        if (!validId(cursor)) fail(400,'Invalid page.');
        const sql = await getSql(); await prepare(sql);
        const rows = status === 'all'
          ? await sql`SELECT id::text AS id,name,email,book_title,genre,stage,platforms,links,concern,description,status,created_at FROM author_inquiries WHERE id < ${cursor}::bigint ORDER BY id DESC LIMIT 21`
          : await sql`SELECT id::text AS id,name,email,book_title,genre,stage,platforms,links,concern,description,status,created_at FROM author_inquiries WHERE status = ${status} AND id < ${cursor}::bigint ORDER BY id DESC LIMIT 21`;
        return respond({inquiries:rows.slice(0,20),next:rows.length>20?rows[19].id:null});
      }
      if (request.method !== 'POST') { headers.Allow='GET, POST'; fail(405,'Method not allowed.'); }
      if (request.headers.get('origin') !== origin) fail(403,'Please use the form on Loren’s website.');
      if (!(request.headers.get('content-type')||'').startsWith('application/json')) fail(415,'JSON required.');
      if (Number(request.headers.get('content-length')) > 30000) fail(413,'Request is too large.');
      const raw = await request.text();
      if (Buffer.byteLength(raw,'utf8') > 30000) fail(413,'Request is too large.');
      let body; try { body=JSON.parse(raw); } catch { fail(400,'Invalid request.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400,'Invalid request.');
      const action = body.action || 'submit';
      if (action === 'login') {
        const sql=await getSql(); await prepare(sql); await rateLimit(sql,request,'login',5);
        if (typeof body.password !== 'string' || !equal(body.password,secret)) fail(401,'Incorrect password.');
        const payload = `${Date.now()+86400000}.${randomBytes(16).toString('hex')}`;
        headers['Set-Cookie'] = `${cookieName}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`;
        return respond({ok:true});
      }
      if (action === 'logout') {
        headers['Set-Cookie'] = `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
        return respond({ok:true});
      }
      if (['close','reopen','delete'].includes(action)) {
        if (!authorized(request)) fail(401,'Please sign in.');
        if (!validId(body.id)) fail(400,'Invalid request.');
        const sql=await getSql(); await prepare(sql);
        const rows = action === 'delete'
          ? await sql`DELETE FROM author_inquiries WHERE id=${body.id}::bigint RETURNING id`
          : await sql`UPDATE author_inquiries SET status=${action==='close'?'closed':'new'} WHERE id=${body.id}::bigint RETURNING id`;
        if (!rows.length) fail(404,'Request no longer exists.');
        return respond({ok:true});
      }
      if (action !== 'submit') fail(400,'Invalid action.');
      if (body.website) return respond({ok:true},202);
      if (body.consent !== true) fail(400,'Please confirm that Loren may reply to you by email.');
      const clean=(v,max=2000)=>typeof v==='string'?v.trim().slice(0,max):'';
      const name=clean(body.name,80), email=clean(body.email,160).toLowerCase(), bookTitle=clean(body.bookTitle,180), genre=clean(body.genre,100), stage=clean(body.stage,120), platforms=clean(body.platforms,300), links=clean(body.links,1200), concern=clean(body.concern,3000), description=clean(body.description,6000);
      if (name.length<1 || bookTitle.length<1 || concern.length<10) fail(400,'Please complete your name, book title, and main concern.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>160) fail(400,'Please enter a valid email address.');
      const sql=await getSql(); await prepare(sql); await rateLimit(sql,request,'submit',4);
      await sql`INSERT INTO author_inquiries (name,email,book_title,genre,stage,platforms,links,concern,description) VALUES (${name},${email},${bookTitle},${genre},${stage},${platforms},${links},${concern},${description})`;
      return respond({ok:true},201);
    } catch (error) {
      if (!error.status) console.error('Author Help request failed:', error.code || error.name || 'Error');
      if (error.status===429) headers['Retry-After']='900';
      return respond({error:error.status?error.message:'The form is temporarily unavailable. Please try again later.'},error.status||503);
    }
  };
}
