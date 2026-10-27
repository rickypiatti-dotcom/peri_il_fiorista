// Servizio "auth" del gestionale del fiorista.
//  POST /login, /refresh, GET /stream        login, rinnovo token, flusso SSE delle modifiche (come negli altri siti)
//  POST /api/password {attuale, nuova}       cambio della propria password
//  GET/POST /api/utenti, POST/DELETE /api/utenti/<id>, POST /api/utenti/<id>/password   utenti (solo titolare)
//  POST /api/allegati?spesa=<id>|bolla=<id>&nome=<nome>  carica un allegato (PDF/JPEG/PNG/WebP fino a 8 MB)
//                                            su una spesa (solo titolare) o su una bolla (tutto il personale)
//  GET  /api/allegati/<uuid>                 scarica un allegato (stesse regole; token nell'intestazione)
//  GET  /health
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import { createThrottle, normalizeIp } from './throttle.js';

const scrypt = promisify(crypto.scrypt);
const {
  DATABASE_URL,
  JWT_SECRET,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  PORT = '4000',
  TOKEN_TTL_SECONDS = '43200', // 12 ore
  TRUST_CF_HEADER = '0',       // 1 = il servizio è raggiungibile da Internet solo tramite Cloudflare (che imposta CF-Connecting-IP)
} = process.env;

if (!DATABASE_URL || !JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('Servono DATABASE_URL e JWT_SECRET (almeno 32 caratteri).');
  process.exit(1);
}

const ttl = Number(TOKEN_TTL_SECONDS);
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 8 });
pool.on('error', (e) => console.error('pool:', e.message));

// ------------------------------------------------------------------ JWT ---
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');

function createToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + ttl };
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify(payload));
  return { token: `${head}.${body}.${sign(`${head}.${body}`)}`, payload };
}

