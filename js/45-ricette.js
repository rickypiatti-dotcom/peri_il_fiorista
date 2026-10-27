/* Composizioni: bouquet, centrotavola, corone... descritti come ricetta di articoli del magazzino.
   Calcola costo dei materiali, margine, prezzo consigliato e quante se ne possono fare con le scorte. */
'use strict';
(() => {
  const { $, $$, esc, eur, num, perc, cent, qty, get, rest, S, isOwner, toast, apri, chiudi, conferma, occupato, catDi, vuoto, render, VIEWS, euroInput } = FG;

  VIEWS.ricette = async () => {
    const lista = await get('ricette_vista?order=attiva.desc,nome');
    VIEWS.ricette.lista = lista;
    return `<header class="testa"><div><h1>Composizioni</h1><p class="muted">Ogni composizione è una «ricetta»: quando la vendi, il magazzino scala ogni stelo, vaso e nastro${isOwner() ? ', e sai subito quanto ci guadagni' : ''}.</p></div>
      <button class="btn primary" type="button" id="r-nuova">+ Composizione</button></header>
      ${lista.length ? `<ul class="cards">${lista.map((r) => {
        const netto = r.prezzo_vendita_cent / (1 + Number(r.aliquota_iva) / 100), m = netto > 0 ? r.margine_cent / netto : null;
        return `<li><button type="button" class="card ricetta-card${r.attiva ? '' : ' spenta'}" data-id="${r.id}">
          <div class="o-testa"><b>${esc(r.nome)}</b><span>${esc(eur(r.prezzo_vendita_cent))}</span></div>
          ${isOwner() ? `<dl class="mini-dati"><dt>Materiali</dt><dd>${esc(eur(r.costo_materiali_cent))}</dd>${r.manodopera_cent ? `<dt>Lavoro</dt><dd>${esc(eur(r.manodopera_cent))}</dd>` : ''}
          <dt>Margine</dt><dd class="${r.margine_cent < 0 ? 'neg' : 'pos'}">${esc(eur(r.margine_cent))} (${esc(perc(m))})</dd>
          <dt>Consigliato</dt><dd>${esc(eur(r.prezzo_consigliato_cent))}</dd></dl>` : ''}
          <small class="${r.possibili === 0 ? 'neg' : 'muted'}">${r.componenti ? `${r.componenti} componenti · ${r.possibili == null ? '' : r.possibili > 0 ? `materiale per ${r.possibili}` : 'manca materiale'}` : 'nessun componente'}${r.attiva ? '' : ' · disattivata'}</small></button></li>`;
      }).join('')}</ul>` : vuoto('Nessuna composizione. Creane una: es. «Bouquet rose rosse 12 steli» con 12 rose, 3 rami di verde, carta e nastro.')}`;
  };
  VIEWS.ricette.dopo = (v) => {
    $('#r-nuova', v).onclick = () => scheda(null);
    $$('[data-id]', v).forEach((b) => (b.onclick = () => scheda(VIEWS.ricette.lista.find((r) => r.id === Number(b.dataset.id)))));
  };

  async function scheda(r) {
    const [prodotti, righe] = await Promise.all([
      get('prodotti_vista?attivo=is.true&order=nome&select=id,nome,unita,prezzo_acquisto_cent,giacenza,a_magazzino'),
      r ? get('ricetta_righe?ricetta_id=eq.' + r.id) : [],
    ]);
    const comp = righe.map((x) => ({ prodotto_id: x.prodotto_id, quantita: Number(x.quantita) }));
    if (!comp.length) comp.push({ prodotto_id: null, quantita: 1 });
    const tit = isOwner(); // costi, lavoro, margine e prezzo consigliato: solo il titolare
    const v = r || { aliquota_iva: Number(S.imp.aliquota_default), attiva: true, categoria_id: (catDi('prodotto').find((c) => /composizion/i.test(c.nome)) || {}).id };
    const d = apri(`<h2>${r ? esc(r.nome) : 'Nuova composizione'}</h2><form novalidate>
      <div class="grid-form">
        <label class="f"><span>Nome *</span><input name="nome" value="${esc(v.nome || '')}" maxlength="120" required placeholder="es. Bouquet rose rosse 12 steli"></label>
        <label class="f w2"><span>Categoria (per le statistiche)</span><select name="categoria_id"><option value="">—</option>${catDi('prodotto').map((c) => `<option value="${c.id}"${c.id === v.categoria_id ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
        <label class="f w2"><span>IVA</span><select name="aliquota_iva">${[10, 22, 4, 5, 0].map((a) => `<option value="${a}"${Number(v.aliquota_iva) === a ? ' selected' : ''}>${a}%</option>`).join('')}</select></label>
      </div>
      <h3 class="sez">Componenti</h3><div id="r-comp"></div>
      <div class="azioni sinistra"><button type="button" class="btn sm" id="r-piu">+ Componente</button></div>
      <div class="grid-form">
        ${tit ? `<label class="f w3"><span>Costo del lavoro</span><div class="euro"><input name="manodopera" inputmode="decimal" value="${esc(euroInput(v.manodopera_cent))}" placeholder="0,00"><span>€</span></div><small>facoltativo: il tuo tempo</small></label>` : ''}
        <label class="f w3"><span>Minuti di lavoro</span><input name="minuti" inputmode="numeric" value="${esc(v.minuti ?? '')}"></label>
        <label class="f w3"><span>Prezzo di vendita (IVA inclusa) *</span><div class="euro"><input name="prezzo" inputmode="decimal" value="${esc(euroInput(v.prezzo_vendita_cent))}"><span>€</span></div></label>
      </div>
      <div class="calcolo" id="r-calc"></div>
      <label class="f"><span>Note (come si fa, varianti di stagione)</span><textarea name="note" rows="2" maxlength="2000">${esc(v.note || '')}</textarea></label>
      <label class="check"><input type="checkbox" name="attiva"${v.attiva ? ' checked' : ''}> <span>Attiva (si vede in cassa)</span></label>
      <p class="alert err" hidden></p>
      <div class="azioni">${r ? '<button class="btn danger ghost" type="button" data-del>Elimina</button><span class="spazio"></span>' : ''}<button class="btn" type="button" data-no>Annulla</button><button class="btn primary" type="submit">Salva</button></div></form>`, 'largo');
    const f = d.querySelector('form'), err = f.querySelector('.alert');
    d.querySelector('[data-no]').onclick = chiudi;
    const opz = (sel) => prodotti.map((p) => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${esc(p.nome)}${tit ? ` · ${esc(eur(p.prezzo_acquisto_cent))}/${esc(p.unita)}` : ''}</option>`).join('');
    const disegna = () => {
      $('#r-comp', d).innerHTML = comp.map((c, i) => `<div class="voce"><select data-cp="${i}" aria-label="Articolo"><option value="">Scegli l'articolo…</option>${opz(c.prodotto_id)}</select>
        <input data-cq="${i}" class="q" inputmode="decimal" value="${esc(String(c.quantita ?? '').replace('.', ','))}" aria-label="Quantità"><span class="muted" data-cu="${i}"></span>
        <button type="button" class="link neg" data-cx="${i}" aria-label="Togli">✕</button></div>`).join('');
      $$('[data-cp]', d).forEach((s) => (s.onchange = () => { comp[s.dataset.cp].prodotto_id = Number(s.value) || null; calcola(); }));
      $$('[data-cq]', d).forEach((s) => (s.oninput = () => { comp[s.dataset.cq].quantita = qty(s.value); calcola(); }));
      $$('[data-cx]', d).forEach((s) => (s.onclick = () => { comp.splice(s.dataset.cx, 1); if (!comp.length) comp.push({ prodotto_id: null, quantita: 1 }); disegna(); }));
      calcola();
    };
    const calcola = () => {
      let costo = 0, possibili = Infinity;
      comp.forEach((c, i) => {
        const p = prodotti.find((x) => x.id === c.prodotto_id), u = $(`[data-cu="${i}"]`, d);
        if (!p || !(c.quantita > 0)) { if (u) u.textContent = ''; return; }
        const t = c.quantita * p.prezzo_acquisto_cent; costo += t;
        if (p.a_magazzino) possibili = Math.min(possibili, Math.floor(Math.max(0, p.giacenza) / c.quantita));
        if (u) u.textContent = tit ? `${p.unita} · ${eur(Math.round(t))}` : p.unita;
      });
      costo = Math.round(costo);
      if (!tit) { $('#r-calc', d).innerHTML = `<div><span>Con le scorte attuali</span><b>${possibili === Infinity ? '—' : possibili}</b><small>composizioni</small></div>`; return; }
      const lavoro = cent(f.manodopera.value) || 0, prezzo = cent(f.prezzo.value), al = Number(f.aliquota_iva.value);
      const sugg = Math.round(((costo + lavoro) * Number(S.imp.ricarico) * (1 + al / 100)) / 50) * 50;
      const netto = prezzo > 0 ? prezzo / (1 + al / 100) : 0, marg = Math.round(netto - costo - lavoro);
      $('#r-calc', d).innerHTML = `<div><span>Materiali</span><b>${esc(eur(costo))}</b></div>
        <div><span>Prezzo consigliato (×${esc(num(S.imp.ricarico))})</span><b>${esc(eur(sugg))}</b> <button type="button" class="link" id="r-usa">usa</button></div>
        <div><span>Ti resta</span><b class="${marg < 0 ? 'neg' : 'pos'}">${prezzo > 0 ? esc(eur(marg)) + ' · ' + esc(perc(netto ? marg / netto : null)) : '—'}</b><small>al netto di IVA, materiali e lavoro</small></div>
        <div><span>Con le scorte attuali</span><b>${possibili === Infinity ? '—' : possibili}</b><small>composizioni</small></div>`;
      $('#r-usa', d).onclick = () => { f.prezzo.value = euroInput(sugg); calcola(); };
    };
    f.oninput = (e) => { if (!e.target.dataset.cq && !e.target.dataset.cp) calcola(); };
    $('#r-piu', d).onclick = () => { comp.push({ prodotto_id: null, quantita: 1 }); disegna(); };
    disegna();
    f.onsubmit = (e) => {
      e.preventDefault();
      occupato(f.querySelector('[type=submit]'), async () => {
        err.hidden = true;
        try {
          const prezzo = cent(f.prezzo.value), lavoro = tit ? cent(f.manodopera.value) || 0 : 0, minuti = f.minuti.value.trim() ? Number(f.minuti.value) : null;
          if (f.nome.value.trim().length < 2) throw new Error('Scrivi il nome');
          if (prezzo == null || Number.isNaN(prezzo) || prezzo < 0) throw new Error('Prezzo di vendita non valido');
          if (Number.isNaN(lavoro) || lavoro < 0 || (minuti != null && !(Number.isInteger(minuti) && minuti >= 0))) throw new Error('Controlla lavoro e minuti');
          const buoni = comp.filter((c) => c.prodotto_id);
          if (buoni.some((c) => !(c.quantita > 0))) throw new Error('Ogni componente ha bisogno di una quantità');
          if (new Set(buoni.map((c) => c.prodotto_id)).size !== buoni.length) throw new Error('Un articolo compare due volte: somma le quantità');
          const dati = { nome: f.nome.value.trim(), categoria_id: Number(f.categoria_id.value) || null, aliquota_iva: Number(f.aliquota_iva.value), prezzo_vendita_cent: prezzo,
            ...(tit ? { manodopera_cent: lavoro } : {}), minuti, note: f.note.value.trim() || null, attiva: f.attiva.checked };
          const [salvata] = r ? await rest('PATCH', 'ricette?id=eq.' + r.id, dati) : await rest('POST', 'ricette', dati);
          if (r) await rest('DELETE', 'ricetta_righe?ricetta_id=eq.' + r.id);
          if (buoni.length) await rest('POST', 'ricetta_righe', buoni.map((c) => ({ ricetta_id: salvata.id, prodotto_id: c.prodotto_id, quantita: c.quantita })), 'return=minimal');
          chiudi(); toast('Composizione salvata', 'ok'); render(true);
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      });
    };
    const del = d.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      if (!(await conferma(`Eliminare «${r.nome}»? Le vendite già fatte restano.`, 'Elimina'))) return;
      try { await rest('DELETE', 'ricette?id=eq.' + r.id); toast('Eliminata'); render(true); } catch (ex) { toast(ex.message, 'err'); }
    };
  }
})();
