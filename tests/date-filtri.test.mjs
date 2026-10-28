// Date dei filtri scritte a mano: la pagina NON si deve ridisegnare a ogni cifra (bug del 28 ott: scritto il giorno,
// le statistiche si aggiornavano subito e non si poteva scrivere il mese). Calendario/Invio/uscita dal campo = subito.
// Stesse variabili di browser.test.mjs (CHROME, NGINX, MIME, PW, LD_LIBRARY_PATH).
import assert from 'node:assert/strict';
import { avvia, contatore } from './ambiente.mjs';

const A = await avvia(8198);
const { prova, fine } = contatore();
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

  await prova('statistiche: giorno, mese e anno scritti a mano senza che la pagina si aggiorni a metà', async () => {
    await A.vai(pg, 'statistiche');
    const sel = '#pf [name=da]';
    await segna(pg, sel);
    await scrivi(pg, sel, gm('15', '03').slice(0, 2));
    assert.ok(await ancoraLui(pg, sel), 'ridisegnata dopo il primo pezzo');
    await scrivi(pg, sel, gm('15', '03').slice(2) + '2025'); // il fuoco resta sul campo: continua dal pezzo dopo
    assert.ok(await ancoraLui(pg, sel), 'ridisegnata mentre si scriveva');
    await pg.waitForSelector(`${sel}:not([data-vecchio])`, { timeout: 5000 });
    assert.equal(await pg.$eval(sel, (e) => e.value), '2025-03-15');
    assert.match(await pg.$eval('#view', (e) => e.innerText), /Dal 15\/03\/2025/);
  });
  await prova('statistiche: con Invio si aggiorna subito', async () => {
    const sel = '#pf [name=a]';
    await segna(pg, sel);
    await scrivi(pg, sel, gm('20', '10'));
    const t0 = Date.now();
    await pg.keyboard.press('Enter');
    await pg.waitForSelector(`${sel}:not([data-vecchio])`, { timeout: 5000 });
    assert.ok(Date.now() - t0 < 1200, 'troppo lento con Invio');
    assert.match(await pg.$eval(sel, (e) => e.value), /-10-20$/);
  });
  await prova('statistiche: data scelta dal calendario = aggiornamento immediato', async () => {
    const sel = '#pf [name=da]';
    await segna(pg, sel);
    const t0 = Date.now();
    await pg.fill(sel, '2026-01-01');
    await pg.waitForSelector(`${sel}:not([data-vecchio])`, { timeout: 5000 });
    assert.ok(Date.now() - t0 < 1200, 'troppo lento dal calendario');
    assert.equal(await pg.$eval(sel, (e) => e.value), '2026-01-01');
  });
  await prova('statistiche: uscendo dal campo si aggiorna subito', async () => {
    const sel = '#pf [name=da]';
    await segna(pg, sel);
    await scrivi(pg, sel, gm('05', '01'));
    assert.ok(await ancoraLui(pg, sel));
    await pg.keyboard.press('Shift+Tab'); // fuori dal campo (anche il clic altrove fa lo stesso)
    await pg.click('#view h1');
    await pg.waitForSelector(`${sel}:not([data-vecchio])`, { timeout: 1200 });
    assert.equal(await pg.$eval(sel, (e) => e.value), '2026-01-05');
  });
  for (const [nome, rotta, sel] of [['incassi', 'cassa/incassi', '#fi [name=da]'], ['spese', 'spese', '#sf [name=da]'],
    ['pagina Altro', 'altro', '#al-f [name=da]'], ['movimenti', 'magazzino/movimenti', '#mf [name=da]']]) {
    await prova(`${nome}: niente aggiornamento a metà data, poi data giusta`, async () => {
      await A.vai(pg, rotta);
      await pg.waitForSelector(sel);
      await segna(pg, sel);
      await scrivi(pg, sel, gm('02', '04'));
      assert.ok(await ancoraLui(pg, sel), 'ridisegnata mentre si scriveva');
      await scrivi(pg, sel, '2026');
      await pg.waitForSelector(`${sel}:not([data-vecchio])`, { timeout: 5000 });
      assert.equal(await pg.$eval(sel, (e) => e.value), '2026-04-02');
    });
  }
  await prova('chiusura di cassa: il giorno scritto a mano cambia pagina solo a data finita', async () => {
    await A.vai(pg, 'cassa/chiusura');
    await scrivi(pg, '#ch-data', gm('01', '10'));
    assert.match(await pg.evaluate(() => location.hash), /^#\/cassa\/chiusura\/?$/);
    await pg.waitForSelector('#ch-data[value$="-10-01"]', { timeout: 5000 });
    assert.match(await pg.evaluate(() => location.hash), /chiusura\/\d{4}-10-01$/);
  });
  await prova('consegne: giorno dal calendario = subito', async () => {
    await A.vai(pg, 'ordini/consegne');
    await pg.fill('#gc-data', '2026-12-24');
    await pg.waitForSelector('#gc-data[value="2026-12-24"]', { timeout: 1500 });
  });
  await prova('telefono: data scelta col selettore aggiorna le statistiche', async () => {
    const tel = await A.nuova({ telefono: true });
    await A.entra(tel);
    await A.vai(tel, 'statistiche');
    await tel.fill('#pf [name=da]', '2026-02-01');
    await tel.waitForSelector('#pf [name=da][value="2026-02-01"]', { timeout: 1500 });
  });
  await prova('nessun errore JavaScript', async () => { assert.deepEqual(A.problemi, []); });
} finally {
  await A.chiudiTutto();
}
process.exit(fine() ? 1 : 0);
