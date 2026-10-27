/* Clienti (con ricorrenze da ricordare, ordini e quanto hanno speso) e fornitori. */
'use strict';
(() => {
  const { $, $$, esc, eur, oggi, dataIt, dataBreve, get, rest, S, isOwner, toast, apri, chiudi, conferma, occupato, vuoto, render, VIEWS, pill, vai, caricaComuni, MESI_LUNGHI, csv } = FG;

  // ------------------------------------------------------------ clienti
  const CAMPI_CLI = [
    { k: 'nome', l: 'Nome e cognome / ragione sociale', req: true, max: 120 },
    { k: 'tipo', l: 'Tipo', t: 'select', vuoto: false, o: [['privato', 'Privato'], ['azienda', 'Azienda'], ['ente', 'Ente / parrocchia / comune']], w: 2 },
    { k: 'telefono', l: 'Telefono', t: 'tel', max: 40, w: 2 }, { k: 'email', l: 'Email', t: 'email', max: 120, w: 2 },
    { k: 'cf_piva', l: 'Codice fiscale / P.IVA', max: 20, w: 2 }, { k: 'indirizzo', l: 'Indirizzo', max: 200 },
    { k: 'note', l: 'Note (gusti, fiori preferiti, allergie...)', t: 'textarea' },
  ];
  let cerca = '';
  VIEWS.clienti = async (args) => {
    if (/^\d+$/.test(args[0] || '')) return cliente(Number(args[0]));
    const lista = await get('clienti?order=nome&limit=5000');
    VIEWS.clienti.lista = lista;
    const q = cerca.trim().toLowerCase();
    const vis = lista.filter((c) => !q || [c.nome, c.telefono, c.email].some((x) => (x || '').toLowerCase().includes(q)));
    return `<header class="testa"><h1>Clienti</h1><div class="azioni"><button class="btn" type="button" id="c-csv"${lista.length ? '' : ' disabled'}>Scarica CSV</button><button class="btn primary" type="button" id="c-nuovo">+ Cliente</button></div></header>
      <div class="filtri"><label class="f"><span>Cerca</span><input type="search" id="c-q" value="${esc(cerca)}" placeholder="nome, telefono, email"></label></div>
      ${vis.length ? `<div class="tabella"><table><thead><tr><th>Cliente</th><th>Contatti</th><th>Note</th></tr></thead><tbody>
        ${vis.map((c) => `<tr data-id="${c.id}" tabindex="0"><td><b>${esc(c.nome)}</b>${c.tipo !== 'privato' ? ` <small class="muted">${esc(c.tipo)}</small>` : ''}</td>
          <td>${c.telefono ? esc(c.telefono) : ''}${c.email ? `<br><small class="muted">${esc(c.email)}</small>` : ''}</td><td><small>${esc((c.note || '').slice(0, 80))}</small></td></tr>`).join('')}</tbody></table></div>`
        : vuoto(lista.length ? 'Nessun cliente trovato.' : 'Nessun cliente ancora. I clienti servono per ordini, preventivi e ricorrenze da ricordare.')}`;
  };
  VIEWS.clienti.dopo = (v, args) => {
    if (/^\d+$/.test(args[0] || '')) return collegaCliente(v, Number(args[0]));
    const q = $('#c-q', v);
    q.oninput = () => { cerca = q.value; clearTimeout(q.t); q.t = setTimeout(() => render(true).then(() => { const n = $('#c-q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }), 250); };
    $('#c-nuovo', v).onclick = () => FG.scheda({ titolo: 'Nuovo cliente', tabella: 'clienti', fields: CAMPI_CLI, vals: { tipo: 'privato' }, dopo: (c) => vai('clienti/' + c.id) });
    $('#c-csv', v).onclick = () => csv('clienti_' + oggi(), ['Nome', 'Tipo', 'Telefono', 'Email', 'CF/P.IVA', 'Indirizzo', 'Note'], VIEWS.clienti.lista.map((c) => [c.nome, c.tipo, c.telefono || '', c.email || '', c.cf_piva || '', c.indirizzo || '', c.note || '']));
    $$('tr[data-id]', v).forEach((tr) => (tr.onclick = tr.onkeydown = (e) => { if (e.type === 'keydown' && e.key !== 'Enter') return; vai('clienti/' + tr.dataset.id); }));
  };

  async function cliente(id) {
    const [[c], ric, ordini, entrate] = await Promise.all([get('clienti?id=eq.' + id), get('ricorrenze?cliente_id=eq.' + id + '&order=mese,giorno'),
      get('ordini_vista?cliente_id=eq.' + id + '&order=data_consegna.desc&limit=50'), get('entrate?cliente_id=eq.' + id + '&select=totale_cent,data&order=data.desc')]);
    if (!c) return vuoto('Cliente non trovato.');
    VIEWS.clienti.c = c;
    const speso = entrate.reduce((a, e) => a + e.totale_cent, 0);
    return `<header class="testa"><div><a class="link" href="#/clienti">← Clienti</a><h1>${esc(c.nome)}</h1></div><div class="azioni"><button class="btn" type="button" id="cl-mod">Modifica</button></div></header>
      <div class="colonne2"><section class="card"><dl class="dati">
        ${c.telefono ? `<dt>Telefono</dt><dd><a href="tel:${esc(c.telefono.replace(/\s/g, ''))}">${esc(c.telefono)}</a> · <a target="_blank" rel="noopener noreferrer" href="https://wa.me/${esc(c.telefono.replace(/[^\d]/g, '').replace(/^(?!39)(3\d{8,9})$/, '39$1'))}">WhatsApp</a></dd>` : ''}
        ${c.email ? `<dt>Email</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd>` : ''}${c.indirizzo ? `<dt>Indirizzo</dt><dd>${esc(c.indirizzo)}</dd>` : ''}
        ${c.cf_piva ? `<dt>CF / P.IVA</dt><dd>${esc(c.cf_piva)}</dd>` : ''}${c.note ? `<dt>Note</dt><dd>${esc(c.note)}</dd>` : ''}
        <dt>Ha speso</dt><dd><b>${esc(eur(speso))}</b> in ${entrate.length} incassi${entrate[0] ? ` · ultimo ${esc(dataIt(entrate[0].data))}` : ''}</dd></dl></section>
      <section class="card"><h2>🎂 Ricorrenze da ricordare</h2>${ric.length ? `<ul class="lista compatta">${ric.map((r) => `<li>${esc(r.giorno)} ${esc(MESI_LUNGHI[r.mese - 1])}: <b>${esc(r.descrizione)}</b> <small class="muted">avviso ${r.preavviso} giorni prima</small> <button type="button" class="link neg" data-xr="${r.id}">togli</button></li>`).join('')}</ul>` : '<p class="muted">Nessuna. Es. «anniversario di matrimonio», «compleanno della moglie».</p>'}
        <form id="cl-ric" class="grid-form" novalidate><label class="f"><span>Cosa</span><input name="d" maxlength="120" placeholder="es. Anniversario di matrimonio"></label>
          <label class="f w3"><span>Giorno</span><input name="g" inputmode="numeric" maxlength="2"></label>
          <label class="f w3"><span>Mese</span><select name="m">${MESI_LUNGHI.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select></label>
          <label class="f w3"><span>Avvisa giorni prima</span><input name="p" inputmode="numeric" value="7"></label>
          <div class="azioni w1"><button class="btn sm" type="submit">+ Aggiungi</button></div></form></section></div>
      <section class="card"><h2>Ordini e preventivi</h2>${ordini.length ? `<ul class="lista">${ordini.map((o) => `<li><a href="#/ordini/${o.id}">${esc(dataBreve(o.data_consegna))} · ${esc(o.descrizione.slice(0, 90))}</a> ${pill(FG.STATI_ORD[o.stato], o.stato)} <b>${esc(eur(o.totale_cent))}</b></li>`).join('')}</ul>` : '<p class="muted">Nessun ordine.</p>'}</section>`;
  }
  function collegaCliente(v, id) {
    $('#cl-mod', v).onclick = () => FG.scheda({ titolo: 'Modifica cliente', tabella: 'clienti', fields: CAMPI_CLI, vals: VIEWS.clienti.c, dopo: (c) => (c ? render(true) : vai('clienti')) });
    $$('[data-xr]', v).forEach((b) => (b.onclick = async () => { try { await rest('DELETE', 'ricorrenze?id=eq.' + b.dataset.xr); render(true); } catch (e) { toast(e.message, 'err'); } }));
    const f = $('#cl-ric', v);
    f.onsubmit = (e) => {
      e.preventDefault();
      occupato(f.querySelector('[type=submit]'), async () => {
        const g = Number(f.g.value), m = Number(f.m.value), p = Number(f.p.value || 7);
        if (f.d.value.trim().length < 2 || !(g >= 1 && g <= new Date(2024, m, 0).getDate()) || !(p >= 0 && p <= 60)) return toast('Controlla descrizione, giorno e preavviso', 'err');
        try { await rest('POST', 'ricorrenze', { cliente_id: id, descrizione: f.d.value.trim(), giorno: g, mese: m, preavviso: p }, 'return=minimal'); toast('Ricorrenza aggiunta'); render(true); }
        catch (ex) { toast(ex.message, 'err'); }
      });
    };
  }

  // ------------------------------------------------------------ fornitori
  const CAMPI_FORN = [
    { k: 'nome', l: 'Nome', req: true, max: 120 }, { k: 'referente', l: 'Referente', max: 80, w: 2 }, { k: 'partita_iva', l: 'P.IVA', max: 20, w: 2 },
    { k: 'telefono', l: 'Telefono / WhatsApp', t: 'tel', max: 40, w: 2 }, { k: 'email', l: 'Email', t: 'email', max: 120, w: 2 },
    { k: 'indirizzo', l: 'Indirizzo', max: 200 }, { k: 'iban', l: 'IBAN', max: 40 },
    { k: 'note', l: 'Note (giorni di consegna, ordine minimo, orari...)', t: 'textarea' }, { k: 'attivo', l: 'Attivo', t: 'bool' },
  ];
  VIEWS.fornitori = async () => {
    const anno = oggi().slice(0, 4) + '-01-01';
    const [lista, bolle, spese] = await Promise.all([get('fornitori?order=attivo.desc,nome'), get('bolle?select=fornitore_id,data_arrivo&order=data_arrivo.desc&limit=5000'),
      isOwner() ? get(`spese?select=fornitore_id,importo_cent&data=gte.${anno}&fornitore_id=not.is.null`) : []]);
    VIEWS.fornitori.lista = lista;
    const ultima = {}, nb = {}, speso = {};
    for (const b of bolle) { if (!ultima[b.fornitore_id]) ultima[b.fornitore_id] = b.data_arrivo; nb[b.fornitore_id] = (nb[b.fornitore_id] || 0) + 1; }
    for (const s of spese) speso[s.fornitore_id] = (speso[s.fornitore_id] || 0) + s.importo_cent;
    return `<header class="testa"><h1>Fornitori</h1><button class="btn primary" type="button" id="f-nuovo">+ Fornitore</button></header>
      ${lista.length ? `<div class="tabella"><table><thead><tr><th>Fornitore</th><th>Contatti</th><th class="n">Bolle</th>${isOwner() ? '<th class="n">Speso quest\'anno</th>' : ''}</tr></thead><tbody>
        ${lista.map((f) => `<tr data-id="${f.id}" tabindex="0" class="${f.attivo ? '' : 'spenta'}"><td><b>${esc(f.nome)}</b>${f.referente ? `<br><small class="muted">${esc(f.referente)}</small>` : ''}${f.note ? `<br><small>${esc(f.note.slice(0, 80))}</small>` : ''}</td>
          <td>${f.telefono ? `<a href="tel:${esc(f.telefono.replace(/\s/g, ''))}">${esc(f.telefono)}</a>` : ''}${f.email ? `<br><small><a href="mailto:${esc(f.email)}">${esc(f.email)}</a></small>` : ''}</td>
          <td class="n">${nb[f.id] || 0}${ultima[f.id] ? `<br><small class="muted">ultima ${esc(dataIt(ultima[f.id]))}</small>` : ''}</td>${isOwner() ? `<td class="n">${esc(eur(speso[f.id] || 0))}</td>` : ''}</tr>`).join('')}</tbody></table></div>`
        : vuoto('Nessun fornitore. Aggiungi i grossisti, i vivai e chi ti manda le bollette (luce, telefono...).')}`;
  };
  VIEWS.fornitori.dopo = (v) => {
    const dopo = async () => { await caricaComuni(); render(true); };
    $('#f-nuovo', v).onclick = () => FG.scheda({ titolo: 'Nuovo fornitore', tabella: 'fornitori', fields: CAMPI_FORN, vals: { attivo: true }, dopo });
    $$('tr[data-id]', v).forEach((tr) => (tr.onclick = tr.onkeydown = (e) => { if (e.type === 'keydown' && e.key !== 'Enter') return;
      FG.scheda({ titolo: 'Fornitore', tabella: 'fornitori', fields: CAMPI_FORN, vals: VIEWS.fornitori.lista.find((f) => f.id === Number(tr.dataset.id)), dopo, cancella: isOwner() }); }));
  };
})();
