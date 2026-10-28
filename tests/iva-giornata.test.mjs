// Modifiche del 28 ott 2026 (richieste di Riccardo):
//  1. Totale di giornata con l'IVA divisa per aliquota (migrazione 005): un incasso per metodo × aliquota,
//     totali per metodo e per aliquota esatti al centesimo, IVA di ogni aliquota = quella del suo totale,
//     niente righe di vendita (non entra negli «articoli venduti»), formato vecchio ancora valido.
//  2. Prezzo di vendita facoltativo (articoli e composizioni): si vende al prezzo scritto in cassa e le statistiche
//     contano quanto si è incassato davvero e quanto è costato dal fornitore.
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

const { adminDb } = await start();
const db = adminDb(); await db.connect();
const q = async (sql, args) => (await db.query(sql, args)).rows;
try {
  const T = (await auth('login', { method: 'POST', body: { email: CFG.adminEmail, password: CFG.adminPass } })).j.access_token;
  const [{ oggi }] = await q('select current_date::text oggi');
  const giornata = (p, token = T) => rest('rpc/registra_giornata', { method: 'POST', token, body: { p: { data: oggi, ...p } } });
  const ultimoId = async () => (await q('select coalesce(max(id), 0)::int m from entrate'))[0].m;
  const nuove = async (dopo) => q('select id, metodo, descrizione, totale_cent, iva_cent from entrate where id > $1 order by id', [dopo]);
  const ivaDi = async (lordo, al) => (await q('select public.iva_di($1, $2) v', [lordo, al]))[0].v;
  // controlla una giornata registrata: totali per metodo, per aliquota, IVA per aliquota, nessun importo nullo
  async function verifica(prima, importi, iva) {
    const e = await nuove(prima);
    assert.ok(e.length > 0, 'nessun incasso registrato');
    assert.ok(e.every((x) => x.totale_cent > 0 && x.iva_cent >= 0), 'importo nullo o IVA negativa');
    for (const [m, c] of Object.entries(importi).filter(([, c]) => c > 0)) {
      assert.equal(e.filter((x) => x.metodo === m).reduce((a, x) => a + x.totale_cent, 0), c, `totale del metodo ${m}`);
    }
    const perAl = {};
    for (const r of iva) if (r.importo_cent > 0) perAl[r.aliquota] = (perAl[r.aliquota] || 0) + r.importo_cent;
    const aliquote = Object.keys(perAl);
    for (const al of aliquote) {
      const di = aliquote.length > 1 ? e.filter((x) => x.descrizione.endsWith(`IVA ${al}%)`)) : e;
      assert.equal(di.reduce((a, x) => a + x.totale_cent, 0), perAl[al], `totale dell'aliquota ${al}%`);
      assert.equal(di.reduce((a, x) => a + x.iva_cent, 0), await ivaDi(perAl[al], Number(al)), `IVA dell'aliquota ${al}%`);
    }
    assert.equal(Number((await q('select count(*) n from entrata_righe where entrata_id = any($1)', [e.map((x) => x.id)]))[0].n), 0, 'righe di vendita create');
    return e;
  }

  console.log('Totale di giornata con l\'IVA divisa per aliquota');
  await prova('esempio: 100 € al 10% + 50 € al 22%, pagati 90 € contanti + 60 € carta', async () => {
    const prima = await ultimoId();
    const imp = { contanti: 9000, carta: 6000 }, iva = [{ aliquota: 10, importo_cent: 10000 }, { aliquota: 22, importo_cent: 5000 }];
    assert.equal(okR(await giornata({ importi: imp, iva })), 4);
    const e = await verifica(prima, imp, iva);
    assert.deepEqual(e.map((x) => [x.descrizione, x.totale_cent]).sort(), [
      ['Totale di giornata (contanti · IVA 10%)', 6000], ['Totale di giornata (contanti · IVA 22%)', 3000],
      ['Totale di giornata (carta · IVA 10%)', 4000], ['Totale di giornata (carta · IVA 22%)', 2000]].sort());
  });
  await prova('una sola aliquota: un incasso per metodo, come prima', async () => {
    const prima = await ultimoId();
    const imp = { contanti: 12345, satispay: 655 }, iva = [{ aliquota: 22, importo_cent: 13000 }];
    assert.equal(okR(await giornata({ importi: imp, iva })), 2);
    const e = await verifica(prima, imp, iva);
    assert.deepEqual(e.map((x) => x.descrizione).sort(), ['Totale di giornata (contanti)', 'Totale di giornata (satispay)']);
  });
  await prova('formato vecchio (aliquota_iva unica, senza righe IVA) ancora valido', async () => {
    const prima = await ultimoId();
    assert.equal(okR(await giornata({ importi: { contanti: 30000, carta: 0 }, aliquota_iva: 10 })), 1);
    const e = await nuove(prima);
    assert.deepEqual(e.map((x) => [x.descrizione, x.totale_cent, x.iva_cent]), [['Totale di giornata (contanti)', 30000, await ivaDi(30000, 10)]]);
  });
  await prova('arrotondamenti difficili: 3 metodi × 3 aliquote al centesimo', async () => {
    const prima = await ultimoId();
    const imp = { contanti: 3333, carta: 3333, satispay: 3334 }, iva = [{ aliquota: 4, importo_cent: 1001 }, { aliquota: 10, importo_cent: 2002 }, { aliquota: 22, importo_cent: 6997 }];
    okR(await giornata({ importi: imp, iva }));
    await verifica(prima, imp, iva);
  });
  await prova('stessa aliquota due volte = si sommano', async () => {
    const prima = await ultimoId();
    const imp = { contanti: 5000 }, iva = [{ aliquota: 10, importo_cent: 2000 }, { aliquota: 10, importo_cent: 3000 }];
    assert.equal(okR(await giornata({ importi: imp, iva })), 1);
    await verifica(prima, imp, iva);
  });
  await prova('500 giornate casuali (1-4 metodi, 1-4 aliquote): conti sempre esatti', async () => {
    let seme = 12345; const caso = (n) => { seme = (seme * 1103515245 + 12345) % 2147483648; return seme % n; };
    const METODI = ['contanti', 'carta', 'satispay', 'bonifico'], ALIQ = [0, 4, 5, 10, 22];
    for (let t = 0; t < 500; t++) {
      const km = 1 + caso(4), ka = 1 + caso(4);
      const met = METODI.slice(0, km), al = [...ALIQ].sort(() => caso(3) - 1).slice(0, ka);
      const imp = Object.fromEntries(met.map((m) => [m, caso(5) === 0 ? 1 + caso(9) : 1 + caso(60000)]));
      const tot = Object.values(imp).reduce((a, c) => a + c, 0);
      // divido il totale tra le aliquote in modo casuale (anche quote di 1 centesimo)
      const tagli = Array.from({ length: ka - 1 }, () => caso(tot + 1)).sort((a, b) => a - b);
      const quote = [...tagli, tot].map((x, i) => x - (i ? tagli[i - 1] : 0));
      const iva = al.map((a, i) => ({ aliquota: a, importo_cent: quote[i] }));
      const prima = await ultimoId();
      const r = await giornata({ importi: imp, iva });
      assert.ok(r.status < 300, `caso ${t} ${JSON.stringify({ imp, iva })}: ${JSON.stringify(r.j)}`);
      try { await verifica(prima, imp, iva); } catch (e) { e.message = `caso ${t} ${JSON.stringify({ imp, iva })}: ${e.message}`; throw e; }
    }
  });
  await prova('righe IVA che non tornano col totale dei pagamenti: errore chiaro, niente registrato', async () => {
    const prima = await ultimoId();
    const r = await giornata({ importi: { contanti: 10000 }, iva: [{ aliquota: 10, importo_cent: 9000 }] });
    assert.equal(r.status, 400);
    assert.match(r.j.message, /righe IVA fanno 90,00 € ma i pagamenti fanno 100,00 €/);
    assert.equal(await ultimoId(), prima);
  });
  await prova('aliquota inesistente o importo sbagliato rifiutati, niente registrato', async () => {
    const prima = await ultimoId();
    for (const iva of [[{ aliquota: 7, importo_cent: 100 }], [{ aliquota: 10, importo_cent: -100 }], [{ aliquota: 10, importo_cent: 1.5 }], [{ aliquota: 10, importo_cent: '100' }]]) {
      const r = await giornata({ importi: { contanti: 100 }, iva });
      assert.equal(r.status, 400, JSON.stringify(iva));
    }
    assert.equal(await ultimoId(), prima);
  });
  await prova('il commesso registra il totale di giornata di oggi con le righe IVA', async () => {
    okR(await auth('api/utenti', { method: 'POST', token: T, body: { email: 'staff@example.test', password: 'Commesso-1234', role: 'staff', nome: 'Staff' } }));
    const S = (await auth('login', { method: 'POST', body: { email: 'staff@example.test', password: 'Commesso-1234' } })).j.access_token;
    const prima = await ultimoId();
    const imp = { contanti: 7000 }, iva = [{ aliquota: 10, importo_cent: 4000 }, { aliquota: 22, importo_cent: 3000 }];
    okR(await giornata({ importi: imp, iva }, S));
    await verifica(prima, imp, iva);
  });
  await prova('statistiche: IVA delle vendite = somma esatta per aliquota, nessun «articolo venduto»', async () => {
    const s = okR(await rest('rpc/statistiche', { method: 'POST', token: T, body: { p_da: oggi, p_a: oggi } }));
    const [{ iva }] = await q('select sum(iva_cent)::int iva from entrate where data = $1', [oggi]);
    assert.equal(s.totali.iva_entrate, iva);
    assert.deepEqual(s.articoli_categorie, []); assert.deepEqual(s.top_articoli, []);
  });

  console.log('Prezzo di vendita facoltativo');
  await db.query('delete from entrate');
  await prova('articolo e composizione senza prezzo si salvano (prezzo 0)', async () => {
    const [p] = okR(await rest('prodotti?select=id,prezzo_vendita_cent', { method: 'POST', token: T, body: { nome: 'Ortensia blu', prezzo_acquisto_cent: 500, aliquota_iva: 22 } }));
    assert.equal(p.prezzo_vendita_cent, 0);
    const [r] = okR(await rest('ricette?select=id,prezzo_vendita_cent', { method: 'POST', token: T, body: { nome: 'Cesto ortensie', aliquota_iva: 22, prezzo_vendita_cent: 0 } }));
    assert.equal(r.prezzo_vendita_cent, 0);
    okR(await rest('ricetta_righe', { method: 'POST', token: T, body: { ricetta_id: r.id, prodotto_id: p.id, quantita: 2 } }));
  });
  await prova('venduti al prezzo scritto in cassa: statistiche su incasso reale e costo del fornitore', async () => {
    const [{ id: pid }] = await q("select id from prodotti where nome = 'Ortensia blu'");
    const [{ id: rid }] = await q("select id from ricette where nome = 'Cesto ortensie'");
    // 2 ortensie a 12,20 € l'una (IVA 22% = 10,00 € netti) e un cesto a 30,50 € (25,00 € netti, costo 2 × 5,00 €)
    okR(await rest('rpc/registra_vendita', { method: 'POST', token: T, body: { p: { metodo: 'contanti', righe: [
      { prodotto_id: pid, quantita: 2, prezzo_unit_cent: 1220 }, { ricetta_id: rid, quantita: 1, prezzo_unit_cent: 3050 }] } } }));
    const s = okR(await rest('rpc/statistiche', { method: 'POST', token: T, body: { p_da: oggi, p_a: oggi } }));
    const art = Object.fromEntries(s.top_articoli.map((a) => [a.nome, a]));
    assert.equal(Number(art['Ortensia blu'].ricavo), 2440); assert.equal(Number(art['Ortensia blu'].margine), 2000 - 1000);
    assert.equal(Number(art['Cesto ortensie'].ricavo), 3050); assert.equal(Number(art['Cesto ortensie'].margine), 2500 - 1000);
    assert.equal(s.articoli_categorie.reduce((a, c) => a + Number(c.ricavo_netto) - Number(c.costo), 0), 1000 + 1500);
  });
} finally {
  await db.end();
  await stop();
}
console.log(`\n${ok} ok, ${ko} falliti`);
process.exit(ko ? 1 : 0);
