/* Spese (solo titolare): tutte le uscite con fatture e foto allegate, spese da pagare, spese ricorrenti (affitto, TARI, luce...). */
'use strict';
(() => {
  const { $, $$, esc, eur, num, cent, oggi, dataIt, dataBreve, addGiorni, get, getTutti, righeVisibili, notaRighe, rpc, rest, S, toast, apri, chiudi, conferma, occupato,
    catDi, schede, vuoto, render, VIEWS, euroInput, pill, csv, eurCsv, vai, pallino, giorniTra } = FG;
  const tabs = (a) => schede('spese', [['', 'Tutte le spese'], ['da-pagare', 'Da pagare'], ['ricorrenti', 'Spese ricorrenti']], a);
  const OGNI = { 1: 'ogni mese', 2: 'ogni 2 mesi', 3: 'ogni 3 mesi', 4: 'ogni 4 mesi', 6: 'ogni 6 mesi', 12: 'ogni anno' };
  const meseInizio = () => oggi().slice(0, 8) + '01';
  const F = { da: meseInizio(), a: oggi(), cat: '', forn: '', tipo: '', cerca: '' };

  VIEWS.spese = async (args) => {
    if (args[0] === 'ricorrenti') return ricorrenti();
    const daPagare = args[0] === 'da-pagare';
    let q = 'spese_vista?order=' + (daPagare ? 'scadenza.asc.nullslast,data,id' : 'data.desc,id.desc');
    if (daPagare) q += '&pagata=is.false';
    else {
      q += `&data=gte.${F.da}&data=lte.${F.a}`;
      if (F.cat) q += '&categoria_id=eq.' + F.cat;
      if (F.forn) q += '&fornitore_id=eq.' + F.forn;
      if (F.tipo) q += '&categoria_tipo=eq.' + F.tipo;
      if (F.cerca.trim()) q += '&or=(descrizione.ilike.*' + encodeURIComponent(F.cerca.trim().replace(/[*,()]/g, ' ')) + '*,numero_documento.ilike.*' + encodeURIComponent(F.cerca.trim().replace(/[*,()]/g, ' ')) + '*)';
    }
    const lista = await getTutti(q);
    VIEWS.spese.lista = lista;
    const tot = lista.reduce((a, s) => a + s.importo_cent, 0), iva = lista.reduce((a, s) => a + s.iva_cent, 0);
    const t = oggi();
    const id = /^\d+$/.test(args[0] || '') ? Number(args[0]) : null;
    if (id) setTimeout(() => apriSpesa(id), 0);
    return `<header class="testa"><h1>Spese</h1><button class="btn primary" type="button" id="s-nuova">+ Spesa</button></header>${tabs(daPagare ? 'da-pagare' : '')}
      ${daPagare ? '' : `<form class="filtri" id="sf">
        <label class="f"><span>Dal</span><input type="date" name="da" value="${F.da}"></label><label class="f"><span>Al</span><input type="date" name="a" value="${F.a}"></label>${FG.cercaDate}
        <label class="f"><span>Categoria</span><select name="cat"><option value="">Tutte</option>${catDi('spesa', false).map((c) => `<option value="${c.id}"${String(c.id) === F.cat ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
        <label class="f"><span>Fornitore</span><select name="forn"><option value="">Tutti</option>${S.fornitori.map((f) => `<option value="${f.id}"${String(f.id) === F.forn ? ' selected' : ''}>${esc(f.nome)}</option>`).join('')}</select></label>
        <label class="f"><span>Tipo</span><select name="tipo">${[['', 'Fisse e variabili'], ['fissa', 'Solo fisse'], ['variabile', 'Solo variabili']].map(([k, x]) => `<option value="${k}"${k === F.tipo ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="f"><span>Cerca</span><input type="search" name="cerca" value="${esc(F.cerca)}" placeholder="descrizione o numero"></label>
        <div class="rapidi"><button type="button" class="chip" data-p="mese">Questo mese</button><button type="button" class="chip" data-p="scorso">Mese scorso</button><button type="button" class="chip" data-p="anno">Quest'anno</button></div>
        <button type="button" class="btn sm" id="s-csv"${lista.length ? '' : ' disabled'}>Scarica CSV</button></form>`}
      <section class="kpi"><div class="kpi-box"><span>${daPagare ? 'Da pagare' : 'Totale spese'}</span><b>${esc(eur(tot))}</b><small>${lista.length} spese · IVA ${esc(eur(iva))}</small></div>
        ${daPagare ? `<div class="kpi-box neg"><span>Già scadute</span><b>${esc(eur(lista.filter((s) => s.scadenza && s.scadenza < t).reduce((a, s) => a + s.importo_cent, 0)))}</b></div>` : ''}</section>
      ${notaRighe(lista)}${lista.length ? `<div class="tabella"><table><thead><tr><th>Data</th><th>Spesa</th><th>Categoria</th><th>Pagamento</th><th class="n">Importo</th></tr></thead><tbody>
        ${righeVisibili(lista).map((s) => `<tr data-id="${s.id}" tabindex="0"><td>${esc(dataIt(s.data))}</td>
          <td><b>${esc(s.descrizione)}</b>${s.fornitore ? `<br><small class="muted">${esc(s.fornitore)}</small>` : ''}${s.numero_documento ? `<br><small class="muted">n. ${esc(s.numero_documento)}</small>` : ''}${s.allegati ? ' 📎' : ''}${s.bolle ? ` <small class="muted">· ${s.bolle} bolle</small>` : ''}</td>
          <td>${pallino(s.categoria_colore)}${esc(s.categoria || '—')}${s.categoria_tipo === 'fissa' ? ' <small class="muted">fissa</small>' : ''}</td>
          <td>${esc(s.metodo)}<br>${s.pagata ? '<small class="pos">pagata</small>' : `<small class="${s.scadenza && s.scadenza < t ? 'neg' : 'att'}">da pagare${s.scadenza ? ' entro ' + esc(dataBreve(s.scadenza)) : ''}</small>`}</td>
          <td class="n"><b>${esc(eur(s.importo_cent))}</b>${s.iva_cent ? `<br><small class="muted">IVA ${esc(eur(s.iva_cent))}</small>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : vuoto(daPagare ? 'Nessuna spesa da pagare. 👍' : 'Nessuna spesa nel periodo.')}`;
  };
  VIEWS.spese.dopo = (v, args) => {
    if (args[0] === 'ricorrenti') return collegaRicorrenti(v);
    $('#s-nuova', v).onclick = () => modulo(null);
    $$('tr[data-id]', v).forEach((tr) => (tr.onclick = tr.onkeydown = (e) => { if (e.type === 'keydown' && e.key !== 'Enter') return; apriSpesa(Number(tr.dataset.id)); }));
    const f = $('#sf', v); if (!f) return;
    f.onchange = (e) => { if (e.target.name === 'cerca') return; F.da = f.da.value || F.da; F.a = f.a.value || F.a; F.cat = f.cat.value; F.forn = f.forn.value; F.tipo = f.tipo.value; render(true); };
    f.cerca.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); F.cerca = f.cerca.value; render(true); } };
    f.cerca.onsearch = () => { F.cerca = f.cerca.value; render(true); };
    $$('[data-p]', f).forEach((b) => (b.onclick = () => {
      const t = oggi(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
      if (b.dataset.p === 'mese') { F.da = meseInizio(); F.a = t; }
      else if (b.dataset.p === 'scorso') { const d = new Date(y, m - 2, 1); F.da = FG.iso(d); F.a = FG.iso(new Date(y, m - 1, 0)); }
      else { F.da = y + '-01-01'; F.a = t; }
      render(true);
    }));
    $('#s-csv', v).onclick = () => csv(`spese_${F.da}_${F.a}`, ['Data', 'Descrizione', 'Categoria', 'Tipo', 'Fornitore', 'Numero documento', 'Importo', 'IVA', 'Imponibile', 'Pagamento', 'Pagata', 'Scadenza', 'Allegati', 'Nota'],
      VIEWS.spese.lista.map((s) => [s.data, s.descrizione, s.categoria || '', s.categoria_tipo || '', s.fornitore || '', s.numero_documento || '', eurCsv(s.importo_cent), eurCsv(s.iva_cent), eurCsv(s.importo_cent - s.iva_cent), s.metodo, s.pagata ? 'sì' : 'no', s.scadenza || '', s.allegati, s.nota || '']));
  };

  async function apriSpesa(id) {
    const [s] = await get('spese_vista?id=eq.' + id);
    if (s) modulo(s);
  }

  // ------------------------------------------------------------ modulo spesa
  async function modulo(s) {
    const allegati = s ? await get('allegati?spesa_id=eq.' + s.id + '&select=id,nome,dimensione') : [];
    const bolle = s && s.bolle ? await get('bolle?spesa_id=eq.' + s.id + '&select=id,numero,data_arrivo') : [];
    const v = s || { data: oggi(), metodo: S.imp.metodi_spesa[0], pagata: true, iva_cent: 0 };
    const d = apri(`<h2>${s ? esc(s.descrizione) : 'Nuova spesa'}</h2><form novalidate>
      <div class="grid-form">
        <label class="f w2"><span>Data *</span><input type="date" name="data" value="${esc(v.data)}" required></label>
        <label class="f w2"><span>Categoria</span><select name="categoria_id"><option value="">—</option>${catDi('spesa').map((c) => `<option value="${c.id}"${c.id === v.categoria_id ? ' selected' : ''}>${esc(c.nome)}${c.tipo === 'fissa' ? ' (fissa)' : ''}</option>`).join('')}</select></label>
        <label class="f"><span>Descrizione *</span><input name="descrizione" value="${esc(v.descrizione || '')}" maxlength="200" required placeholder="es. Affitto ottobre, Bolletta luce set-ott, TARI 1ª rata"></label>
        <label class="f w2"><span>Fornitore</span><select name="fornitore_id"><option value="">—</option>${S.fornitori.map((f) => `<option value="${f.id}"${f.id === v.fornitore_id ? ' selected' : ''}>${esc(f.nome)}</option>`).join('')}</select></label>
        <label class="f w2"><span>Numero fattura / documento</span><input name="numero_documento" value="${esc(v.numero_documento || '')}" maxlength="60"></label>
        <label class="f w2"><span>Importo totale (IVA compresa) *</span><div class="euro"><input name="importo" inputmode="decimal" value="${esc(euroInput(v.importo_cent))}" required><span>€</span></div></label>
        <label class="f w2"><span>di cui IVA</span><div class="euro"><input name="iva" inputmode="decimal" value="${esc(euroInput(v.iva_cent))}"><span>€</span></div>
          <small>calcola: <button type="button" class="link" data-iva="22">22%</button> · <button type="button" class="link" data-iva="10">10%</button> · <button type="button" class="link" data-iva="4">4%</button> · <button type="button" class="link" data-iva="0">nessuna</button></small></label>
        <label class="f w2"><span>Pagamento</span><select name="metodo">${[...new Set([...S.imp.metodi_spesa, v.metodo])].map((m) => `<option${m === v.metodo ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
        <label class="check w2"><input type="checkbox" name="pagata"${v.pagata ? ' checked' : ''}> <span>Già pagata</span></label>
        <label class="f w2 scad"><span>Scadenza</span><input type="date" name="scadenza" value="${esc(v.scadenza || '')}"></label>
        <label class="f"><span>Nota</span><textarea name="nota" rows="2" maxlength="2000">${esc(v.nota || '')}</textarea></label>
      </div>
      ${bolle.length ? `<p class="muted">Bolle collegate: ${bolle.map((b) => `<a href="#/bolle/${b.id}">${esc(b.numero || 's.n.')} (${esc(dataIt(b.data_arrivo))})</a>`).join(', ')}</p>` : ''}
      <h3 class="sez">📎 Fattura, bolletta, ricevuta</h3>
      ${allegati.length ? `<ul class="lista compatta">${allegati.map((a) => `<li><button type="button" class="link" data-all="${esc(a.id)}">${esc(a.nome)}</button> <small class="muted">${Math.round(a.dimensione / 1024)} KB</small> <button type="button" class="link neg" data-togli="${esc(a.id)}">togli</button></li>`).join('')}</ul>` : ''}
      <label class="f"><span>Aggiungi foto o PDF (massimo 8 MB)</span><input type="file" name="file" accept="image/*,application/pdf"></label>
      <p class="alert err" hidden></p>
      <div class="azioni">${s ? '<button class="btn danger ghost" type="button" data-del>Elimina</button><span class="spazio"></span>' : ''}<button class="btn" type="button" data-no>Annulla</button><button class="btn primary" type="submit">Salva</button></div></form>`, 'largo');
    const f = d.querySelector('form'), err = f.querySelector('.alert');
    d.querySelector('[data-no]').onclick = chiudi;
    const scad = () => { f.querySelector('.scad').hidden = f.pagata.checked; };
    f.pagata.onchange = scad; scad();
    $$('[data-iva]', d).forEach((b) => (b.onclick = () => { const imp = cent(f.importo.value), a = Number(b.dataset.iva); if (imp > 0) f.iva.value = euroInput(Math.round(imp - imp / (1 + a / 100))); }));
    $$('[data-all]', d).forEach((x) => (x.onclick = () => FG.apriAllegato(x.dataset.all)));
    $$('[data-togli]', d).forEach((x) => (x.onclick = async () => { try { await rest('DELETE', 'allegati?id=eq.' + x.dataset.togli); x.closest('li').remove(); toast('Allegato tolto'); } catch (e) { toast(e.message, 'err'); } }));
    f.onsubmit = (e) => {
      e.preventDefault();
      occupato(f.querySelector('[type=submit]'), async () => {
        err.hidden = true;
        try {
          const imp = cent(f.importo.value), iva = cent(f.iva.value) || 0;
          if (imp == null || Number.isNaN(imp) || imp < 0) throw new Error('Importo non valido (es. 650,00)');
          if (Number.isNaN(iva) || iva < 0 || iva > imp) throw new Error('IVA non valida');
          if (f.descrizione.value.trim().length < 2) throw new Error('Scrivi una descrizione');
          const file = f.file.files[0]; if (file && file.size > 8 * 1024 * 1024) throw new Error('Il file è troppo grande (massimo 8 MB)');
          const dati = { data: f.data.value || oggi(), categoria_id: Number(f.categoria_id.value) || null, descrizione: f.descrizione.value.trim(), fornitore_id: Number(f.fornitore_id.value) || null,
            numero_documento: f.numero_documento.value.trim() || null, importo_cent: imp, iva_cent: iva, metodo: f.metodo.value, pagata: f.pagata.checked,
            scadenza: f.pagata.checked ? null : f.scadenza.value || null, nota: f.nota.value.trim() || null };
          const [salvata] = s ? await rest('PATCH', 'spese?id=eq.' + s.id, dati) : await rest('POST', 'spese', dati);
          if (file) { try { await FG.caricaAllegato(file, 'spesa', salvata.id); } catch (ex) { toast('Spesa salvata, ma l\'allegato no: ' + ex.message, 'err'); } }
          chiudi(); toast('Spesa salvata', 'ok');
          if (location.hash.match(/^#\/spese\/\d+/)) vai('spese'); else render(true);
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      });
    };
    const del = d.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      if (!(await conferma('Eliminare la spesa e i suoi allegati? Le bolle collegate restano, senza fattura.', 'Elimina'))) return;
      try { await rest('DELETE', 'spese?id=eq.' + s.id); toast('Eliminata'); vai('spese'); } catch (ex) { toast(ex.message, 'err'); }
    };
  }
  FG.nuovaSpesa = () => modulo(null);

  // ------------------------------------------------------------ ricorrenti
  async function ricorrenti() {
    const lista = await get('ricorrenti?order=attiva.desc,prossima');
    VIEWS.spese.ric = lista;
    const mese = lista.filter((r) => r.attiva).reduce((a, r) => a + r.importo_cent / r.ogni_mesi, 0);
    const t = oggi();
    return `<header class="testa"><h1>Spese</h1><button class="btn primary" type="button" id="r-nuova">+ Spesa ricorrente</button></header>${tabs('ricorrenti')}
      <p class="muted">Affitto, TARI, luce, telefono, commercialista, assicurazione...: scrivile una volta. Quando arriva il momento il cruscotto le ricorda e con «Registra» diventano una spesa (l'importo si può correggere, es. bollette).</p>
      <section class="kpi"><div class="kpi-box"><span>Costi fissi</span><b>${esc(eur(Math.round(mese)))}</b><small>al mese (le annuali divise per 12) · ${esc(eur(Math.round(mese * 12)))} all'anno</small></div></section>
      ${lista.length ? `<div class="tabella"><table><thead><tr><th>Voce</th><th>Quando</th><th class="n">Importo</th><th class="n">Al mese</th><th></th></tr></thead><tbody>
        ${lista.map((r) => `<tr data-id="${r.id}" class="${r.attiva ? '' : 'spenta'}"><td><b>${esc(r.descrizione)}</b><br><small class="muted">${esc(FG.catNome(r.categoria_id) || '')}${r.attiva ? '' : ' · sospesa'}</small></td>
          <td>${esc(OGNI[r.ogni_mesi])}<br><small class="${r.attiva && r.prossima < t ? 'neg' : 'muted'}">prossima ${esc(dataIt(r.prossima))}${r.attiva && r.prossima <= t ? ' · da registrare' : giorniTra(t, r.prossima) <= 7 ? ' · tra pochi giorni' : ''}</small></td>
          <td class="n">${esc(eur(r.importo_cent))}</td><td class="n">${esc(eur(Math.round(r.importo_cent / r.ogni_mesi)))}</td>
          <td class="n">${r.attiva ? `<button type="button" class="btn sm${r.prossima <= t ? ' primary' : ''}" data-reg="${r.id}">Registra</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : vuoto('Nessuna spesa ricorrente.', '<button type="button" class="btn primary" id="r-esempi">Aggiungi affitto, TARI, luce, telefono… (da completare)</button>')}`;
  }
  const campiRic = () => [
    { k: 'descrizione', l: 'Voce', req: true, max: 160, ph: 'es. Affitto negozio' },
    { k: 'categoria_id', l: 'Categoria', t: 'select', num: true, o: catDi('spesa').map((c) => [c.id, c.nome]), w: 2 },
    { k: 'fornitore_id', l: 'A chi (fornitore)', t: 'select', num: true, o: S.fornitori.map((f) => [f.id, f.nome]), w: 2 },
    { k: 'importo_cent', l: 'Importo (IVA compresa)', t: 'money', req: true, w: 2 },
    { k: 'iva_cent', l: 'di cui IVA', t: 'money', w: 2 },
    { k: 'ogni_mesi', l: 'Ogni quanto', t: 'select', num: true, vuoto: false, o: Object.entries(OGNI).map(([k, x]) => [k, x]), w: 2 },
    { k: 'prossima', l: 'Prossima scadenza', t: 'date', req: true, w: 2 },
    { k: 'metodo', l: 'Pagamento', t: 'select', vuoto: false, o: S.imp.metodi_spesa.map((m) => [m, m]), w: 2 },
    { k: 'attiva', l: 'Attiva', t: 'bool', w: 2 },
    { k: 'nota', l: 'Nota', t: 'textarea', rows: 2 },
  ];
  function collegaRicorrenti(v) {
    const nuova = (vals = {}) => FG.scheda({ titolo: vals.id ? vals.descrizione : 'Nuova spesa ricorrente', tabella: 'ricorrenti', fields: campiRic(),
      vals: { ogni_mesi: 1, attiva: true, metodo: S.imp.metodi_spesa[0], prossima: oggi(), iva_cent: 0, ...vals },
      prima: (dati) => { if ((dati.iva_cent || 0) > dati.importo_cent) throw new Error('L\'IVA non può superare l\'importo'); dati.iva_cent = dati.iva_cent || 0; return dati; } });
    $('#r-nuova', v).onclick = () => nuova();
    $$('tr[data-id]', v).forEach((tr) => (tr.onclick = (e) => { if (e.target.closest('[data-reg]')) return; nuova(VIEWS.spese.ric.find((r) => r.id === Number(tr.dataset.id))); }));
    $$('[data-reg]', v).forEach((b) => (b.onclick = () => registra(VIEWS.spese.ric.find((r) => r.id === Number(b.dataset.reg)))));
    const es = $('#r-esempi', v);
    if (es) es.onclick = () => occupato(es, async () => {
      const c = (n) => (catDi('spesa').find((x) => x.nome.toLowerCase().startsWith(n)) || {}).id || null;
      const m1 = FG.iso(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1));
      const voci = [['Affitto negozio', 'affitto', 1], ['TARI (rifiuti)', 'tari', 4], ['Luce', 'luce', 1], ['Gas e riscaldamento', 'gas', 2], ['Acqua', 'acqua', 3],
        ['Telefono e internet', 'telefono', 1], ['Commercialista', 'commercialista', 3], ['Assicurazione negozio', 'assicuraz', 12], ['Canone POS e cassa', 'canoni', 1]];
      try {
        await rest('POST', 'ricorrenti', voci.map(([d, k, o]) => ({ descrizione: d, categoria_id: c(k), importo_cent: 0, ogni_mesi: o, prossima: m1, attiva: false, nota: 'Da completare: importo e prossima scadenza, poi «Attiva».' })), 'return=minimal');
        toast('Voci aggiunte: completale con importo e data, poi attivale'); render(true);
      } catch (ex) { toast(ex.message, 'err'); }
    });
  }
  // come PostgreSQL (data + N mesi): se il giorno non esiste nel mese si va all'ultimo (31 gen + 1 mese = 28/29 feb)
  const dopoMesi = (s, n) => { const [y, m, g] = s.split('-').map(Number); const ultimo = new Date(y, m - 1 + n + 1, 0).getDate(); return FG.iso(new Date(y, m - 1 + n, Math.min(g, ultimo))); };
  function registra(r) {
    const d = apri(`<h2>Registra: ${esc(r.descrizione)}</h2><form novalidate class="grid-form">
      <label class="f w2"><span>Data</span><input type="date" name="data" value="${esc(r.prossima)}"></label>
      <label class="f w2"><span>Importo (cambialo se la bolletta è diversa)</span><div class="euro"><input name="imp" inputmode="decimal" value="${esc(euroInput(r.importo_cent))}"><span>€</span></div></label>
      <label class="check"><input type="checkbox" name="pagata" checked> <span>Già pagata</span></label>
      <p class="muted w1">La prossima scadenza passa al ${esc(dataIt(dopoMesi(r.prossima, r.ogni_mesi)))}.</p>
      <p class="alert err" hidden></p><div class="azioni"><button class="btn" type="button" data-no>Annulla</button><button class="btn primary" type="submit">Registra la spesa</button></div></form>`, 'piccolo');
    const f = d.querySelector('form'); d.querySelector('[data-no]').onclick = chiudi;
    f.onsubmit = (e) => {
      e.preventDefault();
      occupato(f.querySelector('[type=submit]'), async () => {
        const imp = cent(f.imp.value);
        if (imp == null || Number.isNaN(imp) || imp < 0) { const a = f.querySelector('.alert'); a.textContent = 'Importo non valido'; a.hidden = false; return; }
        try { const id = await rpc('registra_ricorrente', { p_id: r.id, p_data: f.data.value || r.prossima, p_importo: imp, p_pagata: f.pagata.checked }); chiudi(); toast('Spesa registrata: puoi allegare la bolletta', 'ok'); vai('spese/' + id); }
        catch (ex) { const a = f.querySelector('.alert'); a.textContent = ex.message; a.hidden = false; }
      });
    };
  }
})();
