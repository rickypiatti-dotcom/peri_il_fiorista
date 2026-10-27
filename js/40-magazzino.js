/* Magazzino: articoli (piante, fiori, vasi...), movimenti e scarti, inventario, lista di riordino.
   Arrivi e bolle: ogni arrivo di merce è una bolla con numero, data e foto; la fattura del fornitore può raggruppare più bolle. */
'use strict';
(() => {
  const { $, $$, esc, eur, num, perc, cent, qty, oggi, dataIt, dataBreve, quando, addGiorni, get, rpc, rest, S, isOwner, toast, apri, chiudi, conferma, occupato,
    campi, leggi, catDi, catNome, schede, vuoto, render, VIEWS, euroInput, cap, pill, stampa, copia, csv, eurCsv, numCsv, vai, pallino } = FG;
  const tabs = (a) => schede('magazzino', [['', 'Articoli'], ['movimenti', 'Movimenti e scarti'], ['inventario', 'Inventario'], ['riordino', 'Lista di riordino']], a);
  const TIPI = { carico: 'Arrivo', vendita: 'Vendita', scarto: 'Scarto', uso: 'Uso interno', reso: 'Reso al fornitore', rettifica: 'Correzione inventario' };
  const fornOpz = () => S.fornitori.filter((f) => f.attivo).map((f) => [f.id, f.nome]);
  // prezzo consigliato: costo (IVA esclusa) × ricarico, IVA compresa, arrotondato a 50 centesimi
  const consigliato = (costo, aliquota) => (costo > 0 ? Math.round((costo * Number(S.imp.ricarico) * (1 + Number(aliquota) / 100)) / 50) * 50 : null);
  const margine = (p) => { const netto = p.prezzo_vendita_cent / (1 + Number(p.aliquota_iva) / 100); return netto > 0 ? (netto - p.prezzo_acquisto_cent) / netto : null; };

  // ------------------------------------------------------------ articoli
  const F = { cerca: '', cat: '', solo: '' };
  VIEWS.magazzino = async (args) => {
    if (args[0] === 'movimenti') return movimenti();
    if (args[0] === 'inventario') return inventario();
    if (args[0] === 'riordino') return riordino();
    const lista = await get('prodotti_vista?order=nome');
    VIEWS.magazzino.lista = lista;
    const q = F.cerca.trim().toLowerCase();
    const vis = lista.filter((p) => (F.solo === 'disattivi' ? !p.attivo : p.attivo) && (!F.cat || String(p.categoria_id) === F.cat)
      && (!q || p.nome.toLowerCase().includes(q) || (p.codice || '').toLowerCase().includes(q) || (p.nome_botanico || '').toLowerCase().includes(q))
      && (F.solo !== 'scorta' || p.sotto_scorta) && (F.solo !== 'controllare' || p.da_controllare));
    const valore = vis.reduce((a, p) => a + Number(p.valore_cent || 0), 0), tit = isOwner(); // costi, margini e valore: solo il titolare
    return `<header class="testa"><h1>Magazzino</h1><div class="azioni"><a class="btn" href="#/bolle/nuova">📦 Arrivo merce</a><button class="btn primary" type="button" id="a-nuovo">+ Articolo</button></div></header>${tabs('')}
      <form class="filtri" id="af"><label class="f"><span>Cerca</span><input type="search" name="cerca" value="${esc(F.cerca)}" placeholder="nome, codice, nome botanico"></label>
        <label class="f"><span>Categoria</span><select name="cat"><option value="">Tutte</option>${catDi('prodotto').map((c) => `<option value="${c.id}"${String(c.id) === F.cat ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
        <label class="f"><span>Mostra</span><select name="solo">${[['', 'Tutti gli attivi'], ['scorta', 'Sotto scorta'], ['controllare', 'Da controllare (deperibili)'], ['disattivi', 'Disattivati']].map(([k, t]) => `<option value="${k}"${k === F.solo ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <button type="button" class="btn sm" id="a-csv">Scarica CSV</button></form>
      <p class="muted">${vis.length} articoli${tit ? ` · valore al costo ${esc(eur(valore))}` : ''}</p>
      ${vis.length ? `<div class="tabella"><table><thead><tr><th>Articolo</th><th>Categoria</th><th class="n">Giacenza</th>${tit ? '<th class="n">Costo</th>' : ''}<th class="n">Prezzo</th>${tit ? '<th class="n">Margine</th><th class="n">Valore</th>' : ''}</tr></thead><tbody>
        ${vis.map((p) => `<tr data-id="${p.id}" tabindex="0"><td><b>${esc(p.nome)}</b>${p.nome_botanico ? `<br><small class="muted"><i>${esc(p.nome_botanico)}</i></small>` : ''}${p.codice ? `<br><small class="muted">${esc(p.codice)}</small>` : ''}</td>
          <td>${pallino(p.categoria_colore)}${esc(p.categoria || '—')}</td>
          <td class="n">${p.a_magazzino ? `<b class="${p.giacenza <= 0 ? 'neg' : p.sotto_scorta ? 'att' : ''}">${esc(num(p.giacenza))}</b> ${esc(p.unita)}${p.sotto_scorta ? '<br><small class="att">sotto scorta</small>' : ''}${p.da_controllare ? `<br><small class="neg">arrivati da ${p.giorni_da_carico} gg</small>` : ''}` : '<small class="muted">servizio</small>'}</td>
          ${tit ? `<td class="n">${esc(eur(p.prezzo_acquisto_cent))}</td>` : ''}<td class="n">${esc(eur(p.prezzo_vendita_cent))}</td>${tit ? `<td class="n">${esc(perc(margine(p)))}</td><td class="n">${esc(eur(p.valore_cent))}</td>` : ''}</tr>`).join('')}
        </tbody></table></div>` : vuoto(lista.length ? 'Nessun articolo con questi filtri.' : 'Il magazzino è vuoto: aggiungi il primo articolo o registra un arrivo di merce.')}`;
  };
  VIEWS.magazzino.dopo = (v, args) => {
    if (args[0] === 'inventario') return collegaInventario(v);
    if (args[0] === 'riordino') return collegaRiordino(v);
    if (args[0] === 'movimenti') return collegaMovimenti(v);
    const f = $('#af', v);
    f.onchange = () => { F.cat = f.cat.value; F.solo = f.solo.value; render(true); };
    f.cerca.oninput = () => { F.cerca = f.cerca.value; clearTimeout(f.t); f.t = setTimeout(() => { render(true).then(() => { const c = $('#af [name=cerca]'); if (c) { c.focus(); c.setSelectionRange(c.value.length, c.value.length); } }); }, 250); };
    f.onsubmit = (e) => e.preventDefault();
    $('#a-nuovo', v).onclick = () => articolo(null);
    $('#a-csv', v).onclick = () => (isOwner()
      ? csv('magazzino_' + oggi(), ['Articolo', 'Codice', 'Categoria', 'Fornitore', 'Unità', 'Giacenza', 'Scorta minima', 'Costo (IVA esclusa)', 'Prezzo (IVA inclusa)', 'IVA %', 'Valore al costo', 'Attivo'],
        VIEWS.magazzino.lista.map((p) => [p.nome, p.codice || '', p.categoria || '', p.fornitore || '', p.unita, numCsv(p.giacenza), numCsv(p.scorta), eurCsv(p.prezzo_acquisto_cent), eurCsv(p.prezzo_vendita_cent), numCsv(p.aliquota_iva), eurCsv(p.valore_cent), p.attivo ? 'sì' : 'no']))
      : csv('magazzino_' + oggi(), ['Articolo', 'Codice', 'Categoria', 'Fornitore', 'Unità', 'Giacenza', 'Scorta minima', 'Prezzo (IVA inclusa)', 'IVA %', 'Attivo'],
        VIEWS.magazzino.lista.map((p) => [p.nome, p.codice || '', p.categoria || '', p.fornitore || '', p.unita, numCsv(p.giacenza), numCsv(p.scorta), eurCsv(p.prezzo_vendita_cent), numCsv(p.aliquota_iva), p.attivo ? 'sì' : 'no'])));
    $$('tr[data-id]', v).forEach((tr) => (tr.onclick = tr.onkeydown = (e) => { if (e.type === 'keydown' && e.key !== 'Enter') return; articolo(VIEWS.magazzino.lista.find((p) => p.id === Number(tr.dataset.id))); }));
  };

  const CAMPI_ART = () => [
    { k: 'nome', l: 'Nome', req: true, max: 120 }, { k: 'codice', l: 'Codice / codice a barre', max: 40, w: 2 },
    { k: 'categoria_id', l: 'Categoria', t: 'select', num: true, o: catDi('prodotto').map((c) => [c.id, c.nome]), w: 2 },
    { k: 'fornitore_id', l: 'Fornitore abituale', t: 'select', num: true, o: fornOpz(), w: 2 },
    { k: 'unita', l: 'Unità', t: 'select', vuoto: false, o: S.imp.unita.map((u) => [u, u]), w: 2 },
    { sez: 'Prezzi' },
    ...(isOwner() ? [{ k: 'prezzo_acquisto_cent', l: 'Costo d\'acquisto (IVA esclusa)', t: 'money', w: 3, help: 'si aggiorna da solo con l\'ultima bolla' }] : []),
    { k: 'aliquota_iva', l: 'IVA', t: 'select', vuoto: false, o: [[10, '10% (piante e fiori)'], [22, '22% (vasi, accessori)'], [4, '4%'], [5, '5%'], [0, '0%']], w: 3 },
    { k: 'prezzo_vendita_cent', l: 'Prezzo di vendita (IVA inclusa)', t: 'money', w: 3 },
    { sez: 'Magazzino' },
    { k: 'a_magazzino', l: 'Si tiene a magazzino', t: 'bool', help: 'togli la spunta per i servizi (consegna, confezione regalo)' },
    { k: 'scorta_minima', l: 'Scorta minima', t: 'qty', w: 3, help: `vuoto = ${num(S.imp.scorta_minima)} (Impostazioni)` },
    { k: 'riordino', l: 'Quantità da riordinare', t: 'qty', w: 3, help: 'per la lista di riordino' },
    { k: 'deperibile', l: 'Deperibile (fiori recisi, verde)', t: 'bool', w: 3 },
    { k: 'giorni_vita', l: 'Dura circa (giorni)', t: 'int', w: 3, help: 'dopo, il cruscotto ricorda di controllarlo' },
    { sez: 'Scheda della pianta (facoltativa)' },
    { k: 'nome_botanico', l: 'Nome botanico', max: 120, w: 2 },
    { k: 'posizione', l: 'Dove sta', t: 'select', num: false, o: [['interno', 'Interno'], ['esterno', 'Esterno'], ['entrambi', 'Interno ed esterno']], w: 2 },
    { k: 'luce', l: 'Luce', t: 'select', o: [['sole', 'Sole pieno'], ['mezzombra', 'Mezz\'ombra'], ['ombra', 'Ombra']], w: 2 },
    { k: 'acqua', l: 'Acqua', t: 'select', o: [['poca', 'Poca'], ['media', 'Media'], ['molta', 'Molta']], w: 2 },
    { k: 'note', l: 'Note e consigli di cura', t: 'textarea' },
    { k: 'attivo', l: 'Attivo (si vede in cassa)', t: 'bool' },
  ];

  async function articolo(p) {
    const vals = p || { unita: S.imp.unita[0], aliquota_iva: Number(S.imp.aliquota_default), a_magazzino: true, attivo: true };
    const storico = p ? await get(`movimenti_vista?prodotto_id=eq.${p.id}&order=data.desc,id.desc&limit=30`) : [];
    const fields = CAMPI_ART();
    const extra = `${!p ? '<div class="grid-form"><label class="f w2"><span>Quantità che hai ora</span><input name="iniziale" inputmode="decimal" placeholder="0"></label></div>' : ''}
      <p class="suggerito muted" id="a-sugg"></p>
      ${p ? `<h3 class="sez">Giacenza: ${esc(num(p.giacenza))} ${esc(p.unita)}</h3>
        <div class="azioni sinistra"><button type="button" class="btn sm" data-mov="scarto">Scarto</button><button type="button" class="btn sm" data-mov="uso">Uso interno</button>
        <button type="button" class="btn sm" data-mov="reso">Reso</button><button type="button" class="btn sm" data-mov="rettifica">Correggi giacenza</button></div>
        ${storico.length ? `<table class="mini"><tbody>${storico.map((m) => `<tr><td>${esc(dataIt(m.data))}</td><td>${esc(TIPI[m.tipo])}${m.motivo ? ` <small class="muted">${esc(m.motivo)}</small>` : ''}</td><td class="n ${m.quantita < 0 ? 'neg' : 'pos'}">${m.quantita > 0 ? '+' : ''}${esc(num(m.quantita))}</td></tr>`).join('')}</tbody></table>` : ''}` : ''}`;
    const d = FG.scheda({ titolo: p ? p.nome : 'Nuovo articolo', tabella: 'prodotti', fields, vals, extra, cancella: isOwner(),
      dopo: async (salvato) => {
        const ini = d.querySelector('[name=iniziale]');
        if (!p && salvato && ini && qty(ini.value) > 0) await rpc('imposta_giacenza', { p_prodotto: salvato.id, p_contati: qty(ini.value), p_motivo: 'Giacenza iniziale' });
        render(true);
      } });
    d.classList.add('largo');
    const f = d.querySelector('form'), sugg = d.querySelector('#a-sugg');
    const aggiorna = () => {
      if (!f.prezzo_acquisto_cent) return; // commesso: niente costi né margini
      const c = cent(f.prezzo_acquisto_cent.value), v = cent(f.prezzo_vendita_cent.value), al = Number(f.aliquota_iva.value);
      const s = consigliato(c, al);
      const m = v > 0 && c >= 0 ? (v / (1 + al / 100) - c) / (v / (1 + al / 100)) : null;
      sugg.innerHTML = s ? `Prezzo consigliato con ricarico ×${esc(num(S.imp.ricarico))}: <b>${esc(eur(s))}</b> <button type="button" class="link" id="a-usa">usa</button>${m != null ? ` · margine attuale ${esc(perc(m))}` : ''}` : '';
      const u = sugg.querySelector('#a-usa'); if (u) u.onclick = () => { f.prezzo_vendita_cent.value = euroInput(s); aggiorna(); };
    };
    f.oninput = aggiorna; aggiorna();
    f.categoria_id.onchange = () => { const c = S.cats.find((x) => String(x.id) === f.categoria_id.value); if (c && c.aliquota != null && !p) f.aliquota_iva.value = Number(c.aliquota); aggiorna(); };
    $$('[data-mov]', d).forEach((b) => (b.onclick = () => movimento(p, b.dataset.mov)));
  }

  // scarto / uso interno / reso / correzione
  function movimento(p, tipo) {
    const corr = tipo === 'rettifica';
    const d = apri(`<h2>${esc(TIPI[tipo])}: ${esc(p.nome)}</h2><form novalidate class="grid-form">
      <label class="f w2"><span>${corr ? 'Quantità contata adesso' : 'Quantità'} (${esc(p.unita)})</span><input name="q" inputmode="decimal" required${corr ? ` value="${esc(String(p.giacenza).replace('.', ','))}"` : ''}></label>
      ${corr ? '' : `<label class="f w2"><span>Giorno</span><input type="date" name="data" value="${oggi()}" max="${oggi()}"></label>`}
      <label class="f"><span>Motivo</span><input name="motivo" maxlength="200" placeholder="${tipo === 'scarto' ? 'es. appassiti, rotti nel trasporto' : tipo === 'uso' ? 'es. composizione per la vetrina' : ''}"></label>
      <p class="muted w1">Ora: ${esc(num(p.giacenza))} ${esc(p.unita)}</p>
      <p class="alert err" hidden></p><div class="azioni"><button class="btn" type="button" data-no>Annulla</button><button class="btn primary" type="submit">Registra</button></div></form>`, 'piccolo');
    const f = d.querySelector('form'); d.querySelector('[data-no]').onclick = chiudi;
    f.onsubmit = (e) => {
      e.preventDefault();
      occupato(f.querySelector('[type=submit]'), async () => {
        const q = qty(f.q.value), err = f.querySelector('.alert');
        if (q == null || Number.isNaN(q) || q < 0 || (!corr && q === 0)) { err.textContent = 'Quantità non valida'; err.hidden = false; return; }
        try {
          if (corr) await rpc('imposta_giacenza', { p_prodotto: p.id, p_contati: q, p_motivo: f.motivo.value.trim() || null });
          else await rest('POST', 'movimenti', { prodotto_id: p.id, tipo, quantita: -q, data: f.data.value || oggi(), motivo: f.motivo.value.trim() || null }, 'return=minimal');
          chiudi(); toast('Registrato'); render(true);
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      });
    };
  }
  FG.movimento = movimento;

  // ------------------------------------------------------------ movimenti
  const M = { da: addGiorni(oggi(), -30), a: oggi(), tipo: '' };
  async function movimenti() {
    let q = `movimenti_vista?data=gte.${M.da}&data=lte.${M.a}&order=data.desc,id.desc&limit=3000`;
    if (M.tipo) q += '&tipo=eq.' + M.tipo;
    const lista = await get(q);
    movimenti.lista = lista;
    const perdite = lista.filter((m) => m.tipo === 'scarto').reduce((a, m) => a + Math.round(-m.quantita * (m.costo_unit_cent || 0)), 0), tit = isOwner();
    return `<header class="testa"><h1>Magazzino</h1><button class="btn primary" type="button" id="m-scarto">+ Registra scarto</button></header>${tabs('movimenti')}
      <form class="filtri" id="mf"><label class="f"><span>Dal</span><input type="date" name="da" value="${M.da}"></label><label class="f"><span>Al</span><input type="date" name="a" value="${M.a}"></label>
        <label class="f"><span>Tipo</span><select name="tipo"><option value="">Tutti</option>${Object.entries(TIPI).map(([k, t]) => `<option value="${k}"${k === M.tipo ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <button type="button" class="btn sm" id="m-csv"${lista.length ? '' : ' disabled'}>Scarica CSV</button></form>
      <p class="muted">${lista.length} movimenti${tit ? ` · scarti nel periodo: <b class="neg">${esc(eur(perdite))}</b> (al costo)` : ''}</p>
      ${lista.length ? `<div class="tabella"><table><thead><tr><th>Data</th><th>Articolo</th><th>Tipo</th><th class="n">Quantità</th>${tit ? '<th class="n">Valore</th>' : ''}</tr></thead><tbody>
        ${lista.map((m) => `<tr><td>${esc(dataIt(m.data))}</td><td>${esc(m.prodotto)}<br><small class="muted">${esc(m.categoria || '')}</small></td>
          <td>${esc(TIPI[m.tipo])}${m.motivo ? `<br><small class="muted">${esc(m.motivo)}</small>` : ''}${m.bolla_id ? `<br><a class="link" href="#/bolle/${m.bolla_id}">bolla ${esc(m.bolla_numero || '')}${m.fornitore ? ' · ' + esc(m.fornitore) : ''}</a>` : ''}</td>
          <td class="n ${m.quantita < 0 ? 'neg' : 'pos'}">${m.quantita > 0 ? '+' : ''}${esc(num(m.quantita))} ${esc(m.unita)}</td>${tit ? `<td class="n">${esc(eur(Math.round(Math.abs(m.quantita) * (m.costo_unit_cent || 0))))}</td>` : ''}</tr>`).join('')}
        </tbody></table></div>` : vuoto('Nessun movimento nel periodo.')}`;
  }
  function collegaMovimenti(v) {
    const f = $('#mf', v);
    f.onchange = () => { M.da = f.da.value || M.da; M.a = f.a.value || M.a; M.tipo = f.tipo.value; render(true); };
    const tit = isOwner();
    $('#m-csv', v).onclick = () => csv(`movimenti_${M.da}_${M.a}`, ['Data', 'Articolo', 'Categoria', 'Tipo', 'Quantità', 'Unità', ...(tit ? ['Costo unitario'] : []), 'Motivo', 'Bolla', 'Fornitore'],
      movimenti.lista.map((m) => [m.data, m.prodotto, m.categoria || '', TIPI[m.tipo], numCsv(m.quantita), m.unita, ...(tit ? [eurCsv(m.costo_unit_cent)] : []), m.motivo || '', m.bolla_numero || '', m.fornitore || '']));
    $('#m-scarto', v).onclick = async () => {
      const prodotti = await get('prodotti?attivo=is.true&a_magazzino=is.true&order=nome&select=id,nome,giacenza,unita');
      const d = apri(`<h2>Registra uno scarto</h2><label class="f"><span>Articolo</span><select id="ms-p"><option value="">Scegli…</option>${prodotti.map((p) => `<option value="${p.id}">${esc(p.nome)} (${esc(num(p.giacenza))} ${esc(p.unita)})</option>`).join('')}</select></label>`, 'piccolo');
      d.querySelector('#ms-p').onchange = (e) => { const p = prodotti.find((x) => String(x.id) === e.target.value); if (p) movimento(p, 'scarto'); };
    };
  }

  // ------------------------------------------------------------ inventario
  async function inventario() {
    const lista = await get('prodotti_vista?attivo=is.true&a_magazzino=is.true&order=categoria.nullslast,nome');
    inventario.lista = lista;
    let gruppo = null;
    return `<header class="testa"><h1>Magazzino</h1><div class="azioni"><button class="btn" type="button" id="i-stampa">🖨 Foglio da compilare</button><button class="btn primary" type="button" id="i-salva">Salva i conteggi</button></div></header>${tabs('inventario')}
      <p class="muted">Conta la merce e scrivi la quantità solo dove è diversa: salvando, il gestionale registra la correzione (con data e utente) e la giacenza diventa quella contata.</p>
      ${lista.length ? `<div class="tabella"><table><thead><tr><th>Articolo</th><th class="n">Nel gestionale</th><th class="n">Contati</th></tr></thead><tbody>
        ${lista.map((p) => { const t = p.categoria !== gruppo ? `<tr class="gruppo"><td colspan="3">${esc((gruppo = p.categoria) || 'Senza categoria')}</td></tr>` : '';
          return `${t}<tr><td>${esc(p.nome)}</td><td class="n">${esc(num(p.giacenza))} ${esc(p.unita)}</td><td class="n"><input class="q" inputmode="decimal" data-inv="${p.id}" aria-label="Contati ${esc(p.nome)}"></td></tr>`; }).join('')}
        </tbody></table></div>` : vuoto('Nessun articolo a magazzino.')}`;
  }
  function collegaInventario(v) {
    $('#i-stampa', v).onclick = () => stampa(`<table class="st-tab"><thead><tr><th>Articolo</th><th>Categoria</th><th>Nel gestionale</th><th>Contati</th></tr></thead><tbody>
      ${inventario.lista.map((p) => `<tr><td>${esc(p.nome)}</td><td>${esc(p.categoria || '')}</td><td class="n">${esc(num(p.giacenza))} ${esc(p.unita)}</td><td style="width:30%"></td></tr>`).join('')}</tbody></table>`, `Inventario del ${dataIt(oggi())}`);
    const b = $('#i-salva', v);
    b.onclick = () => occupato(b, async () => {
      const da = $$('[data-inv]', v).filter((i) => i.value.trim() !== '');
      if (!da.length) return toast('Scrivi almeno una quantità contata');
      const sbagliati = da.filter((i) => { const q = qty(i.value); return q == null || Number.isNaN(q) || q < 0; });
      if (sbagliati.length) { sbagliati[0].focus(); return toast('Una quantità non è valida', 'err'); }
      let n = 0;
      try {
        for (const i of da) { const delta = await rpc('imposta_giacenza', { p_prodotto: Number(i.dataset.inv), p_contati: qty(i.value), p_motivo: 'Inventario del ' + dataIt(oggi()) }); if (Number(delta)) n++; }
        toast(`Inventario salvato: ${n} ${n === 1 ? 'correzione' : 'correzioni'}`, 'ok'); render(true);
      } catch (ex) { toast(ex.message, 'err'); }
    });
  }

  // ------------------------------------------------------------ lista di riordino
  async function riordino() {
    const lista = await get('prodotti_vista?sotto_scorta=is.true&order=fornitore.nullslast,nome');
    const gruppi = new Map();
    for (const p of lista) {
      const k = p.fornitore_id || 0;
      if (!gruppi.has(k)) gruppi.set(k, { id: p.fornitore_id, nome: p.fornitore || 'Senza fornitore', voci: [] });
      const suggerita = p.riordino != null ? Number(p.riordino) : Math.max(1, Math.ceil(Number(p.scorta) * 2 - Math.max(0, Number(p.giacenza))));
      gruppi.get(k).voci.push({ ...p, suggerita });
    }
    riordino.gruppi = [...gruppi.values()];
    return `<header class="testa"><h1>Magazzino</h1></header>${tabs('riordino')}
      <p class="muted">Articoli arrivati alla scorta minima, divisi per fornitore. Correggi le quantità e copia il messaggio (WhatsApp, email) oppure stampalo. Quando la merce arriva, «Registra l'arrivo» prepara la bolla con questi articoli.</p>
      ${riordino.gruppi.length ? riordino.gruppi.map((g, gi) => `<section class="card"><h2>🚚 ${esc(g.nome)}</h2>
        <table class="mini"><thead><tr><th>Articolo</th><th class="n">Ora</th><th class="n">Minimo</th><th class="n">Da ordinare</th></tr></thead><tbody>
        ${g.voci.map((p, i) => `<tr><td>${esc(p.nome)}</td><td class="n ${p.giacenza <= 0 ? 'neg' : ''}">${esc(num(p.giacenza))}</td><td class="n">${esc(num(p.scorta))}</td>
          <td class="n"><input class="q" inputmode="decimal" data-g="${gi}" data-i="${i}" value="${esc(String(p.suggerita).replace('.', ','))}"> ${esc(p.unita)}</td></tr>`).join('')}</tbody></table>
        <div class="azioni sinistra"><button class="btn sm" type="button" data-copia="${gi}">📋 Copia il messaggio</button><button class="btn sm" type="button" data-stampa="${gi}">🖨 Stampa</button>
        <button class="btn sm primary" type="button" data-arrivo="${gi}">📦 Registra l'arrivo</button></div></section>`).join('') : vuoto('Nessun articolo sotto la scorta minima. 🌱')}`;
  }
  function collegaRiordino(v) {
    const quantita = (gi) => riordino.gruppi[gi].voci.map((p, i) => ({ ...p, q: qty($(`[data-g="${gi}"][data-i="${i}"]`, v).value) })).filter((p) => p.q > 0);
    const testo = (gi) => `Buongiorno${riordino.gruppi[gi].id ? '' : ''}, vorrei ordinare:\n${quantita(gi).map((p) => `- ${num(p.q)} ${p.unita} ${p.nome}${p.codice ? ' (cod. ' + p.codice + ')' : ''}`).join('\n')}\n\nGrazie, ${S.imp.nome_attivita}`;
    $$('[data-copia]', v).forEach((b) => (b.onclick = () => copia(testo(Number(b.dataset.copia)))));
    $$('[data-stampa]', v).forEach((b) => (b.onclick = () => { const gi = Number(b.dataset.stampa); stampa(`<pre class="st-pre">${esc(testo(gi))}</pre>`, 'Ordine a ' + riordino.gruppi[gi].nome); }));
    $$('[data-arrivo]', v).forEach((b) => (b.onclick = () => {
      const gi = Number(b.dataset.arrivo);
      FG.bozzaBolla = { fornitore_id: riordino.gruppi[gi].id, righe: quantita(gi).map((p) => ({ prodotto_id: p.id, quantita: p.q, costo: p.prezzo_acquisto_cent })) };
      vai('bolle/nuova');
    }));
  }

  // ============================================================ ARRIVI E BOLLE
  const B = { fornitore: '', stato: '' };
  VIEWS.bolle = async (args) => {
    if (args[0] === 'nuova') return nuovaBolla();
    if (/^\d+$/.test(args[0] || '')) return bolla(Number(args[0]));
    let q = 'bolle_vista?order=data_arrivo.desc,id.desc&limit=500';
    if (B.fornitore) q += '&fornitore_id=eq.' + B.fornitore;
    if (B.stato === 'aperte') q += '&spesa_id=is.null'; else if (B.stato === 'fatturate') q += '&spesa_id=not.is.null';
    const lista = await get(q);
    VIEWS.bolle.lista = lista;
    const tit = isOwner(); // totali e fatture: solo il titolare
    return `<header class="testa"><h1>Arrivi e bolle</h1><a class="btn primary" href="#/bolle/nuova">📦 Arrivo merce</a></header>
      <form class="filtri" id="bf"><label class="f"><span>Fornitore</span><select name="fornitore"><option value="">Tutti</option>${S.fornitori.map((f) => `<option value="${f.id}"${String(f.id) === B.fornitore ? ' selected' : ''}>${esc(f.nome)}</option>`).join('')}</select></label>
        <label class="f"${tit ? '' : ' hidden'}><span>Fattura</span><select name="stato">${[['', 'Tutte'], ['aperte', 'Senza fattura'], ['fatturate', 'Con fattura']].map(([k, t]) => `<option value="${k}"${k === B.stato ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        ${isOwner() ? '<button type="button" class="btn sm" id="b-fattura" disabled>🧾 Collega una fattura alle bolle scelte</button>' : ''}</form>
      ${lista.length ? `<div class="tabella"><table><thead><tr>${isOwner() ? '<th></th>' : ''}<th>Arrivata</th><th>Fornitore</th><th>Bolla</th><th class="n">Righe</th>${tit ? '<th class="n">Totale</th><th>Fattura</th>' : ''}</tr></thead><tbody>
        ${lista.map((b) => `<tr data-id="${b.id}" tabindex="0">${isOwner() ? `<td>${b.spesa_id ? '' : `<input type="checkbox" data-sel="${b.id}" data-f="${b.fornitore_id || 0}" aria-label="Scegli">`}</td>` : ''}
          <td>${esc(dataIt(b.data_arrivo))}</td><td>${esc(b.fornitore || '—')}</td><td>${esc(b.numero || '—')}${b.data_documento ? `<br><small class="muted">del ${esc(dataIt(b.data_documento))}</small>` : ''}${b.allegati ? ' 📎' : ''}</td>
          <td class="n">${b.righe}</td>${tit ? `<td class="n">${esc(eur(b.lordo_cent))}<br><small class="muted">${esc(eur(b.netto_cent))} + IVA</small></td>
          <td>${b.spesa_id ? pill('collegata', 'pos') : pill('da collegare', 'att')}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : vuoto('Nessuna bolla registrata.', '<a class="btn primary" href="#/bolle/nuova">Registra il primo arrivo</a>')}`;
  };
  VIEWS.bolle.dopo = (v, args) => {
    if (args[0] === 'nuova') return collegaNuovaBolla(v);
    if (/^\d+$/.test(args[0] || '')) return collegaBolla(v, Number(args[0]));
    const f = $('#bf', v);
    f.onchange = (e) => { if (e.target.dataset.sel) return; B.fornitore = f.fornitore.value; B.stato = f.stato.value; render(true); };
    $$('tr[data-id]', v).forEach((tr) => (tr.onclick = (e) => { if (e.target.closest('input')) return; vai('bolle/' + tr.dataset.id); }));
    const bf = $('#b-fattura', v);
    if (bf) {
      const scelte = () => $$('[data-sel]:checked', v);
      v.addEventListener('change', (e) => { if (e.target.dataset.sel) bf.disabled = !scelte().length; });
      bf.onclick = () => {
        const sel = scelte(); if (new Set(sel.map((x) => x.dataset.f)).size > 1) return toast('Scegli bolle dello stesso fornitore', 'err');
        fatturaBolle(sel.map((x) => Number(x.dataset.sel)));
      };
    }
  };

  // ------------------------------------------------------------ nuova bolla / arrivo merce
  let prodBolla = [];
  async function nuovaBolla() {
    prodBolla = await get('prodotti_vista?attivo=is.true&a_magazzino=is.true&order=nome&select=id,nome,unita,prezzo_acquisto_cent,aliquota_iva,fornitore_id,categoria_id');
    const bozza = FG.bozzaBolla || { righe: [] }; FG.bozzaBolla = null;
    nuovaBolla.righe = bozza.righe.length ? bozza.righe : [{ prodotto_id: null, quantita: null, costo: null }];
    const catSpesa = catDi('spesa').find((c) => c.nome.toLowerCase() === 'acquisto merce');
    return `<header class="testa"><div><a class="link" href="#/bolle">← Arrivi e bolle</a><h1>Arrivo merce</h1></div></header>
      <form id="nb" novalidate class="card"><div class="grid-form">
        <label class="f w2"><span>Fornitore</span><select name="fornitore_id"><option value="">—</option>${S.fornitori.filter((x) => x.attivo).map((x) => `<option value="${x.id}"${x.id === bozza.fornitore_id ? ' selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label>
        <label class="f w2"><span>Numero della bolla (DDT)</span><input name="numero" maxlength="60"></label>
        <label class="f w2"><span>Data della bolla</span><input type="date" name="data_documento" max="${oggi()}"></label>
        <label class="f w2"><span>Arrivata il *</span><input type="date" name="data" value="${oggi()}" max="${oggi()}" required></label>
        <label class="f"><span>Nota</span><input name="nota" maxlength="1000" placeholder="es. 2 scatole danneggiate, manca 1 vaso"></label></div>
      <h3 class="sez">Articoli arrivati ${isOwner() ? '<small class="muted">(costo IVA esclusa, come sulla bolla)</small>' : ''}</h3>
      <div id="nb-righe"></div>
      <div class="azioni sinistra"><button type="button" class="btn sm" id="nb-piu">+ Riga</button><button type="button" class="btn sm" id="nb-nuovo">+ Articolo nuovo</button>
        <span class="spazio"></span><span id="nb-tot"></span></div>
      ${isOwner() ? `<details class="sez-box" id="nb-sp"><summary>🧾 Registra anche la fattura o la spesa (facoltativo)</summary>
        <p class="muted">Se il fornitore manda una fattura a fine mese per più bolle, lascia stare: la colleghi dopo da «Arrivi e bolle».</p>
        <div class="grid-form"><label class="check"><input type="checkbox" name="con_spesa"> <span>Registra la spesa adesso</span></label>
        <label class="f w2"><span>Categoria</span><select name="sp_cat">${catDi('spesa').map((c) => `<option value="${c.id}"${catSpesa && c.id === catSpesa.id ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
        <label class="f w2"><span>Importo totale (IVA compresa)</span><div class="euro"><input name="sp_imp" inputmode="decimal" placeholder="calcolato dalle righe"><span>€</span></div></label>
        <label class="f w2"><span>Pagamento</span><select name="sp_met">${S.imp.metodi_spesa.map((m) => `<option>${esc(m)}</option>`).join('')}</select></label>
        <label class="check w2"><input type="checkbox" name="sp_pagata" checked> <span>Già pagata</span></label>
        <label class="f w2"><span>Scadenza (se da pagare)</span><input type="date" name="sp_scad"></label></div></details>` : ''}
      <label class="f"><span>Foto o PDF della bolla</span><input type="file" name="file" accept="image/*,application/pdf" capture="environment"></label>
      <p class="alert err" hidden></p><div class="azioni"><a class="btn" href="#/bolle">Annulla</a><button class="btn primary big" type="submit">Carica in magazzino</button></div></form>`;
  }
  function collegaNuovaBolla(v) {
    const f = $('#nb', v), righe = nuovaBolla.righe, err = f.querySelector('.alert'), tit = isOwner(); // il commesso: articoli e quantità, niente costi
    const opz = (sel) => prodBolla.map((p) => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${esc(p.nome)} (${esc(p.unita)})</option>`).join('');
    const disegna = () => {
      $('#nb-righe', v).innerHTML = righe.map((r, i) => `<div class="voce"><select data-rp="${i}" aria-label="Articolo"><option value="">Scegli l'articolo…</option>${opz(r.prodotto_id)}</select>
        <input data-rq="${i}" class="q" inputmode="decimal" placeholder="q.tà" value="${esc(r.quantita == null ? '' : String(r.quantita).replace('.', ','))}" aria-label="Quantità">
        ${tit ? `<div class="euro sm"><input data-rc="${i}" inputmode="decimal" placeholder="costo" value="${esc(euroInput(r.costo))}" aria-label="Costo unitario"><span>€</span></div>` : ''}
        <button type="button" class="link neg" data-rx="${i}" aria-label="Togli">✕</button></div>`).join('');
      $$('[data-rp]', v).forEach((s) => (s.onchange = () => { const r = righe[s.dataset.rp], p = prodBolla.find((x) => String(x.id) === s.value); r.prodotto_id = p ? p.id : null; if (p && r.costo == null) r.costo = p.prezzo_acquisto_cent || null; disegna(); }));
      $$('[data-rq]', v).forEach((s) => (s.oninput = () => { righe[s.dataset.rq].quantita = qty(s.value); totali(); }));
      $$('[data-rc]', v).forEach((s) => (s.oninput = () => { righe[s.dataset.rc].costo = cent(s.value); totali(); }));
      $$('[data-rx]', v).forEach((s) => (s.onclick = () => { righe.splice(s.dataset.rx, 1); if (!righe.length) righe.push({ prodotto_id: null, quantita: null, costo: null }); disegna(); }));
      totali();
    };
    const calcola = () => {
      let netto = 0, iva = 0;
      for (const r of righe) { const p = prodBolla.find((x) => x.id === r.prodotto_id); if (p && r.quantita > 0 && r.costo > 0) { const t = r.quantita * r.costo; netto += t; iva += (t * Number(p.aliquota_iva)) / 100; } }
      return { netto: Math.round(netto), iva: Math.round(iva) };
    };
    const totali = () => { if (!tit) return; const { netto, iva } = calcola(); $('#nb-tot', v).innerHTML = `Imponibile <b>${esc(eur(netto))}</b> · IVA ${esc(eur(iva))} · totale <b>${esc(eur(netto + iva))}</b>`; };
    disegna();
    f.fornitore_id.onchange = () => { // fornitore scelto: gli articoli suoi in cima
      const id = Number(f.fornitore_id.value) || null;
      prodBolla.sort((a, b) => (b.fornitore_id === id) - (a.fornitore_id === id) || a.nome.localeCompare(b.nome)); disegna();
    };
    $('#nb-piu', v).onclick = () => { righe.push({ prodotto_id: null, quantita: null, costo: null }); disegna(); };
    $('#nb-nuovo', v).onclick = () => {
      const d = apri(`<h2>Articolo nuovo</h2><form novalidate class="grid-form">
        <label class="f"><span>Nome *</span><input name="nome" maxlength="120" required></label>
        <label class="f w2"><span>Categoria</span><select name="cat">${catDi('prodotto').map((c) => `<option value="${c.id}" data-al="${c.aliquota ?? ''}">${esc(c.nome)}</option>`).join('')}</select></label>
        <label class="f w2"><span>Unità</span><select name="unita">${S.imp.unita.map((u) => `<option>${esc(u)}</option>`).join('')}</select></label>
        <label class="f w2"><span>Prezzo di vendita (IVA inclusa)</span><div class="euro"><input name="pv" inputmode="decimal"><span>€</span></div></label>
        <label class="check w2"><input type="checkbox" name="dep"> <span>Deperibile</span></label>
        <p class="alert err" hidden></p><div class="azioni"><button type="button" class="btn" data-no>Annulla</button><button class="btn primary" type="submit">Crea e aggiungi</button></div></form>`, 'piccolo');
      const nf = d.querySelector('form'); d.querySelector('[data-no]').onclick = chiudi;
      nf.onsubmit = (e) => {
        e.preventDefault();
        occupato(nf.querySelector('[type=submit]'), async () => {
          try {
            const c = S.cats.find((x) => String(x.id) === nf.cat.value), pv = cent(nf.pv.value);
            if (Number.isNaN(pv)) throw new Error('Prezzo non valido');
            const [p] = await rest('POST', 'prodotti', { nome: nf.nome.value.trim(), categoria_id: c ? c.id : null, unita: nf.unita.value, prezzo_vendita_cent: pv || 0,
              aliquota_iva: c && c.aliquota != null ? Number(c.aliquota) : Number(S.imp.aliquota_default), deperibile: nf.dep.checked, fornitore_id: Number(f.fornitore_id.value) || null });
            prodBolla.unshift({ id: p.id, nome: p.nome, unita: p.unita, prezzo_acquisto_cent: 0, aliquota_iva: p.aliquota_iva, fornitore_id: p.fornitore_id });
            const vuota = righe.find((r) => !r.prodotto_id); if (vuota) vuota.prodotto_id = p.id; else righe.push({ prodotto_id: p.id, quantita: null, costo: null });
            chiudi(); disegna();
          } catch (ex) { const a = nf.querySelector('.alert'); a.textContent = ex.message; a.hidden = false; }
        });
      };
    };
    f.onsubmit = (e) => {
      e.preventDefault();
      occupato(f.querySelector('[type=submit]'), async () => {
        err.hidden = true;
        try {
          const buone = righe.filter((r) => r.prodotto_id);
          if (!buone.length) throw new Error('Aggiungi almeno un articolo');
          for (const r of buone) {
            if (!(r.quantita > 0)) throw new Error('Manca la quantità di «' + prodBolla.find((p) => p.id === r.prodotto_id).nome + '»');
            if (Number.isNaN(r.costo) || r.costo < 0) throw new Error('Un costo non è valido');
          }
          const file = f.file.files[0];
          if (file && file.size > 8 * 1024 * 1024) throw new Error('Il file è troppo grande (massimo 8 MB)');
          const p = { fornitore_id: Number(f.fornitore_id.value) || null, numero_documento: f.numero.value, data_documento: f.data_documento.value || null, data: f.data.value || oggi(),
            nota: f.nota.value, righe: buone.map((r) => ({ prodotto_id: r.prodotto_id, quantita: r.quantita, costo_unit_cent: tit ? r.costo ?? null : null })) };
          if (f.con_spesa && f.con_spesa.checked) {
            const imp = cent(f.sp_imp.value); if (Number.isNaN(imp)) throw new Error('Importo della spesa non valido');
            const { netto, iva } = calcola();
            p.spesa = { categoria_id: Number(f.sp_cat.value) || null, metodo: f.sp_met.value, pagata: f.sp_pagata.checked, scadenza: f.sp_pagata.checked ? null : f.sp_scad.value || null,
              importo_cent: imp ?? netto + iva, iva_cent: imp != null && netto + iva > 0 ? Math.round((iva * imp) / (netto + iva)) : iva };
          }
          const r = await rpc('registra_carico', { p });
          if (file) { try { await FG.caricaAllegato(file, 'bolla', r.bolla_id); } catch (ex) { toast('Bolla salvata, ma la foto non è stata caricata: ' + ex.message, 'err'); } }
          toast(`Caricati ${r.righe} articoli in magazzino`, 'ok'); vai('bolle/' + r.bolla_id);
        } catch (ex) { err.textContent = ex.message; err.hidden = false; err.scrollIntoView({ block: 'center' }); }
      });
    };
  }

  // ------------------------------------------------------------ scheda bolla
  async function bolla(id) {
    const [[b], righe, all] = await Promise.all([get('bolle_vista?id=eq.' + id), get(`movimenti_vista?bolla_id=eq.${id}&order=id`), get('allegati?bolla_id=eq.' + id + '&select=id,nome,tipo,dimensione')]);
    if (!b) return vuoto('Bolla non trovata.');
    let spesa = null;
    if (b.spesa_id && isOwner()) [spesa] = await get('spese?id=eq.' + b.spesa_id + '&select=id,descrizione,importo_cent,pagata,numero_documento');
    bolla.b = b;
    const tit = isOwner(); // costi, totali e fattura: solo il titolare
    return `<header class="testa"><div><a class="link" href="#/bolle">← Arrivi e bolle</a><h1>Bolla ${esc(b.numero || 'senza numero')} · ${esc(b.fornitore || 'fornitore non indicato')}</h1></div>
      <div class="azioni">${isOwner() && !b.spesa_id ? '<button class="btn" data-a="fattura">🧾 Collega fattura</button>' : ''}<button class="btn" data-a="modifica">Modifica dati</button></div></header>
      <div class="colonne2"><section class="card"><dl class="dati"><dt>Arrivata il</dt><dd>${esc(dataIt(b.data_arrivo))}</dd>${b.data_documento ? `<dt>Data della bolla</dt><dd>${esc(dataIt(b.data_documento))}</dd>` : ''}
        ${b.nota ? `<dt>Nota</dt><dd>${esc(b.nota)}</dd>` : ''}<dt>Inserita</dt><dd>${esc(quando(b.creato_il))}</dd>
        ${tit ? `<dt>Fattura</dt><dd>${spesa ? `<a href="#/spese/${spesa.id}">${esc(spesa.descrizione)}${spesa.numero_documento ? ' n. ' + esc(spesa.numero_documento) : ''}</a> · ${esc(eur(spesa.importo_cent))} ${spesa.pagata ? pill('pagata', 'pos') : pill('da pagare', 'att')}` : b.spesa_id ? 'collegata' : pill('non ancora collegata', 'att')}</dd>` : ''}</dl>
        <table class="mini"><thead><tr><th>Articolo</th><th class="n">Quantità</th>${tit ? '<th class="n">Costo</th><th class="n">Totale</th>' : ''}</tr></thead><tbody>
        ${righe.map((m) => `<tr><td>${esc(m.prodotto)}</td><td class="n">${esc(num(m.quantita))} ${esc(m.unita)}</td>${tit ? `<td class="n">${esc(eur(m.costo_unit_cent))}</td><td class="n">${esc(eur(Math.round(m.quantita * (m.costo_unit_cent || 0))))}</td>` : ''}</tr>`).join('')}</tbody></table>
        ${tit ? `<p class="carr-totale"><span>Imponibile ${esc(eur(b.netto_cent))}</span><b>${esc(eur(b.lordo_cent))}</b></p>` : ''}</section>
      <section class="card"><h2>📎 Foto e documenti</h2>${all.length ? `<ul class="lista compatta">${all.map((a) => `<li><button type="button" class="link" data-all="${esc(a.id)}">${esc(a.nome)}</button> <small class="muted">${Math.round(a.dimensione / 1024)} KB</small> <button type="button" class="link neg" data-togli="${esc(a.id)}">togli</button></li>`).join('')}</ul>` : '<p class="muted">Nessuna foto.</p>'}
        <label class="f"><span>Aggiungi foto o PDF</span><input type="file" id="b-file" accept="image/*,application/pdf" capture="environment"></label></section></div>
      <div class="azioni sinistra"><button class="btn danger ghost sm" data-a="annulla">Annulla la bolla</button></div>`;
  }
  function collegaBolla(v, id) {
    const b = bolla.b;
    $$('[data-all]', v).forEach((x) => (x.onclick = () => FG.apriAllegato(x.dataset.all)));
    $$('[data-togli]', v).forEach((x) => (x.onclick = async () => { if (await conferma('Togliere questo allegato?', 'Togli')) { try { await rest('DELETE', 'allegati?id=eq.' + x.dataset.togli); render(true); } catch (e) { toast(e.message, 'err'); } } }));
    $('#b-file', v).onchange = async (e) => { const file = e.target.files[0]; if (!file) return; try { await FG.caricaAllegato(file, 'bolla', id); toast('Caricato'); render(true); } catch (ex) { toast(ex.message, 'err'); } };
    $$('[data-a]', v).forEach((x) => (x.onclick = async () => {
      const a = x.dataset.a;
      if (a === 'fattura') return fatturaBolle([id]);
      if (a === 'modifica') return FG.scheda({ titolo: 'Dati della bolla', tabella: 'bolle', cancella: false, vals: b, fields: [
        { k: 'fornitore_id', l: 'Fornitore', t: 'select', num: true, o: S.fornitori.map((f) => [f.id, f.nome]), w: 2 }, { k: 'numero', l: 'Numero', max: 60, w: 2 },
        { k: 'data_documento', l: 'Data della bolla', t: 'date', w: 2 }, { k: 'data_arrivo', l: 'Arrivata il', t: 'date', req: true, w: 2 }, { k: 'nota', l: 'Nota', t: 'textarea' }] });
      if (a === 'annulla') {
        if (!(await conferma('Annullare la bolla? La merce viene tolta dal magazzino. Le foto vengono cancellate.', 'Annulla la bolla'))) return;
        try { await rpc('annulla_bolla', { p_id: id }); toast('Bolla annullata'); vai('bolle'); } catch (e) { toast(e.message, 'err'); }
      }
    }));
  }

  // fattura del fornitore per una o più bolle
  async function fatturaBolle(ids) {
    const bolle = await get(`bolle_vista?id=in.(${ids.join(',')})`);
    const forn = bolle[0]?.fornitore_id;
    const spese = forn ? await get(`spese?fornitore_id=eq.${forn}&order=data.desc&limit=30&select=id,data,descrizione,importo_cent,numero_documento`) : [];
    const tot = bolle.reduce((a, b) => a + Number(b.lordo_cent), 0);
    const d = apri(`<h2>Fattura per ${bolle.length} ${bolle.length === 1 ? 'bolla' : 'bolle'}</h2>
      <p class="muted">${bolle.map((b) => `${esc(b.numero || 's.n.')} del ${esc(dataIt(b.data_documento || b.data_arrivo))}`).join(' · ')} — totale delle bolle ${esc(eur(tot))}</p>
      <form novalidate class="grid-form">
        ${spese.length ? `<label class="f"><span>La fattura è già tra le spese?</span><select name="esistente"><option value="">No, registrala adesso</option>${spese.map((s) => `<option value="${s.id}">${esc(dataIt(s.data))} · ${esc(s.descrizione)} · ${esc(eur(s.importo_cent))}</option>`).join('')}</select></label>` : ''}
        <div class="nuova w1"><div class="grid-form">
          <label class="f w2"><span>Numero fattura</span><input name="num" maxlength="60"></label>
          <label class="f w2"><span>Data fattura</span><input type="date" name="data" value="${oggi()}"></label>
          <label class="f w2"><span>Totale (IVA compresa)</span><div class="euro"><input name="imp" inputmode="decimal" value="${esc(euroInput(tot))}"><span>€</span></div><small>controlla con la fattura: può avere trasporto o sconti</small></label>
          <label class="f w2"><span>IVA</span><div class="euro"><input name="iva" inputmode="decimal" value="${esc(euroInput(bolle.reduce((a, b) => a + Number(b.lordo_cent) - Number(b.netto_cent), 0)))}"><span>€</span></div></label>
          <label class="f w2"><span>Pagamento</span><select name="met">${S.imp.metodi_spesa.map((m) => `<option>${esc(m)}</option>`).join('')}</select></label>
          <label class="check w2"><input type="checkbox" name="pagata"> <span>Già pagata</span></label>
          <label class="f w2"><span>Scadenza</span><input type="date" name="scad" value="${addGiorni(oggi(), 30)}"></label></div></div>
        <p class="alert err" hidden></p><div class="azioni"><button class="btn" type="button" data-no>Annulla</button><button class="btn primary" type="submit">Collega</button></div></form>`);
    const f = d.querySelector('form'); d.querySelector('[data-no]').onclick = chiudi;
    if (f.esistente) f.esistente.onchange = () => { f.querySelector('.nuova').hidden = !!f.esistente.value; };
    f.onsubmit = (e) => {
      e.preventDefault();
      occupato(f.querySelector('[type=submit]'), async () => {
        const err = f.querySelector('.alert');
        try {
          let p;
          if (f.esistente && f.esistente.value) p = { spesa_id: Number(f.esistente.value) };
          else {
            const imp = cent(f.imp.value), iva = cent(f.iva.value);
            if (!(imp >= 0) || Number.isNaN(iva) || iva > imp) throw new Error('Controlla totale e IVA');
            p = { numero_documento: f.num.value, data: f.data.value || oggi(), importo_cent: imp, iva_cent: iva || 0, metodo: f.met.value, pagata: f.pagata.checked, scadenza: f.pagata.checked ? null : f.scad.value || null };
          }
          await rpc('fattura_bolle', { p_bolle: ids, p });
          chiudi(); toast('Fattura collegata', 'ok'); render(true);
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      });
    };
  }
})();