function verifyToken(token) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) return null;
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- password ---
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString('base64')}:${hash.toString('base64')}`;
}

async function checkPassword(password, stored) {
  const [kind, salt, hash] = String(stored).split(':');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const dummyHash = await hashPassword('non-una-password-vera');
const passwordValida = (p) => typeof p === 'string' && p.length >= 10 && p.length <= 200;
const emailValida = (e) => typeof e === 'string' && e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ---------------------------------------------------- limite tentativi ---
const throttle = createThrottle();
setInterval(() => throttle.sweep(), 60 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------- HTTP ---
const clientIp = (req) => {
  if (TRUST_CF_HEADER === '1') {
    const raw = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0];
    if (raw) return normalizeIp(raw);
  }
  return normalizeIp(req.socket.remoteAddress);
};

function send(res, status, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(Object.assign(new Error('Richiesta troppo grande'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, max = 20_000) {
  const buf = await readBody(req, max);
  const j = JSON.parse(buf.toString() || '{}');
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('non valido');
  return j;
}

const sessionOf = (token, payload) => ({
  access_token: token,
  expires_at: payload.exp,
  user: { id: payload.sub, email: payload.email },
});

async function handleLogin(req, res) {
  let body;
  try { body = await readJson(req, 10_000); } catch { return send(res, 400, { error: 'Richiesta non valida' }); }
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password || email.length > 200 || password.length > 200) {
    return send(res, 400, { error: 'Email e password obbligatorie' });
  }

  const ip = clientIp(req);
  if (throttle.blocked(ip, email)) {
    return send(res, 429, { error: 'Troppi tentativi, riprova tra 15 minuti' }, { 'Retry-After': '900' });
  }
  const wait = throttle.delayMs(ip, email);
  if (wait) await sleep(wait);

  const { rows } = await pool.query('select id, email, password_hash from auth.users where lower(email) = $1', [email]);
  const user = rows[0];
  const ok = await checkPassword(password, user ? user.password_hash : dummyHash);
  if (!user || !ok) {
    throttle.fail(ip, email);
    console.warn(`login fallito da ${ip}`);
    return send(res, 401, { error: 'Email o password non corretti' });
  }
  throttle.success(ip, email);

  const { token, payload } = createToken(user);
  const out = sessionOf(token, payload);
  out.user.role = (await ruoloDi(user.id)) || null;
  send(res, 200, out);
}

async function ruoloDi(id) {
  const { rows } = await pool.query('select role from public.staff_roles where user_id = $1', [id]);
  return rows[0]?.role || null;
}

async function handleRefresh(req, res) {
  const auth = req.headers.authorization || '';
  const payload = verifyToken(auth.startsWith('Bearer ') ? auth.slice(7) : '');
  if (!payload) return send(res, 401, { error: 'Sessione scaduta' });
  // un account cancellato non può rinnovare la sessione
  const { rows } = await pool.query('select id, email from auth.users where id = $1', [payload.sub]);
  if (!rows.length) return send(res, 401, { error: 'Sessione scaduta' });
  const { token, payload: fresh } = createToken(rows[0]);
  const out = sessionOf(token, fresh);
  out.user.role = await ruoloDi(rows[0].id);
  send(res, 200, out);
}

async function staffDa(req) {
  const auth = req.headers.authorization || '';
  const payload = verifyToken(auth.startsWith('Bearer ') ? auth.slice(7) : '');
  if (!payload) return null;
  const role = await ruoloDi(payload.sub);
  return role ? { id: payload.sub, email: payload.email, role } : null;
}

// ------------------------------------------------------------- realtime ---
// Ai dispositivi del personale arriva solo "tabella X cambiata": la pagina ricarica i dati che le servono.
const streams = new Set();
let listener = null;

async function startListener() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  client.on('error', (e) => { console.error('listener:', e.message); scheduleReconnect(); });
  client.on('end', scheduleReconnect);
  client.on('notification', (msg) => {
    let data;
    try { data = JSON.parse(msg.payload); } catch { return; }
    const line = `data: ${JSON.stringify({ table: data.table, eventType: data.eventType })}\n\n`;
    for (const s of streams) s.res.write(line);
  });
  await client.connect();
  await client.query('listen db_changes');
  listener = client;
  console.log('Realtime: in ascolto su db_changes');
}

let reconnecting = false;
function scheduleReconnect() {
  if (reconnecting) return;
  reconnecting = true;
  try { listener?.removeAllListeners(); listener?.end().catch(() => {}); } catch { /* già chiuso */ }
  listener = null;
  // Gli eventi persi nel frattempo non arrivano più: si chiudono i flussi e le pagine si ricollegano e ricaricano.
  for (const s of streams) { try { s.res.end(); } catch { /* chiuso */ } }
  setTimeout(async () => {
    reconnecting = false;
    try { await startListener(); } catch (e) { console.error('riconnessione:', e.message); scheduleReconnect(); }
  }, 3000);
}

async function handleStream(req, res, url) {
  const payload = verifyToken(url.searchParams.get('token') || '');
  if (!payload || !(await ruoloDi(payload.sub))) return send(res, 401, { error: 'Accesso richiesto' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const stream = { res };
  streams.add(stream);
  const ping = setInterval(() => res.write('event: ping\ndata: {}\n\n'), 25_000);
  const expiry = setTimeout(() => res.end(), Math.max(1000, payload.exp * 1000 - Date.now()));
  req.on('close', () => {
    clearInterval(ping);
    clearTimeout(expiry);
    streams.delete(stream);
  });
}

// ---------------------------------------------------------------- utenti ---
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function handlePassword(req, res) {
  const staff = await staffDa(req);
  if (!staff) return send(res, 401, { error: 'Accesso richiesto' });
  let body;
  try { body = await readJson(req, 10_000); } catch { return send(res, 400, { error: 'Richiesta non valida' }); }
  if (!passwordValida(body.nuova)) return send(res, 400, { error: 'La nuova password deve avere almeno 10 caratteri' });
  const ip = clientIp(req);
  if (throttle.blocked(ip, staff.email)) return send(res, 429, { error: 'Troppi tentativi, riprova tra 15 minuti' }, { 'Retry-After': '900' });
  const { rows } = await pool.query('select password_hash from auth.users where id = $1', [staff.id]);
  if (!rows.length || !(await checkPassword(String(body.attuale || ''), rows[0].password_hash))) {
    throttle.fail(ip, staff.email);
    return send(res, 400, { error: 'La password attuale non è corretta' });
  }
  await pool.query('update auth.users set password_hash = $2 where id = $1', [staff.id, await hashPassword(body.nuova)]);
  send(res, 200, { ok: true });
}

async function handleUtenti(req, res, p) {
  const staff = await staffDa(req);
  if (!staff) return send(res, 401, { error: 'Accesso richiesto' });
  if (staff.role !== 'owner') return send(res, 403, { error: 'Solo il titolare gestisce gli utenti' });

  if (req.method === 'GET' && p === '/api/utenti') {
    const { rows } = await pool.query(`select u.id, u.email, u.created_at, r.role, r.nome
      from auth.users u join public.staff_roles r on r.user_id = u.id order by r.role, u.email`);
    return send(res, 200, rows);
  }

  let body = {};
  if (req.method === 'POST') {
    try { body = await readJson(req, 10_000); } catch { return send(res, 400, { error: 'Richiesta non valida' }); }
  }
  const nome = body.nome == null ? null : String(body.nome).trim().slice(0, 60) || null;
  const role = body.role;
  if (role !== undefined && !['owner', 'staff'].includes(role)) return send(res, 400, { error: 'Ruolo non valido' });

  if (req.method === 'POST' && p === '/api/utenti') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!emailValida(email)) return send(res, 400, { error: 'Email non valida' });
    if (!passwordValida(body.password)) return send(res, 400, { error: 'La password deve avere almeno 10 caratteri' });
    const client = await pool.connect();
    try {
      await client.query('begin');
      const r = await client.query('insert into auth.users (email, password_hash) values ($1, $2) returning id', [email, await hashPassword(body.password)]);
      await client.query('insert into public.staff_roles (user_id, role, nome) values ($1, $2, $3)', [r.rows[0].id, role || 'staff', nome]);
      await client.query('commit');
      console.log(`utente creato: ${email} (${role || 'staff'})`);
      return send(res, 201, { id: r.rows[0].id });
    } catch (e) {
      await client.query('rollback');
      if (e.code === '23505') return send(res, 409, { error: 'Esiste già un utente con questa email' });
      throw e;
    } finally {
      client.release();
    }
  }

  const m = p.match(/^\/api\/utenti\/([0-9a-f-]{36})(\/password)?$/);
  if (!m || !UUID.test(m[1])) return send(res, 404, { error: 'Non trovato' });
  const id = m[1];
  const { rows: cur } = await pool.query('select role from public.staff_roles where user_id = $1', [id]);
  if (!cur.length) return send(res, 404, { error: 'Utente inesistente' });
  const altriTitolari = async () => (await pool.query("select count(*)::int n from public.staff_roles where role = 'owner' and user_id <> $1", [id])).rows[0].n;

  if (req.method === 'POST' && m[2]) {
    if (!passwordValida(body.password)) return send(res, 400, { error: 'La password deve avere almeno 10 caratteri' });
    await pool.query('update auth.users set password_hash = $2 where id = $1', [id, await hashPassword(body.password)]);
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST') {
    if (role === 'staff' && cur[0].role === 'owner' && !(await altriTitolari())) return send(res, 400, { error: 'Serve almeno un titolare' });
    await pool.query('update public.staff_roles set role = coalesce($2, role), nome = $3 where user_id = $1', [id, role || null, nome]);
    return send(res, 200, { ok: true });
  }
  if (req.method === 'DELETE') {
    if (id === staff.id) return send(res, 400, { error: 'Non puoi cancellare te stesso' });
    if (cur[0].role === 'owner' && !(await altriTitolari())) return send(res, 400, { error: 'Serve almeno un titolare' });
    await pool.query('delete from auth.users where id = $1', [id]);
    return send(res, 200, { ok: true });
  }
  send(res, 405, { error: 'Metodo non ammesso' });
}

// -------------------------------------------------------------- allegati ---
function tipoFile(buf) {
  if (buf.length > 4 && buf.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

async function handleUpload(req, res, url) {
  const staff = await staffDa(req);
  if (!staff) return send(res, 401, { error: 'Accesso richiesto' });
  const dove = url.searchParams.has('bolla') ? 'bolla' : 'spesa';
  if (dove === 'spesa' && staff.role !== 'owner') return send(res, 403, { error: 'Solo il titolare' });
  const id = Number(url.searchParams.get(dove));
  if (!Number.isInteger(id) || id <= 0) return send(res, 400, { error: 'Manca la spesa o la bolla' });
  const nome = String(url.searchParams.get('nome') || 'documento').replace(/[\u0000-\u001f"\\/]/g, '').trim().slice(0, 160) || 'documento';
  let buf;
  try { buf = await readBody(req, 8 * 1024 * 1024); } catch (e) { return send(res, e.status || 400, { error: 'File troppo grande (massimo 8 MB)' }); }
  const tipo = tipoFile(buf);
  if (!tipo) return send(res, 415, { error: 'Formato non valido: usa PDF, JPEG, PNG o WebP' });
  const tabella = dove === 'bolla' ? 'public.bolle' : 'public.spese';
  const { rows: s } = await pool.query(`select 1 from ${tabella} where id = $1`, [id]);
  if (!s.length) return send(res, 404, { error: dove === 'bolla' ? 'Bolla inesistente' : 'Spesa inesistente' });
  const { rows } = await pool.query(`insert into public.allegati (${dove}_id, nome, tipo, dimensione, dati) values ($1, $2, $3, $4, $5) returning id`,
    [id, nome, tipo, buf.length, buf]);
  send(res, 201, { id: rows[0].id });
}

async function handleAllegato(req, res, id) {
  const staff = await staffDa(req);
  if (!staff) return send(res, 401, { error: 'Accesso richiesto' });
  if (!UUID.test(id)) return send(res, 404, { error: 'Non trovato' });
  const { rows } = await pool.query('select nome, tipo, dati, bolla_id from public.allegati where id = $1', [id]);
  if (!rows.length) return send(res, 404, { error: 'Non trovato' });
  if (!rows[0].bolla_id && staff.role !== 'owner') return send(res, 403, { error: 'Solo il titolare' });
  res.writeHead(200, {
    'Content-Type': rows[0].tipo,
    'Content-Length': rows[0].dati.length,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(rows[0].nome)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  });
  res.end(rows[0].dati);
}

// ------------------------------------------------------------------ server ---
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true });
    if (req.method === 'POST' && p === '/login') return await handleLogin(req, res);
    if (req.method === 'POST' && p === '/refresh') return await handleRefresh(req, res);
    if (req.method === 'GET' && p === '/stream') return await handleStream(req, res, url);
    if (req.method === 'POST' && p === '/api/password') return await handlePassword(req, res);
    if (p === '/api/utenti' || p.startsWith('/api/utenti/')) return await handleUtenti(req, res, p);
    if (req.method === 'POST' && p === '/api/allegati') return await handleUpload(req, res, url);
    if (req.method === 'GET' && p.startsWith('/api/allegati/')) return await handleAllegato(req, res, p.slice(14));
    send(res, 404, { error: 'Non trovato' });
  } catch (e) {
    console.error('errore:', e.message);
    if (!res.headersSent) send(res, 500, { error: 'Errore interno' });
  }
});

// -------------------------------------------------------------- avvio ---
async function waitForDb() {
  for (let i = 0; i < 60; i++) {
    try { await pool.query('select 1'); return; } catch { await new Promise((r) => setTimeout(r, 2000)); }
  }
  throw new Error('Database non raggiungibile');
}

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

async function runMigrations() {
  let files = [];
  try {
    files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  } catch { /* nessuna cartella: niente da fare */ }

  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(727001)');
    await client.query('create table if not exists auth.schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const { rows } = await client.query('select name from auth.schema_migrations');
    const done = new Set(rows.map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into auth.schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        console.log(`Migrazione applicata: ${file}`);
      } catch (e) {
        await client.query('rollback');
        throw new Error(`Migrazione ${file} fallita: ${e.message}`);
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
}

async function bootstrapAdmin() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
  const email = ADMIN_EMAIL.trim().toLowerCase();
  const { rows } = await pool.query('select 1 from auth.users where lower(email) = $1', [email]);
  if (rows.length) return;
  const hash = await hashPassword(ADMIN_PASSWORD);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const r = await client.query('insert into auth.users (email, password_hash) values ($1, $2) returning id', [email, hash]);
    await client.query("insert into public.staff_roles (user_id, role, nome) values ($1, 'owner', 'Titolare')", [r.rows[0].id]);
    await client.query('commit');
    console.log(`Creato utente titolare: ${email}`);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

await waitForDb();
await runMigrations();
// PostgREST parte insieme a questo servizio: se si è messo in ascolto DOPO le migrazioni non ha sentito l'avviso
// «reload schema» e non vedrebbe funzioni e tabelle nuove. Lo si ripete qualche volta all'avvio (costa nulla).
for (const s of [3, 15, 60]) setTimeout(() => pool.query("notify pgrst, 'reload schema'").catch(() => {}), s * 1000).unref();
await bootstrapAdmin();
await startListener();
server.listen(Number(PORT), () => console.log(`Servizio in ascolto sulla porta ${PORT}`));
