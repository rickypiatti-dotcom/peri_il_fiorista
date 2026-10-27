// Anteprima dei grafici con 12 mesi di dati finti (anche un mese in perdita): schermate in shots/grafici-*.png
import { avvia } from './ambiente.mjs';
const A = await avvia(8194);
const { q, nuova, entra, vai, foto } = A;
try {
  const cats = await q("select id, nome from categorie where ambito = 'spesa'");
  const c = (n) => cats.find((x) => x.nome === n).id;
  for (let m = 11; m >= 0; m--) {
    const stagione = [1.0, 1.6, 1.3, 1.1, 1.8, 1.2, 0.9, 0.6, 1.0, 1.1, 2.4, 1.5][(new Date().getMonth() - m + 24) % 12];
    for (let g = 1; g <= 24; g += 1)
      await q(`insert into entrate (data, totale_cent, metodo) values ((date_trunc('month', current_date) - make_interval(months => $1) + make_interval(days => $2))::date, $3, $4)`,
        [m, g - 1, Math.round((9000 + Math.random() * 14000) * stagione), g % 3 ? 'carta' : 'contanti']);
    await q(`insert into spese (data, descrizione, importo_cent, categoria_id) values ((date_trunc('month', current_date) - make_interval(months => $1))::date, 'Affitto', 120000, $2),
      ((date_trunc('month', current_date) - make_interval(months => $1) + interval '9 days')::date, 'Merce', $3, $4), ((date_trunc('month', current_date) - make_interval(months => $1) + interval '14 days')::date, 'Luce', 21000, $5)`,
      [m, c('Affitto'), Math.round(160000 * stagione * (m === 4 ? 2.6 : 1)), c('Acquisto merce'), c('Luce')]);
  }
  const pg = await nuova(); await entra(pg);
  await vai(pg, 'cruscotto'); await pg.waitForSelector('.grafico svg'); await pg.locator('.grafico').scrollIntoViewIfNeeded();
  await pg.locator('.grafico').screenshot({ path: 'shots/grafici-cruscotto.png' });
  const r = await pg.$eval('.grafico svg', (s) => { const b = s.getBoundingClientRect(); return { x: b.left + b.width * 0.62, y: b.top + 80 }; });
  await pg.mouse.move(r.x, r.y); await pg.waitForTimeout(150); await pg.locator('.grafico').screenshot({ path: 'shots/grafici-cruscotto-valori.png' });
  await vai(pg, 'statistiche'); await pg.click('[data-k="dodici"]'); await pg.waitForSelector('.grafico svg'); await pg.waitForTimeout(300);
  await foto(pg, 'grafici-statistiche');
  const tel = await nuova({ telefono: true }); await entra(tel); await vai(tel, 'cruscotto'); await tel.waitForSelector('.grafico svg');
  await tel.locator('.grafico').scrollIntoViewIfNeeded(); await tel.locator('.grafico').screenshot({ path: 'shots/grafici-telefono.png' });
  console.log('fatto');
} finally { await A.chiudiTutto(); }
