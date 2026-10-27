// Il commesso (ruolo staff) lavora ma NON vede la contabilità: incassi (tranne le sue vendite di oggi e i pagamenti degli ordini),
// spese, statistiche, costi d'acquisto e margini. Prova le regole del DATABASE chiamando l'API come farebbe chiunque col suo token.
import { start, stop, CFG } from './stack.mjs';
import assert from 'node:assert/strict';

let ok = 0, ko = 0;
async function prova(nome, fn) {
  try { await fn(); ok++; console.log('  ✓ ' + nome); }
  catch (e) { ko++; console.log('  ✗ ' + nome + '\n      ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n      ')); }
}
const REST = `http://127.0.0.1:${CFG.rest}/`, AUTH = `http://127.0.0.1:${CFG.auth}/`;
async function req(base, path, { method = 'GET', token, body } = {}) {
  const h = {};
  if (token) h.Authorization = 'Bearer ' + token;
  if (body !== undefined) { h['Content-Type'] = 'application/json'; h.Prefer = 'return=representation'; }
  const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, j };
}
const rest = (p, o) => req(REST, p, o), auth = (p, o) => req(AUTH, p, o);
const okR = (r, msg = '') => { assert.ok(r.status < 300, `${msg} ${r.status} ${JSON.stringify(r.j)}`); return r.j; };
const vietato = (r, msg = '') => assert.ok(r.status >= 400, `${msg} doveva essere vietato: ${r.status} ${JSON.stringify(r.j).slice(0, 120)}`);

