/* Altro (clic sul fiore accanto al nome): contabilità separata degli incassi con metodo di pagamento "altro" (buoni regalo).
   Questi incassi NON entrano in cruscotto, statistiche, elenco incassi e chiusura di cassa: si vedono solo qui. Solo titolare. */
'use strict';
(() => {
  const { $, $$, esc, eur, eur0, perc, oggi, iso, dataIt, get, getTutti, righeVisibili, notaRighe, S, isOwner, VIEWS, render, csv, eurCsv, stampa, meseIt, cap, vuoto, pallino } = FG;
  const P = { da: null, a: null, chiave: 'mese' };
  const GIORNI = ['', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
  const PERIODI = [['oggi', 'Oggi'], ['mese', 'Questo mese'], ['scorso', 'Mese scorso'], ['anno', 'Quest\'anno'], ['annoscorso', 'Anno scorso'], ['dodici', 'Ultimi 12 mesi']];
  function periodo(k) {
    const d = new Date(), y = d.getFullYear(), m = d.getMonth(), t = oggi();
    return { oggi: [t, t], mese: [iso(new Date(y, m, 1)), t], scorso: [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))],
      anno: [`${y}-01-01`, t], annoscorso: [`${y - 1}-01-01`, `${y - 1}-12-31`], dodici: [iso(new Date(y, m - 11, 1)), t] }[k];
  }
  const annoPrima = (d) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`.replace(/-02-29$/, '-02-28');
  const somma = (rr) => rr.reduce((a, r) => a + r.totale_cent, 0);
  const SEL = 'metodo=ilike.altro';
  const tr = (n) => `${n} ${n === 1 ? 'transazione' : 'transazioni'}`;

  VIEWS.altro = async () => {
    if (!isOwner()) return `<header class="testa"><h1>🌸 Altro</h1></header>${vuoto('La contabilità «altro» la vede solo il titolare.')}`;
    if (!P.da) [P.da, P.a] = periodo(P.chiave);
    const [righe, prima, oggiR] = await Promise.all([
      getTutti(`entrate_vista?${SEL}&data=gte.${P.da}&data=lte.${P.a}&order=data.desc,id.desc`),
      getTutti(`entrate?${SEL}&select=totale_cent&data=gte.${annoPrima(P.da)}&data=lte.${annoPrima(P.a)}&order=id`),
      get(`entrate?${SEL}&select=totale_cent&data=eq.${oggi()}`),
    ]);
    VIEWS.altro.righe = righe;
    const tot = somma(righe), iva = righe.reduce((a, r) => a + (r.iva_cent || 0), 0), totPrima = somma(prima);
    const giorni = Math.round((new Date(P.a) - new Date(P.da)) / 864e5) + 1;
    const ivaOk = S.imp.regime === 'ordinario';

    // mese per mese
    const mesi = [];
    for (let d = new Date(P.da.slice(0, 7) + '-01T12:00'); iso(d).slice(0, 7) <= P.a.slice(0, 7); d.setMonth(d.getMonth() + 1)) mesi.push(iso(d).slice(0, 7));
    const perMese = Object.fromEntries(mesi.map((m) => [m, { tot: 0, n: 0 }]));
    for (const r of righe) { const x = perMese[r.data.slice(0, 7)]; if (x) { x.tot += r.totale_cent; x.n++; } }
    // per tipo, per giorno della settimana, per documento
    const raggruppa = (chiave) => {
      const g = new Map();
      for (const r of righe) { const k = chiave(r); const x = g.get(k[0]) || { nome: k[0], colore: k[1], valore: 0, n: 0 }; x.valore += r.totale_cent; x.n++; g.set(k[0], x); }
      return [...g.values()].sort((a, b) => b.valore - a.valore);
    };
    const perTipo = raggruppa((r) => [r.categoria || 'Senza tipo', r.categoria_colore || '#999999']);
    const perGiorno = raggruppa((r) => { const w = new Date(r.data + 'T12:00').getDay() || 7; return [String(w), S.imp.colore_tema]; })
      .sort((a, b) => a.nome - b.nome).map((x) => ({ ...x, nome: cap(GIORNI[x.nome]) }));

    return `<header class="testa"><div><h1>🌸 Altro</h1><p class="muted">Contabilità separata dei pagamenti «altro» (buoni regalo). Questi incassi non sono nel cruscotto, nelle statistiche, nell'elenco incassi né nella chiusura di cassa.</p></div>
      <div class="azioni"><button class="btn" type="button" id="al-csv"${righe.length ? '' : ' disabled'}>⬇ Scarica CSV</button><button class="btn" type="button" id="al-stampa">🖨 Stampa</button></div></header>
      <form class="filtri" id="al-f">
        <div class="rapidi">${PERIODI.map(([k, t]) => `<button type="button" class="chip${P.chiave === k ? ' on' : ''}" data-k="${k}">${t}</button>`).join('')}</div>
        <label class="f"><span>Dal</span><input type="date" name="da" value="${P.da}"></label><label class="f"><span>Al</span><input type="date" name="a" value="${P.a}"></label>${FG.cercaDate}</form>
      <div id="al-corpo">
      <p class="muted">Dal ${esc(dataIt(P.da))} al ${esc(dataIt(P.a))} (${giorni} giorni). Importi IVA compresa dove non indicato.</p>
      <section class="kpi">
        <div class="kpi-box"><span>Totale «altro»</span><b>${esc(eur(tot))}</b><small>${totPrima ? `${tot >= totPrima ? '▲' : '▼'} ${esc(perc(Math.abs(tot - totPrima) / totPrima))} rispetto a un anno prima (${esc(eur0(totPrima))})` : 'nessun dato dell\'anno prima'}</small></div>
        <div class="kpi-box"><span>Transazioni</span><b>${righe.length}</b><small>importo medio ${esc(eur(righe.length ? Math.round(tot / righe.length) : 0))}</small></div>
        <div class="kpi-box"><span>Oggi</span><b>${esc(eur(somma(oggiR)))}</b><small>${tr(oggiR.length)}</small></div>
        ${ivaOk ? `<div class="kpi-box"><span>IVA compresa</span><b>${esc(eur(iva))}</b><small>al netto dell'IVA ${esc(eur(tot - iva))}</small></div>` : ''}
      </section>
      ${righe.length ? `
      ${mesi.length > 1 ? `<section class="card"><h2>Mese per mese</h2>${FG.colonne(mesi.map(meseIt), [{ nome: '«Altro»', colore: S.imp.colore_tema, valori: mesi.map((m) => perMese[m].tot) }])}
        <div class="tabella"><table class="mini"><thead><tr><th>Mese</th><th class="n">Transazioni</th><th class="n">Totale</th></tr></thead><tbody>
        ${mesi.map((m) => `<tr><td>${esc(FG.MESI_LUNGHI[Number(m.slice(5)) - 1])} ${esc(m.slice(0, 4))}</td><td class="n">${perMese[m].n}</td><td class="n">${esc(eur(perMese[m].tot))}</td></tr>`).join('')}
        <tr class="totale"><td>Totale</td><td class="n">${righe.length}</td><td class="n">${esc(eur(tot))}</td></tr></tbody></table></div></section>` : ''}
      <div class="colonne2">
        <section class="card"><h2>Per tipo di incasso</h2>${FG.ciambella(perTipo.map((x) => ({ nome: x.nome, valore: x.valore, colore: x.colore })), { centro: eur0(tot) })}
          ${FG.barre(perTipo.map((x) => ({ nome: x.nome, valore: x.valore, colore: x.colore, nota: tr(x.n) })))}</section>
        <section class="card"><h2>Per giorno della settimana</h2>${FG.barre(perGiorno.map((x) => ({ nome: x.nome, valore: x.valore, colore: x.colore, nota: tr(x.n) })))}</section>
      </div>
      <section class="card"><h2>Tutte le transazioni</h2>${notaRighe(righe)}<div class="tabella"><table><thead><tr><th>Data</th><th>Cosa</th><th>Tipo</th><th>Documento</th><th class="n">Importo</th></tr></thead><tbody>
        ${righeVisibili(righe).map((r) => `<tr data-id="${r.id}" tabindex="0"><td>${esc(dataIt(r.data))}<br><small class="muted">${esc(new Date(r.creato_il).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }))}</small></td>
          <td>${esc(r.articoli || r.descrizione || '—')}${r.cliente ? `<br><small class="muted">${esc(r.cliente)}</small>` : ''}${r.ordine_numero ? `<br><small class="muted">ordine ${esc(r.ordine_numero)}</small>` : ''}${r.nota ? `<br><small class="muted">${esc(r.nota)}</small>` : ''}</td>
          <td>${pallino(r.categoria_colore)}${esc(r.categoria || '—')}</td><td>${esc(r.documento)}${r.numero_documento ? `<br><small class="muted">${esc(r.numero_documento)}</small>` : ''}</td>
          <td class="n"><b>${esc(eur(r.totale_cent))}</b>${r.sconto_cent ? `<br><small class="muted">sconto ${esc(eur(r.sconto_cent))}</small>` : ''}</td></tr>`).join('')}
        <tr class="totale"><td colspan="4">Totale</td><td class="n"><b>${esc(eur(tot))}</b></td></tr></tbody></table></div></section>`
      : vuoto('Nessun pagamento «altro» nel periodo scelto.')}
      </div>`;
  };
  VIEWS.altro.dopo = (v) => {
    const f = $('#al-f', v);
    if (!f) return;
    $$('[data-k]', f).forEach((b) => (b.onclick = () => { P.chiave = b.dataset.k; [P.da, P.a] = periodo(P.chiave); render(); }));
    f.onchange = () => { if (f.da.value && f.a.value) { P.chiave = ''; [P.da, P.a] = [f.da.value, f.a.value].sort(); render(); } };
    $('#al-stampa', v).onclick = () => stampa($('#al-corpo', v).innerHTML, `${S.imp.nome_attivita} · «altro» dal ${dataIt(P.da)} al ${dataIt(P.a)}`);
    $('#al-csv', v).onclick = () => csv(`altro_${P.da}_${P.a}`, ['Data', 'Descrizione', 'Tipo', 'Cliente', 'Metodo', 'Documento', 'Numero', 'Totale', 'IVA', 'Imponibile', 'Nota'],
      VIEWS.altro.righe.map((r) => [r.data, r.articoli || r.descrizione || '', r.categoria || '', r.cliente || '', r.metodo, r.documento, r.numero_documento || '',
        eurCsv(r.totale_cent), eurCsv(r.iva_cent), eurCsv(r.totale_cent - r.iva_cent), r.nota || '']));
    $$('tr[data-id]', v).forEach((tr) => (tr.onclick = tr.onkeydown = (e) => { if (e.type === 'keydown' && e.key !== 'Enter') return; FG.dettaglioIncasso(Number(tr.dataset.id)); }));
  };
})();
