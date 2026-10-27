// Suite completa della CASSA nel browser vero (Chromium + nginx + stack vero), al computer e al telefono (tocco).
// Vendita al banco, campi di quantità/prezzo/sconto, metodi e resto, importo libero, scontrino salvato, doppio tocco,
// aggiornamenti in diretta, totale di giornata, elenco incassi (filtri, dettaglio, modifica, annullo, CSV), chiusura di cassa, permessi del commesso.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { avvia, contatore, CFG } from './ambiente.mjs';

const A = await avvia(8195);
const { q, nuova, entra, vai, toast, foto, utente, problemi } = A;
const { prova, fine } = contatore();
const oggi = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ieri = oggi(new Date(Date.now() - 86400000));
const euro = (c) => (c / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }).replace(/\s/g, ' ');
const testo = async (pg, sel) => (await pg.textContent(sel)).replace(/\s/g, ' ');
const ultimaEntrata = async () => (await q('select * from entrate order by id desc limit 1'))[0];
const giacenza = async (nome) => Number((await q('select giacenza from prodotti where nome = $1', [nome]))[0].giacenza);
const quanteEntrate = async () => (await q('select count(*)::int n from entrate'))[0].n;
const ultimoId = async () => (await q('select coalesce(max(id), 0)::int n from entrate'))[0].n;
async function incassa(pg, sel = '#s-ok') { // tocco su «Incassa» e attesa dell'incasso nuovo nel database
  const prima = await ultimoId(); await (pg.tocca ? pg.tocca(sel) : pg.click(sel));
  for (let i = 0; i < 80; i++) { if ((await ultimoId()) > prima) { await pg.waitForTimeout(150); return; } await pg.waitForTimeout(100); }
  throw new Error('nessun incasso registrato');
}

// ---------------------------------------------------------------- dati di partenza
const cat = async (ambito, nome) => (await q('select id from categorie where ambito = $1 and nome = $2', [ambito, nome]))[0].id;
const fiori = await cat('prodotto', 'Fiori recisi'), vasi = await cat('prodotto', 'Vasi e cachepot'), serv = await cat('prodotto', 'Servizi (consegna, confezione)');
const verde = await cat('prodotto', 'Verde ornamentale');
await q(`insert into prodotti (nome, categoria_id, unita, prezzo_vendita_cent, prezzo_acquisto_cent, aliquota_iva, codice, a_magazzino) values
  ('Rosa rossa', $1, 'stelo', 300, 90, 10, null, true), ('Vaso ceramica', $2, 'pz', 1200, 400, 22, '8001234567890', true),
  ('Consegna a domicilio', $3, 'pz', 800, 0, 22, null, false), ('Ruscus', $4, 'stelo', 100, 20, 10, null, true), ('Senza prezzo', $1, 'pz', 0, 0, 10, null, true)`, [fiori, vasi, serv, verde]);
for (const [n, g] of [['Rosa rossa', 100], ['Vaso ceramica', 10], ['Ruscus', 50], ['Senza prezzo', 5]])
  await q(`insert into movimenti (prodotto_id, tipo, quantita) select id, 'carico', $2 from prodotti where nome = $1`, [n, g]);
const [{ id: ric }] = await q("insert into ricette (nome, prezzo_vendita_cent, aliquota_iva) values ('Bouquet 12 rose', 4500, 10) returning id");
await q("insert into ricetta_righe (ricetta_id, prodotto_id, quantita) select $1, id, case nome when 'Rosa rossa' then 12 else 3 end from prodotti where nome in ('Rosa rossa','Ruscus')", [ric]);
await q("insert into clienti (nome) values ('Mario Bianchi')");

