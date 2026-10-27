// Ambiente comune per le prove nel browser: stack vero + nginx vero (configurazione del sito) + Chromium.
// Variabili: CHROME, NGINX, MIME, PW, eventualmente LD_LIBRARY_PATH (vedi README).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { start, stop, CFG } from './stack.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname), H = path.resolve(HERE, '..');
export const SHOTS = path.join(HERE, 'shots');
export { CFG };

export async function avvia(porta = 8196) {
  const BASE = `http://127.0.0.1:${porta}`;
  fs.mkdirSync(SHOTS, { recursive: true });
  const NG = fs.mkdtempSync(path.join(os.tmpdir(), 'fing-'));
  const conf = fs.readFileSync(path.join(H, 'nginx.conf'), 'utf8')
    .replace(/resolver 127\.0\.0\.11[^;]*;/, '')
    .replaceAll('http://postgrest:3000', `http://127.0.0.1:${CFG.rest}`).replaceAll('http://auth:4000', `http://127.0.0.1:${CFG.auth}`)
    .replace('listen 80;', `listen 127.0.0.1:${porta};`).replace('root /usr/share/nginx/html;', `root ${H};`)
    .replaceAll('/etc/nginx/snippets/security.conf', path.join(H, 'nginx-security.conf'));
  fs.writeFileSync(path.join(NG, 'nginx.conf'), `pid ${NG}/nginx.pid; error_log ${NG}/error.log; daemon off;
events {} http { include ${process.env.MIME}; default_type application/octet-stream; access_log ${NG}/access.log;
client_body_temp_path ${NG}/cb; proxy_temp_path ${NG}/px; fastcgi_temp_path ${NG}/fc; uwsgi_temp_path ${NG}/uw; scgi_temp_path ${NG}/sc;
${conf} }`);
  const t = spawnSync(process.env.NGINX, ['-t', '-p', NG, '-c', path.join(NG, 'nginx.conf')], { encoding: 'utf8' });
  assert.equal(t.status, 0, 'nginx -t: ' + t.stderr);

  const stack = await start();
  const ngx = spawn(process.env.NGINX, ['-p', NG, '-c', path.join(NG, 'nginx.conf')], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 400));
  const db = stack.adminDb(); await db.connect();
  const q = async (sql, p) => (await db.query(sql, p)).rows;
  const { chromium } = createRequire(import.meta.url)(process.env.PW || 'playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox', '--disable-gpu'] });
  const problemi = [];

  async function nuova({ telefono = false } = {}) {
    const ctx = await browser.newContext(telefono
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'it-IT', timezoneId: 'Europe/Rome', acceptDownloads: true }
      : { viewport: { width: 1280, height: 900 }, locale: 'it-IT', timezoneId: 'Europe/Rome', acceptDownloads: true });
    const pg = await ctx.newPage();
    pg.on('console', (m) => { if (m.type() === 'error') problemi.push(m.text()); });
    pg.on('pageerror', (e) => problemi.push('JS: ' + e.message));
    pg.tocca = (sel) => (telefono ? pg.tap(sel) : pg.click(sel));
    return pg;
  }
  async function entra(pg, email = CFG.adminEmail, password = CFG.adminPass) {
    await pg.goto(BASE + '/');
    await pg.fill('#l-email', email); await pg.fill('#l-pass', password); await pg.tocca('#l-btn');
    await pg.waitForSelector('#app:not([hidden]) #view .testa');
  }
  async function vai(pg, r) { await pg.evaluate((x) => FG.vai(x), r); await pg.waitForTimeout(150); await pg.waitForSelector('#view .testa'); await pg.waitForTimeout(100); }
  const toast = (pg, testo) => pg.waitForSelector(`.toast:has-text("${testo}")`, { timeout: 8000 });
  const foto = (pg, n) => pg.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: true });
  async function utente(email, password, role = 'staff') {
    const r = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: CFG.adminEmail, password: CFG.adminPass }) });
    const tok = (await r.json()).access_token;
    const c = await fetch(BASE + '/api/utenti', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, role }) });
    assert.equal(c.status, 201);
  }
  async function chiudiTutto() { await browser.close(); ngx.kill(); await db.end(); await stop(); }
  return { BASE, q, nuova, entra, vai, toast, foto, utente, problemi, chiudiTutto };
}

// contatore dei controlli: una prova che fallisce non ferma le altre
export function contatore() {
  let ok = 0, ko = 0;
  return {
    async prova(nome, fn) {
      try { await fn(); ok++; console.log('  ✓ ' + nome); }
      catch (e) { ko++; console.log('  ✗ ' + nome + '\n      ' + String(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); }
    },
    fine() { console.log(`\n${ok} ok, ${ko} falliti`); return ko; },
  };
}