const { adminDb } = await start();
const db = adminDb(); await db.connect();
const q = async (sql, args) => (await db.query(sql, args)).rows;
try {
  const T = (await auth('login', { method: 'POST', body: { email: CFG.adminEmail, password: CFG.adminPass } })).j.access_token;
  okR(await auth('api/utenti', { method: 'POST', token: T, body: { email: 'staff@example.test', password: 'Commesso-1234', role: 'staff', nome: 'Staff' } }));
  const S = (await auth('login', { method: 'POST', body: { email: 'staff@example.test', password: 'Commesso-1234' } })).j.access_token;
  const ieri = (await q("select (current_date - 1)::text d"))[0].d;

  // dati del titolare: articolo con costo, bolla, composizione con lavoro, incassi di ieri e di oggi, chiusura di ieri, ordine con acconto
  const [rosa] = okR(await rest('prodotti?select=id', { method: 'POST', token: T, body: { nome: 'Rosa', prezzo_acquisto_cent: 80, prezzo_vendita_cent: 300, aliquota_iva: 10 } }));
  const bolla = okR(await rest('rpc/registra_carico', { method: 'POST', token: T, body: { p: { righe: [{ prodotto_id: rosa.id, quantita: 50, costo_unit_cent: 80 }] } } }));
  const [ric] = okR(await rest('ricette?select=id', { method: 'POST', token: T, body: { nome: 'Bouquet', prezzo_vendita_cent: 3000, manodopera_cent: 500 } }));
  okR(await rest('ricetta_righe', { method: 'POST', token: T, body: { ricetta_id: ric.id, prodotto_id: rosa.id, quantita: 10 } }));
  const vIeri = okR(await rest('rpc/registra_vendita', { method: 'POST', token: T, body: { p: { data: ieri, importo_cent: 50000 } } }));
  const vTit = okR(await rest('rpc/registra_vendita', { method: 'POST', token: T, body: { p: { righe: [{ prodotto_id: rosa.id, quantita: 2, prezzo_unit_cent: 300 }] } } }));
  okR(await rest('chiusure', { method: 'POST', token: T, body: { data: ieri, fondo_cent: 5000, contati_cent: 7000 } }));
  const [ord] = okR(await rest('ordini', { method: 'POST', token: T, body: { descrizione: 'Corona', data_consegna: '2027-01-10' } }));
  okR(await rest('ordine_righe', { method: 'POST', token: T, body: { ordine_id: ord.id, descrizione: 'Corona', quantita: 1, prezzo_unit_cent: 20000 } }));
  okR(await rest('rpc/registra_vendita', { method: 'POST', token: T, body: { p: { ordine_id: ord.id, importo_cent: 5000, descrizione: 'acconto' } } }));

  console.log('Il commesso lavora');
  let vMia;
  await prova('vende, e vede SOLO le sue vendite di oggi', async () => {
    vMia = okR(await rest('rpc/registra_vendita', { method: 'POST', token: S, body: { p: { righe: [{ prodotto_id: rosa.id, quantita: 1, prezzo_unit_cent: 300 }] } } }));
    const e = okR(await rest('entrate?select=id,ordine_id&order=id', { token: S }));
    assert.ok(e.some((x) => x.id === vMia), 'la sua vendita');
    assert.ok(!e.some((x) => x.id === vIeri || x.id === vTit), 'niente vendite del titolare né di ieri');
    assert.ok(e.every((x) => x.id === vMia || x.ordine_id), 'il resto sono solo pagamenti di ordini');
    const v = okR(await rest('entrate_vista?select=id', { token: S })); assert.ok(!v.some((x) => x.id === vIeri || x.id === vTit));
    const righe = okR(await rest('entrata_righe?select=entrata_id', { token: S })); assert.ok(righe.every((x) => x.entrata_id === vMia));
  });
  await prova('ordini: li crea, e vede pagamenti e residuo giusti (anche quelli del titolare)', async () => {
    const [o] = okR(await rest('ordini', { method: 'POST', token: S, body: { descrizione: 'Bouquet sposa', data_consegna: '2027-02-01' } }));
    okR(await rest('ordine_righe', { method: 'POST', token: S, body: { ordine_id: o.id, descrizione: 'Bouquet', quantita: 1, prezzo_unit_cent: 9000 } }));
    const [v] = okR(await rest('ordini_vista?id=eq.' + ord.id, { token: S })); assert.equal(v.incassato_cent, 5000); assert.equal(v.totale_cent, 20000);
    assert.equal(okR(await rest('entrate?ordine_id=eq.' + ord.id + '&select=totale_cent', { token: S })).length, 1);
  });
  await prova('chiusura di cassa di oggi: la fa e vede i contanti attesi', async () => {
    const g = okR(await rest('rpc/cassa_giorno', { method: 'POST', token: S, body: { p_data: (await q('select current_date::text d'))[0].d } }));
    assert.equal(g.fondo_proposto, 7000); assert.equal(g.metodi.contanti, 600 + 300 + 5000);
    const [c] = okR(await rest('chiusure', { method: 'POST', token: S, body: { fondo_cent: 7000, contati_cent: 12900 } }));
    assert.equal(c.attesi_cent, 7000 + 5900);
  });
  await prova('magazzino: articoli, scarti, arrivi, composizioni', async () => {
    okR(await rest('prodotti?select=id', { method: 'POST', token: S, body: { nome: 'Tulipano', prezzo_vendita_cent: 200 } }));
    okR(await rest('movimenti?select=id', { method: 'POST', token: S, body: { prodotto_id: rosa.id, tipo: 'scarto', quantita: -2 } }));
    okR(await rest('rpc/registra_carico', { method: 'POST', token: S, body: { p: { righe: [{ prodotto_id: rosa.id, quantita: 10 }] } } }));
    okR(await rest('ricette?select=id', { method: 'POST', token: S, body: { nome: 'Mazzolino', prezzo_vendita_cent: 1500 } }));
    const [p] = okR(await rest('prodotti_vista?id=eq.' + rosa.id + '&select=giacenza', { token: S })); assert.equal(Number(p.giacenza), 50 - 2 - 1 - 2 + 10);
  });

  console.log('Il commesso NON vede la contabilità');
  await prova('cruscotto senza incassi, spese, risultati', async () => {
    const c = okR(await rest('rpc/cruscotto', { method: 'POST', token: S, body: {} }));
    for (const k of ['oggi', 'oggi_metodi', 'mese_entrate', 'mese_uscite', 'mesi', 'valore_magazzino', 'da_pagare']) assert.equal(c[k], undefined, k);
    assert.ok(Array.isArray(c.ordini) && Array.isArray(c.sotto_scorta));
    const t = okR(await rest('rpc/cruscotto', { method: 'POST', token: T, body: {} })); assert.ok(t.oggi.totale > 0 && t.mese_entrate > 0);
  });
  await prova('incassi di altri giorni e chiusure passate: niente', async () => {
    assert.equal(okR(await rest(`entrate?data=eq.${ieri}`, { token: S })).length, 0);
    assert.equal(okR(await rest(`chiusure?data=eq.${ieri}`, { token: S })).length, 0);
    vietato(await rest('rpc/cassa_giorno', { method: 'POST', token: S, body: { p_data: ieri } }), 'cassa di ieri');
    assert.equal(okR(await rest('entrata_righe_vista', { token: S })).length, 0);
  });
  await prova('spese, ricorrenti, registro, statistiche: niente', async () => {
    for (const t of ['spese', 'spese_vista', 'ricorrenti', 'registro']) { const r = await rest(t, { token: S }); assert.ok(r.status >= 400 || r.j.length === 0, t); }
    vietato(await rest('rpc/statistiche', { method: 'POST', token: S, body: { p_da: '2026-01-01', p_a: '2027-12-31' } }));
  });
  await prova('costi d\'acquisto: non leggibili dalle tabelle', async () => {
    vietato(await rest('prodotti?select=prezzo_acquisto_cent', { token: S }), 'prodotti');
    vietato(await rest('prodotti', { token: S }), 'prodotti select *');
    vietato(await rest('ricette?select=manodopera_cent', { token: S }), 'ricette');
    vietato(await rest('movimenti?select=costo_unit_cent', { token: S }), 'movimenti');
    vietato(await rest('entrata_righe?select=costo_unit_cent', { token: S }), 'entrata_righe');
  });
  await prova('costi, margini, valori e totali delle bolle: vuoti nelle viste', async () => {
    const [p] = okR(await rest('prodotti_vista?id=eq.' + rosa.id, { token: S })); assert.equal(p.prezzo_acquisto_cent, null); assert.equal(p.valore_cent, null);
    const [r] = okR(await rest('ricette_vista?id=eq.' + ric.id, { token: S }));
    for (const k of ['manodopera_cent', 'costo_materiali_cent', 'margine_cent', 'prezzo_consigliato_cent']) assert.equal(r[k], null, k);
    assert.equal(r.possibili, 5); // 55 rose / 10
    const [b] = okR(await rest('bolle_vista?id=eq.' + bolla.bolla_id, { token: S })); assert.equal(b.netto_cent, null); assert.equal(b.lordo_cent, null); assert.equal(b.righe, 1);
    const m = okR(await rest('movimenti_vista', { token: S })); assert.ok(m.length > 0 && m.every((x) => x.costo_unit_cent === null));
  });
  await prova('il titolare invece vede tutto', async () => {
    const [p] = okR(await rest('prodotti_vista?id=eq.' + rosa.id, { token: T })); assert.equal(p.prezzo_acquisto_cent, 80); assert.ok(p.valore_cent > 0);
    const [r] = okR(await rest('ricette_vista?id=eq.' + ric.id, { token: T })); assert.equal(r.manodopera_cent, 500); assert.equal(r.costo_materiali_cent, 800);
    const [b] = okR(await rest('bolle_vista?id=eq.' + bolla.bolla_id, { token: T })); assert.equal(b.netto_cent, 4000);
    assert.ok(okR(await rest('entrata_righe_vista', { token: T })).some((x) => x.costo_unit_cent === 80));
    assert.ok(okR(await rest(`entrate?data=eq.${ieri}`, { token: T })).length === 1);
  });

  console.log('Il commesso NON scrive i costi');
  await prova('articoli: costo ignorato (nuovi a 0, modifiche lasciano quello di prima)', async () => {
    const [n] = okR(await rest('prodotti?select=id', { method: 'POST', token: S, body: { nome: 'Vaso', prezzo_acquisto_cent: 999 } }));
    okR(await rest('prodotti?id=eq.' + rosa.id + '&select=id', { method: 'PATCH', token: S, body: { prezzo_acquisto_cent: 1, prezzo_vendita_cent: 350 } }));
    const c = await q('select id, prezzo_acquisto_cent, prezzo_vendita_cent from prodotti where id = any($1) order by id', [[rosa.id, n.id]]);
    assert.equal(c[0].prezzo_acquisto_cent, 80); assert.equal(c[0].prezzo_vendita_cent, 350, 'il prezzo di vendita sì'); assert.equal(c[1].prezzo_acquisto_cent, 0);
  });
  await prova('arrivi e scarti: si usa il costo dell\'articolo, non quello scritto', async () => {
    const r = okR(await rest('rpc/registra_carico', { method: 'POST', token: S, body: { p: { righe: [{ prodotto_id: rosa.id, quantita: 5, costo_unit_cent: 1 }] } } }));
    okR(await rest('movimenti?select=id', { method: 'POST', token: S, body: { prodotto_id: rosa.id, tipo: 'scarto', quantita: -1, costo_unit_cent: 1 } }));
    const m = await q("select costo_unit_cent from movimenti where bolla_id = $1 or (tipo = 'scarto' and costo_unit_cent is not null) order by id desc limit 2", [r.bolla_id]);
    assert.deepEqual(m.map((x) => x.costo_unit_cent), [80, 80]);
    assert.equal((await q('select prezzo_acquisto_cent from prodotti where id = $1', [rosa.id]))[0].prezzo_acquisto_cent, 80);
  });
  await prova('composizioni: lavoro ignorato', async () => {
    okR(await rest('ricette?id=eq.' + ric.id + '&select=id', { method: 'PATCH', token: S, body: { manodopera_cent: 1, nome: 'Bouquet grande' } }));
    const [r] = await q('select nome, manodopera_cent from ricette where id = $1', [ric.id]); assert.equal(r.manodopera_cent, 500); assert.equal(r.nome, 'Bouquet grande');
  });
  await prova('il titolare i costi li cambia', async () => {
    okR(await rest('prodotti?id=eq.' + rosa.id + '&select=id', { method: 'PATCH', token: T, body: { prezzo_acquisto_cent: 85 } }));
    assert.equal((await q('select prezzo_acquisto_cent from prodotti where id = $1', [rosa.id]))[0].prezzo_acquisto_cent, 85);
  });
} finally {
  await db.end();
  await stop();
}
console.log(`\n${ok} ok, ${ko} falliti`);
process.exit(ko ? 1 : 0);