try {
  // ============================================================ VENDITA AL BANCO (computer)
  console.log('Vendita al banco (computer)');
  const pg = await nuova();
  await entra(pg); await vai(pg, 'cassa');

  await prova('si vedono articoli e composizioni; il servizio dice «servizio»', async () => {
    for (const n of ['Rosa rossa', 'Vaso ceramica', 'Consegna a domicilio', 'Bouquet 12 rose']) assert.ok(await pg.isVisible(`.tile:has-text("${n}")`), n);
    assert.ok((await testo(pg, '.tile:has-text("Consegna a domicilio")')).includes('servizio'));
    assert.ok((await testo(pg, '.tile.ricetta')).includes('materiale per 8')); // 100 rose / 12
  });
  await prova('ricerca per nome e filtro per categoria', async () => {
    await pg.fill('#banco-q', 'vaso'); await pg.waitForTimeout(100);
    assert.equal((await pg.$$('.tile')).length, 1);
    await pg.fill('#banco-q', ''); await pg.click(`.chips [data-f="${fiori}"]`);
    const nomi = await pg.$$eval('.tile b', (b) => b.map((x) => x.textContent));
    assert.deepEqual(nomi.sort(), ['Rosa rossa', 'Senza prezzo']);
    await pg.click('.chips [data-f="comp"]'); assert.deepEqual(await pg.$$eval('.tile b', (b) => b.map((x) => x.textContent)), ['Bouquet 12 rose']);
    await pg.click('.chips [data-f=""]');
  });
  await prova('lettore di codici a barre: codice + Invio aggiunge l\'articolo e svuota la ricerca', async () => {
    await pg.fill('#banco-q', '8001234567890'); await pg.press('#banco-q', 'Enter');
    await pg.waitForSelector('.carr-nome:has-text("Vaso ceramica")');
    assert.equal(await pg.inputValue('#banco-q'), '');
    await pg.click('#s-svuota');
  });
  await prova('stesso articolo due volte = una riga con quantità 2', async () => {
    await pg.click('.tile:has-text("Rosa rossa")'); await pg.click('.tile:has-text("Rosa rossa")');
    assert.equal((await pg.$$('.carr-righe li')).length, 1); assert.equal(await pg.inputValue('[data-q="0"]'), '2');
    assert.equal(await testo(pg, '#s-tot'), euro(600));
  });
  await prova('pulsanti + e −; − su 1 toglie la riga; ✕ toglie la riga', async () => {
    await pg.click('[data-su="0"]'); assert.equal(await pg.inputValue('[data-q="0"]'), '3');
    await pg.click('[data-giu="0"]'); await pg.click('[data-giu="0"]'); assert.equal(await pg.inputValue('[data-q="0"]'), '1');
    await pg.click('[data-giu="0"]'); assert.equal((await pg.$$('.carr-righe li')).length, 0);
    await pg.click('.tile:has-text("Ruscus")'); await pg.click('[data-togli="0"]'); assert.equal((await pg.$$('.carr-righe li')).length, 0);
    assert.ok(await pg.isDisabled('#s-ok'));
  });
  await prova('quantità con la virgola: il totale cambia MENTRE si scrive', async () => {
    await pg.click('.tile:has-text("Ruscus")');
    await pg.click('[data-q="0"]'); await pg.keyboard.type('2,5');
    assert.equal(await testo(pg, '[data-rt="0"]'), euro(250)); assert.equal(await testo(pg, '#s-tot'), euro(250));
    await pg.keyboard.press('Tab'); assert.equal(await pg.inputValue('[data-q="0"]'), '2,5');
    await pg.click('#s-svuota');
  });
  await prova('prezzo: cliccando il campo si scrive SOPRA (non «3,4,5000»), totale aggiornato, formato sistemato', async () => {
    await pg.click('.tile:has-text("Rosa rossa")');
    await pg.click('[data-pr="0"]'); await pg.keyboard.type('4,5');
    assert.equal(await pg.inputValue('[data-pr="0"]'), '4,5'); assert.equal(await testo(pg, '#s-tot'), euro(450));
    await pg.click('#scontrino h2'); assert.equal(await pg.inputValue('[data-pr="0"]'), '4,50');
  });
  await prova('prezzo sbagliato: campo rosso, messaggio, NON si incassa; corretto si incassa', async () => {
    const prima = await quanteEntrate();
    await pg.click('[data-pr="0"]'); await pg.keyboard.type('4,5,0'); await pg.click('#scontrino h2');
    assert.ok(await pg.isVisible('[data-pr="0"].sbagliato')); assert.ok((await testo(pg, '#s-err')).includes('non è un numero valido'));
    await pg.click('#s-ok'); await pg.waitForTimeout(500);
    assert.equal(await quanteEntrate(), prima); assert.ok((await testo(pg, '#s-err')).includes('Correggi il campo in rosso'));
    await pg.click('[data-pr="0"]'); await pg.keyboard.type('5'); await pg.click('#scontrino h2');
    assert.ok(!(await pg.isVisible('[data-pr="0"].sbagliato'))); assert.ok(await pg.isHidden('#s-err'));
    await incassa(pg);
    const e = await ultimaEntrata(); assert.equal(e.totale_cent, 500);
    const [r] = await q('select * from entrata_righe where entrata_id = $1', [e.id]); assert.equal(r.prezzo_unit_cent, 500); assert.equal(r.descrizione, 'Rosa rossa');
  });
  await prova('prezzo vuoto: messaggio «Scrivi un numero»', async () => {
    await pg.click('.tile:has-text("Senza prezzo")');
    await pg.fill('[data-pr="0"]', ''); await pg.click('#scontrino h2');
    assert.ok((await testo(pg, '#s-err')).includes('Scrivi un numero'));
    await pg.click('[data-pr="0"]'); await pg.keyboard.type('7'); await pg.click('#scontrino h2'); assert.equal(await pg.inputValue('[data-pr="0"]'), '7,00');
    await pg.click('#s-svuota');
  });
  await prova('sconto: si applica subito e non supera il totale', async () => {
    await pg.click('.tile:has-text("Vaso ceramica")');
    await pg.click('#s-sconto'); await pg.keyboard.type('2');
    assert.equal(await testo(pg, '#s-tot'), euro(1000)); assert.ok((await testo(pg, '#s-sc-nota')).includes('2,00'));
    await pg.fill('#s-sconto', '50'); await pg.dispatchEvent('#s-sconto', 'input'); await pg.click('#scontrino h2');
    assert.equal(await testo(pg, '#s-tot'), euro(0)); assert.equal(await pg.inputValue('#s-sconto'), '12,00');
    await pg.fill('#s-sconto', ''); await pg.dispatchEvent('#s-sconto', 'input'); await pg.click('#scontrino h2');
    assert.equal(await testo(pg, '#s-tot'), euro(1200));
    await pg.click('#s-svuota');
  });
  await prova('vendita completa: articoli, composizione, servizio, sconto, metodo, tipo, documento, cliente, nota', async () => {
    const rosePrima = await giacenza('Rosa rossa'), ruscusPrima = await giacenza('Ruscus'), vasiPrima = await giacenza('Vaso ceramica');
    await pg.click('.tile:has-text("Rosa rossa")'); await pg.click('.tile:has-text("Rosa rossa")');
    await pg.click('.tile.ricetta'); await pg.click('.tile:has-text("Vaso ceramica")'); await pg.click('.tile:has-text("Consegna a domicilio")');
    await pg.fill('#s-sconto', '1'); await pg.dispatchEvent('#s-sconto', 'input');
    await pg.selectOption('#s-cat', { label: 'Composizioni e bouquet' }); await pg.selectOption('#s-doc', 'fattura');
    await pg.selectOption('#s-cli', { label: 'Mario Bianchi' }); await pg.fill('#s-nota', 'consegna ore 17'); await pg.dispatchEvent('#s-nota', 'change');
    await pg.click('[data-met="carta"]');
    const atteso = 600 + 4500 + 1200 + 800 - 100;
    assert.equal(await testo(pg, '#s-ok'), 'Incassa ' + euro(atteso));
    await foto(pg, 'cassa-01-scontrino');
    await incassa(pg);
    const e = await ultimaEntrata();
    assert.equal(e.totale_cent, atteso); assert.equal(e.sconto_cent, 100); assert.equal(e.metodo, 'carta'); assert.equal(e.documento, 'fattura');
    assert.equal(e.nota, 'consegna ore 17'); assert.equal(e.categoria_id, await cat('entrata', 'Composizioni e bouquet'));
    assert.equal(e.cliente_id, (await q("select id from clienti where nome = 'Mario Bianchi'"))[0].id);
    const lordo = 600 + 4500 + 1200 + 800, ivaLorda = Math.round(600 - 600 / 1.1) + Math.round(4500 - 4500 / 1.1) + Math.round(1200 - 1200 / 1.22) + Math.round(800 - 800 / 1.22);
    assert.equal(e.iva_cent, Math.round(ivaLorda * (lordo - 100) / lordo));
    const righe = await q('select * from entrata_righe where entrata_id = $1 order by id', [e.id]);
    assert.equal(righe.length, 4); assert.equal(righe[1].ricetta_id, ric); assert.equal(righe[1].costo_unit_cent, 12 * 90 + 3 * 20);
    assert.equal(await giacenza('Rosa rossa'), rosePrima - 2 - 12); assert.equal(await giacenza('Ruscus'), ruscusPrima - 3); assert.equal(await giacenza('Vaso ceramica'), vasiPrima - 1);
    assert.equal((await q("select count(*)::int n from movimenti m join prodotti p on p.id = m.prodotto_id where p.nome = 'Consegna a domicilio'"))[0].n, 0, 'il servizio non muove il magazzino');
    assert.equal((await pg.$$('.carr-righe li')).length, 0, 'scontrino svuotato'); assert.equal(await pg.inputValue('#s-nota'), '');
    assert.ok((await testo(pg, '.tile.ricetta')).includes('materiale per'), 'riquadri aggiornati');
  });
  await prova('contanti: compare «Contanti ricevuti» e calcola il resto; con la carta sparisce', async () => {
    await pg.click('.tile:has-text("Vaso ceramica")'); await pg.click('[data-met="contanti"]');
    await pg.fill('#s-ricevuti', '20'); await pg.dispatchEvent('#s-ricevuti', 'input');
    assert.equal(await testo(pg, '#s-resto'), 'Resto ' + euro(800));
    await pg.fill('#s-ricevuti', '5'); await pg.dispatchEvent('#s-ricevuti', 'input'); assert.equal(await testo(pg, '#s-resto'), '');
    await pg.click('[data-met="carta"]'); assert.ok(!(await pg.$('#s-ricevuti')));
    await pg.click('#s-svuota');
  });
  await prova('doppio clic su «Incassa» = un solo incasso', async () => {
    const prima = await quanteEntrate();
    await pg.click('.tile:has-text("Ruscus")');
    await pg.dblclick('#s-ok'); await toast(pg, 'Incassati'); await pg.waitForTimeout(700);
    assert.equal(await quanteEntrate(), prima + 1);
  });
  await prova('«Importo libero»: si aggiunge con descrizione, prezzo e quantità; prezzo sbagliato = errore', async () => {
    await pg.click('#banco-libera');
    await pg.fill('#modal [name=nome]', 'Confezione regalo'); await pg.fill('#modal [name=prezzo]', 'abc'); await pg.click('#modal [type=submit]');
    assert.ok(await pg.isVisible('#modal .alert.err'));
    await pg.fill('#modal [name=prezzo]', '2,5'); await pg.fill('#modal [name=quantita]', '3'); await pg.click('#modal [type=submit]');
    await pg.waitForSelector('.carr-nome:has-text("Confezione regalo")');
    assert.equal(await pg.inputValue('[data-q="0"]'), '3'); assert.equal(await testo(pg, '#s-tot'), euro(750));
    await pg.click('#banco-libera'); await pg.click('#modal [data-no]'); assert.equal((await pg.$$('.carr-righe li')).length, 1);
    await incassa(pg);
    const [r] = await q('select * from entrata_righe where entrata_id = $1', [(await ultimaEntrata()).id]);
    assert.equal(r.prodotto_id, null); assert.equal(r.descrizione, 'Confezione regalo'); assert.equal(Number(r.quantita), 3);
  });
  await prova('lo scontrino resta se si cambia pagina o si ricarica', async () => {
    await pg.click('.tile:has-text("Rosa rossa")'); await pg.click('[data-pr="0"]'); await pg.keyboard.type('3,8'); await pg.click('#scontrino h2');
    await pg.fill('#s-nota', 'da ricordare'); await pg.dispatchEvent('#s-nota', 'change');
    await vai(pg, 'ordini'); await vai(pg, 'cassa');
    assert.equal(await pg.inputValue('[data-pr="0"]'), '3,80'); assert.equal(await pg.inputValue('#s-nota'), 'da ricordare');
    await pg.reload(); await pg.waitForSelector('.carr-righe li');
    assert.equal(await pg.inputValue('[data-pr="0"]'), '3,80');
  });
  await prova('«Svuota» toglie tutto', async () => {
    await pg.click('#s-svuota'); assert.equal((await pg.$$('.carr-righe li')).length, 0); assert.equal(await pg.inputValue('#s-nota'), '');
  });
  await prova('un incasso fatto da un altro dispositivo NON cancella quello che si sta scrivendo', async () => {
    await pg.click('.tile:has-text("Rosa rossa")'); await pg.click('[data-pr="0"]'); await pg.keyboard.type('9,9');
    await q("insert into entrate (totale_cent, metodo) values (100, 'contanti')"); // notifica in tempo reale
    await pg.waitForTimeout(1500);
    assert.equal(await pg.inputValue('[data-pr="0"]'), '9,9');
    assert.equal(await pg.evaluate(() => document.activeElement.dataset.pr), '0');
    await pg.click('#scontrino h2'); await pg.waitForTimeout(1200); // ora la pagina può aggiornarsi: il prezzo resta
    assert.equal(await pg.inputValue('[data-pr="0"]'), '9,90');
    await pg.click('#s-svuota');
  });
  await prova('metodi di incasso presi dalle Impostazioni (anche nuovi)', async () => {
    await q("update impostazioni set metodi_incasso = '{contanti,carta,buono regalo}'");
    await vai(pg, 'impostazioni'); await vai(pg, 'cassa'); await pg.reload(); await pg.waitForSelector('.metodi');
    assert.deepEqual(await pg.$$eval('.metodi button', (b) => b.map((x) => x.dataset.met)), ['contanti', 'carta', 'buono regalo']);
    await pg.click('.tile:has-text("Ruscus")'); await pg.click('[data-met="buono regalo"]'); await incassa(pg);
    assert.equal((await ultimaEntrata()).metodo, 'buono regalo');
    await q("update impostazioni set metodi_incasso = '{contanti,carta,bancomat,satispay,bonifico,assegno,altro}'");
    await pg.reload(); await pg.waitForSelector('.metodi [data-met="satispay"]');
  });

  // ============================================================ TOTALE DI GIORNATA
  console.log('Totale di giornata');
  await vai(pg, 'cassa/giornata');
  await prova('nessun importo = errore, importo sbagliato = errore', async () => {
    const prima = await quanteEntrate();
    await pg.click('#gg [type=submit]'); assert.ok((await testo(pg, '#gg .alert')).includes('almeno un importo'));
    await pg.fill('[data-met="contanti"]', '12,3,4'); await pg.click('#gg [type=submit]'); assert.ok((await testo(pg, '#gg .alert')).includes('non è valido'));
    assert.equal(await quanteEntrate(), prima);
  });
  await prova('un incasso per ogni metodo, con data, tipo, IVA e numero di chiusura; totale in diretta', async () => {
    await pg.fill('#gg [name=data]', ieri);
    await pg.selectOption('#gg [name=cat]', { label: 'Vendita al banco' }); await pg.selectOption('#gg [name=iva]', '22');
    await pg.fill('#gg [name=doc]', 'Z 0042');
    await pg.fill('[data-met="contanti"]', '350,50'); await pg.fill('[data-met="carta"]', '120'); await pg.fill('[data-met="satispay"]', '0');
    assert.equal(await testo(pg, '#gg-tot'), euro(47050));
    await foto(pg, 'cassa-02-giornata');
    await pg.click('#gg [type=submit]'); await pg.waitForSelector('.tabs a.on:has-text("Incassi")');
    const r = await q("select * from entrate where numero_documento = 'Z 0042' order by metodo");
    assert.equal(r.length, 2, 'lo zero non crea incassi');
    assert.deepEqual(r.map((x) => [x.metodo, x.totale_cent, x.iva_cent]), [['carta', 12000, Math.round(12000 - 12000 / 1.22)], ['contanti', 35050, Math.round(35050 - 35050 / 1.22)]]);
    assert.ok(r.every((x) => oggi(x.data) === ieri && x.descrizione.startsWith('Totale di giornata')));
  });
  await prova('non si può mettere una data futura', async () => {
    assert.equal(await (await pg.evaluate(() => { location.hash = '#/cassa/giornata'; }), pg.waitForSelector('#gg'), pg.getAttribute('#gg [name=data]', 'max')), oggi());
  });

  // ============================================================ INCASSI
  console.log('Elenco incassi');
  await vai(pg, 'cassa/incassi');
  await prova('oggi: tutti gli incassi di oggi con totale per metodo', async () => {
    const [{ n, t }] = await q('select count(*)::int n, sum(totale_cent)::int t from entrate where data = current_date');
    assert.equal((await pg.$$('tr[data-id]')).length, n);
    assert.ok((await testo(pg, '.kpi-box')).includes(euro(t)));
  });
  await prova('«Ieri» mostra il totale di giornata; filtro per metodo', async () => {
    await pg.click('[data-p="ieri"]'); await pg.waitForTimeout(400);
    assert.equal((await pg.$$('tr[data-id]')).length, 2);
    await pg.selectOption('#fi [name=metodo]', 'carta'); await pg.waitForTimeout(400);
    assert.equal((await pg.$$('tr[data-id]')).length, 1);
    await pg.selectOption('#fi [name=metodo]', ''); await pg.waitForTimeout(300);
  });
  await prova('CSV per Excel con tutte le righe del periodo', async () => {
    const [d] = await Promise.all([pg.waitForEvent('download'), pg.click('#fi-csv')]);
    const csv = fs.readFileSync(await d.path(), 'utf8');
    assert.ok(csv.startsWith('﻿Data;Descrizione')); assert.ok(csv.includes('350,50')); assert.equal(csv.trim().split('\r\n').length, 3);
  });
  await prova('dettaglio, modifica del titolare (metodo, documento, nota)', async () => {
    await pg.click('[data-p="oggi"]'); await pg.waitForTimeout(400);
    const id = Number(await pg.getAttribute('tr[data-id]', 'data-id'));
    await pg.click('tr[data-id]'); await pg.waitForSelector('#de');
    await pg.selectOption('#de [name=metodo]', 'bancomat'); await pg.selectOption('#de [name=documento]', 'ricevuta');
    await pg.fill('#de [name=numero_documento]', 'R-7'); await pg.fill('#de [name=nota]', 'corretto'); await pg.click('[data-salva]'); await toast(pg, 'Salvato');
    const [e] = await q('select * from entrate where id = $1', [id]);
    assert.deepEqual([e.metodo, e.documento, e.numero_documento, e.nota], ['bancomat', 'ricevuta', 'R-7', 'corretto']);
  });
  await prova('annullare un incasso rimette la merce in magazzino', async () => {
    await vai(pg, 'cassa'); await pg.click('.tile.ricetta'); await incassa(pg);
    const e = await ultimaEntrata(), rose = await giacenza('Rosa rossa');
    await vai(pg, 'cassa/incassi'); await pg.click(`tr[data-id="${e.id}"]`); await pg.click('[data-annulla]');
    await pg.click('#modal [data-si]'); await toast(pg, 'Incasso annullato');
    assert.equal((await q('select count(*)::int n from entrate where id = $1', [e.id]))[0].n, 0); assert.equal(await giacenza('Rosa rossa'), rose + 12);
  });

  // ============================================================ CHIUSURA DI CASSA
  console.log('Chiusura di cassa');
  await prova('attesi = fondo + incassi in contanti − spese pagate in contanti − contanti tolti', async () => {
    await q("insert into spese (descrizione, importo_cent, metodo, pagata) values ('Caffè fornitore', 300, 'contanti', true)");
    await vai(pg, 'cassa/chiusura');
    const [{ c }] = await q("select coalesce(sum(totale_cent),0)::int c from entrate where data = current_date and metodo = 'contanti'");
    await pg.fill('#ch [name=fondo]', '100'); await pg.fill('#ch [name=versati]', '50');
    const attesi = 10000 + c - 300 - 5000;
    await pg.fill('#ch [name=contati]', (attesi / 100).toFixed(2).replace('.', ','));
    await pg.click('#ch [type=submit]'); await pg.waitForSelector('.esito');
    assert.ok((await testo(pg, '.esito b')).includes('Cassa giusta'));
    assert.equal((await q('select attesi_cent from chiusure where data = current_date'))[0].attesi_cent, attesi);
    await foto(pg, 'cassa-03-chiusura');
  });
  await prova('ricontare lo stesso giorno aggiorna (non duplica) e dice quanto manca', async () => {
    await pg.fill('#ch [name=contati]', '1'); await pg.click('#ch [type=submit]'); await pg.waitForSelector('.esito.neg');
    assert.ok((await testo(pg, '.esito b')).startsWith('Mancano'));
    assert.equal((await q('select count(*)::int n from chiusure'))[0].n, 1);
  });
  await prova('importo sbagliato = errore; giorno precedente dallo storico; fondo proposto = contati del giorno prima', async () => {
    await pg.fill('#ch [name=contati]', 'abc'); await pg.click('#ch [type=submit]'); assert.ok(await pg.isVisible('#ch .alert.err'));
    await q("update chiusure set data = current_date - 1"); await vai(pg, 'cassa/chiusura');
    assert.equal(await pg.inputValue('#ch [name=fondo]'), '1,00');
    await pg.click(`a[href="#/cassa/chiusura/${ieri}"]`); await pg.waitForSelector('.esito');
  });

  // ============================================================ TELEFONO (tocco)
  console.log('Telefono');
  const tel = await nuova({ telefono: true });
  await entra(tel); await vai(tel, 'cassa');
  await prova('tocco sul prezzo + tastiera: si scrive sopra; tocco subito su «Incassa» registra il prezzo nuovo', async () => {
    await tel.tap('.tile:has-text("Rosa rossa")');
    await tel.tap('[data-pr="0"]'); await tel.keyboard.type('4,50'); assert.equal(await tel.inputValue('[data-pr="0"]'), '4,50');
    await incassa(tel);
    assert.equal((await ultimaEntrata()).totale_cent, 450);
  });
  await prova('tocco sulla quantità: si scrive sopra', async () => {
    await tel.tap('.tile:has-text("Ruscus")'); await tel.tap('[data-q="0"]'); await tel.keyboard.type('6');
    assert.equal(await tel.inputValue('[data-q="0"]'), '6'); assert.equal(await testo(tel, '#s-tot'), euro(600));
  });
  await prova('barra in basso: pezzi e totale aggiornati in diretta; toccandola porta allo scontrino', async () => {
    assert.ok(await tel.isVisible('#pos-barra')); assert.ok((await testo(tel, '#pos-barra')).includes(euro(600)) && (await testo(tel, '#pos-barra')).includes('6 pezzi'));
    await tel.tap('#pos-barra'); await tel.waitForTimeout(700);
    const y = await tel.evaluate(() => document.getElementById('scontrino').getBoundingClientRect().top);
    assert.ok(y < 200, 'scontrino visibile: ' + y);
    await foto(tel, 'cassa-04-telefono');
    await tel.tap('#s-svuota'); assert.ok(await tel.isHidden('#pos-barra'));
  });
  await prova('nessuna scheda della cassa è più larga dello schermo', async () => {
    for (const r of ['cassa', 'cassa/giornata', 'cassa/incassi', 'cassa/chiusura']) {
      await vai(tel, r); assert.ok(await tel.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), r);
    }
  });
  await prova('pulsante «+ Vendita» in alto porta alla cassa', async () => {
    await vai(tel, 'ordini'); await tel.tap('#nuova-vendita'); await tel.waitForSelector('#banco');
  });

  // ============================================================ COMMESSO
  console.log('Commesso');
  await utente('luca@example.test', 'Commesso-12345');
  const st = await nuova();
  await entra(st, 'luca@example.test', 'Commesso-12345'); await vai(st, 'cassa');
  await prova('commesso: vende; se gli sconti sono vietati il campo non c\'è', async () => {
    await q('update impostazioni set staff_sconti = false'); await st.reload(); await st.waitForSelector('.tile');
    await st.click('.tile:has-text("Ruscus")'); assert.ok(!(await st.$('#s-sconto')));
    await incassa(st);
    await q('update impostazioni set staff_sconti = true');
  });
  await prova('commesso: vede solo le SUE vendite di oggi (niente totali, filtri, CSV); annulla la sua, niente modifica', async () => {
    const mio = await ultimaEntrata();
    const altro = (await q("select id from entrate where creato_da is null or creato_da <> $1 order by id desc limit 1", [mio.creato_da]))[0];
    await vai(st, 'cassa/incassi'); await st.waitForSelector(`tr[data-id="${mio.id}"]`);
    assert.ok((await st.content()).includes('Le mie vendite di oggi'));
    assert.ok(!(await st.$(`tr[data-id="${altro.id}"]`)), 'le vendite degli altri non si vedono');
    assert.ok(!(await st.$('#fi')) && !(await st.$('#fi-csv')) && !(await st.$('.kpi')), 'niente filtri, CSV né totali');
    await st.click(`tr[data-id="${mio.id}"]`); await st.waitForSelector('#modal .dialog');
    assert.ok(!(await st.$('[data-salva]'))); await st.click('[data-annulla]'); await st.click('#modal [data-si]'); await toast(st, 'Incasso annullato');
  });
  await prova('commesso: se il titolare lo vieta, niente annullo', async () => {
    await vai(st, 'cassa'); await st.click('.tile:has-text("Ruscus")'); await incassa(st);
    await q('update impostazioni set staff_annulla = false'); await st.reload(); await vai(st, 'cassa/incassi');
    await st.click(`tr[data-id="${(await ultimaEntrata()).id}"]`); await st.waitForSelector('#modal .dialog');
    assert.ok(!(await st.$('[data-annulla]')));
  });
  await prova('commesso: chiusura di cassa di oggi sì, senza scegliere il giorno né lo storico', async () => {
    await st.click('[data-chiudi]'); await vai(st, 'cassa/chiusura');
    assert.ok(!(await st.$('#ch-data')) && !(await st.content()).includes('Ultime chiusure'));
    await st.fill('#ch [name=contati]', '10'); await st.click('#ch [type=submit]'); await st.waitForSelector('.esito');
  });
  await prova('commesso: niente contabilità a schermo (cruscotto, menu, magazzino, composizioni, bolle)', async () => {
    await vai(st, 'cruscotto'); await st.waitForSelector('.testa h1');
    let t = await st.textContent('#view');
    assert.ok(!/Incassato|Uscite del mese|Risultato del mese|Pareggio|Ultimi 12 mesi/i.test(t), 'cruscotto: ' + t.slice(0, 200));
    const menu = await st.textContent('#nav'); assert.ok(!/Spese|Statistiche|Impostazioni/.test(menu), menu);
    await vai(st, 'magazzino'); await st.waitForSelector('#af');
    t = await st.textContent('#view'); assert.ok(!/valore al costo|Margine|Costo/.test(t), 'magazzino');
    await st.click('tr[data-id]'); await st.waitForSelector('#modal form');
    assert.ok(!(await st.$('#modal [name=prezzo_acquisto_cent]')) && !(await st.textContent('#modal')).includes('consigliato')); await st.click('#modal [data-annulla]');
    await vai(st, 'ricette'); await st.waitForSelector('.testa h1');
    t = await st.textContent('#view'); assert.ok(!/Materiali|Margine|Consigliato|guadagni/.test(t), 'composizioni');
    await vai(st, 'bolle/nuova'); await st.waitForSelector('#nb');
    assert.ok(!(await st.$('[data-rc]')) && !(await st.$('#nb-sp')) && !(await st.textContent('#nb-tot')), 'nuova bolla senza costi');
  });

  await prova('nessun errore JavaScript in tutta la suite', async () => {
    assert.deepEqual(problemi.filter((p) => !/Failed to load resource.*(401|403)/.test(p)), []);
  });
} finally {
  await A.chiudiTutto();
}
process.exit(fine() ? 1 : 0);
