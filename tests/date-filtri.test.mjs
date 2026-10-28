// Date dei filtri: la pagina NON si ridisegna mentre si scrive o si sceglie la data (bug del 28 ott: scritto il giorno,
// le statistiche si aggiornavano subito e non si poteva scrivere il mese). Si cerca SOLO col pulsante «🔍 Cerca» (o Invio).
// Stesse variabili di browser.test.mjs (CHROME, NGINX, MIME, PW, LD_LIBRARY_PATH).
import assert from 'node:assert/strict';
import { avvia, contatore } from './ambiente.mjs';

const A = await avvia(8198);
const { prova, fine } = contatore();
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const cerca = (pg, box) => pg.click(`${box} .cerca-date`);
const segna = (pg, sel) => pg.$eval(sel, (e) => { e.dataset.vecchio = '1'; });
const ancoraLui = async (pg, sel) => (await pg.$(`${sel}[data-vecchio]`)) !== null;
const scrivi = async (pg, sel, tasti) => { await pg.focus(sel); await pg.keyboard.type(tasti, { delay: 150 }); };
// ordine dei pezzi della data nel campo (gg/mm in italiano, mm/gg nel Chromium di prova senza lingua): si scopre scrivendo in un campo di prova
let MESE_PRIMA = false;
async function ordine(pg) {
  MESE_PRIMA = await pg.evaluate(() => { const i = document.createElement('input'); i.type = 'date'; i.id = 'sonda'; document.body.append(i); return true; })
    && (await (async () => { await pg.focus('#sonda'); await pg.keyboard.type('0102'); await pg.keyboard.type('2026');
      const v = await pg.$eval('#sonda', (e) => { const x = e.value; e.remove(); return x; }); return v === '2026-01-02'; })());
}
const gm = (g, m) => (MESE_PRIMA ? m + g : g + m); // giorno e mese nell'ordine del campo
try {
  const pg = await A.nuova();
  await A.entra(pg);
  await ordine(pg);

  await prova('statistiche: data scritta a mano, nessun aggiornamento finché non si preme Cerca', async () => {
    await A.vai(pg, 'statistiche');
    const sel = '#pf [name=da]';
    await segna(pg, sel);
    await scrivi(pg, sel, gm('15', '03') + '2025');
    await pausa(2500); // nemmeno dopo una pausa
    assert.ok(await ancoraLui(pg, sel), 'ridisegnata senza premere Cerca');
    assert.ok(await pg.$('#pf .cerca-date.primary'), 'il pulsante non segnala la ricerca da fare');
    await cerca(pg, '#pf');
    await pg.waitForSelector(`${sel}:not([data-vecchio])`, { timeout: 5000 });
    assert.equal(await pg.$eval(sel, (e) => e.value), '2025-03-15');
    assert.match(await pg.$eval('#view', (e) => e.innerText), /Dal 15\/03\/2025/);
    assert.equal(await pg.$('#pf .cerca-date.primary'), null);
  });
  await prova('statistiche: anche dal calendario si aspetta Cerca', async () => {
    const sel = '#pf [name=da]';
    await segna(pg, sel);
    await pg.fill(sel, '2026-01-01');
    await pausa(800);
    assert.ok(await ancoraLui(pg, sel), 'ridisegnata senza premere Cerca');
    await cerca(pg, '#pf');
    await pg.waitForSelector(`${sel}:not([data-vecchio])`, { timeout: 5000 });
    assert.equal(await pg.$eval(sel, (e) => e.value), '2026-01-01');
  });
  await prova('statistiche: Invio nel campo = Cerca', async () => {
    const sel = '#pf [name=a]';
    await segna(pg, sel);
    await scrivi(pg, sel, gm('20', '10'));
    await pg.keyboard.press('Enter');
    await pg.waitForSelector(`${sel}:not([data-vecchio])`, { timeout: 5000 });
    assert.match(await pg.$eval(sel, (e) => e.value), /-10-20$/);
  });
  await prova('statistiche: date invertite (Al prima di Dal) vengono scambiate', async () => {
    await pg.fill('#pf [name=da]', '2026-05-31'); await pg.fill('#pf [name=a]', '2026-05-01');
    await cerca(pg, '#pf');
    await pg.waitForSelector('#pf [name=da][value="2026-05-01"]', { timeout: 5000 });
    assert.equal(await pg.$eval('#pf [name=a]', (e) => e.value), '2026-05-31');
  });
  await prova('statistiche: data incompleta = messaggio, nessuna ricerca', async () => {
    const sel = '#pf [name=da]';
    await segna(pg, sel);
    await pg.fill(sel, '');
    await cerca(pg, '#pf');
    await A.toast(pg, 'data completa');
    assert.ok(await ancoraLui(pg, sel));
  });
  for (const [nome, rotta, box] of [['incassi', 'cassa/incassi', '#fi'], ['spese', 'spese', '#sf'],
    ['pagina Altro', 'altro', '#al-f'], ['movimenti', 'magazzino/movimenti', '#mf'], ['registro', 'impostazioni/registro', '#rf']]) {
    await prova(`${nome}: la data scritta non aggiorna da sola, Cerca sì`, async () => {
      await A.vai(pg, rotta);
      const sel = `${box} [name=da]`;
      await pg.waitForSelector(sel);
      await segna(pg, sel);
      await scrivi(pg, sel, gm('02', '04') + '2026');
      await pausa(2000);
      assert.ok(await ancoraLui(pg, sel), 'ridisegnata senza premere Cerca');
      await cerca(pg, box);
      await pg.waitForSelector(`${sel}:not([data-vecchio])`, { timeout: 5000 });
      assert.equal(await pg.$eval(sel, (e) => e.value), '2026-04-02');
    });
  }
  await prova('chiusura di cassa: il giorno cambia solo con Cerca', async () => {
    await A.vai(pg, 'cassa/chiusura');
    await scrivi(pg, '#ch-data', gm('01', '10'));
    await pausa(2000);
    assert.match(await pg.evaluate(() => location.hash), /^#\/cassa\/chiusura\/?$/);
    await pg.click('#view .filtri .cerca-date');
    await pg.waitForSelector('#ch-data[value$="-10-01"]', { timeout: 5000 });
    assert.match(await pg.evaluate(() => location.hash), /chiusura\/\d{4}-10-01$/);
  });
  await prova('consegne: il giorno cambia solo con Cerca; i tasti Oggi/Domani restano immediati', async () => {
    await A.vai(pg, 'ordini/consegne');
    await pg.fill('#gc-data', '2026-12-24');
    await pausa(800);
    assert.doesNotMatch(await pg.evaluate(() => location.hash), /2026-12-24/);
    await pg.click('#view .filtri .cerca-date');
    await pg.waitForSelector('#gc-data[value="2026-12-24"]', { timeout: 5000 });
    await pg.click('[data-g]');
    await pg.waitForSelector('#gc-data:not([value="2026-12-24"])', { timeout: 5000 });
  });
  await prova('telefono: date e pulsante Cerca stanno nello schermo e funzionano', async () => {
    const tel = await A.nuova({ telefono: true });
    await A.entra(tel);
    await A.vai(tel, 'statistiche');
    await tel.fill('#pf [name=da]', '2026-02-01');
    await tel.tap('#pf .cerca-date');
    await tel.waitForSelector('#pf [name=da][value="2026-02-01"]', { timeout: 5000 });
    assert.ok(await tel.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'pagina più larga dello schermo');
    await A.foto(tel, 'date-cerca-telefono');
  });
  await prova('nessun errore JavaScript', async () => { assert.deepEqual(A.problemi, []); });
} finally {
  await A.chiudiTutto();
}
process.exit(fine() ? 1 : 0);
