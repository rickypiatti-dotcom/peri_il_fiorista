// Controllo completo del 28 ott 2026: un controllo per ogni difetto trovato (sul codice di prima falliscono).
// Database (via API, come chiunque col proprio token) e pagine (Chromium vero dietro nginx vero).
// Stesse variabili di browser.test.mjs (CHROME, NGINX, MIME, PW, LD_LIBRARY_PATH).
import assert from 'node:assert/strict';
import { avvia, contatore, CFG } from './ambiente.mjs';

const A = await avvia(8195);
const { prova, fine } = contatore();
const testo = (pg, sel = '#view') => pg.$eval(sel, (e) => e.innerText);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function token(email = CFG.adminEmail, password = CFG.adminPass) {
  const r = await fetch(A.BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return (await r.json()).access_token;
}
async function api(tok, path, { method = 'GET', body, prefer = 'return=representation' } = {}) {
  const h = { Authorization: 'Bearer ' + tok };
  if (body !== undefined) { h['Content-Type'] = 'application/json'; h.Prefer = prefer; }
  const r = await fetch(A.BASE + '/rest/v1/' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, j };
}
const ok = (r, m = '') => { assert.ok(r.status < 300, `${m} ${r.status} ${JSON.stringify(r.j)}`); return r.j; };

try {
  const T = await token();
  await A.utente('staff@example.test', 'Commesso-1234');
  const S = await token('staff@example.test', 'Commesso-1234');
  const [{ oggi, ieri }] = await A.q("select current_date::text oggi, (current_date - 1)::text ieri");

  console.log('Database');
  await prova('commesso: niente incassi con una data passata (anche chiamando l\'API)', async () => {
    const r = await api(S, 'rpc/registra_vendita', { method: 'POST', body: { p: { data: ieri, importo_cent: 1000 } } });
    assert.ok(r.status >= 400, 'doveva essere rifiutato'); assert.match(r.j.message, /solo incassi di oggi/);
    ok(await api(S, 'rpc/registra_vendita', { method: 'POST', body: { p: { importo_cent: 1000 } } }), 'oggi sì');
    ok(await api(T, 'rpc/registra_vendita', { method: 'POST', body: { p: { data: ieri, importo_cent: 1000 } } }), 'il titolare sì');
  });
  await prova('totale di giornata: tutto o niente', async () => {
    const prima = (await A.q('select count(*)::int n from entrate'))[0].n;
    const r = await api(T, 'rpc/registra_giornata', { method: 'POST', body: { p: { data: oggi, importi: { contanti: 30000, carta: 999999999 } } } });
    assert.ok(r.status >= 400, 'importo enorme doveva fallire');
    assert.equal((await A.q('select count(*)::int n from entrate'))[0].n, prima, 'i contanti non dovevano restare salvati');
    assert.equal(ok(await api(T, 'rpc/registra_giornata', { method: 'POST', body: { p: { data: ieri, importi: { contanti: 30000, carta: 20000, satispay: 0 } } } })), 2);
    const r2 = await api(S, 'rpc/registra_giornata', { method: 'POST', body: { p: { data: ieri, importi: { contanti: 100 } } } });
    assert.ok(r2.status >= 400, 'commesso con data passata');
  });
  await prova('categorie e fornitori usati non si cancellano; quelli mai usati sì', async () => {
    const [cat] = ok(await api(T, 'categorie', { method: 'POST', body: { ambito: 'prodotto', nome: 'Categoria usata' } }));
    const [forn] = ok(await api(T, 'fornitori', { method: 'POST', body: { nome: 'Fornitore usato' } }));
    ok(await api(T, 'prodotti?select=id', { method: 'POST', body: { nome: 'Articolo di prova', categoria_id: cat.id, fornitore_id: forn.id } }));
    for (const [t, id] of [['categorie', cat.id], ['fornitori', forn.id]]) {
      const r = await api(T, `${t}?id=eq.${id}`, { method: 'DELETE' });
      assert.ok(r.status >= 400, t + ' usato cancellato'); assert.match(r.j.message, /non si può cancellare/);
    }
    assert.equal((await A.q('select count(*)::int n from prodotti where categoria_id = $1 and fornitore_id = $2', [cat.id, forn.id]))[0].n, 1);
    const [libera] = ok(await api(T, 'categorie', { method: 'POST', body: { ambito: 'spesa', nome: 'Mai usata' } }));
    ok(await api(T, `categorie?id=eq.${libera.id}`, { method: 'DELETE' }));
  });
  await prova('dati di esempio: si caricano e si cancellano ancora (le funzioni interne non sono bloccate)', async () => {
    await A.q('delete from movimenti; delete from entrata_righe; delete from entrate; delete from prodotti');
    ok(await api(T, 'rpc/carica_dati_esempio', { method: 'POST', body: {} }));
    // una spesa VERA su un fornitore di esempio: il fornitore non si cancella, ma la cancellazione degli esempi deve riuscire
    const [f] = await A.q("select id from fornitori where nome = 'Enel Energia'");
    ok(await api(T, 'spese', { method: 'POST', body: { descrizione: 'Bolletta vera', importo_cent: 5000, fornitore_id: f.id } }));
    ok(await api(T, 'rpc/cancella_dati_esempio', { method: 'POST', body: {} }));
    assert.equal((await A.q("select count(*)::int n from spese where descrizione = 'Bolletta vera'"))[0].n, 1);
    await A.q("delete from spese where descrizione = 'Bolletta vera'");
  });

  console.log('Pagine');
  const pg = await A.nuova();
  await A.entra(pg);
  await prova('incassi: con più di 5000 righe il totale è giusto (prima si fermava a 2000/5000 in silenzio)', async () => {
    await A.q('delete from movimenti; delete from entrata_righe; delete from entrate');
    await A.q("insert into entrate (data, totale_cent, metodo, descrizione) select current_date, 100, 'contanti', 'riga ' || g from generate_series(1, 6200) g");
    await A.vai(pg, 'cassa/incassi');
    const t = await testo(pg);
    assert.match(t, /Totale\s*6\.?200,00\s*€/); assert.match(t, /6200 incassi/); assert.match(t, /prime 1000 righe di 6200/);
    assert.equal(await pg.$$eval('#view tr[data-id]', (r) => r.length), 1000);
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#fi-csv')]);
    const csv = await (await import('node:fs')).promises.readFile(await dl.path(), 'utf8');
    await A.q('delete from entrate');
    assert.equal(csv.trim().split('\r\n').length, 6201, 'il CSV deve avere tutte le righe');
  });
  await prova('statistiche: «Dati per il commercialista» con tutte le 6200 righe', async () => {
    await A.q("insert into entrate (data, totale_cent, metodo, descrizione) select current_date, 100, 'contanti', 'riga ' || g from generate_series(1, 6200) g");
    await A.vai(pg, 'statistiche');
    const scaricati = [];
    pg.on('download', (d) => scaricati.push(d));
    await pg.click('#st-csv');
    for (let i = 0; i < 60 && scaricati.length < 2; i++) await pausa(200);
    const inc = scaricati.find((d) => d.suggestedFilename().startsWith('incassi'));
    const csv = await (await import('node:fs')).promises.readFile(await inc.path(), 'utf8');
    assert.equal(csv.trim().split('\r\n').length, 6201);
    await A.q('delete from entrate');
  });
  await prova('totale di giornata: avviso se quel giorno ce n\'è già uno', async () => {
    await A.vai(pg, 'cassa/giornata');
    await pg.fill('[data-met="contanti"]', '100'); await pg.click('#gg [type=submit]');
    await A.toast(pg, 'Totale di giornata registrato');
    await A.vai(pg, 'cassa/giornata');
    await pg.fill('[data-met="carta"]', '50'); await pg.click('#gg [type=submit]');
    await pg.waitForSelector('#modal:not([hidden]) [data-si]');
    assert.match(await testo(pg, '#modal'), /già registrato un totale di giornata \(100,00/);
    await pg.click('#modal [data-no]');
    assert.equal((await A.q("select count(*)::int n from entrate where descrizione like 'Totale di giornata%'"))[0].n, 1);
  });
  await prova('una conferma chiusa con × non lascia il pulsante bloccato su «Attendi…»', async () => {
    await A.vai(pg, 'cassa/giornata');
    await pg.fill('[data-met="carta"]', '50'); await pg.click('#gg [type=submit]');
    await pg.waitForSelector('#modal:not([hidden]) .x');
    await pg.click('#modal .x');
    await pg.waitForSelector('#gg [type=submit]:not([disabled]):has-text("Registra")', { timeout: 3000 });
  });
  await prova('commesso: nel totale di giornata non si sceglie il giorno (solo oggi)', async () => {
    const s = await A.nuova(); await A.entra(s, 'staff@example.test', 'Commesso-1234');
    await A.vai(s, 'cassa/giornata');
    assert.equal(await s.$('#gg [name=data]'), null);
    assert.match(await testo(s, '#gg'), /Giorno:\s*oggi/);
    await s.fill('[data-met="contanti"]', '20'); await s.click('#gg [type=submit]');
    await A.toast(s, 'Totale di giornata registrato');
    await s.context().close();
  });
  await prova('scontrino: togliendo una riga lo sconto si riduce (prima l\'incasso falliva con «Sconto non valido»)', async () => {
    await A.q('delete from movimenti; delete from entrata_righe; delete from entrate');
    await pg.evaluate(() => localStorage.removeItem('fg_scontrino'));
    await pg.reload(); await pg.waitForSelector('#app:not([hidden])');
    await A.vai(pg, 'cassa');
    for (const [nome, prezzo] of [['Uno', '10'], ['Due', '5']]) {
      await pg.click('#banco-libera'); await pg.fill('#modal [name=nome]', nome); await pg.fill('#modal [name=prezzo]', prezzo); await pg.click('#modal [type=submit]');
    }
    await pg.fill('#s-sconto', '8'); await pg.press('#s-sconto', 'Tab');
    await pg.click('[data-togli="0"]'); // resta solo «Due» da 5 €
    assert.match(await testo(pg, '#s-tot'), /0,00/);
    await pg.click('#s-ok');
    await A.toast(pg, 'Incassati');
    const [e] = await A.q('select totale_cent, sconto_cent from entrate');
    assert.deepEqual(e, { totale_cent: 0, sconto_cent: 500 });
  });
  await prova('ordine: se il salvataggio delle voci fallisce, le voci di prima restano', async () => {
    const [o] = ok(await api(T, 'ordini', { method: 'POST', body: { descrizione: 'Matrimonio', data_consegna: oggi } }));
    ok(await api(T, 'ordine_righe', { method: 'POST', body: [{ ordine_id: o.id, descrizione: 'Bouquet', quantita: 1, prezzo_unit_cent: 15000 }] }));
    await A.vai(pg, 'ordini/' + o.id);
    await pg.click('[data-a="modifica"]'); await pg.waitForSelector('#om');
    // il server rifiuta le voci nuove (rete che cade, valore fuori limite...): si simula bloccando la richiesta
    await pg.route('**/rest/v1/ordine_righe', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 500, body: '{"message":"errore di prova"}' }) : r.continue()));
    await pg.fill('[data-vp="0"]', '200'); await pg.click('#om [type=submit]');
    await pg.waitForSelector('#om .alert:not([hidden])');
    await pg.unroute('**/rest/v1/ordine_righe');
    const righe = await A.q('select descrizione, prezzo_unit_cent from ordine_righe where ordine_id = $1', [o.id]);
    assert.deepEqual(righe, [{ descrizione: 'Bouquet', prezzo_unit_cent: 15000 }]);
    assert.equal((await A.q('select totale_cent from ordini where id = $1', [o.id]))[0].totale_cent, 15000);
    await pg.click('#om [type=submit]'); // riprovando va a buon fine e le voci vecchie spariscono
    await A.toast(pg, 'Ordine salvato');
    assert.deepEqual(await A.q('select prezzo_unit_cent from ordine_righe where ordine_id = $1', [o.id]), [{ prezzo_unit_cent: 20000 }]);
  });
  await prova('ordine con cliente nuovo: riprovando dopo un errore non si crea un secondo cliente', async () => {
    await A.vai(pg, 'ordini');
    await pg.click('#o-nuovo'); await pg.waitForSelector('#om');
    await pg.selectOption('#om [name=cliente_id]', 'nuovo'); await pg.fill('#om [name=nc_nome]', 'Cliente Unico');
    await pg.fill('#om [name=descrizione]', 'Corona'); await pg.fill('[data-vd="0"]', 'Corona'); await pg.fill('[data-vp="0"]', '80');
    await pg.route('**/rest/v1/ordini*', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 500, body: '{"message":"errore di prova"}' }) : r.continue()));
    await pg.click('#om [type=submit]'); await pg.waitForSelector('#om .alert:not([hidden])');
    await pg.unroute('**/rest/v1/ordini*');
    await pg.click('#om [type=submit]');
    let id = null; // si aspetta l'ordine nel database e la sua pagina (non l'avviso: quello del controllo prima può essere ancora a schermo)
    for (let i = 0; i < 50 && !id; i++) { await pausa(200); id = (await A.q("select id from ordini where descrizione = 'Corona'"))[0]?.id; }
    for (let i = 0; i < 50 && (await pg.evaluate(() => location.hash)) !== '#/ordini/' + id; i++) await pausa(100);
    await pg.waitForSelector('#view h1:has-text("Ordine")');
    assert.equal((await A.q("select count(*)::int n from clienti where nome = 'Cliente Unico'"))[0].n, 1);
  });
  await prova('preventivo rifiutato: modificandolo resta un preventivo (non diventa un ordine «Da fare»), niente «Incassa»', async () => {
    const [o] = ok(await api(T, 'ordini', { method: 'POST', body: { descrizione: 'Allestimento', data_consegna: oggi, stato: 'rifiutato' } }));
    ok(await api(T, 'ordine_righe', { method: 'POST', body: [{ ordine_id: o.id, descrizione: 'Archi', quantita: 1, prezzo_unit_cent: 30000 }] }));
    await A.vai(pg, 'ordini/' + o.id);
    await pg.waitForSelector('#view h1:has-text("Preventivo")');
    assert.equal(await pg.$('[data-a="incassa"]'), null);
    assert.equal(await pg.$('[data-a="annulla"]'), null);
    await pg.click('[data-a="modifica"]'); await pg.waitForSelector('#om');
    await pg.fill('#om [name=note]', 'ricontattare a maggio'); await pg.click('#om [type=submit]');
    await A.toast(pg, 'Preventivo salvato');
    assert.equal((await A.q('select stato from ordini where id = $1', [o.id]))[0].stato, 'rifiutato');
  });
  await prova('composizione: se il salvataggio dei componenti fallisce, restano quelli di prima', async () => {
    const [a] = ok(await api(T, 'prodotti?select=id', { method: 'POST', body: { nome: 'Rosa', prezzo_vendita_cent: 300 } }));
    const [b] = ok(await api(T, 'prodotti?select=id', { method: 'POST', body: { nome: 'Ruscus', prezzo_vendita_cent: 100 } }));
    const [r] = ok(await api(T, 'ricette?select=id', { method: 'POST', body: { nome: 'Bouquet rose', prezzo_vendita_cent: 4000 } }));
    ok(await api(T, 'ricetta_righe', { method: 'POST', body: [{ ricetta_id: r.id, prodotto_id: a.id, quantita: 12 }, { ricetta_id: r.id, prodotto_id: b.id, quantita: 3 }] }));
    await A.vai(pg, 'ricette');
    await pg.click(`[data-id="${r.id}"]`); await pg.waitForSelector('#r-comp');
    await pg.route('**/rest/v1/ricetta_righe*', (x) => (x.request().method() === 'POST' ? x.fulfill({ status: 500, body: '{"message":"errore di prova"}' }) : x.continue()));
    await pg.fill('[data-cq="0"]', '10'); await pg.click('#modal [type=submit]');
    await pg.waitForSelector('#modal .alert:not([hidden])');
    await pg.unroute('**/rest/v1/ricetta_righe*');
    assert.equal((await A.q('select count(*)::int n from ricetta_righe where ricetta_id = $1', [r.id]))[0].n, 2);
    await pg.click('[data-cx="1"]'); // via il ruscus, rose a 10
    await pg.click('#modal [type=submit]'); await A.toast(pg, 'Composizione salvata');
    assert.deepEqual(await A.q('select prodotto_id::int, quantita::float q from ricetta_righe where ricetta_id = $1', [r.id]), [{ prodotto_id: Number(a.id), q: 10 }]);
  });
  await prova('le date scelte e non ancora cercate restano anche se arriva un aggiornamento da un altro dispositivo', async () => {
    await A.vai(pg, 'statistiche');
    await pg.fill('#pf [name=da]', '2025-01-01');
    await pg.click('#view h1'); // fuori dal campo
    ok(await api(T, 'rpc/registra_vendita', { method: 'POST', body: { p: { importo_cent: 700 } } })); // un'altra cassa vende
    await pausa(1500);
    assert.equal(await pg.$eval('#pf [name=da]', (e) => e.value), '2025-01-01');
  });
  await prova('nuovo articolo senza costo né prezzo: si salva a 0 (prima errore «null value…» in inglese)', async () => {
    await A.vai(pg, 'magazzino'); await pg.click('#a-nuovo'); await pg.fill('#modal [name=nome]', 'Articolo senza prezzi');
    await pg.click('#modal [type=submit]');
    for (let i = 0; i < 40 && !(await A.q("select 1 from prodotti where nome = 'Articolo senza prezzi'")).length; i++) await pausa(100);
    const [p] = await A.q("select prezzo_acquisto_cent a, prezzo_vendita_cent v from prodotti where nome = 'Articolo senza prezzi'");
    assert.deepEqual(p, { a: 0, v: 0 });
  });
  await prova('categoria usata: il gestionale spiega perché non si cancella', async () => {
    await A.vai(pg, 'impostazioni/categorie');
    const id = (await A.q("select id from categorie where nome = 'Categoria usata'"))[0].id;
    await A.q("insert into prodotti (nome, categoria_id) values ('Usa la categoria', $1)", [id]);
    await pg.click(`[data-cat="${id}"]`); await pg.click('#modal [data-del]');
    await pg.click('#modal [data-si]');
    await A.toast(pg, 'non si può cancellare');
  });
  await prova('feste: un giorno che non esiste nel mese (31 aprile) viene rifiutato', async () => {
    await A.vai(pg, 'impostazioni/feste');
    await pg.click('#fe-nuova'); await pg.fill('#modal [name=nome]', 'Festa sbagliata');
    await pg.fill('#modal [name=giorno]', '31'); await pg.selectOption('#modal [name=mese]', '4');
    await pg.click('#modal [type=submit]');
    assert.match(await testo(pg, '#modal .alert'), /un giorno che esiste/);
    await pg.keyboard.press('Escape');
  });
  await prova('spese ricorrenti: l\'anteprima della prossima scadenza è quella vera (31 gen + 1 mese = fine febbraio)', async () => {
    const [r] = ok(await api(T, 'ricorrenti', { method: 'POST', body: { descrizione: 'Affitto', importo_cent: 80000, ogni_mesi: 1, prossima: '2027-01-31' } }));
    await A.vai(pg, 'spese/ricorrenti');
    await pg.click(`[data-reg="${r.id}"]`);
    assert.match(await testo(pg, '#modal'), /passa al 28\/02\/2027/);
    await pg.click('#modal [type=submit]'); await A.toast(pg, 'Spesa registrata');
    assert.equal((await A.q('select prossima::text p from ricorrenti where id = $1', [r.id]))[0].p, '2027-02-28');
  });
  // 400/500 voluti: cancellazione rifiutata dal database ed errori simulati
  await prova('nessun errore JavaScript', async () => { const p = A.problemi.filter((x) => !/status of (400|500)|errore di prova/.test(x)); if (p.length) console.log(p); assert.deepEqual(p, []); });
} finally {
  await A.chiudiTutto();
}
process.exit(fine() ? 1 : 0);
