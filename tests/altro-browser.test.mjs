// Pagina «Altro» nel browser: clic sul fiore accanto al nome, totale di giornata con «altro», contabilità separata.
// Stesse variabili di browser.test.mjs (CHROME, NGINX, MIME, PW, LD_LIBRARY_PATH).
import assert from 'node:assert/strict';
import { avvia, contatore, CFG } from './ambiente.mjs';

const A = await avvia(8197);
const { prova, fine } = contatore();
const testo = (pg, sel = '#view') => pg.$eval(sel, (e) => e.innerText);
try {
  const pg = await A.nuova();
  await A.entra(pg);

  await prova('totale di giornata: il campo «Altro» avvisa che va nella contabilità a parte', async () => {
    await A.vai(pg, 'cassa/giornata');
    assert.match(await testo(pg, '#gg'), /Altro\s*· contabilità a parte/);
    await pg.fill('[data-met="contanti"]', '300'); await pg.fill('[data-met="carta"]', '200'); await pg.fill('[data-met="altro"]', '150');
    await pg.click('#gg [type=submit]');
    await A.toast(pg, 'Totale di giornata registrato');
    assert.equal((await A.q('select count(*)::int n from entrate'))[0].n, 3);
  });
  await prova('elenco incassi: 500 € senza «altro», con il rimando alla pagina Altro', async () => {
    await A.vai(pg, 'cassa/incassi');
    const t = await testo(pg);
    assert.match(t, /Totale\s*500,00\s*€/); assert.doesNotMatch(t, /150,00/);
    assert.match(t, /contabilità separata/);
    assert.ok(!(await pg.$$eval('#fi [name=metodo] option', (o) => o.map((x) => x.textContent))).includes('altro'));
  });
  await prova('cruscotto: incassato oggi 500 €, niente «altro»', async () => {
    await A.vai(pg, 'cruscotto');
    const t = await testo(pg);
    assert.match(t, /500,00/); assert.doesNotMatch(t, /650,00/); assert.doesNotMatch(t, /altro 150/);
  });
  await prova('statistiche: incassi 500 €', async () => {
    await A.vai(pg, 'statistiche');
    const t = await testo(pg, '.kpi');
    assert.match(t, /Incassi\s*500,00\s*€/);
  });
  await prova('clic sul fiore accanto al nome: si apre la pagina Altro con 150 €', async () => {
    await pg.click('.brand .fiore');
    await pg.waitForSelector('#view h1:has-text("Altro")');
    assert.equal(await pg.evaluate(() => location.hash), '#/altro');
    const t = await testo(pg);
    assert.match(t, /Totale «altro»\s*150,00\s*€/); assert.match(t, /Transazioni\s*1/);
    assert.match(t, /Totale di giornata \(altro\)/); assert.doesNotMatch(t, /contanti\)/);
    await A.foto(pg, 'altro-computer');
  });
  await prova('pagina Altro: dettaglio dal clic sulla riga e CSV', async () => {
    await pg.click('#view tr[data-id]');
    await pg.waitForSelector('#modal:not([hidden]) h2');
    assert.match(await testo(pg, '#modal'), /150,00/);
    await pg.click('#modal [data-chiudi]');
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#al-csv')]);
    assert.match(dl.suggestedFilename(), /^altro_.*\.csv$/);
  });
  await prova('pagina Altro: periodo «Anno scorso» vuoto', async () => {
    await pg.click('[data-k="annoscorso"]'); await pg.waitForSelector('#view .vuoto');
    assert.match(await testo(pg), /Nessun pagamento «altro»/);
  });
  await prova('telefono: fiore nella barra in alto, pagina non più larga dello schermo', async () => {
    const tel = await A.nuova({ telefono: true });
    await A.entra(tel);
    await tel.tap('.top .fiore');
    await tel.waitForSelector('#view h1:has-text("Altro")');
    await tel.waitForSelector('#view .kpi');
    assert.ok(await tel.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'pagina più larga dello schermo');
    await A.foto(tel, 'altro-telefono');
  });
  await prova('commesso: la pagina Altro non mostra dati', async () => {
    await A.utente('staff@example.test', 'Commesso-1234');
    const s = await A.nuova();
    await A.entra(s, 'staff@example.test', 'Commesso-1234');
    await s.click('.brand .fiore');
    await s.waitForSelector('#view h1:has-text("Altro")');
    assert.match(await testo(s), /solo il titolare/); assert.doesNotMatch(await testo(s), /150/);
  });
  await prova('nessun errore JavaScript', async () => { assert.deepEqual(A.problemi, []); });
  void CFG;
} finally {
  await A.chiudiTutto();
}
process.exit(fine() ? 1 : 0);
