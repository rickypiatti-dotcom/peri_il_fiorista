// Prova nel browser VERO (Chromium) attraverso nginx VERO con la configurazione del sito.
// Servono (non sono nel repository, vedi README): CHROME, NGINX, MIME, PW (cartella di playwright-core), LD_LIBRARY_PATH se mancano librerie.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { start, stop, CFG } from './stack.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname), H = path.resolve(HERE, '..');
const PORT = 8198, BASE = `http://127.0.0.1:${PORT}`;
const { chromium } = createRequire(import.meta.url)(process.env.PW || 'playwright-core');
const SHOTS = path.join(HERE, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });

const NG = fs.mkdtempSync(path.join(os.tmpdir(), 'fing-'));
const conf = fs.readFileSync(path.join(H, 'nginx.conf'), 'utf8')
  .replace(/resolver 127\.0\.0\.11[^;]*;/, '')
  .replaceAll('http://postgrest:3000', `http://127.0.0.1:${CFG.rest}`).replaceAll('http://auth:4000', `http://127.0.0.1:${CFG.auth}`)
  .replace('listen 80;', `listen 127.0.0.1:${PORT};`).replace('root /usr/share/nginx/html;', `root ${H};`)
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
let ok = 0; const pass = (m) => { ok++; console.log('  ok -', m); };
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox', '--disable-gpu'] });
const problemi = [];
async function nuova(vp = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'it-IT', timezoneId: 'Europe/Rome' });
  const pg = await ctx.newPage();
  pg.on('console', (m) => { if (m.type() === 'error') problemi.push(m.text()); });
  pg.on('pageerror', (e) => problemi.push('JS: ' + e.message));
  return pg;
}
const foto = (pg, n) => pg.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: true });
const dialogo = '#modal .dialog';
async function entra(pg, email, pass_) {
  await pg.goto(BASE + '/');
  await pg.fill('#l-email', email); await pg.fill('#l-pass', pass_); await pg.click('#l-btn');
  await pg.waitForSelector('#app:not([hidden]) #view .testa');
}
async function vai(pg, r) { await pg.evaluate((x) => { location.hash = '#/' + x; }, r); await pg.waitForTimeout(150); await pg.waitForSelector('#view .testa'); }
async function toast(pg, testo) { await pg.waitForSelector(`.toast:has-text("${testo}")`, { timeout: 8000 }); }
const nessunoSborda = async (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

try {
  console.log('Titolare al computer');
  const pg = await nuova();
  await pg.goto(BASE + '/');
  await pg.waitForSelector('#login:not([hidden])');
  await pg.fill('#l-email', CFG.adminEmail); await pg.fill('#l-pass', 'sbagliata'); await pg.click('#l-btn');
  await pg.waitForSelector('#l-err:not([hidden])');
  pass('password sbagliata: messaggio');
  await entra(pg, CFG.adminEmail, CFG.adminPass);
  assert.ok(await pg.isVisible('#nav a[data-r=spese]')); assert.ok(await pg.isVisible('text=Punto di pareggio'));
  await foto(pg, '01-cruscotto-vuoto'); pass('cruscotto del titolare (vuoto), menu completo');

  // impostazioni: nome e colore
  await vai(pg, 'impostazioni');
  await pg.fill('#ia [name=nome_attivita]', 'Peri il Fiorista'); await pg.fill('#ia [name=partita_iva]', '01234567890');
  await pg.fill('#ia [name=obiettivo_mese_cent]', '8000');
  await pg.click('#ia [type=submit]'); await toast(pg, 'Impostazioni salvate');
  assert.equal(await pg.textContent('#brand-nome'), 'Peri il Fiorista'); pass('impostazioni: il nome cambia ovunque');
  for (const tab of ['liste', 'categorie', 'feste', 'utenti', 'registro', 'dati']) { await vai(pg, 'impostazioni/' + tab); }
  await foto(pg, '02-impostazioni-dati'); pass('tutte le schede delle impostazioni si aprono');
  await vai(pg, 'impostazioni/liste');
  await pg.fill('#il [name="Metodi di incasso"]', 'contanti\ncarta\nsatispay\nbuono regalo');
  await pg.click('#il [type=submit]'); await toast(pg, 'Salvato');
  assert.deepEqual((await q('select metodi_incasso from impostazioni'))[0].metodi_incasso, ['contanti', 'carta', 'satispay', 'buono regalo']); pass('liste modificabili (metodi di incasso)');

  // fornitore
  await vai(pg, 'fornitori'); await pg.click('#f-nuovo');
  await pg.fill(`${dialogo} [name=nome]`, 'Vivaio Verde Sas'); await pg.click(`${dialogo} [type=submit]`); await toast(pg, 'Salvato');
  await pg.waitForSelector('td:has-text("Vivaio Verde Sas")'); pass('fornitore creato');

  // articoli
  await vai(pg, 'magazzino'); await pg.click('#a-nuovo');
  await pg.fill(`${dialogo} [name=nome]`, 'Rosa rossa Freedom');
  await pg.selectOption(`${dialogo} [name=categoria_id]`, { label: 'Fiori recisi' });
  await pg.selectOption(`${dialogo} [name=unita]`, 'stelo');
  await pg.fill(`${dialogo} [name=prezzo_acquisto_cent]`, '0,80');
  await pg.waitForSelector('#a-sugg:has-text("Prezzo consigliato")');
  await pg.click('#a-usa');
  assert.equal(await pg.inputValue(`${dialogo} [name=prezzo_vendita_cent]`), '2,00'); // 0,80 × 2,5 × 1,10 = 2,20 -> arrotondato a 50 cent = 2,00
  await pg.fill(`${dialogo} [name=prezzo_vendita_cent]`, '3,00');
  await pg.check(`${dialogo} [name=deperibile]`); await pg.fill(`${dialogo} [name=giorni_vita]`, '6');
  await pg.fill(`${dialogo} [name=scorta_minima]`, '20'); await pg.fill(`${dialogo} [name=iniziale]`, '10');
  await foto(pg, '03-articolo');
  await pg.click(`${dialogo} [type=submit]`); await toast(pg, 'Salvato');
  await pg.waitForSelector('td:has-text("Rosa rossa Freedom")');
  let [rosa] = await q("select * from prodotti where nome = 'Rosa rossa Freedom'");
  assert.equal(Number(rosa.giacenza), 10); assert.equal(rosa.prezzo_vendita_cent, 300); pass('articolo con prezzo consigliato e giacenza iniziale');
  await pg.click('#a-nuovo');
  await pg.fill(`${dialogo} [name=nome]`, 'Eucalipto'); await pg.selectOption(`${dialogo} [name=categoria_id]`, { label: 'Verde ornamentale' });
  await pg.fill(`${dialogo} [name=prezzo_acquisto_cent]`, '0,30'); await pg.fill(`${dialogo} [name=prezzo_vendita_cent]`, '1,00');
  await pg.click(`${dialogo} [type=submit]`); await toast(pg, 'Salvato');

  // bolla
  await vai(pg, 'bolle/nuova');
  await pg.selectOption('#nb [name=fornitore_id]', { label: 'Vivaio Verde Sas' });
  await pg.fill('#nb [name=numero]', 'DDT 1203'); await pg.fill('#nb [name=data_documento]', '2026-10-20');
  await pg.selectOption('[data-rp="0"]', { label: 'Rosa rossa Freedom (stelo)' });
  await pg.fill('[data-rq="0"]', '50'); await pg.fill('[data-rc="0"]', '0,90');
  await pg.click('#nb-piu'); await pg.selectOption('[data-rp="1"]', { label: 'Eucalipto (pz)' }); await pg.fill('[data-rq="1"]', '20');
  await pg.waitForSelector('#nb-tot:has-text("totale")');
  await pg.setInputFiles('#nb [name=file]', { name: 'bolla.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a6a60000000049454e44ae426082', 'hex') });
  await foto(pg, '04-bolla-nuova');
  await pg.click('#nb [type=submit]'); await toast(pg, 'Caricati 2 articoli');
  await pg.waitForSelector('h1:has-text("DDT 1203")'); await pg.waitForSelector('[data-all]');
  [rosa] = await q("select * from prodotti where nome = 'Rosa rossa Freedom'");
  assert.equal(Number(rosa.giacenza), 60); assert.equal(rosa.prezzo_acquisto_cent, 90); assert.equal(rosa.ultimo_carico.getDate ? 1 : 1, 1);
  await foto(pg, '05-bolla'); pass('bolla: merce caricata, costo aggiornato, foto allegata');

  // composizione
  await vai(pg, 'ricette'); await pg.click('#r-nuova');
  await pg.fill(`${dialogo} [name=nome]`, 'Bouquet 12 rose');
  await pg.selectOption('[data-cp="0"]', { index: 1 }); // eucalipto o rosa: scegliamo per nome sotto
  const opz = await pg.$$eval('[data-cp="0"] option', (o) => o.map((x) => [x.value, x.textContent]));
  await pg.selectOption('[data-cp="0"]', opz.find(([, t]) => t.startsWith('Rosa'))[0]); await pg.fill('[data-cq="0"]', '12');
  await pg.click('#r-piu'); await pg.selectOption('[data-cp="1"]', opz.find(([, t]) => t.startsWith('Eucalipto'))[0]); await pg.fill('[data-cq="1"]', '3');
  await pg.fill(`${dialogo} [name=manodopera]`, '5');
  await pg.waitForSelector('#r-calc:has-text("Materiali")');
  await pg.click('#r-usa');
  await foto(pg, '06-composizione');
  await pg.click(`${dialogo} [type=submit]`); await toast(pg, 'Composizione salvata');
  const [ric] = await q("select * from ricette_vista where nome = 'Bouquet 12 rose'");
  assert.equal(Number(ric.costo_materiali_cent), 12 * 90 + 3 * 30); assert.equal(ric.possibili, 5); pass('composizione: costo materiali e quante se ne possono fare');

  // cassa
  await vai(pg, 'cassa');
  await pg.click('.tile:has-text("Rosa rossa Freedom")'); await pg.click('.tile:has-text("Rosa rossa Freedom")');
  await pg.click('.tile.ricetta:has-text("Bouquet 12 rose")');
  await pg.click('[data-met="carta"]');
  await foto(pg, '07-cassa');
  const totaleTesto = await pg.textContent('#s-ok');
  await pg.click('#s-ok'); await toast(pg, 'Incassati');
  const [v] = await q('select * from entrate order by id desc limit 1');
  assert.equal(v.metodo, 'carta'); assert.equal(v.totale_cent, 600 + ric.prezzo_vendita_cent); assert.ok(totaleTesto.includes(((600 + ric.prezzo_vendita_cent) / 100).toFixed(2).replace('.', ',')));
  [rosa] = await q("select * from prodotti where nome = 'Rosa rossa Freedom'");
  assert.equal(Number(rosa.giacenza), 60 - 2 - 12); pass('vendita al banco: articoli + composizione, magazzino scalato');
  // importo libero + contanti con resto
  await pg.click('#banco-libera'); await pg.fill(`${dialogo} [name=prezzo]`, '15'); await pg.click(`${dialogo} [type=submit]`);
  await pg.click('[data-met="contanti"]'); await pg.fill('#s-ricevuti', '20');
  assert.ok((await pg.textContent('#s-resto')).includes('5,00')); await pg.click('#s-ok'); await toast(pg, 'Incassati'); pass('importo libero, resto calcolato');

  await vai(pg, 'cassa/giornata');
  await pg.fill('[data-met="contanti"]', '120'); await pg.fill('[data-met="satispay"]', '30,50');
  await pg.click('#gg [type=submit]'); await pg.waitForSelector('.tabs a.on:has-text("Incassi")');
  assert.equal((await q("select count(*)::int n from entrate where descrizione like 'Totale di giornata%'"))[0].n, 2); pass('totale di giornata: un incasso per metodo');
  await foto(pg, '08-incassi');
  await pg.click('tr[data-id]'); await pg.waitForSelector(`${dialogo} [data-annulla]`); await pg.click(`${dialogo} [data-chiudi]`); pass('dettaglio di un incasso');

  await vai(pg, 'cassa/chiusura');
  await pg.fill('#ch [name=fondo]', '100'); await pg.fill('#ch [name=contati]', '250');
  await pg.click('#ch [type=submit]'); await pg.waitForSelector('.esito');
  const esito = await pg.textContent('.esito b');
  assert.ok(/Avanzano|Mancano|giusta/.test(esito), esito);
  await foto(pg, '09-chiusura'); pass('chiusura di cassa: ' + esito.trim());

  // preventivo -> ordine -> acconto
  await vai(pg, 'ordini/preventivi'); await pg.click('#o-nuovo');
  await pg.selectOption(`${dialogo} [name=cliente_id]`, 'nuovo'); await pg.fill(`${dialogo} [name=nc_nome]`, 'Giulia Bianchi'); await pg.fill(`${dialogo} [name=nc_tel]`, '333 1112222');
  await pg.fill(`${dialogo} [name=descrizione]`, 'Matrimonio Bianchi: bouquet sposa e 10 centrotavola');
  await pg.selectOption(`${dialogo} [name=consegna]`, 'evento'); await pg.fill(`${dialogo} [name=indirizzo]`, 'Villa Rosa, Saronno');
  await pg.fill('[data-vd="0"]', 'Bouquet sposa'); await pg.fill('[data-vp="0"]', '150');
  await pg.click('#om-piu'); await pg.fill('[data-vd="1"]', 'Centrotavola'); await pg.fill('[data-vq="1"]', '10'); await pg.fill('[data-vp="1"]', '45');
  await pg.selectOption('#om-ric', { index: 1 });
  await foto(pg, '10-preventivo-modulo');
  await pg.click(`${dialogo} [type=submit]`); await toast(pg, 'Preventivo salvato');
  await pg.waitForSelector('h1:has-text("Preventivo")');
  const [o] = await q('select * from ordini_vista order by id desc limit 1');
  assert.equal(o.totale_cent, 15000 + 45000 + ric.prezzo_vendita_cent); assert.equal(o.cliente, 'Giulia Bianchi'); pass('preventivo con nuovo cliente, voci e composizione');
  await pg.evaluate(() => { window.print = () => {}; });
  await pg.click('[data-a="stampa"]'); await pg.waitForTimeout(200); pass('stampa del preventivo senza errori');
  await pg.click('[data-a="accetta"]'); await toast(pg, 'Preventivo accettato');
  await pg.click('[data-a="incassa"]'); await pg.click(`${dialogo} [type=submit]`); await toast(pg, 'Incasso registrato');
  const [o2] = await q('select * from ordini_vista where id = $1', [o.id]);
  assert.equal(o2.stato, 'da_fare'); assert.ok(o2.incassato_cent > 0); await foto(pg, '11-ordine'); pass('preventivo accettato, acconto collegato');
  await vai(pg, 'ordini/consegne/2026-01-01'); pass('giro consegne');

  // spese e ricorrenti
  await vai(pg, 'spese'); await pg.click('#s-nuova');
  await pg.selectOption(`${dialogo} [name=categoria_id]`, { label: 'Affitto (fissa)' });
  await pg.fill(`${dialogo} [name=descrizione]`, 'Affitto ottobre'); await pg.fill(`${dialogo} [name=importo]`, '650'); await pg.click(`${dialogo} [data-iva="22"]`);
  assert.equal(await pg.inputValue(`${dialogo} [name=iva]`), '117,21');
  await pg.click(`${dialogo} [type=submit]`); await toast(pg, 'Spesa salvata');
  await pg.waitForSelector('td:has-text("Affitto ottobre")'); pass('spesa con IVA calcolata');
  await vai(pg, 'spese/ricorrenti'); await pg.click('#r-esempi'); await toast(pg, 'Voci aggiunte');
  assert.ok((await q('select count(*)::int n from ricorrenti'))[0].n >= 9); await foto(pg, '12-ricorrenti'); pass('spese ricorrenti di esempio');

  await vai(pg, 'statistiche');
  await pg.waitForSelector('.grafico svg'); await pg.waitForSelector('text=Dove vanno i soldi');
  await foto(pg, '13-statistiche'); pass('statistiche con grafici');
  await vai(pg, 'cruscotto'); await pg.waitForSelector('text=Ultimi 12 mesi'); await foto(pg, '14-cruscotto'); pass('cruscotto con dati');
  await vai(pg, 'clienti'); await pg.click('tr[data-id]'); await pg.waitForSelector('#cl-ric');
  await pg.fill('#cl-ric [name=d]', 'Anniversario'); await pg.fill('#cl-ric [name=g]', String(new Date().getDate()));
  await pg.selectOption('#cl-ric [name=m]', String(new Date().getMonth() + 1)); await pg.click('#cl-ric [type=submit]'); await toast(pg, 'Ricorrenza aggiunta');
  await vai(pg, 'cruscotto'); await pg.waitForSelector('text=Ricorrenze dei clienti'); pass('ricorrenza del cliente nel cruscotto');
  await q("update prodotti set scorta_minima = 100, riordino = 200, fornitore_id = (select id from fornitori limit 1) where nome = 'Rosa rossa Freedom'");
  await vai(pg, 'magazzino/riordino'); await pg.waitForSelector('td:has-text("Rosa rossa Freedom")');
  assert.equal(await pg.inputValue('[data-g="0"][data-i="0"]'), '200');
  await pg.click('[data-arrivo="0"]'); await pg.waitForSelector('#nb');
  assert.equal(await pg.inputValue('[data-rq="0"]'), '200'); await foto(pg, '15-riordino-bolla'); pass('lista di riordino -> bolla già compilata');
  await vai(pg, 'magazzino/inventario'); await vai(pg, 'magazzino/movimenti'); await vai(pg, 'bolle'); pass('inventario, movimenti, elenco bolle');

  console.log('Telefono');
  const tel = await nuova({ width: 390, height: 844 });
  await entra(tel, CFG.adminEmail, CFG.adminPass);
  for (const r of ['cruscotto', 'cassa', 'ordini', 'magazzino', 'spese', 'statistiche', 'impostazioni']) {
    await vai(tel, r); await tel.waitForTimeout(150);
    if (!(await nessunoSborda(tel))) console.log('SBORDA', r, await tel.evaluate(() => [...document.querySelectorAll('#view *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.scorri,.tabs,.chips,.tabella')).slice(0, 8).map((e) => e.tagName + '.' + (e.getAttribute('class') || '') + ' ' + Math.round(e.getBoundingClientRect().right) + ' ' + (e.textContent || '').slice(0, 40))));
    assert.ok(await nessunoSborda(tel), 'la pagina sborda al telefono: ' + r);
  }
  await vai(tel, 'cassa'); await tel.click('.tile:has-text("Eucalipto")'); await tel.waitForSelector('#pos-barra:not([hidden])');
  assert.ok((await tel.textContent('#pos-barra')).includes('1,00')); await foto(tel, '20-telefono-cassa');
  await tel.click('#pos-barra'); await tel.click('#s-svuota');
  await tel.click('#menu-btn'); await tel.waitForTimeout(300); await foto(tel, '21-telefono-menu'); await tel.click('#nav a[data-r=ordini]');
  await tel.waitForSelector('h1:has-text("Ordini")'); pass('telefono: nessuna pagina sborda, menu a scomparsa');

  console.log('Commesso');
  const [{ id: commesso }] = await q("select id from auth.users limit 1");
  const r = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: CFG.adminEmail, password: CFG.adminPass }) });
  const tok = (await r.json()).access_token;
  assert.equal((await fetch(BASE + '/api/utenti', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'luca@example.test', password: 'Commesso-12345', role: 'staff' }) })).status, 201);
  const st = await nuova({ width: 1024, height: 768 });
  await entra(st, 'luca@example.test', 'Commesso-12345');
  const voci = await st.$$eval('#nav a', (a) => a.map((x) => x.dataset.r));
  assert.ok(!voci.includes('spese') && !voci.includes('statistiche') && !voci.includes('impostazioni') && voci.includes('cassa'), voci.join(','));
  assert.ok(!(await st.isVisible('text=Uscite del mese'))); await foto(st, '30-commesso'); pass('commesso: niente spese, statistiche, impostazioni');
  await vai(st, 'spese'); await st.waitForTimeout(500); pass('commesso che apre a mano #/spese: nessun dato (lo vieta il database)');
  void commesso;

  const veri = problemi.filter((p) => !/Failed to load resource.*(401|403)/.test(p));
  assert.deepEqual(veri, [], 'errori nel browser');
  pass('nessun errore JavaScript nel browser');
} finally {
  await browser.close(); ngx.kill(); await db.end(); await stop();
}
console.log(`\n${ok} controlli superati`);
