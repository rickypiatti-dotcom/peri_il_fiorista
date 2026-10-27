// Schermate per la guida: gestionale vero in locale, dati di esempio caricati col pulsante di Impostazioni.
// Uso (dalla cartella tests, con le variabili del README): node ../docs/guida/schermate.mjs  -> docs/guida/img/*.jpg
import fs from 'node:fs'; import path from 'node:path';
import { avvia } from '../../tests/ambiente.mjs';

const IMG = path.join(path.dirname(new URL(import.meta.url).pathname), 'img');
fs.mkdirSync(IMG, { recursive: true });
const A = await avvia(8193);
const { nuova, entra, vai, toast } = A;
const scatta = async (pg, nome, opz = {}) => {
  await pg.waitForTimeout(250);
  await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove())); // niente avvisi sopra le schermate
  const vp = pg.viewportSize();
  if (opz.el) { // una finestra più alta dello schermo verrebbe tagliata: si allunga lo schermo quanto serve
    const h = await pg.locator(opz.el).first().evaluate((e) => e.getBoundingClientRect().height);
    if (h + 80 > vp.height) { await pg.setViewportSize({ width: vp.width, height: Math.ceil(h + 80) }); await pg.waitForTimeout(250); }
  }
  if (opz.da) { await pg.locator(opz.da).first().evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 20)); await pg.waitForTimeout(200); }
  await (opz.el ? pg.locator(opz.el).first() : pg).screenshot({ path: path.join(IMG, nome + '.jpg'), type: 'jpeg', quality: 82, fullPage: !!opz.tutta });
  if (pg.viewportSize().height !== vp.height) await pg.setViewportSize(vp);
  if (opz.da) await pg.evaluate(() => window.scrollTo(0, 0));
  console.log('  ' + nome);
};
const chiudi = (pg) => pg.click('#modal .x');

