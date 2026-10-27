// Pagamenti "altro" (buoni regalo): contabilità SEPARATA. Non entrano in cruscotto, statistiche, chiusura di cassa
// (pagamenti elettronici) né negli elenchi incassi del sito; si leggono solo con il filtro metodo=altro (pagina Altro).
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
  const [{ oggi, ieri, inizio, anno_scorso }] = await q(`select current_date::text oggi, (current_date - 1)::text ieri,
    date_trunc('month', current_date)::date::text inizio, (current_date - interval '1 year')::date::text anno_scorso`);
  const v = async (p) => okR(await rest('rpc/registra_vendita', { method: 'POST', token: T, body: { p } }));

  // oggi: totale di giornata come lo registra la pagina (un incasso per metodo): contanti 300, carta 200, altro (buoni) 150
  for (const [metodo, c] of [['contanti', 30000], ['carta', 20000], ['altro', 15000]]) {
    await v({ data: oggi, metodo, importo_cent: c, aliquota_iva: 10, descrizione: `Totale di giornata (${metodo})` });
  }
  // ieri: vendita al banco pagata con buono ("Altro" con la maiuscola, come potrebbe scriverlo il titolare nelle impostazioni)
  await v({ data: ieri, metodo: 'Altro', importo_cent: 4000, descrizione: 'buono regalo' });
  await v({ data: ieri, metodo: 'satispay', importo_cent: 1000 });
  // un anno fa: un altro buono (per il confronto della pagina Altro) e una vendita normale
  await v({ data: anno_scorso, metodo: 'altro', importo_cent: 9900 });
  await v({ data: anno_scorso, metodo: 'contanti', importo_cent: 100 });

  console.log('Contabilità principale senza «altro»');
  await prova('cruscotto: oggi, metodi di oggi e mese senza «altro»', async () => {
    const c = okR(await rest('rpc/cruscotto', { method: 'POST', token: T, body: {} }));
    assert.equal(c.oggi.totale, 50000); assert.equal(c.oggi.n, 2);
    assert.deepEqual(Object.keys(c.oggi_metodi).sort(), ['carta', 'contanti']);
    const atteso = ieri >= inizio ? 51000 : 50000;
    assert.equal(c.mese_entrate, atteso);
    assert.equal(c.mesi.at(-1).entrate, atteso);
    assert.equal(c.mese_anno_scorso, anno_scorso >= `${Number(inizio.slice(0, 4)) - 1}${inizio.slice(4)}` ? 100 : 0);
  });
  await prova('statistiche: totali, IVA, numero, mesi, tipi, metodi, settimana, anno prima senza «altro»', async () => {
    const s = okR(await rest('rpc/statistiche', { method: 'POST', token: T, body: { p_da: ieri, p_a: oggi } }));
    assert.equal(s.totali.entrate, 51000); assert.equal(s.totali.n_incassi, 3);
    assert.equal(s.totali.iva_entrate, (await q("select sum(iva_cent)::int t from entrate where data between $1 and $2 and lower(metodo) <> 'altro'", [ieri, oggi]))[0].t);
    assert.equal(s.mesi.reduce((a, m) => a + Number(m.entrate), 0), 51000);
    assert.equal(s.entrate_categorie.reduce((a, c) => a + Number(c.totale), 0), 51000);
    assert.deepEqual(s.metodi.map((m) => m.nome).sort(), ['carta', 'contanti', 'satispay']);
    assert.equal(s.settimana.reduce((a, g) => a + Number(g.totale), 0), 51000);
    const p = okR(await rest('rpc/statistiche', { method: 'POST', token: T, body: { p_da: anno_scorso, p_a: anno_scorso } }));
    assert.equal(p.totali.entrate, 100);
  });
  await prova('articoli venduti: una vendita a righe pagata con «altro» non conta', async () => {
    const [rosa] = okR(await rest('prodotti?select=id', { method: 'POST', token: T, body: { nome: 'Rosa', prezzo_acquisto_cent: 80, prezzo_vendita_cent: 300, aliquota_iva: 10 } }));
    await v({ metodo: 'altro', righe: [{ prodotto_id: rosa.id, quantita: 3, prezzo_unit_cent: 300 }] });
    const s = okR(await rest('rpc/statistiche', { method: 'POST', token: T, body: { p_da: oggi, p_a: oggi } }));
    assert.equal(s.top_articoli.length, 0); assert.equal(s.articoli_categorie.length, 0);
    assert.equal(s.totali.entrate, 50000);
    // il magazzino invece scende: la merce è uscita davvero
    assert.equal(Number((await q('select giacenza from prodotti where id = $1', [rosa.id]))[0].giacenza), -3);
  });
  await prova('chiusura di cassa: «altro» non è tra gli incassi né tra i pagamenti elettronici', async () => {
    const cg = okR(await rest('rpc/cassa_giorno', { method: 'POST', token: T, body: { p_data: oggi } }));
    assert.deepEqual(Object.keys(cg.metodi).sort(), ['carta', 'contanti']);
    const [ch] = okR(await rest('chiusure', { method: 'POST', token: T, body: { data: oggi, fondo_cent: 0, contati_cent: 30000 } }));
    assert.equal(ch.attesi_cent, 30000); assert.equal(ch.pos_cent, 20000);
  });
  await prova('elenco incassi del sito (filtro not.ilike.altro): niente «altro», anche scritto «Altro»', async () => {
    const r = okR(await rest(`entrate_vista?data=gte.${ieri}&data=lte.${oggi}&metodo=not.ilike.altro&select=metodo,totale_cent`, { token: T }));
    assert.ok(r.every((x) => x.metodo.toLowerCase() !== 'altro'));
    assert.equal(r.reduce((a, x) => a + x.totale_cent, 0), 51000);
  });

  console.log('Pagina Altro');
  await prova('pagina Altro (filtro ilike.altro): solo i buoni, compresi «Altro» e le vendite a righe', async () => {
    const r = okR(await rest(`entrate_vista?metodo=ilike.altro&data=gte.${ieri}&data=lte.${oggi}&order=data.desc,id.desc`, { token: T }));
    assert.equal(r.length, 3);
    assert.equal(r.reduce((a, x) => a + x.totale_cent, 0), 15000 + 4000 + 900);
    assert.ok(r[0].articoli.includes('Rosa'));
    const p = okR(await rest(`entrate?metodo=ilike.altro&select=totale_cent&data=eq.${anno_scorso}`, { token: T }));
    assert.equal(p[0].totale_cent, 9900);
  });
  await prova('metodo_separato(): stessa regola del sito', async () => {
    const r = await q("select public.metodo_separato(x) s from unnest(array['altro','Altro',' ALTRO ','altri','contanti',null]) x");
    assert.deepEqual(r.map((x) => x.s), [true, true, true, false, false, false]);
  });
} finally {
  await db.end();
  await stop();
}
console.log(`\n${ok} ok, ${ko} falliti`);
process.exit(ko ? 1 : 0);
