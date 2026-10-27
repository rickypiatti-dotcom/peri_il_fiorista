/* Statistiche (solo titolare): periodo a scelta, incassi e spese per mese e per categoria, margini per categoria di articoli,
   più venduti, perdite (scarti), fornitori, magazzino, giorni della settimana, IVA indicativa, confronto con l'anno prima. */
'use strict';
(() => {
  const { $, $$, esc, eur, eur0, num, perc, oggi, iso, dataIt, get, rpc, S, VIEWS, render, csv, eurCsv, numCsv, stampa, meseIt, cap } = FG;
  const P = { da: null, a: null, chiave: 'anno' };
  const GIORNI = ['', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
  function periodo(k) {
    const d = new Date(), y = d.getFullYear(), m = d.getMonth(), t = oggi();
    return { mese: [iso(new Date(y, m, 1)), t], scorso: [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))], trimestre: [iso(new Date(y, Math.floor(m / 3) * 3, 1)), t],
      anno: [`${y}-01-01`, t], annoscorso: [`${y - 1}-01-01`, `${y - 1}-12-31`], dodici: [iso(new Date(y, m - 11, 1)), t] }[k];
  }
  const variazione = (ora, prima) => (prima ? `${ora >= prima ? '▲' : '▼'} ${perc(Math.abs(ora - prima) / prima)} rispetto a un anno prima (${eur0(prima)})` : 'nessun dato dell\'anno prima');

  VIEWS.statistiche = async () => {
    if (!P.da) [P.da, P.a] = periodo(P.chiave);
    const s = await rpc('statistiche', { p_da: P.da, p_a: P.a });
    VIEWS.statistiche.s = s;
    const T = s.totali, ris = T.entrate - T.uscite, ivaOk = S.imp.regime === 'ordinario';
    const nettoEntrate = T.entrate - (ivaOk ? T.iva_entrate : 0);
    const art = s.articoli_categorie.map((c) => ({ ...c, margine: Number(c.ricavo_netto) - Number(c.costo) }));
    const totArt = art.reduce((a, c) => a + c.margine, 0), ricArt = art.reduce((a, c) => a + Number(c.ricavo_netto), 0);
    const perdite = s.scarti.filter((x) => x.tipo === 'scarto').reduce((a, x) => a + Number(x.valore), 0);
    const usi = s.scarti.filter((x) => x.tipo === 'uso').reduce((a, x) => a + Number(x.valore), 0);
    const mesi = s.mesi.map((m) => meseIt(m.mese));
    const variabili = T.uscite - T.fisse;
    const sett = s.settimana.map((g) => ({ nome: cap(GIORNI[g.giorno]), valore: Number(g.totale), colore: S.imp.colore_tema, nota: `${g.n} incassi` }));

    return `<header class="testa"><h1>Statistiche</h1><div class="azioni"><button class="btn" type="button" id="st-csv">⬇ Dati per il commercialista</button><button class="btn" type="button" id="st-stampa">🖨 Stampa</button></div></header>
      <form class="filtri" id="pf">
        <div class="rapidi">${[['mese', 'Questo mese'], ['scorso', 'Mese scorso'], ['trimestre', 'Trimestre'], ['anno', 'Quest\'anno'], ['annoscorso', 'Anno scorso'], ['dodici', 'Ultimi 12 mesi']].map(([k, t]) => `<button type="button" class="chip${P.chiave === k ? ' on' : ''}" data-k="${k}">${t}</button>`).join('')}</div>
        <label class="f"><span>Dal</span><input type="date" name="da" value="${P.da}"></label><label class="f"><span>Al</span><input type="date" name="a" value="${P.a}"></label></form>
      <div id="st-corpo">
      <p class="muted">Dal ${esc(dataIt(s.da))} al ${esc(dataIt(s.a))} (${T.giorni} giorni). Importi IVA compresa dove non indicato.</p>
      <section class="kpi">
        <div class="kpi-box"><span>Incassi</span><b>${esc(eur(T.entrate))}</b><small>${esc(variazione(T.entrate, s.precedente.entrate))}</small></div>
        <div class="kpi-box"><span>Spese</span><b>${esc(eur(T.uscite))}</b><small>${esc(variazione(T.uscite, s.precedente.uscite))}</small></div>
        <div class="kpi-box ${ris < 0 ? 'neg' : 'pos'}"><span>Risultato</span><b>${esc(eur(ris))}</b><small>incassi meno spese${T.entrate ? ' · ' + esc(perc(ris / T.entrate)) + ' degli incassi' : ''}</small></div>
        <div class="kpi-box"><span>Scontrino medio</span><b>${esc(eur(T.n_incassi ? Math.round(T.entrate / T.n_incassi) : 0))}</b><small>${T.n_incassi} incassi · ${esc(eur(Math.round(T.entrate / Math.max(1, T.giorni))))} al giorno</small></div>
        <div class="kpi-box"><span>Spese fisse</span><b>${esc(eur(T.fisse))}</b><small>${T.uscite ? esc(perc(T.fisse / T.uscite)) + ' delle spese' : ''} · variabili ${esc(eur(variabili))}</small></div>
        <div class="kpi-box ${perdite ? 'neg' : ''}"><span>Perdite (scarti)</span><b>${esc(eur(perdite))}</b><small>al costo · uso interno ${esc(eur(usi))}</small></div>
      </section>

      <section class="card"><h2>Mese per mese</h2>${FG.colonne(mesi, [
        { nome: 'Incassi', colore: S.imp.colore_tema, valori: s.mesi.map((m) => m.entrate) },
        { nome: 'Spese', colore: S.imp.colore_accento, valori: s.mesi.map((m) => m.uscite) },
      ], { linea: { nome: 'Risultato', colore: '#e0a96d', valori: s.mesi.map((m) => m.entrate - m.uscite) } })}
        <div class="tabella"><table class="mini"><thead><tr><th>Mese</th><th class="n">Incassi</th><th class="n">Spese</th><th class="n">di cui fisse</th><th class="n">Risultato</th></tr></thead><tbody>
        ${s.mesi.map((m) => `<tr><td>${esc(FG.MESI_LUNGHI[Number(m.mese.slice(5)) - 1])} ${esc(m.mese.slice(0, 4))}</td><td class="n">${esc(eur(m.entrate))}</td><td class="n">${esc(eur(m.uscite))}</td><td class="n">${esc(eur(m.fisse))}</td><td class="n ${m.entrate - m.uscite < 0 ? 'neg' : ''}">${esc(eur(m.entrate - m.uscite))}</td></tr>`).join('')}
        <tr class="totale"><td>Totale</td><td class="n">${esc(eur(T.entrate))}</td><td class="n">${esc(eur(T.uscite))}</td><td class="n">${esc(eur(T.fisse))}</td><td class="n">${esc(eur(ris))}</td></tr></tbody></table></div></section>

      <div class="colonne2">
        <section class="card"><h2>Dove vanno i soldi: spese per categoria</h2>${FG.ciambella(s.uscite_categorie.map((c) => ({ nome: c.nome, valore: Number(c.totale), colore: c.colore })), { centro: eur0(T.uscite) })}
          ${FG.barre(s.uscite_categorie.map((c) => ({ nome: c.nome, valore: Number(c.totale), colore: c.colore, nota: `${c.n} spese${c.tipo === 'fissa' ? ' · fissa' : ''}` })))}</section>
        <section class="card"><h2>Da dove arrivano: incassi per tipo</h2>${FG.ciambella(s.entrate_categorie.map((c) => ({ nome: c.nome, valore: Number(c.totale), colore: c.colore })), { centro: eur0(T.entrate) })}
          ${FG.barre(s.entrate_categorie.map((c) => ({ nome: c.nome, valore: Number(c.totale), colore: c.colore, nota: `${c.n} incassi` })))}</section>
      </div>

      <section class="card"><h2>Articoli venduti per categoria: quanto rende ognuna</h2>
        <p class="muted"><small>Ricavo al netto dell'IVA meno costo d'acquisto (conta solo le vendite fatte articolo per articolo o con le composizioni, non i totali di giornata).</small></p>
        ${art.length ? `<div class="tabella"><table><thead><tr><th>Categoria</th><th class="n">Quantità</th><th class="n">Incassato</th><th class="n">Netto IVA</th><th class="n">Costo merce</th><th class="n">Margine</th><th class="n">Margine %</th></tr></thead><tbody>
          ${art.map((c) => `<tr><td>${FG.pallino(c.colore)}${esc(c.nome)}</td><td class="n">${esc(num(c.quantita))}</td><td class="n">${esc(eur(c.ricavo))}</td><td class="n">${esc(eur(c.ricavo_netto))}</td><td class="n">${esc(eur(c.costo))}</td>
            <td class="n ${c.margine < 0 ? 'neg' : ''}"><b>${esc(eur(c.margine))}</b></td><td class="n">${esc(perc(Number(c.ricavo_netto) ? c.margine / Number(c.ricavo_netto) : null))}</td></tr>`).join('')}
          <tr class="totale"><td>Totale</td><td></td><td></td><td class="n">${esc(eur(ricArt))}</td><td></td><td class="n">${esc(eur(totArt))}</td><td class="n">${esc(perc(ricArt ? totArt / ricArt : null))}</td></tr></tbody></table></div>
          ${FG.barre(art.map((c) => ({ nome: c.nome, valore: Math.max(0, c.margine), colore: c.colore })), { formato: eur })}` : '<p class="muted">Nessuna vendita di articoli nel periodo.</p>'}</section>

      <div class="colonne2">
        <section class="card"><h2>I più venduti</h2>${s.top_articoli.length ? `<table class="mini"><thead><tr><th>Articolo</th><th class="n">Q.tà</th><th class="n">Incassato</th><th class="n">Margine</th></tr></thead><tbody>
          ${s.top_articoli.map((a) => `<tr><td>${esc(a.nome)}</td><td class="n">${esc(num(a.quantita))}</td><td class="n">${esc(eur(a.ricavo))}</td><td class="n ${a.margine < 0 ? 'neg' : ''}">${esc(eur(a.margine))}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nessun dato.</p>'}</section>
        <section class="card"><h2>Perdite: scarti e uso interno</h2>${s.scarti.length ? FG.barre(s.scarti.map((x) => ({ nome: x.nome + (x.tipo === 'uso' ? ' (uso interno)' : ''), valore: Number(x.valore), colore: x.colore, nota: num(x.quantita) + ' pezzi' })))
          + `<p class="muted"><small>Merce comprata nel periodo: ${esc(eur(s.acquisti_merce))} (al costo). ${s.acquisti_merce ? 'Scarti = ' + esc(perc(perdite / s.acquisti_merce)) + ' della merce comprata.' : ''}</small></p>` : '<p class="muted">Nessuno scarto registrato. 🌷</p>'}</section>
      </div>

      <div class="colonne2">
        <section class="card"><h2>Giorni della settimana</h2>${FG.barre(sett, { formato: eur })}</section>
        <section class="card"><h2>Come pagano i clienti</h2>${FG.barre(s.metodi.map((m, i) => ({ nome: cap(m.nome), valore: Number(m.totale), colore: ['#2f5d50', '#d9737f', '#e0a96d', '#6c8ebf', '#b07cc6', '#7fa05a', '#999999'][i % 7], nota: `${m.n} incassi` })))}</section>
      </div>

      <div class="colonne2">
        <section class="card"><h2>Fornitori: quanto si spende</h2>${FG.barre(s.fornitori.map((f) => ({ nome: f.nome, valore: Number(f.totale), colore: S.imp.colore_accento, nota: `${f.n} spese` })))}</section>
        <section class="card"><h2>Magazzino oggi</h2>${s.magazzino.length ? `<table class="mini"><thead><tr><th>Categoria</th><th class="n">Articoli</th><th class="n">Valore al costo</th><th class="n">Valore di vendita</th></tr></thead><tbody>
          ${s.magazzino.map((c) => `<tr><td>${FG.pallino(c.colore)}${esc(c.nome)}${c.sotto_scorta ? ` <small class="att">${c.sotto_scorta} sotto scorta</small>` : ''}</td><td class="n">${c.articoli}</td><td class="n">${esc(eur(c.valore))}</td><td class="n">${esc(eur(c.valore_vendita))}</td></tr>`).join('')}
          <tr class="totale"><td>Totale</td><td></td><td class="n">${esc(eur(s.magazzino.reduce((a, c) => a + Number(c.valore), 0)))}</td><td class="n">${esc(eur(s.magazzino.reduce((a, c) => a + Number(c.valore_vendita), 0)))}</td></tr></tbody></table>` : '<p class="muted">Magazzino vuoto.</p>'}</section>
      </div>

      <div class="colonne2">
        <section class="card"><h2>Ordini e preventivi</h2><dl class="dati"><dt>Ordini nel periodo</dt><dd>${s.ordini.n} · ${esc(eur(s.ordini.totale))}</dd><dt>Consegnati</dt><dd>${s.ordini.consegnati}</dd><dt>Annullati</dt><dd>${s.ordini.annullati}</dd>
          <dt>Preventivi</dt><dd>${s.ordini.preventivi}${s.ordini.preventivi ? ` · accettati ${s.ordini.accettati} (${esc(perc(s.ordini.accettati / s.ordini.preventivi))})` : ''}</dd></dl></section>
        ${ivaOk ? `<section class="card"><h2>IVA del periodo (indicativa)</h2><dl class="dati"><dt>IVA sulle vendite</dt><dd>${esc(eur(T.iva_entrate))}</dd><dt>IVA sugli acquisti e spese</dt><dd>${esc(eur(T.iva_uscite))}</dd>
          <dt>Differenza</dt><dd><b>${esc(eur(T.iva_entrate - T.iva_uscite))}</b> ${T.iva_entrate - T.iva_uscite >= 0 ? 'da versare' : 'a credito'}</dd><dt>Incassi al netto dell'IVA</dt><dd>${esc(eur(nettoEntrate))}</dd></dl>
          <p class="muted"><small>Stima dai dati inseriti: il conto vero lo fa il commercialista (detraibilità, registri, liquidazioni).</small></p></section>` : ''}
      </div>
      ${T.da_pagare ? `<p class="muted">Spese ancora da pagare (di qualsiasi periodo): <b>${esc(eur(T.da_pagare))}</b> · <a href="#/spese/da-pagare">vedi</a></p>` : ''}
      </div>`;
  };
  VIEWS.statistiche.dopo = (v) => {
    const f = $('#pf', v);
    $$('[data-k]', f).forEach((b) => (b.onclick = () => { P.chiave = b.dataset.k; [P.da, P.a] = periodo(P.chiave); render(); }));
    f.onchange = () => { if (f.da.value && f.a.value) { P.chiave = ''; P.da = f.da.value; P.a = f.a.value; render(); } };
    $('#st-stampa', v).onclick = () => stampa($('#st-corpo', v).innerHTML, `${S.imp.nome_attivita} · statistiche dal ${dataIt(P.da)} al ${dataIt(P.a)}`);
    $('#st-csv', v).onclick = async () => {
      const [ent, spe] = await Promise.all([get(`entrate_vista?data=gte.${P.da}&data=lte.${P.a}&metodo=not.ilike.altro&order=data,id`), get(`spese_vista?data=gte.${P.da}&data=lte.${P.a}&order=data,id`)]);
      csv(`incassi_${P.da}_${P.a}`, ['Data', 'Descrizione', 'Tipo', 'Cliente', 'Metodo', 'Documento', 'Numero', 'Totale', 'IVA', 'Imponibile'],
        ent.map((r) => [r.data, r.articoli || r.descrizione || '', r.categoria || '', r.cliente || '', r.metodo, r.documento, r.numero_documento || '', eurCsv(r.totale_cent), eurCsv(r.iva_cent), eurCsv(r.totale_cent - r.iva_cent)]));
      setTimeout(() => csv(`spese_${P.da}_${P.a}`, ['Data', 'Descrizione', 'Categoria', 'Fornitore', 'Numero documento', 'Totale', 'IVA', 'Imponibile', 'Pagamento', 'Pagata', 'Allegati'],
        spe.map((s) => [s.data, s.descrizione, s.categoria || '', s.fornitore || '', s.numero_documento || '', eurCsv(s.importo_cent), eurCsv(s.iva_cent), eurCsv(s.importo_cent - s.iva_cent), s.metodo, s.pagata ? 'sì' : 'no', s.allegati])), 600);
      FG.toast('Scaricati due file: incassi e spese (si aprono con Excel)');
    };
  };
})();