try {
  const pg = await nuova();
  await pg.setViewportSize({ width: 1280, height: 820 });
  await pg.goto(A.BASE + '/'); await pg.waitForSelector('#login:not([hidden])'); await scatta(pg, '00-login');
  await entra(pg);
  await vai(pg, 'impostazioni/dati'); await scatta(pg, '41-impostazioni-dati');
  await pg.click('#d-esempio'); await pg.click('#modal [data-si]');
  await pg.waitForSelector('.toast:has-text("Caricati")', { timeout: 120000 });
  await pg.waitForSelector('text=Ultimi 12 mesi');
  // dati del negozio (finti) per l'intestazione del preventivo
  await A.q("update impostazioni set ragione_sociale = 'Il Fiorista di Esempio Srl', partita_iva = '01234567890', indirizzo = 'Via dei Fiori 1, 21047 Saronno (VA)', telefono = '02 1234567', email = 'negozio@example.com'");
  await pg.reload(); await pg.waitForSelector('#view .testa');

  // cruscotto
  await vai(pg, 'cruscotto'); await pg.waitForSelector('.grafico svg');
  await scatta(pg, '01-cruscotto'); await scatta(pg, '01b-cruscotto', { da: 'h2:has-text("Ricorrenze")' }); await scatta(pg, '01c-cruscotto', { da: 'h2:has-text("Ultimi 12 mesi")' });
  // cassa
  await vai(pg, 'cassa');
  for (const t of ['Rosa rossa', 'Rosa rossa', 'Rosa rossa', 'Vaso ceramica 14 cm']) await pg.click(`.tile:has-text("${t}")`);
  await pg.click('.tile.ricetta:has-text("Bouquet 12 rose")'); await pg.click('[data-met="contanti"]');
  await pg.fill('#s-ricevuti', '70'); await pg.dispatchEvent('#s-ricevuti', 'input');
  await pg.evaluate(() => window.scrollTo(0, 0)); await scatta(pg, '02-cassa-vendita');
  await pg.click('#banco-libera'); await pg.fill('#modal [name=nome]', 'Confezione speciale'); await pg.fill('#modal [name=prezzo]', '4'); await scatta(pg, '03-cassa-importo-libero', { el: '#modal .dialog' }); await chiudi(pg);
  await pg.click('#s-svuota');
  await vai(pg, 'cassa/giornata'); await pg.fill('[data-met="contanti"]', '412,50'); await pg.fill('[data-met="carta"]', '638'); await pg.dispatchEvent('#gg', 'input'); await scatta(pg, '04-cassa-giornata');
  await vai(pg, 'cassa/incassi'); await scatta(pg, '05-cassa-incassi');
  await pg.click('tr[data-id]'); await scatta(pg, '06-cassa-incasso-dettaglio', { el: '#modal .dialog' }); await chiudi(pg);
  await vai(pg, 'cassa/chiusura'); await pg.fill('#ch [name=fondo]', '150'); await pg.fill('#ch [name=contati]', '420'); await pg.click('#ch [type=submit]'); await pg.waitForSelector('.esito'); await scatta(pg, '07-cassa-chiusura');
  // ordini
  await vai(pg, 'ordini'); await scatta(pg, '10-ordini');
  await pg.click('.card.ordine:has-text("peonie")'); await pg.waitForSelector('h1:has-text("Ordine")'); await scatta(pg, '11-ordine-scheda');
  await vai(pg, 'ordini/preventivi'); await pg.click('.card.ordine'); await pg.waitForSelector('h1:has-text("Preventivo")'); await scatta(pg, '12-preventivo-scheda');
  await pg.click('[data-a="modifica"]'); await pg.waitForSelector('#om'); await scatta(pg, '13-preventivo-modulo', { el: '#modal .dialog' }); await chiudi(pg);
  // anteprima di stampa del preventivo (lo stesso foglio che si salva in PDF)
  await pg.evaluate(() => { window.print = () => {}; }); await pg.click('[data-a="stampa"]');
  await pg.emulateMedia({ media: 'print' }); await pg.evaluate(() => document.body.classList.add('stampando'));
  await pg.waitForTimeout(200); await scatta(pg, '14-preventivo-stampa', { el: '#stampa' });
  await pg.emulateMedia({ media: 'screen' }); await pg.evaluate(() => { document.body.classList.remove('stampando'); document.getElementById('stampa')?.remove(); });
  await vai(pg, 'ordini/consegne/' + (await pg.evaluate(() => FG.addGiorni(FG.oggi(), 1)))); await scatta(pg, '15-giro-consegne');
  // magazzino
  await vai(pg, 'magazzino'); await scatta(pg, '20-magazzino');
  await pg.click('tr[data-id]:has-text("Orchidea")'); await pg.waitForSelector('#a-sugg'); await scatta(pg, '21-articolo', { el: '#modal .dialog' }); await chiudi(pg);
  await vai(pg, 'magazzino/movimenti'); await scatta(pg, '22-movimenti');
  await vai(pg, 'magazzino/inventario'); await scatta(pg, '23-inventario');
  await vai(pg, 'magazzino/riordino'); await scatta(pg, '24-riordino');
  await vai(pg, 'bolle'); await scatta(pg, '25-bolle');
  await pg.click('tr[data-id]'); await pg.waitForSelector('h1:has-text("Bolla")'); await scatta(pg, '26-bolla-scheda');
  await vai(pg, 'bolle/nuova');
  await pg.selectOption('#nb [name=fornitore_id]', { index: 1 }); await pg.fill('#nb [name=numero]', 'DDT 4471');
  const opz = await pg.$$eval('[data-rp="0"] option', (o) => o.map((x) => [x.value, x.textContent]));
  await pg.selectOption('[data-rp="0"]', opz.find(([, t]) => t.startsWith('Rosa rossa'))[0]); await pg.fill('[data-rq="0"]', '50'); await pg.fill('[data-rc="0"]', '0,85');
  await pg.click('#nb-piu'); await pg.selectOption('[data-rp="1"]', opz.find(([, t]) => t.startsWith('Eucalipto'))[0]); await pg.fill('[data-rq="1"]', '20'); await pg.fill('[data-rc="1"]', '0,35');
  await pg.dispatchEvent('[data-rc="1"]', 'input'); await scatta(pg, '27-bolla-nuova');
  // composizioni
  await vai(pg, 'ricette'); await scatta(pg, '30-composizioni');
  await pg.click('.ricetta-card:has-text("Bouquet 12 rose")'); await pg.waitForSelector('#r-calc'); await scatta(pg, '31-composizione', { el: '#modal .dialog' }); await chiudi(pg);
  // spese
  await vai(pg, 'spese'); await pg.click('[data-p="anno"]'); await pg.waitForTimeout(400); await scatta(pg, '32-spese');
  await pg.click('#s-nuova'); await pg.waitForSelector('#modal [name=importo]'); await scatta(pg, '33-spesa-nuova', { el: '#modal .dialog' }); await chiudi(pg);
  await vai(pg, 'spese/da-pagare'); await scatta(pg, '34-spese-da-pagare');
  await vai(pg, 'spese/ricorrenti'); await scatta(pg, '35-ricorrenti');
  // statistiche
  await vai(pg, 'statistiche'); await pg.click('[data-k="dodici"]'); await pg.waitForSelector('.grafico svg');
  await scatta(pg, '36-statistiche'); await scatta(pg, '36b-statistiche', { da: 'h2:has-text("Dove vanno i soldi")' });
  await scatta(pg, '36c-statistiche', { da: 'h2:has-text("Articoli venduti per categoria")' }); await scatta(pg, '36d-statistiche', { da: 'h2:has-text("Giorni della settimana")' });
  // anagrafiche
  await vai(pg, 'clienti'); await scatta(pg, '37-clienti');
  await pg.click('tr[data-id]:has-text("Maria Rossi")'); await pg.waitForSelector('#cl-ric'); await scatta(pg, '38-cliente');
  await vai(pg, 'fornitori'); await scatta(pg, '39-fornitori');
  // impostazioni
  for (const [t, n] of [['', '40-impostazioni'], ['liste', '42-impostazioni-liste'], ['categorie', '43-impostazioni-categorie'], ['feste', '44-impostazioni-feste'], ['utenti', '45-impostazioni-utenti'], ['registro', '46-impostazioni-registro']]) {
    await vai(pg, 'impostazioni' + (t ? '/' + t : '')); await scatta(pg, n);
  }
  // telefono
  const tel = await nuova({ telefono: true }); await entra(tel);
  await scatta(tel, '50-telefono-cruscotto');
  await vai(tel, 'cassa'); await tel.tap('.tile.ricetta'); await tel.tap('.tile:has-text("Eucalipto")'); await scatta(tel, '51-telefono-cassa');
  await tel.tap('#menu-btn'); await tel.waitForTimeout(300); await scatta(tel, '52-telefono-menu');
  console.log('fatto');
} finally {
  await A.chiudiTutto();
}
