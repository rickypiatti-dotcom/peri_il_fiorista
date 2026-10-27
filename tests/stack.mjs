// Avvia lo stack vero in locale: PostgreSQL (embedded) + servizio auth (backend/) + PostgREST.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const HERE = path.dirname(new URL(import.meta.url).pathname), H = path.resolve(HERE, '..') + '/';
export const CFG = { pg: 54349, auth: 4110, rest: 3110, adminEmail: 'titolare@example.test', adminPass: 'PasswordDiProva-123', jwt: 'x'.repeat(16) + 'prova-di-un-segreto-lungo-almeno-32-caratteri-ok' };
const procs = []; let epg;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHttp(url, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { try { const r = await fetch(url); if (r.status < 500) return true; } catch {} await sleep(150); } throw new Error('non risponde: ' + url); }
export const dbUrl = () => `postgres://postgres:pw@127.0.0.1:${CFG.pg}/fiorista`;
export async function startDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fipg-'));
  epg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: CFG.pg, persistent: false, onLog: () => {}, onError: () => {} });
  await epg.initialise(); await epg.start(); await epg.createDatabase('fiorista');
  const c = new pg.Client({ connectionString: dbUrl() }); await c.connect();
  await c.query("create role anon nologin; create role authenticated nologin; create role authenticator login noinherit password 'authpw'; grant anon, authenticated to authenticator;");
  await c.query(fs.readFileSync(H + 'db/init/01-schema.sql', 'utf8'));
  await c.query(fs.readFileSync(H + 'db/init/02-seed.sql', 'utf8'));
  await c.end();
  return () => new pg.Client({ connectionString: dbUrl() });
}
export async function start(extraEnv = {}) {
  const adminDb = await startDb();
  const APP = path.join(HERE, '.app');
  fs.rmSync(APP, { recursive: true, force: true }); fs.mkdirSync(APP, { recursive: true });
  for (const f of fs.readdirSync(H + 'backend').filter((f) => f.endsWith('.js'))) fs.copyFileSync(H + 'backend/' + f, path.join(APP, f));
  fs.symlinkSync(H + 'db/migrations', path.join(APP, 'migrations'));
  fs.symlinkSync(path.join(HERE, 'node_modules'), path.join(APP, 'node_modules'));
  fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify({ type: 'module' }));
  const env = { ...process.env, DATABASE_URL: dbUrl(), JWT_SECRET: CFG.jwt, ADMIN_EMAIL: CFG.adminEmail, ADMIN_PASSWORD: CFG.adminPass, PORT: String(CFG.auth), TRUST_CF_HEADER: '1', ...extraEnv };
  const auth = spawn(process.execPath, ['server.js'], { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] }); procs.push(auth);
  auth.logs = ''; auth.stdout.on('data', (d) => (auth.logs += d)); auth.stderr.on('data', (d) => (auth.logs += d));
  const rest = spawn(path.join(HERE, 'postgrest'), [], { env: { PGRST_DB_URI: `postgres://authenticator:authpw@127.0.0.1:${CFG.pg}/fiorista`, PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: CFG.jwt, PGRST_DB_MAX_ROWS: '5000', PGRST_OPENAPI_MODE: 'disabled', PGRST_SERVER_PORT: String(CFG.rest) }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(rest); rest.logs = ''; rest.stdout.on('data', (d) => (rest.logs += d)); rest.stderr.on('data', (d) => (rest.logs += d));
  try { await waitHttp(`http://127.0.0.1:${CFG.auth}/health`); await waitHttp(`http://127.0.0.1:${CFG.rest}/categorie`); }
  catch (e) { console.error('AUTH LOG:\n' + auth.logs + '\nREST LOG:\n' + rest.logs); throw e; }
  return { auth, rest, adminDb };
}
export async function stop() { for (const p of procs) p.kill(); procs.length = 0; try { await epg.stop(); } catch {} }
