// Prova dello stack vero: PostgreSQL temporaneo + PostgREST + servizio auth, chiamati come fa il gestionale.
// Controlla calcoli (magazzino, IVA, margini, cassa) e permessi (titolare, commesso, anonimo).
import { start, stop, CFG } from './stack.mjs';
import assert from 'node:assert/strict';

let ok = 0, ko = 0;
async function prova(nome, fn) {
  try { await fn(); ok++; console.log('  ✓ ' + nome); }
  catch (e) { ko++; console.log('  ✗ ' + nome + '\n      ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n      ')); }
}
const REST = `http://127.0.0.1:${CFG.rest}/`, AUTH = `http://127.0.0.1:${CFG.auth}/`;
async function req(base, path, { method = 'GET', token, body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  if (body !== undefined && !raw) { h['Content-Type'] = 'application/json'; h.Prefer = h.Prefer || 'return=representation'; }
  const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, j };
}
const rest = (p, o) => req(REST, p, o), auth = (p, o) => req(AUTH, p, o);
const okR = (r, msg = '') => { assert.ok(r.status < 300, `${msg} ${r.status} ${JSON.stringify(r.j)}`); return r.j; };

const { adminDb } = await start();
try {
  let T, S; // token titolare e commesso
  const ids = {};
  console.log('Login e utenti');
  await prova('login titolare (dalle variabili) con ruolo owner', async () => {
    const r = await auth('login', { method: 'POST', body: { email: CFG.adminEmail, password: CFG.adminPass } });
    assert.equal(r.status, 200); assert.equal(r.j.user.role, 'owner'); T = r.j.access_token;
  });
  await prova('password sbagliata = 401', async () => { assert.equal((await auth('login', { method: 'POST', body: { email: CFG.adminEmail, password: 'no' } })).status, 401); });
  await prova('il titolare crea un commesso; il commesso entra', async () => {
    okR(await auth('api/utenti', { method: 'POST', token: T, body: { email: 'commesso@example.test', password: 'Commesso-1234', role: 'staff', nome: 'Luca' } }));
    const r = await auth('login', { method: 'POST', body: { email: 'commesso@example.test', password: 'Commesso-1234' } });
    assert.equal(r.j.user.role, 'staff'); S = r.j.access_token;
  });
  await prova('il commesso NON gestisce gli utenti (403)', async () => { assert.equal((await auth('api/utenti', { token: S })).status, 403); });
  await prova('password corta rifiutata', async () => { assert.equal((await auth('api/utenti', { method: 'POST', token: T, body: { email: 'x@example.test', password: 'corta' } })).status, 400); });
  await prova('non si può cancellare l\'unico titolare né se stessi', async () => {
    const lista = okR(await auth('api/utenti', { token: T }));
    const io = lista.find((u) => u.role === 'owner');
    assert.equal((await auth('api/utenti/' + io.id, { method: 'DELETE', token: T })).status, 400);
    assert.equal((await auth('api/utenti/' + io.id, { method: 'POST', token: T, body: { role: 'staff' } })).status, 400);
  });

  console.log('Anonimi');
  for (const t of ['prodotti', 'entrate', 'spese', 'clienti', 'impostazioni', 'registro', 'categorie', 'ordini', 'bolle']) {
    await prova(`anonimo non legge ${t}`, async () => { const r = await rest(t); assert.ok(r.status >= 400 || (Array.isArray(r.j) && r.j.length === 0), `${r.status} ${JSON.stringify(r.j).slice(0, 80)}`); });
  }
  await prova('anonimo non chiama le funzioni (registra_vendita, cruscotto, iva_di)', async () => {
    for (const f of ['registra_vendita', 'cruscotto', 'iva_di']) assert.ok((await rest('rpc/' + f, { method: 'POST', body: {} })).status >= 400, f);
  });
  await prova('flusso SSE senza token = 401', async () => { assert.equal((await auth('stream')).status, 401); });

  console.log('Dati di partenza');
  let cats;
  await prova('categorie di partenza e feste presenti, nient\'altro', async () => {
    cats = okR(await rest('categorie?order=id', { token: T }));
    assert.ok(cats.filter((c) => c.ambito === 'spesa').length >= 20); assert.ok(cats.some((c) => c.nome === 'Affitto' && c.tipo === 'fissa'));
    assert.ok(okR(await rest('calendario', { token: T })).length >= 10);
    assert.equal(okR(await rest('prodotti', { token: T })).length, 0);
  });
  const cat = (a, n) => cats.find((c) => c.ambito === a && c.nome === n).id;

  console.log('Magazzino e bolle');
  await prova('fornitore e articoli (commesso)', async () => {
    ids.forn = okR(await rest('fornitori', { method: 'POST', token: S, body: { nome: 'Grossista Fiori Srl' } }))[0].id;
    const base = { unita: 'pz', deperibile: false, giorni_vita: null, scorta_minima: null, a_magazzino: true };
    const p = okR(await rest('prodotti', { method: 'POST', token: S, body: [
      { nome: 'Rosa rossa', categoria_id: cat('prodotto', 'Fiori recisi'), unita: 'stelo', prezzo_vendita_cent: 300, aliquota_iva: 10, deperibile: true, giorni_vita: 5, scorta_minima: 10 },
      { nome: 'Ruscus (verde)', categoria_id: cat('prodotto', 'Verde ornamentale'), unita: 'stelo', prezzo_vendita_cent: 100, aliquota_iva: 10 },
      { nome: 'Vaso ceramica 14', categoria_id: cat('prodotto', 'Vasi e cachepot'), prezzo_vendita_cent: 1200, aliquota_iva: 22 },
      { nome: 'Consegna a domicilio', categoria_id: cat('prodotto', 'Servizi (consegna, confezione)'), prezzo_vendita_cent: 800, aliquota_iva: 22, a_magazzino: false },
    ].map((x) => ({ ...base, ...x })) }));
    [ids.rosa, ids.ruscus, ids.vaso, ids.consegna] = p.map((x) => x.id);
  });
  await prova('il commesso NON può scrivere la giacenza a mano', async () => {
    assert.ok((await rest('prodotti?id=eq.' + ids.rosa, { method: 'PATCH', token: S, body: { giacenza: 999 } })).status >= 400);
  });
  await prova('arrivo merce con bolla: giacenze, costo aggiornato, data arrivo', async () => {
    const r = okR(await rest('rpc/registra_carico', { method: 'POST', token: S, body: { p: { fornitore_id: ids.forn, numero_documento: 'DDT 77', data_documento: '2026-10-20', data: '2026-10-21',
      righe: [{ prodotto_id: ids.rosa, quantita: 50, costo_unit_cent: 80 }, { prodotto_id: ids.ruscus, quantita: 30, costo_unit_cent: 20 }, { prodotto_id: ids.vaso, quantita: 10, costo_unit_cent: 400 }] } } }));
    ids.bolla1 = r.bolla_id; assert.equal(r.spesa_id, null); assert.equal(r.righe, 3);
    const p = okR(await rest(`prodotti?id=in.(${ids.rosa},${ids.vaso})&order=id`, { token: T }));
    assert.equal(Number(p[0].giacenza), 50); assert.equal(p[0].prezzo_acquisto_cent, 80); assert.equal(p[0].ultimo_carico, '2026-10-21'); assert.equal(Number(p[1].giacenza), 10);
    const [b] = okR(await rest('bolle_vista?id=eq.' + ids.bolla1, { token: T }));
    assert.equal(b.netto_cent, 50 * 80 + 30 * 20 + 10 * 400); assert.equal(b.lordo_cent, Math.round(4000 * 1.1 + 600 * 1.1 + 4000 * 1.22)); assert.equal(b.numero, 'DDT 77');
  });
  await prova('il commesso NON registra la spesa insieme alla bolla', async () => {
    const r = await rest('rpc/registra_carico', { method: 'POST', token: S, body: { p: { righe: [{ prodotto_id: ids.rosa, quantita: 1 }], spesa: { metodo: 'bonifico' } } } });
    assert.ok(r.status >= 400); assert.match(r.j.message, /titolare/);
  });
  await prova('il commesso NON inserisce carichi diretti (solo via bolla)', async () => {
    assert.ok((await rest('movimenti', { method: 'POST', token: S, body: { prodotto_id: ids.rosa, tipo: 'carico', quantita: 100 } })).status >= 400);
  });
  await prova('seconda bolla con spesa (titolare) e fattura riepilogativa', async () => {
    const r = okR(await rest('rpc/registra_carico', { method: 'POST', token: T, body: { p: { fornitore_id: ids.forn, numero_documento: 'DDT 78', righe: [{ prodotto_id: ids.rosa, quantita: 20, costo_unit_cent: 90 }],
      spesa: { metodo: 'bonifico', pagata: false, scadenza: '2026-11-30' } } } }));
    assert.ok(r.spesa_id);
    const [s] = okR(await rest('spese?id=eq.' + r.spesa_id, { token: T }));
    assert.equal(s.importo_cent, 1980); assert.equal(s.iva_cent, 180); assert.equal(s.categoria_id, cat('spesa', 'Acquisto merce')); assert.equal(s.pagata, false);
    const sp = okR(await rest('rpc/fattura_bolle', { method: 'POST', token: T, body: { p_bolle: [ids.bolla1], p: { numero_documento: 'FT 12', importo_cent: 9906, iva_cent: 1386 } } }));
    const [b] = okR(await rest('bolle?id=eq.' + ids.bolla1, { token: T })); assert.equal(b.spesa_id, sp);
  });
  await prova('foto della bolla dal commesso; la spesa gli è vietata', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const r = await auth(`api/allegati?bolla=${ids.bolla1}&nome=bolla.png`, { method: 'POST', token: S, body: png, raw: true });
    assert.equal(r.status, 201); ids.foto = r.j.id;
    const g = await fetch(AUTH + 'api/allegati/' + ids.foto, { headers: { Authorization: 'Bearer ' + S } }); assert.equal(g.status, 200); assert.equal(g.headers.get('content-type'), 'image/png');
    assert.equal((await auth(`api/allegati?spesa=1&nome=x.png`, { method: 'POST', token: S, body: png, raw: true })).status, 403);
    assert.equal((await auth(`api/allegati?bolla=${ids.bolla1}&nome=x.exe`, { method: 'POST', token: S, body: Buffer.from('MZ....'), raw: true })).status, 415);
  });
  await prova('scarto (commesso) e correzione d\'inventario', async () => {
    okR(await rest('movimenti', { method: 'POST', token: S, body: { prodotto_id: ids.rosa, tipo: 'scarto', quantita: -5, motivo: 'appassite' } }));
    const d = okR(await rest('rpc/imposta_giacenza', { method: 'POST', token: S, body: { p_prodotto: ids.ruscus, p_contati: 28, p_motivo: 'conta' } }));
    assert.equal(Number(d), -2);
    const p = okR(await rest(`prodotti?id=in.(${ids.rosa},${ids.ruscus})&order=id`, { token: S }));
    assert.equal(Number(p[0].giacenza), 65); assert.equal(Number(p[1].giacenza), 28);
  });

  console.log('Composizioni e cassa');
  await prova('composizione: costo, margine, prezzo consigliato, quante se ne possono fare', async () => {
    ids.ric = okR(await rest('ricette', { method: 'POST', token: S, body: { nome: 'Bouquet 12 rose', prezzo_vendita_cent: 4500, aliquota_iva: 10, manodopera_cent: 500, categoria_id: cat('prodotto', 'Composizioni (ricette)') } }))[0].id;
    okR(await rest('ricetta_righe', { method: 'POST', token: S, body: [{ ricetta_id: ids.ric, prodotto_id: ids.rosa, quantita: 12 }, { ricetta_id: ids.ric, prodotto_id: ids.ruscus, quantita: 3 }] }));
    const [r] = okR(await rest('ricette_vista?id=eq.' + ids.ric, { token: S }));
    assert.equal(r.costo_materiali_cent, 12 * 90 + 3 * 20); // costo rosa aggiornato a 90 dalla seconda bolla
    assert.equal(r.possibili, 5); // 65 rose / 12
    assert.equal(r.margine_cent, 4500 - Math.round(4500 - 4500 / 1.1) - 1140 - 500); // netto IVA - materiali - lavoro = 2451
    assert.equal(r.prezzo_consigliato_cent, Math.round((1140 + 500) * 2.5 * 1.1 / 50) * 50);
  });
  await prova('vendita con articoli, composizione e servizio: totale, IVA, magazzino', async () => {
    const id = okR(await rest('rpc/registra_vendita', { method: 'POST', token: S, body: { p: { metodo: 'contanti', categoria_id: cat('entrata', 'Vendita al banco'), righe: [
      { prodotto_id: ids.rosa, quantita: 3, prezzo_unit_cent: 300 }, { ricetta_id: ids.ric, quantita: 1, prezzo_unit_cent: 4500 },
      { prodotto_id: ids.vaso, quantita: 1, prezzo_unit_cent: 1200 }, { prodotto_id: ids.consegna, quantita: 1, prezzo_unit_cent: 800 }] } } }));
    ids.v1 = id;
    const [e] = okR(await rest('entrate?id=eq.' + id, { token: S }));
    assert.equal(e.totale_cent, 900 + 4500 + 1200 + 800);
    assert.equal(e.iva_cent, Math.round(900 - 900 / 1.1) + Math.round(4500 - 4500 / 1.1) + Math.round(1200 - 1200 / 1.22) + Math.round(800 - 800 / 1.22));
    const p = okR(await rest(`prodotti?id=in.(${ids.rosa},${ids.ruscus},${ids.vaso},${ids.consegna})&order=id`, { token: S }));
    assert.deepEqual(p.map((x) => Number(x.giacenza)), [65 - 3 - 12, 28 - 3, 9, 0]);
  });
  await prova('sconto: lo rifiuta se i commessi non possono, lo accetta dal titolare', async () => {
    okR(await rest('impostazioni?id=eq.1', { method: 'PATCH', token: T, body: { staff_sconti: false } }));
    const r = await rest('rpc/registra_vendita', { method: 'POST', token: S, body: { p: { sconto_cent: 100, righe: [{ prodotto_id: ids.rosa, quantita: 1, prezzo_unit_cent: 300 }] } } });
    assert.ok(r.status >= 400);
    const id = okR(await rest('rpc/registra_vendita', { method: 'POST', token: T, body: { p: { sconto_cent: 100, righe: [{ prodotto_id: ids.rosa, quantita: 1, prezzo_unit_cent: 300 }] } } }));
    const [e] = okR(await rest('entrate?id=eq.' + id, { token: T })); assert.equal(e.totale_cent, 200); assert.equal(e.iva_cent, Math.round(27 * 200 / 300));
    ids.v2 = id;
  });
  await prova('importo libero (totale di giornata) con metodo personalizzato', async () => {
    okR(await rest('impostazioni?id=eq.1', { method: 'PATCH', token: T, body: { metodi_incasso: ['contanti', 'carta', 'buono regalo'] } }));
    const id = okR(await rest('rpc/registra_vendita', { method: 'POST', token: S, body: { p: { metodo: 'buono regalo', importo_cent: 11000, aliquota_iva: 10, descrizione: 'Totale di giornata' } } }));
    const [e] = okR(await rest('entrate?id=eq.' + id, { token: S })); assert.equal(e.iva_cent, 1000); assert.equal(e.metodo, 'buono regalo');
  });
  await prova('documento "nessuno" non esiste più (sempre scontrino, fattura o ricevuta)', async () => {
    assert.ok((await rest('rpc/registra_vendita', { method: 'POST', token: S, body: { p: { documento: 'nessuno', importo_cent: 100 } } })).status >= 400);
  });
  await prova('importi e quantità assurdi rifiutati', async () => {
    for (const p of [{ importo_cent: -5 }, { righe: [{ prodotto_id: ids.rosa, quantita: -1, prezzo_unit_cent: 1 }] }, { righe: [{ prodotto_id: 999999, quantita: 1, prezzo_unit_cent: 1 }] }, { data: '2099-01-01', importo_cent: 1 }])
      assert.ok((await rest('rpc/registra_vendita', { method: 'POST', token: S, body: { p } })).status >= 400, JSON.stringify(p));
  });
  await prova('annullare: il commesso solo se permesso; la merce torna', async () => {
    okR(await rest('impostazioni?id=eq.1', { method: 'PATCH', token: T, body: { staff_annulla: false } }));
    assert.ok((await rest('rpc/annulla_entrata', { method: 'POST', token: S, body: { p_id: ids.v1 } })).status >= 400);
    okR(await rest('impostazioni?id=eq.1', { method: 'PATCH', token: T, body: { staff_annulla: true } }));
    const r = await rest('rpc/annulla_entrata', { method: 'POST', token: S, body: { p_id: ids.v1 } }); assert.ok(r.status < 300, JSON.stringify(r.j));
    const p = okR(await rest(`prodotti?id=in.(${ids.rosa},${ids.ruscus})&order=id`, { token: S }));
    assert.deepEqual(p.map((x) => Number(x.giacenza)), [64, 28]); // 65 - 1 (vendita col titolare)
  });

  console.log('Ordini, preventivi, chiusura di cassa');
  await prova('preventivo con voci: numero, totale calcolato dal database', async () => {
    ids.cli = okR(await rest('clienti', { method: 'POST', token: S, body: { nome: 'Maria Rossi', telefono: '333 1234567' } }))[0].id;
    const [o] = okR(await rest('ordini', { method: 'POST', token: S, body: { cliente_id: ids.cli, descrizione: 'Matrimonio', data_consegna: '2027-05-20', stato: 'preventivo', categoria_id: cat('entrata', 'Matrimoni ed eventi') } }));
    assert.match(o.numero, /^\d{4}-0001$/); ids.ord = o.id;
    okR(await rest('ordine_righe', { method: 'POST', token: S, body: [{ ordine_id: o.id, descrizione: 'Bouquet sposa', quantita: 1, prezzo_unit_cent: 15000 }, { ordine_id: o.id, descrizione: 'Centrotavola', quantita: 12, prezzo_unit_cent: 4500 }] }));
    const [v] = okR(await rest('ordini_vista?id=eq.' + o.id, { token: S })); assert.equal(v.totale_cent, 15000 + 54000);
    assert.ok((await rest('ordini?id=eq.' + o.id, { method: 'PATCH', token: S, body: { totale_cent: 1 } })).status >= 400, 'il totale non si scrive a mano');
  });
  await prova('accettato -> ordine, acconto e saldo collegati', async () => {
    okR(await rest('ordini?id=eq.' + ids.ord, { method: 'PATCH', token: S, body: { stato: 'da_fare', creato_da_preventivo: true } }));
    okR(await rest('rpc/registra_vendita', { method: 'POST', token: S, body: { p: { ordine_id: ids.ord, importo_cent: 20000, metodo: 'carta', descrizione: 'acconto' } } }));
    const [v] = okR(await rest('ordini_vista?id=eq.' + ids.ord, { token: S })); assert.equal(v.incassato_cent, 20000);
  });
  await prova('chiusura di cassa: attesi = fondo + contanti − versati', async () => {
    const [c] = okR(await rest('chiusure', { method: 'POST', token: S, body: { fondo_cent: 10000, versati_cent: 0, contati_cent: 10200 } }));
    // contanti di oggi: vendita del titolare (200, metodo predefinito contanti). La vendita v1 è stata annullata.
    assert.equal(c.attesi_cent, 10000 + 200); assert.equal(c.contati_cent - c.attesi_cent, 0);
    assert.ok((await rest('chiusure', { method: 'POST', token: S, body: { data: '2026-01-01', contati_cent: 1 } })).status >= 400, 'commesso: solo oggi');
  });

  console.log('Spese, ricorrenti, statistiche');
  await prova('il commesso NON vede spese, ricorrenti, registro, statistiche', async () => {
    for (const t of ['spese', 'ricorrenti', 'registro']) { const r = await rest(t, { token: S }); assert.ok(r.status >= 400 || r.j.length === 0, t); }
    assert.ok((await rest('rpc/statistiche', { method: 'POST', token: S, body: { p_da: '2026-01-01', p_a: '2026-12-31' } })).status >= 400);
    assert.ok((await rest('spese', { method: 'POST', token: S, body: { descrizione: 'x', importo_cent: 1 } })).status >= 400);
    const c = okR(await rest('rpc/cruscotto', { method: 'POST', token: S, body: {} })); assert.equal(c.mese_uscite, undefined);
  });
  await prova('spesa ricorrente: registra e sposta la scadenza', async () => {
    const [r] = okR(await rest('ricorrenti', { method: 'POST', token: T, body: { descrizione: 'Affitto', categoria_id: cat('spesa', 'Affitto'), importo_cent: 120000, ogni_mesi: 1, prossima: '2026-10-05', metodo: 'bonifico' } }));
    const id = okR(await rest('rpc/registra_ricorrente', { method: 'POST', token: T, body: { p_id: r.id, p_data: '2026-10-05', p_importo: 120000, p_pagata: true } }));
    const [s] = okR(await rest('spese?id=eq.' + id, { token: T })); assert.equal(s.importo_cent, 120000); assert.equal(s.ricorrente_id, r.id);
    const [r2] = okR(await rest('ricorrenti?id=eq.' + r.id, { token: T })); assert.equal(r2.prossima, '2026-11-05');
  });
  await prova('statistiche: totali, categorie, margini, scarti', async () => {
    const s = okR(await rest('rpc/statistiche', { method: 'POST', token: T, body: { p_da: '2026-01-01', p_a: '2027-12-31' } }));
    const ent = okR(await rest('entrate?select=totale_cent', { token: T })).reduce((a, x) => a + x.totale_cent, 0);
    const spe = okR(await rest('spese?select=importo_cent', { token: T })).reduce((a, x) => a + x.importo_cent, 0);
    assert.equal(s.totali.entrate, ent); assert.equal(s.totali.uscite, spe);
    assert.equal(s.totali.fisse, 120000);
    assert.ok(s.uscite_categorie.some((c) => c.nome === 'Affitto' && c.totale === 120000));
    const sc = s.scarti.find((x) => x.tipo === 'scarto'); assert.equal(Number(sc.valore), 5 * 90);
    assert.ok(s.articoli_categorie.length >= 1); assert.equal(s.ordini.preventivi, 1); assert.equal(s.ordini.accettati, 1);
  });
  await prova('cruscotto del titolare: pareggio, da pagare, bolle da fatturare', async () => {
    const c = okR(await rest('rpc/cruscotto', { method: 'POST', token: T, body: {} }));
    assert.equal(c.costi_fissi_mese, 120000); assert.ok(c.da_pagare.length >= 1); assert.equal(c.bolle_da_fatturare, 0); // entrambe le bolle hanno la fattura assert.ok(c.mesi.length === 12);
    assert.ok(typeof c.spesa_media_mese === 'number' && typeof c.giorni_con_incassi === 'number');
  });
  await prova('registro: chi ha fatto cosa, senza ripetere la giacenza', async () => {
    const r = okR(await rest('registro?order=id', { token: T }));
    assert.ok(r.some((x) => x.tabella === 'entrate' && x.azione === 'delete' && x.email === 'commesso@example.test'));
    assert.ok(!r.some((x) => x.tabella === 'prodotti' && x.azione === 'update'), 'aggiornamenti di giacenza non registrati due volte');
    assert.ok(!r.some((x) => x.tabella === 'allegati' && x.dopo && 'dati' in x.dopo), 'niente file dentro il registro');
  });
  await prova('categorie: il commesso cambia solo quelle degli articoli', async () => {
    assert.ok((await rest('categorie', { method: 'POST', token: S, body: { ambito: 'spesa', nome: 'Prova', tipo: 'variabile' } })).status >= 400);
    okR(await rest('categorie', { method: 'POST', token: S, body: { ambito: 'prodotto', nome: 'Piante da frutto' } }));
  });
  await prova('impostazioni: il commesso le legge ma non le cambia', async () => {
    okR(await rest('impostazioni', { token: S }));
    const r = await rest('impostazioni?id=eq.1', { method: 'PATCH', token: S, body: { nome_attivita: 'Hack' } });
    assert.ok(r.status >= 400 || r.j.length === 0);
    const [i] = okR(await rest('impostazioni', { token: T })); assert.notEqual(i.nome_attivita, 'Hack');
  });
  await prova('annullare la bolla toglie la merce', async () => {
    const r = okR(await rest('rpc/registra_carico', { method: 'POST', token: S, body: { p: { righe: [{ prodotto_id: ids.vaso, quantita: 5, costo_unit_cent: 400 }] } } }));
    okR(await rest('rpc/annulla_bolla', { method: 'POST', token: S, body: { p_id: r.bolla_id } }));
    const [p] = okR(await rest('prodotti?id=eq.' + ids.vaso, { token: S })); assert.equal(Number(p.giacenza), 10);
  });
  await prova('cambio password e vecchia password rifiutata', async () => {
    assert.equal((await auth('api/password', { method: 'POST', token: S, body: { attuale: 'sbagliata', nuova: 'NuovaPassword-99' } })).status, 400);
    okR(await auth('api/password', { method: 'POST', token: S, body: { attuale: 'Commesso-1234', nuova: 'NuovaPassword-99' } }));
    assert.equal((await auth('login', { method: 'POST', body: { email: 'commesso@example.test', password: 'Commesso-1234' } })).status, 401);
    assert.equal((await auth('login', { method: 'POST', body: { email: 'commesso@example.test', password: 'NuovaPassword-99' } })).status, 200);
  });
} finally {
  await stop();
}
console.log(`\n${ok} ok, ${ko} falliti`);
process.exit(ko ? 1 : 0);
