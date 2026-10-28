/* Ordini e preventivi: matrimoni, funerali, bouquet da consegnare... Acconti e saldo diventano incassi.
   Preventivo stampabile (Salva come PDF), giro delle consegne con bigliettini. */
'use strict';
(() => {
  const { $, $$, esc, eur, num, cent, qty, oggi, dataIt, dataBreve, addGiorni, get, rpc, rest, S, isOwner, toast, apri, chiudi, conferma, occupato,
    catDi, schede, vuoto, render, VIEWS, euroInput, cap, pill, stampa, vai } = FG;
  const STATI = { preventivo: 'Preventivo', rifiutato: 'Rifiutato', da_fare: 'Da fare', in_lavorazione: 'In lavorazione', pronto: 'Pronto', consegnato: 'Consegnato', annullato: 'Annullato' };
  const PROSSIMO = { da_fare: 'in_lavorazione', in_lavorazione: 'pronto', pronto: 'consegnato' };
  const CONSEGNA = { ritiro: 'Ritiro in negozio', domicilio: 'Consegna a domicilio', evento: 'Allestimento evento' };
  const tabs = (a) => schede('ordini', [['', 'In corso'], ['consegne', 'Giro consegne'], ['preventivi', 'Preventivi'], ['archivio', 'Archivio']], a);
  const residuo = (o) => Math.max(0, o.totale_cent - o.incassato_cent);

  VIEWS.ordini = async (args) => {
    if (/^\d+$/.test(args[0] || '')) return scheda(Number(args[0]));
    if (args[0] === 'consegne') return consegne(args[1] || oggi());
    const tipo = args[0] || '';
    const filtro = { '': 'stato=in.(da_fare,in_lavorazione,pronto)&order=data_consegna,ora_consegna.nullslast',
      preventivi: 'stato=in.(preventivo)&order=data_consegna', archivio: 'stato=in.(consegnato,annullato,rifiutato)&order=data_consegna.desc&limit=300' }[tipo] || '';
    const ordini = await get('ordini_vista?' + filtro);
    const t = oggi();
    const nuovo = tipo === 'preventivi' ? '+ Nuovo preventivo' : '+ Nuovo ordine';
    return `<header class="testa"><h1>Ordini</h1><button class="btn primary" type="button" id="o-nuovo" data-prev="${tipo === 'preventivi' ? 1 : 0}">${nuovo}</button></header>${tabs(tipo)}
      ${ordini.length ? `<ul class="cards">${ordini.map((o) => `<li><a class="card ordine ${o.data_consegna < t && PROSSIMO[o.stato] ? 'ritardo' : ''}" href="#/ordini/${o.id}">
        <div class="o-testa"><b>${esc(dataBreve(o.data_consegna))}${o.ora_consegna ? ' · ' + esc(o.ora_consegna.slice(0, 5)) : ''}</b>${pill(STATI[o.stato], o.stato)}</div>
        <p>${esc(o.descrizione.slice(0, 140))}</p>
        <small class="muted">${esc(o.numero || '')}${o.cliente ? ' · ' + esc(o.cliente) : ''} · ${esc(CONSEGNA[o.consegna])}${o.categoria ? ' · ' + esc(o.categoria) : ''}</small>
        <div class="o-soldi"><span>${esc(eur(o.totale_cent))}</span>${o.stato !== 'preventivo' && residuo(o) ? `<small class="neg">da incassare ${esc(eur(residuo(o)))}</small>` : o.totale_cent && o.stato !== 'preventivo' ? '<small class="pos">pagato</small>' : ''}${o.stato === 'preventivo' && o.valido_fino ? `<small class="${o.valido_fino < t ? 'neg' : 'muted'}">valido fino al ${esc(dataIt(o.valido_fino))}</small>` : ''}</div>
      </a></li>`).join('')}</ul>` : vuoto(tipo === 'preventivi' ? 'Nessun preventivo in attesa di risposta.' : tipo === 'archivio' ? 'Archivio vuoto.' : 'Nessun ordine in corso.')}`;
  };
  VIEWS.ordini.dopo = (v, args) => {
    const n = $('#o-nuovo', v); if (n) n.onclick = () => modulo(null, n.dataset.prev === '1');
    if (args[0] === 'consegne') collegaConsegne(v, args[1] || oggi());
    if (/^\d+$/.test(args[0] || '')) collegaScheda(v);
  };

  // ------------------------------------------------------------ modulo ordine/preventivo
  async function modulo(o, preventivo) {
    const [clienti, ricette, righe] = await Promise.all([
      get('clienti?select=id,nome,telefono,indirizzo&order=nome'),
      FG.modulo('ricette') ? get('ricette?attiva=is.true&select=id,nome,prezzo_vendita_cent&order=nome') : [],
      o ? get('ordine_righe?ordine_id=eq.' + o.id + '&order=ordine,id') : [],
    ]);
    // anche un preventivo RIFIUTATO resta un preventivo: prima, modificandolo, il campo Stato proponeva «Da fare» e diventava un ordine
    const prev = o ? ['preventivo', 'rifiutato'].includes(o.stato) : preventivo;
    let clienteCreato = null; // se il salvataggio fallisce dopo aver creato il cliente nuovo, riprovando non se ne crea un secondo
    const voci = righe.length ? righe.map((r) => ({ d: r.descrizione, q: r.quantita, p: r.prezzo_unit_cent, ricetta_id: r.ricetta_id })) : [{ d: '', q: 1, p: null }];
    const val = o || { data_consegna: addGiorni(oggi(), prev ? 30 : 1), consegna: 'ritiro', stato: prev ? 'preventivo' : 'da_fare', valido_fino: prev ? addGiorni(oggi(), 30) : null, condizioni: prev ? S.imp.condizioni_preventivo : null };
    const d = apri(`<h2>${o ? (prev ? 'Preventivo ' : 'Ordine ') + esc(o.numero) : prev ? 'Nuovo preventivo' : 'Nuovo ordine'}</h2><form novalidate id="om">
      <div class="grid-form">
        <label class="f w2"><span>Cliente</span><select name="cliente_id"><option value="">—</option>${clienti.map((c) => `<option value="${c.id}"${c.id === val.cliente_id ? ' selected' : ''}>${esc(c.nome)}${c.telefono ? ' · ' + esc(c.telefono) : ''}</option>`).join('')}<option value="nuovo">+ Nuovo cliente…</option></select></label>
        <label class="f w2"><span>Tipo di lavoro</span><select name="categoria_id"><option value="">—</option>${catDi('entrata').map((c) => `<option value="${c.id}"${c.id === val.categoria_id ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
        <div class="nuovo-cliente w1" hidden><div class="grid-form"><label class="f w2"><span>Nome nuovo cliente *</span><input name="nc_nome" maxlength="120"></label><label class="f w2"><span>Telefono</span><input name="nc_tel" type="tel" maxlength="40"></label></div></div>
        <label class="f"><span>Descrizione del lavoro *</span><textarea name="descrizione" rows="2" maxlength="2000" placeholder="es. Matrimonio Rossi: bouquet sposa, 12 centrotavola, addobbo chiesa">${esc(val.descrizione || '')}</textarea></label>
        <label class="f w3"><span>${prev ? 'Data dell\'evento' : 'Data di consegna'} *</span><input type="date" name="data_consegna" value="${esc(val.data_consegna)}" required></label>
        <label class="f w3"><span>Ora</span><input type="time" name="ora_consegna" value="${esc((val.ora_consegna || '').slice(0, 5))}"></label>
        <label class="f w3"><span>Consegna</span><select name="consegna">${Object.entries(CONSEGNA).map(([k, t]) => `<option value="${k}"${k === val.consegna ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <div class="dove w1"><div class="grid-form">
          <label class="f"><span>Indirizzo</span><input name="indirizzo" value="${esc(val.indirizzo || '')}" maxlength="200"></label>
          <label class="f w2"><span>Destinatario</span><input name="destinatario" value="${esc(val.destinatario || '')}" maxlength="120"></label>
          <label class="f w2"><span>Telefono destinatario</span><input name="telefono_dest" type="tel" value="${esc(val.telefono_dest || '')}" maxlength="40"></label></div></div>
        <label class="f"><span>Bigliettino</span><textarea name="biglietto" rows="2" maxlength="600" placeholder="Testo da scrivere sul biglietto">${esc(val.biglietto || '')}</textarea></label>
      </div>
      <h3 class="sez">Voci ${prev ? 'del preventivo' : 'dell\'ordine'} <small class="muted">(prezzi IVA compresa)</small></h3>
      <div id="om-voci"></div>
      <div class="azioni sinistra"><button type="button" class="btn sm" id="om-piu">+ Voce</button>
        ${ricette.length ? `<select id="om-ric" class="sm"><option value="">+ Da una composizione…</option>${ricette.map((r) => `<option value="${r.id}">${esc(r.nome)}${r.prezzo_vendita_cent ? ' · ' + esc(eur(r.prezzo_vendita_cent)) : ''}</option>`).join('')}</select>` : ''}
        <span class="spazio"></span><b>Totale <span id="om-tot"></span></b></div>
      <div class="grid-form">
        ${prev ? `<label class="f w2"><span>Valido fino al</span><input type="date" name="valido_fino" value="${esc(val.valido_fino || '')}"></label>
          <label class="f"><span>Condizioni (si stampano sul preventivo)</span><textarea name="condizioni" rows="3" maxlength="2000">${esc(val.condizioni || '')}</textarea></label>`
        : `<label class="f w2"><span>Stato</span><select name="stato">${['da_fare', 'in_lavorazione', 'pronto', 'consegnato', 'annullato'].map((k) => `<option value="${k}"${k === val.stato ? ' selected' : ''}>${STATI[k]}</option>`).join('')}</select></label>`}
        <label class="f"><span>Note interne</span><textarea name="note" rows="2" maxlength="2000">${esc(val.note || '')}</textarea></label>
      </div>
      <p class="alert err" hidden></p>
      <div class="azioni"><button class="btn" type="button" data-no>Annulla</button><button class="btn primary" type="submit">Salva</button></div></form>`, 'largo');
    const f = d.querySelector('#om'), err = f.querySelector('.alert');
    d.querySelector('[data-no]').onclick = chiudi;
    const mostra = () => { f.querySelector('.dove').hidden = f.consegna.value === 'ritiro'; f.querySelector('.nuovo-cliente').hidden = f.cliente_id.value !== 'nuovo'; };
    f.consegna.onchange = mostra; mostra();
    f.cliente_id.onchange = () => {
      mostra();
      const c = clienti.find((x) => String(x.id) === f.cliente_id.value);
      if (c && c.indirizzo && !f.indirizzo.value) f.indirizzo.value = c.indirizzo;
    };
    const disegnaVoci = () => {
      $('#om-voci', d).innerHTML = voci.map((v, i) => `<div class="voce"><input data-vd="${i}" value="${esc(v.d)}" placeholder="es. Bouquet sposa" maxlength="300" aria-label="Descrizione">
        <input data-vq="${i}" inputmode="decimal" value="${esc(String(v.q).replace('.', ','))}" aria-label="Quantità" class="q">
        <div class="euro sm"><input data-vp="${i}" inputmode="decimal" value="${esc(euroInput(v.p))}" aria-label="Prezzo unitario"><span>€</span></div>
        <button type="button" class="link neg" data-vx="${i}" aria-label="Togli">✕</button></div>`).join('');
      $$('[data-vd]', d).forEach((el) => (el.oninput = () => { voci[el.dataset.vd].d = el.value; }));
      $$('[data-vq]', d).forEach((el) => (el.oninput = () => { voci[el.dataset.vq].q = qty(el.value); totale(); }));
      $$('[data-vp]', d).forEach((el) => (el.oninput = () => { voci[el.dataset.vp].p = cent(el.value); totale(); }));
      $$('[data-vx]', d).forEach((el) => (el.onclick = () => { voci.splice(el.dataset.vx, 1); disegnaVoci(); }));
      totale();
    };
    const totale = () => { $('#om-tot', d).textContent = eur(voci.reduce((a, v) => a + (v.q > 0 && v.p > 0 ? Math.round(v.q * v.p) : 0), 0)); };
    disegnaVoci();
    $('#om-piu', d).onclick = () => { voci.push({ d: '', q: 1, p: null }); disegnaVoci(); $$('[data-vd]', d).pop().focus(); };
    const sr = $('#om-ric', d);
    if (sr) sr.onchange = () => { const r = ricette.find((x) => String(x.id) === sr.value); if (r) { if (voci.length === 1 && !voci[0].d) voci.length = 0; voci.push({ d: r.nome, q: 1, p: r.prezzo_vendita_cent, ricetta_id: r.id }); disegnaVoci(); } sr.value = ''; };

    f.onsubmit = (e) => {
      e.preventDefault();
      occupato(f.querySelector('[type=submit]'), async () => {
        err.hidden = true;
        try {
          const buone = voci.filter((v) => v.d.trim() || v.p);
          for (const v of buone) {
            if (!v.d.trim()) throw new Error('Ogni voce ha bisogno di una descrizione');
            if (!(v.q > 0 && v.q <= 100000)) throw new Error(`«${v.d}»: quantità non valida`);
            if (v.p == null || Number.isNaN(v.p) || v.p < 0 || v.p > 100000000) throw new Error(`«${v.d}»: prezzo non valido`);
          }
          if (buone.reduce((a, v) => a + Math.round(v.q * v.p), 0) > 100000000) throw new Error('Totale troppo alto');
          if (!f.descrizione.value.trim()) throw new Error('Scrivi una descrizione del lavoro');
          if (!f.data_consegna.value) throw new Error('Manca la data');
          let cliente = f.cliente_id.value === 'nuovo' ? null : Number(f.cliente_id.value) || null;
          if (f.cliente_id.value === 'nuovo' && clienteCreato) cliente = clienteCreato;
          else if (f.cliente_id.value === 'nuovo') {
            if (f.nc_nome.value.trim().length < 2) throw new Error('Scrivi il nome del nuovo cliente');
            const [c] = await rest('POST', 'clienti', { nome: f.nc_nome.value.trim(), telefono: f.nc_tel.value.trim() || null, indirizzo: f.consegna.value !== 'ritiro' ? f.indirizzo.value.trim() || null : null });
            cliente = clienteCreato = c.id;
          }
          const ritiro = f.consegna.value === 'ritiro';
          const dati = {
            cliente_id: cliente, categoria_id: Number(f.categoria_id.value) || null, descrizione: f.descrizione.value.trim(),
            data_consegna: f.data_consegna.value, ora_consegna: f.ora_consegna.value || null, consegna: f.consegna.value,
            indirizzo: ritiro ? null : f.indirizzo.value.trim() || null, destinatario: ritiro ? null : f.destinatario.value.trim() || null,
            telefono_dest: ritiro ? null : f.telefono_dest.value.trim() || null, biglietto: f.biglietto.value.trim() || null, note: f.note.value.trim() || null,
          };
          if (prev) { dati.valido_fino = f.valido_fino.value || null; dati.condizioni = f.condizioni.value.trim() || null; if (!o) dati.stato = 'preventivo'; }
          else dati.stato = f.stato.value;
          const [salvato] = o ? await rest('PATCH', 'ordini?id=eq.' + o.id, dati) : await rest('POST', 'ordini', dati);
          // voci: prima si scrivono le nuove, POI si tolgono le vecchie (per numero). Se la scrittura fallisce le voci di prima restano
          // (prima si cancellavano subito: un errore lasciava l'ordine senza voci e con totale 0). Il totale lo ricalcola il database.
          if (buone.length) await rest('POST', 'ordine_righe', buone.map((v, i) => ({ ordine_id: salvato.id, descrizione: v.d.trim(), quantita: v.q, prezzo_unit_cent: v.p, ricetta_id: v.ricetta_id || null, ordine: i })), 'return=minimal');
          if (o && righe.length) await rest('DELETE', `ordine_righe?ordine_id=eq.${o.id}&id=in.(${righe.map((r) => r.id).join(',')})`);
          chiudi(); toast(prev ? 'Preventivo salvato' : 'Ordine salvato', 'ok'); vai('ordini/' + salvato.id);
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      });
    };
  }

  // ------------------------------------------------------------ scheda
  let corrente = null;
  async function scheda(id) {
    const [[o], righe, incassi] = await Promise.all([
      get('ordini_vista?id=eq.' + id), get('ordine_righe?ordine_id=eq.' + id + '&order=ordine,id'),
      get('entrate?ordine_id=eq.' + id + '&order=data,id&select=id,data,totale_cent,metodo,descrizione'),
    ]);
    if (!o) return vuoto('Ordine non trovato.', '<a class="btn" href="#/ordini">Torna agli ordini</a>');
    let cliente = null;
    if (o.cliente_id) [cliente] = await get('clienti?id=eq.' + o.cliente_id);
    corrente = { o, righe, cliente };
    const prev = ['preventivo', 'rifiutato'].includes(o.stato), res = residuo(o);
    return `<header class="testa"><div><a class="link" href="#/ordini${prev ? '/preventivi' : ''}">← ${prev ? 'Preventivi' : 'Ordini'}</a><h1>${prev ? 'Preventivo' : 'Ordine'} ${esc(o.numero)} ${pill(STATI[o.stato], o.stato)}</h1></div>
      <div class="azioni">${prev ? `<button class="btn primary" data-a="accetta">✓ Accettato: diventa ordine</button>${o.stato === 'preventivo' ? '<button class="btn" data-a="rifiuta">Rifiutato</button>' : ''}<button class="btn" data-a="stampa">🖨 Stampa / PDF</button>`
        : `${PROSSIMO[o.stato] ? `<button class="btn primary" data-a="avanza">Segna «${STATI[PROSSIMO[o.stato]]}»</button>` : ''}${res && o.stato !== 'annullato' && FG.modulo('cassa') ? '<button class="btn" data-a="incassa">💶 Incassa</button>' : ''}<button class="btn" data-a="biglietto"${o.biglietto ? '' : ' hidden'}>🖨 Bigliettino</button>`}
        <button class="btn" data-a="modifica">Modifica</button><button class="btn" data-a="duplica">Duplica</button></div></header>
      <div class="colonne2"><section class="card"><h2>${esc(o.descrizione)}</h2>
        <dl class="dati"><dt>${prev ? 'Data dell\'evento' : 'Consegna'}</dt><dd>${esc(dataIt(o.data_consegna))}${o.ora_consegna ? ' alle ' + esc(o.ora_consegna.slice(0, 5)) : ''} · ${esc(CONSEGNA[o.consegna])}</dd>
        ${o.indirizzo ? `<dt>Indirizzo</dt><dd>${esc(o.indirizzo)} <a class="link" target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.indirizzo)}">mappa</a></dd>` : ''}
        ${o.destinatario ? `<dt>Destinatario</dt><dd>${esc(o.destinatario)}${o.telefono_dest ? ` · <a href="tel:${esc(o.telefono_dest.replace(/\s/g, ''))}">${esc(o.telefono_dest)}</a>` : ''}</dd>` : ''}
        ${cliente ? `<dt>Cliente</dt><dd><a href="#/clienti/${cliente.id}">${esc(cliente.nome)}</a>${cliente.telefono ? ` · <a href="tel:${esc(cliente.telefono.replace(/\s/g, ''))}">${esc(cliente.telefono)}</a>` : ''}</dd>` : ''}
        ${o.categoria ? `<dt>Tipo</dt><dd>${esc(o.categoria)}</dd>` : ''}
        ${o.biglietto ? `<dt>Bigliettino</dt><dd class="biglietto">${esc(o.biglietto)}</dd>` : ''}
        ${o.note ? `<dt>Note</dt><dd>${esc(o.note)}</dd>` : ''}
        ${prev && o.valido_fino ? `<dt>Valido fino al</dt><dd>${esc(dataIt(o.valido_fino))}</dd>` : ''}</dl>
        ${righe.length ? `<table class="mini"><tbody>${righe.map((r) => `<tr><td>${esc(r.descrizione)}</td><td class="n">${esc(num(r.quantita))} × ${esc(eur(r.prezzo_unit_cent))}</td><td class="n">${esc(eur(Math.round(r.quantita * r.prezzo_unit_cent)))}</td></tr>`).join('')}</tbody></table>` : ''}
        <p class="carr-totale"><span>Totale</span><b>${esc(eur(o.totale_cent))}</b></p></section>
      ${prev ? '' : `<section class="card"><h2>Pagamenti</h2>${incassi.length ? `<ul class="lista compatta">${incassi.map((e) => `<li>${esc(dataIt(e.data))} · ${esc(e.descrizione || 'Incasso')} <b>${esc(eur(e.totale_cent))}</b> <small class="muted">${esc(e.metodo)}</small></li>`).join('')}</ul>` : '<p class="muted">Nessun acconto ancora.</p>'}
        <p>Incassato <b>${esc(eur(o.incassato_cent))}</b> · ${res ? `da incassare <b class="neg">${esc(eur(res))}</b>` : '<b class="pos">saldato</b>'}</p></section>`}</div>
      <div class="azioni sinistra"><button class="btn danger ghost sm" data-a="elimina">Elimina</button>${!prev && !['annullato', 'consegnato'].includes(o.stato) ? '<button class="btn ghost sm" data-a="annulla">Annulla ordine</button>' : ''}</div>`;
  }

  function collegaScheda(v) {
    const { o, righe } = corrente;
    $$('[data-a]', v).forEach((b) => (b.onclick = () => occupato(b, async () => {
      try {
        const a = b.dataset.a;
        if (a === 'modifica') return modulo(o);
        if (a === 'stampa') return stampaPreventivo(corrente);
        if (a === 'biglietto') return stampa(bigliettini([o]), 'Bigliettino');
        if (a === 'incassa') return incassa(o);
        if (a === 'accetta') { await rest('PATCH', 'ordini?id=eq.' + o.id, { stato: 'da_fare', creato_da_preventivo: true }); toast('Preventivo accettato: ora è un ordine', 'ok'); return render(); }
        if (a === 'rifiuta') { if (await conferma('Segnare il preventivo come rifiutato? Resta nell\'archivio.', 'Rifiutato', false)) { await rest('PATCH', 'ordini?id=eq.' + o.id, { stato: 'rifiutato' }); render(); } return; }
        if (a === 'avanza') { await rest('PATCH', 'ordini?id=eq.' + o.id, { stato: PROSSIMO[o.stato] }); toast('Stato aggiornato'); return render(); }
        if (a === 'annulla') { if (await conferma('Annullare l\'ordine? Gli incassi già registrati restano (eventuali rimborsi vanno annullati in Cassa).', 'Annulla ordine')) { await rest('PATCH', 'ordini?id=eq.' + o.id, { stato: 'annullato' }); render(); } return; }
        if (a === 'duplica') {
          const { id, numero, cliente, cliente_telefono, categoria, incassato_cent, totale_cent, creato_il, aggiornato_il, creato_da_preventivo, ...copia } = o;
          const [n] = await rest('POST', 'ordini', { ...copia, stato: ['preventivo', 'rifiutato'].includes(o.stato) ? 'preventivo' : 'da_fare', data_consegna: addGiorni(oggi(), 1) });
          if (righe.length) await rest('POST', 'ordine_righe', righe.map(({ id: _, ordine_id: __, ...r }) => ({ ...r, ordine_id: n.id })), 'return=minimal');
          toast('Copia creata: controlla la data'); return vai('ordini/' + n.id);
        }
        if (a === 'elimina') {
          if (!(await conferma('Eliminare definitivamente? Gli incassi collegati restano in Cassa (senza ordine).', 'Elimina'))) return;
          await rest('DELETE', 'ordini?id=eq.' + o.id); toast('Eliminato'); return vai('ordini');
        }
      } catch (ex) { toast(ex.message, 'err'); }
    })));
  }

  function incassa(o) {
    const res = residuo(o), acconto = o.incassato_cent === 0 && o.data_consegna > oggi();
    const d = apri(`<h2>Incassa · ordine ${esc(o.numero)}</h2><form novalidate class="grid-form">
      <label class="f w2"><span>Importo</span><div class="euro"><input name="imp" inputmode="decimal" value="${esc(euroInput(acconto ? Math.round(res * 0.3 / 100) * 100 : res))}"><span>€</span></div><small>Totale ${esc(eur(o.totale_cent))}, da incassare ${esc(eur(res))}</small></label>
      <label class="f w2"><span>È un</span><select name="tipo"><option value="acconto"${acconto ? ' selected' : ''}>Acconto</option><option value="saldo"${acconto ? '' : ' selected'}>Saldo</option></select></label>
      <label class="f w2"><span>Pagamento</span><select name="metodo">${S.imp.metodi_incasso.map((m) => `<option>${esc(m)}</option>`).join('')}</select></label>
      <label class="f w2"><span>Documento</span><select name="doc">${FG.DOC.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      <p class="alert err" hidden></p><div class="azioni"><button class="btn" type="button" data-no>Annulla</button><button class="btn primary" type="submit">Registra incasso</button></div></form>`, 'piccolo');
    const f = d.querySelector('form'); d.querySelector('[data-no]').onclick = chiudi;
    f.onsubmit = (e) => {
      e.preventDefault();
      occupato(f.querySelector('[type=submit]'), async () => {
        const c = cent(f.imp.value);
        if (!(c > 0)) { const a = f.querySelector('.alert'); a.textContent = 'Importo non valido'; a.hidden = false; return; }
        try {
          await rpc('registra_vendita', { p: { ordine_id: o.id, cliente_id: o.cliente_id, categoria_id: o.categoria_id, metodo: f.metodo.value, documento: f.doc.value,
            descrizione: `Ordine ${o.numero} - ${f.tipo.value}`, importo_cent: c } });
          chiudi(); toast('Incasso registrato', 'ok'); render();
        } catch (ex) { const a = f.querySelector('.alert'); a.textContent = ex.message; a.hidden = false; }
      });
    };
  }

  // ------------------------------------------------------------ stampe
  function intestazione() {
    const i = S.imp;
    return `<div class="st-intest"><b>${esc(i.nome_attivita)}</b>${i.ragione_sociale ? `<br>${esc(i.ragione_sociale)}` : ''}${i.indirizzo ? `<br>${esc(i.indirizzo)}` : ''}
      ${i.partita_iva ? `<br>P.IVA ${esc(i.partita_iva)}` : ''}${i.codice_fiscale ? ` · C.F. ${esc(i.codice_fiscale)}` : ''}${i.telefono ? `<br>Tel. ${esc(i.telefono)}` : ''}${i.email ? ` · ${esc(i.email)}` : ''}</div>`;
  }
  function stampaPreventivo({ o, righe, cliente }) {
    stampa(`${intestazione()}
      <div class="st-blocco"><p><b>Preventivo n. ${esc(o.numero)}</b> del ${esc(dataIt(o.creato_il.slice(0, 10)))}</p>
      ${cliente ? `<p>Per: <b>${esc(cliente.nome)}</b>${cliente.indirizzo ? '<br>' + esc(cliente.indirizzo) : ''}${cliente.cf_piva ? '<br>C.F./P.IVA ' + esc(cliente.cf_piva) : ''}</p>` : ''}
      <p><b>${esc(o.descrizione)}</b><br>Data: ${esc(dataIt(o.data_consegna))}${o.ora_consegna ? ' ore ' + esc(o.ora_consegna.slice(0, 5)) : ''} · ${esc(CONSEGNA[o.consegna])}${o.indirizzo ? ' · ' + esc(o.indirizzo) : ''}</p></div>
      <table class="st-tab"><thead><tr><th>Descrizione</th><th>Q.tà</th><th>Prezzo</th><th>Importo</th></tr></thead><tbody>
      ${righe.map((r) => `<tr><td>${esc(r.descrizione)}</td><td class="n">${esc(num(r.quantita))}</td><td class="n">${esc(eur(r.prezzo_unit_cent))}</td><td class="n">${esc(eur(Math.round(r.quantita * r.prezzo_unit_cent)))}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="3">Totale (IVA compresa)</td><td class="n"><b>${esc(eur(o.totale_cent))}</b></td></tr></tfoot></table>
      ${o.condizioni ? `<p class="st-cond">${esc(o.condizioni)}</p>` : ''}${o.valido_fino ? `<p>Offerta valida fino al ${esc(dataIt(o.valido_fino))}.</p>` : ''}
      <div class="st-firme"><div>Data e firma per accettazione<br><br>______________________________</div><div>${esc(S.imp.nome_attivita)}<br><br>______________________________</div></div>`,
    `Preventivo ${o.numero}`);
  }
  const bigliettini = (lista) => `<div class="st-biglietti">${lista.map((o) => `<div class="st-biglietto"><p>${esc(o.biglietto || '')}</p>${o.destinatario ? `<small>Per ${esc(o.destinatario)}</small>` : ''}</div>`).join('')}</div>`;

  // ------------------------------------------------------------ giro consegne
  async function consegne(data) {
    const lista = await get(`ordini_vista?data_consegna=eq.${data}&stato=in.(da_fare,in_lavorazione,pronto,consegnato)&order=ora_consegna.nullslast,id`);
    consegne.lista = lista;
    const fuori = lista.filter((o) => o.consegna !== 'ritiro'), ritiri = lista.filter((o) => o.consegna === 'ritiro');
    const riga = (o) => `<li><a href="#/ordini/${o.id}"><b>${o.ora_consegna ? esc(o.ora_consegna.slice(0, 5)) : '—'}</b> ${esc(o.descrizione.slice(0, 100))}</a> ${pill(STATI[o.stato], o.stato)}
      <br><small class="muted">${esc(o.destinatario || o.cliente || '')}${o.indirizzo ? ' · ' + esc(o.indirizzo) : ''}${residuo(o) ? ` · <span class="neg">da incassare ${esc(eur(residuo(o)))}</span>` : ''}</small></li>`;
    return `<header class="testa"><h1>Ordini</h1></header>${tabs('consegne')}
      <div class="filtri"><label class="f"><span>Giorno</span><input type="date" id="gc-data" value="${data}"></label>${FG.cercaDate}
        <div class="rapidi"><button class="chip" type="button" data-g="${oggi()}">Oggi</button><button class="chip" type="button" data-g="${addGiorni(oggi(), 1)}">Domani</button></div>
        <button class="btn sm" type="button" id="gc-stampa"${lista.length ? '' : ' disabled'}>🖨 Stampa giro</button>
        <button class="btn sm" type="button" id="gc-biglietti"${lista.some((o) => o.biglietto) ? '' : ' disabled'}>🖨 Bigliettini</button></div>
      <div class="colonne2"><section class="card"><h2>🚚 Consegne e allestimenti (${fuori.length})</h2>${fuori.length ? `<ul class="lista">${fuori.map(riga).join('')}</ul>` : '<p class="muted">Nessuna consegna.</p>'}</section>
      <section class="card"><h2>🏪 Ritiri in negozio (${ritiri.length})</h2>${ritiri.length ? `<ul class="lista">${ritiri.map(riga).join('')}</ul>` : '<p class="muted">Nessun ritiro.</p>'}</section></div>`;
  }
  function collegaConsegne(v, data) {
    $('#gc-data', v).onchange = (e) => vai('ordini/consegne/' + (e.target.value || oggi()));
    $$('[data-g]', v).forEach((b) => (b.onclick = () => vai('ordini/consegne/' + b.dataset.g)));
    $('#gc-stampa', v).onclick = () => stampa(`<table class="st-tab"><thead><tr><th>Ora</th><th>Cosa</th><th>Dove / a chi</th><th>Da incassare</th><th>Fatto</th></tr></thead><tbody>
      ${consegne.lista.map((o) => `<tr><td>${o.ora_consegna ? esc(o.ora_consegna.slice(0, 5)) : ''}</td><td>${esc(o.numero)}<br>${esc(o.descrizione)}</td>
        <td>${o.consegna === 'ritiro' ? 'Ritiro in negozio' : esc(o.indirizzo || '')}<br>${esc(o.destinatario || o.cliente || '')} ${esc(o.telefono_dest || o.cliente_telefono || '')}</td>
        <td class="n">${residuo(o) ? esc(eur(residuo(o))) : '—'}</td><td>☐</td></tr>`).join('')}</tbody></table>`, `Consegne del ${dataIt(data)}`);
    $('#gc-biglietti', v).onclick = () => stampa(bigliettini(consegne.lista.filter((o) => o.biglietto)), 'Bigliettini');
  }
  FG.STATI_ORD = STATI;
})();
