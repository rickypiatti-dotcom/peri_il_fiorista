/* Cassa: vendita al banco, totale di giornata dal registratore, elenco incassi, chiusura di cassa. */
'use strict';
(() => {
  const { $, $$, esc, eur, num, cent, qty, oggi, dataIt, quando, get, getTutti, righeVisibili, notaRighe, rpc, rest, S, isOwner, toast, apri, chiudi, conferma, occupato,
    csv, eurCsv, numCsv, catDi, catNome, schede, vuoto, render, VIEWS, euroInput, cap } = FG;
  const DOC = [['scontrino', 'Scontrino'], ['fattura', 'Fattura'], ['ricevuta', 'Ricevuta']];
  FG.DOC = DOC;
  // il commesso non vede gli incassi: solo le sue vendite di oggi (per controllarle o annullarle se permesso)
  const tabs = (a) => schede('cassa', [['', 'Vendita'], ['giornata', 'Totale di giornata'], ['incassi', isOwner() ? 'Incassi' : 'Le mie vendite di oggi'], ['chiusura', 'Chiusura di cassa']], a);

  // Scontrino in preparazione: resta salvato nel browser se si cambia pagina
  const KEY = 'fg_scontrino';
  let sc = { voci: [], sconto: 0, metodo: '', cat: '', cliente: '', documento: 'scontrino', nota: '' };
  try { sc = { ...sc, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* ok */ }
  const memo = () => { try { localStorage.setItem(KEY, JSON.stringify(sc)); } catch { /* ok */ } };
  const lordo = () => sc.voci.reduce((t, v) => t + Math.round(v.quantita * v.prezzo), 0);
  const daPagare = () => Math.max(0, lordo() - (sc.sconto || 0));
  let cat = { prodotti: [], ricette: [], clienti: [] }, filtro = '', ricerca = '';

  VIEWS.cassa = async (args) => {
    if (args[0] === 'giornata') return giornata();
    if (args[0] === 'incassi') return incassi();
    if (args[0] === 'chiusura') return chiusura(isOwner() && args[1] || oggi());
    [cat.prodotti, cat.ricette, cat.clienti] = await Promise.all([
      get('prodotti_vista?attivo=is.true&order=nome&select=id,nome,codice,categoria_id,categoria,categoria_colore,prezzo_vendita_cent,unita,giacenza,a_magazzino'),
      FG.modulo('ricette') ? get('ricette_vista?attiva=is.true&order=nome&select=id,nome,prezzo_vendita_cent,possibili') : [],
      FG.modulo('clienti') ? get('clienti?select=id,nome&order=nome') : [],
    ]);
    if (!S.imp.metodi_incasso.includes(sc.metodo)) sc.metodo = S.imp.metodi_incasso[0];
    if (!catDi('entrata').some((c) => String(c.id) === sc.cat)) sc.cat = String((catDi('entrata')[0] || {}).id || '');
    if (sc.cliente && !cat.clienti.some((c) => String(c.id) === sc.cliente)) sc.cliente = ''; // cliente cancellato nel frattempo
    return `<header class="testa"><h1>Cassa</h1></header>${tabs('')}<div class="banco-layout"><section class="pos-articoli" id="banco"></section><aside class="pos-carrello card" id="scontrino"></aside></div>
      <button type="button" class="pos-barra" id="pos-barra" hidden></button>`;
  };
  VIEWS.cassa.dopo = (v, args) => {
    if (!args[0]) { disegnaBanco(); disegnaScontrino(); }
    else if (args[0] === 'giornata') collegaGiornata(v);
    else if (args[0] === 'incassi') collegaIncassi(v);
    else if (args[0] === 'chiusura') collegaChiusura(v, isOwner() && args[1] || oggi());
  };

  // ------------------------------------------------------------ banco: riquadri da toccare
  function disegnaBanco() {
    const box = $('#banco'); if (!box) return;
    const q = ricerca.trim().toLowerCase();
    const gruppi = new Map();
    for (const p of cat.prodotti) if (p.categoria_id) gruppi.set(p.categoria_id, p);
    const prodotti = cat.prodotti.filter((p) => (!filtro || filtro === String(p.categoria_id)) && (!q || p.nome.toLowerCase().includes(q) || (p.codice || '').toLowerCase() === q));
    const ricette = cat.ricette.filter((r) => (!filtro || filtro === 'comp') && (!q || r.nome.toLowerCase().includes(q)));
    box.innerHTML = `<div class="pos-cerca"><input type="search" id="banco-q" placeholder="Cerca, oppure leggi il codice a barre" value="${esc(ricerca)}" autocomplete="off" enterkeyhint="search">
        <button class="btn" type="button" id="banco-libera">+ Importo libero</button></div>
      <div class="chips"><button type="button" data-f="" class="${filtro ? '' : 'on'}">Tutto</button>
        ${cat.ricette.length ? `<button type="button" data-f="comp" class="${filtro === 'comp' ? 'on' : ''}">🌸 Composizioni</button>` : ''}
        ${[...gruppi.values()].map((p) => `<button type="button" data-f="${p.categoria_id}" class="${filtro === String(p.categoria_id) ? 'on' : ''}">${FG.pallino(p.categoria_colore)}${esc(p.categoria)}</button>`).join('')}</div>
      <div class="tiles">
        ${ricette.map((r) => `<button type="button" class="tile ricetta" data-r="${r.id}"><b>${esc(r.nome)}</b><span>${esc(eur(r.prezzo_vendita_cent))}</span><small>${r.possibili == null ? 'composizione' : r.possibili > 0 ? `materiale per ${r.possibili}` : '⚠️ manca materiale'}</small></button>`).join('')}
        ${prodotti.map((p) => `<button type="button" class="tile" data-p="${p.id}" style="--c:${esc(p.categoria_colore || '#999999')}"><b>${esc(p.nome)}</b><span>${esc(eur(p.prezzo_vendita_cent))}${p.unita !== 'pz' ? ' / ' + esc(p.unita) : ''}</span><small class="${p.a_magazzino && p.giacenza <= 0 ? 'neg' : ''}">${p.a_magazzino ? esc(num(p.giacenza)) + ' ' + esc(p.unita) : 'servizio'}</small></button>`).join('')}
      </div>${!prodotti.length && !ricette.length ? `<p class="muted">${q ? 'Nessun risultato.' : 'Ancora nessun articolo: si aggiungono da Magazzino.'} Per vendere comunque usa «Importo libero».</p>` : ''}`;
    const inp = $('#banco-q');
    inp.oninput = () => { ricerca = inp.value; const pos = inp.selectionStart; disegnaBanco(); const n = $('#banco-q'); n.focus(); n.setSelectionRange(pos, pos); };
    inp.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const codice = inp.value.trim().toLowerCase();
      const p = cat.prodotti.find((x) => (x.codice || '').toLowerCase() === codice) || (prodotti.length === 1 ? prodotti[0] : null);
      if (p) { metti({ prodotto_id: p.id, nome: p.nome, prezzo: p.prezzo_vendita_cent }); ricerca = ''; disegnaBanco(); $('#banco-q').focus(); }
    };
    $$('[data-f]', box).forEach((b) => (b.onclick = () => { filtro = b.dataset.f; disegnaBanco(); }));
    $$('[data-p]', box).forEach((b) => (b.onclick = () => { const p = cat.prodotti.find((x) => x.id === Number(b.dataset.p)); metti({ prodotto_id: p.id, nome: p.nome, prezzo: p.prezzo_vendita_cent }); }));
    $$('[data-r]', box).forEach((b) => (b.onclick = () => { const r = cat.ricette.find((x) => x.id === Number(b.dataset.r)); metti({ ricetta_id: r.id, nome: r.nome, prezzo: r.prezzo_vendita_cent }); }));
    $('#banco-libera').onclick = importoLibero;
  }

  function metti(v) {
    const uguale = sc.voci.find((x) => x.prodotto_id === v.prodotto_id && x.ricetta_id === v.ricetta_id && x.nome === v.nome && x.prezzo === v.prezzo && (v.prodotto_id || v.ricetta_id));
    if (uguale) uguale.quantita = Math.round((uguale.quantita + 1) * 100) / 100;
    else sc.voci.push({ quantita: 1, ...v });
    memo(); disegnaScontrino();
  }

  function importoLibero() {
    const d = apri(`<h2>Importo libero</h2><form novalidate>
      <label class="f"><span>Descrizione</span><input name="nome" value="Vendita" maxlength="200" required></label>
      <div class="grid-form"><label class="f w2"><span>Importo (IVA compresa)</span><div class="euro"><input name="prezzo" inputmode="decimal" required><span>€</span></div></label>
      <label class="f w2"><span>Quantità</span><input name="quantita" inputmode="decimal" value="1"></label></div>
      <p class="alert err" hidden></p><div class="azioni"><button class="btn" type="button" data-no>Annulla</button><button class="btn primary" type="submit">Aggiungi</button></div></form>`, 'piccolo');
    const f = d.querySelector('form'); d.querySelector('[data-no]').onclick = chiudi;
    f.prezzo.focus();
    f.onsubmit = (e) => {
      e.preventDefault();
      const prezzo = cent(f.prezzo.value), quantita = qty(f.quantita.value) || 1, nome = f.nome.value.trim() || 'Vendita';
      if (!(prezzo >= 0) || Number.isNaN(quantita) || quantita <= 0) { const a = f.querySelector('.alert'); a.textContent = 'Importo o quantità non validi'; a.hidden = false; return; }
      chiudi(); metti({ nome, prezzo, quantita });
    };
  }

  // ------------------------------------------------------------ scontrino
  function disegnaScontrino() {
    const box = $('#scontrino'); if (!box) return;
    const puoScontare = isOwner() || S.imp.staff_sconti;
    // sconto mai più grande dello scontrino (togliendo righe) e niente sconto rimasto da prima se ora non è permesso
    if (!puoScontare) sc.sconto = 0; else if (sc.sconto > lordo()) sc.sconto = lordo();
    const tot = daPagare();
    const barra = $('#pos-barra'), pezzi = sc.voci.reduce((a, v) => a + v.quantita, 0);
    barra.hidden = !sc.voci.length;
    barra.innerHTML = `<span>🧾 ${esc(num(pezzi))} ${pezzi === 1 ? 'pezzo' : 'pezzi'}</span><b>${esc(eur(tot))}</b><span>Vai allo scontrino ↓</span>`;
    barra.onclick = () => box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    box.innerHTML = `<h2>Scontrino</h2>
      ${sc.voci.length ? `<ul class="carr-righe">${sc.voci.map((v, i) => `<li><div class="carr-nome">${esc(v.nome)}${v.ricetta_id ? ' <small class="muted">composizione</small>' : ''}</div>
        <div class="carr-ctrl"><button type="button" class="qbtn" data-giu="${i}" aria-label="Uno in meno">−</button>
        <input class="carr-q" data-q="${i}" inputmode="decimal" value="${esc(String(v.quantita).replace('.', ','))}" aria-label="Quantità">
        <button type="button" class="qbtn" data-su="${i}" aria-label="Uno in più">+</button>
        <div class="euro sm"><input data-pr="${i}" inputmode="decimal" value="${esc(euroInput(v.prezzo))}" aria-label="Prezzo"><span>€</span></div>
        <b class="carr-tot" data-rt="${i}">${esc(eur(Math.round(v.quantita * v.prezzo)))}</b><button type="button" class="link neg" data-togli="${i}" aria-label="Togli">✕</button></div></li>`).join('')}</ul>`
        : '<p class="muted">Tocca gli articoli per aggiungerli allo scontrino.</p>'}
      <div class="carr-opz grid-form">
        ${puoScontare ? `<label class="f w2"><span>Sconto</span><div class="euro"><input id="s-sconto" inputmode="decimal" value="${esc(sc.sconto ? euroInput(sc.sconto) : '')}" placeholder="0,00"><span>€</span></div></label>` : ''}
        <label class="f w2"><span>Tipo di incasso</span><select id="s-cat">${catDi('entrata').map((c) => `<option value="${c.id}"${String(c.id) === sc.cat ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
        <label class="f w2"><span>Documento</span><select id="s-doc">${DOC.map(([k, t]) => `<option value="${k}"${k === sc.documento ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        ${cat.clienti.length ? `<label class="f w2"><span>Cliente</span><select id="s-cli"><option value="">—</option>${cat.clienti.map((c) => `<option value="${c.id}"${String(c.id) === sc.cliente ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>` : ''}
        <label class="f"><span>Nota</span><input id="s-nota" value="${esc(sc.nota)}" maxlength="300"></label>
      </div>
      <div class="metodi">${S.imp.metodi_incasso.map((m) => `<button type="button" data-met="${esc(m)}" class="${m === sc.metodo ? 'on' : ''}">${esc(cap(m))}</button>`).join('')}</div>
      <div class="carr-totale"><span>Totale <small class="muted" id="s-sc-nota">${sc.sconto ? `(sconto ${esc(eur(sc.sconto))})` : ''}</small></span><b id="s-tot">${esc(eur(tot))}</b></div>
      <p class="alert err" id="s-err" hidden></p>
      ${sc.metodo === 'contanti' && sc.voci.length ? '<div class="resto"><label class="f"><span>Contanti ricevuti</span><div class="euro"><input id="s-ricevuti" inputmode="decimal"><span>€</span></div></label><b id="s-resto"></b></div>' : ''}
      <div class="azioni"><button type="button" class="btn ghost" id="s-svuota"${sc.voci.length ? '' : ' disabled'}>Svuota</button>
        <button type="button" class="btn primary big" id="s-ok"${sc.voci.length ? '' : ' disabled'}>Incassa ${esc(eur(tot))}</button></div>`;
    // pulsanti: cambiano le righe, si ridisegna
    const giro = (fn) => (e) => { fn(Number(Object.values(e.currentTarget.dataset)[0])); memo(); disegnaScontrino(); };
    $$('[data-su]', box).forEach((b) => (b.onclick = giro((i) => { sc.voci[i].quantita = Math.round((sc.voci[i].quantita + 1) * 100) / 100; })));
    $$('[data-giu]', box).forEach((b) => (b.onclick = giro((i) => { if (sc.voci[i].quantita > 1) sc.voci[i].quantita = Math.round((sc.voci[i].quantita - 1) * 100) / 100; else sc.voci.splice(i, 1); })));
    $$('[data-togli]', box).forEach((b) => (b.onclick = giro((i) => sc.voci.splice(i, 1))));
    // campi: si aggiornano mentre si scrive SENZA ridisegnare (un tocco su «Incassa» subito dopo non va perso)
    const campo = (el, leggi, scrivi, formatta) => {
      el.oninput = () => { const n = leggi(el.value); const buono = n != null && !Number.isNaN(n); el.classList.toggle('sbagliato', !buono && el.value.trim() !== ''); if (buono) { scrivi(n); memo(); totali(); } };
      el.onchange = () => {
        const n = leggi(el.value);
        if (n == null || Number.isNaN(n)) { el.classList.add('sbagliato'); errore(el.value.trim() ? `«${el.value.trim()}» non è un numero valido: scrivi ad esempio 4,50` : 'Scrivi un numero (es. 4,50)'); return; }
        el.classList.remove('sbagliato'); errore(''); el.value = formatta(n);
      };
    };
    $$('[data-q]', box).forEach((el) => { const i = Number(el.dataset.q); campo(el, (v) => { const n = qty(v); return n > 0 ? n : n == null ? null : NaN; }, (n) => { sc.voci[i].quantita = n; }, (n) => String(n).replace('.', ',')); });
    $$('[data-pr]', box).forEach((el) => { const i = Number(el.dataset.pr); campo(el, (v) => { const n = cent(v); return n == null || n >= 0 ? n : NaN; }, (n) => { sc.voci[i].prezzo = n; }, euroInput); });
    const s = $('#s-sconto');
    if (s) campo(s, (v) => { const n = cent(v); return n == null ? 0 : n >= 0 ? n : NaN; }, (n) => { sc.sconto = Math.min(n, lordo()); }, (n) => (n ? euroInput(Math.min(n, lordo())) : ''));
    $$('[data-met]', box).forEach((b) => (b.onclick = () => { sc.metodo = b.dataset.met; memo(); disegnaScontrino(); }));
    $('#s-cat').onchange = (e) => { sc.cat = e.target.value; memo(); };
    $('#s-doc').onchange = (e) => { sc.documento = e.target.value; memo(); };
    const cl = $('#s-cli'); if (cl) cl.onchange = (e) => { sc.cliente = e.target.value; memo(); };
    $('#s-nota').onchange = (e) => { sc.nota = e.target.value; memo(); };
    const ric = $('#s-ricevuti');
    if (ric) ric.oninput = () => { const n = cent(ric.value), t = daPagare(); $('#s-resto').textContent = n >= t ? 'Resto ' + eur(n - t) : ''; };
    $('#s-svuota').onclick = () => { sc.voci = []; sc.sconto = 0; sc.nota = ''; sc.cliente = ''; memo(); disegnaScontrino(); };
    $('#s-ok').onclick = (e) => occupato(e.currentTarget, incassa);
  }

  // aggiorna solo i numeri (righe, totale, pulsante, barra, resto)
  function totali() {
    sc.voci.forEach((v, i) => { const el = $(`[data-rt="${i}"]`); if (el) el.textContent = eur(Math.round(v.quantita * v.prezzo)); });
    if (sc.sconto > lordo()) sc.sconto = lordo();
    const t = daPagare(), pezzi = sc.voci.reduce((a, v) => a + v.quantita, 0);
    $('#s-tot').textContent = eur(t); $('#s-ok').textContent = 'Incassa ' + eur(t);
    $('#s-sc-nota').textContent = sc.sconto ? `(sconto ${eur(sc.sconto)})` : '';
    const b = $('#pos-barra');
    if (b) { b.querySelector('b').textContent = eur(t); b.querySelector('span').textContent = `🧾 ${num(pezzi)} ${pezzi === 1 ? 'pezzo' : 'pezzi'}`; }
    const ric = $('#s-ricevuti'); if (ric && ric.value) ric.oninput();
  }
  function errore(m) { const e = $('#s-err'); if (e) { e.textContent = m; e.hidden = !m; } }

  async function incassa() {
    if (!sc.voci.length) return;
    const sbagliato = $('#scontrino .sbagliato');
    if (sbagliato) { errore('Correggi il campo in rosso prima di incassare (es. 4,50)'); sbagliato.focus(); return; }
    if (sc.sconto > lordo()) sc.sconto = lordo();
    const totale = daPagare();
    try {
      await rpc('registra_vendita', { p: {
        categoria_id: sc.cat ? Number(sc.cat) : null, cliente_id: sc.cliente ? Number(sc.cliente) : null, metodo: sc.metodo,
        documento: sc.documento, nota: sc.nota, sconto_cent: sc.sconto || 0,
        righe: sc.voci.map((v) => ({ prodotto_id: v.prodotto_id || null, ricetta_id: v.ricetta_id || null, descrizione: v.nome, quantita: v.quantita, prezzo_unit_cent: v.prezzo })),
      } });
      toast(`Incassati ${eur(totale)} (${sc.metodo})`, 'ok');
      sc = { ...sc, voci: [], sconto: 0, nota: '', cliente: '' }; memo();
      render(true);
    } catch (e) { toast(e.message, 'err'); }
  }

  // ------------------------------------------------------------ totale di giornata (dal registratore telematico)
  function giornata() {
    return `<header class="testa"><h1>Cassa</h1></header>${tabs('giornata')}
      <section class="card stretta"><h2>Totale di giornata</h2>
      <p class="muted">Per chi batte gli scontrini sul registratore: a fine giornata si inserisce il totale, un importo per ogni metodo di pagamento.
      Così incassi e statistiche restano completi. Il magazzino in questo caso si aggiorna con gli scarti e l'inventario.</p>
      <form id="gg" novalidate><div class="grid-form">
        ${isOwner() ? `<label class="f w2"><span>Giorno</span><input type="date" name="data" value="${oggi()}" max="${oggi()}" required></label>`
          : `<p class="f w2 muted">Giorno: <b>oggi, ${esc(dataIt(oggi()))}</b></p>`}
        <label class="f w2"><span>Tipo di incasso</span><select name="cat">${catDi('entrata').map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></label>
        <label class="f w2"><span>IVA media</span><select name="iva">${[10, 22, 4, 5, 0].map((a) => `<option value="${a}"${Number(S.imp.aliquota_default) === a ? ' selected' : ''}>${a}%</option>`).join('')}</select></label>
        <label class="f w2"><span>Numero chiusura (Z)</span><input name="doc" maxlength="60" placeholder="facoltativo"></label>
        ${S.imp.metodi_incasso.map((m) => `<label class="f w2"><span>${esc(cap(m))}</span><div class="euro"><input data-met="${esc(m)}" inputmode="decimal" placeholder="0,00"><span>€</span></div></label>`).join('')}
      </div><div class="carr-totale"><span>Totale</span><b id="gg-tot">${esc(eur(0))}</b></div>
      <p class="alert err" hidden></p><div class="azioni"><button class="btn primary" type="submit">Registra</button></div></form></section>`;
  }
  function collegaGiornata(v) {
    const f = $('#gg', v), err = f.querySelector('.alert');
    const leggiImporti = () => $$('[data-met]', f).map((i) => [i.dataset.met, cent(i.value)]).filter(([, c]) => c !== null);
    f.oninput = () => { $('#gg-tot').textContent = eur(leggiImporti().reduce((a, [, c]) => a + (c > 0 ? c : 0), 0)); };
    f.onsubmit = (e) => {
      e.preventDefault();
      occupato(f.querySelector('[type=submit]'), async () => {
        err.hidden = true;
        const imp = leggiImporti();
        if (imp.some(([, c]) => Number.isNaN(c) || c < 0)) { err.textContent = 'Un importo non è valido (es. 350,50)'; err.hidden = false; return; }
        const veri = imp.filter(([, c]) => c > 0);
        if (!veri.length) { err.textContent = 'Inserisci almeno un importo'; err.hidden = false; return; }
        const giorno = f.data ? f.data.value : oggi();
        if (!giorno) { err.textContent = 'Scegli il giorno'; err.hidden = false; return; }
        try {
          // un totale per lo stesso giorno c'è già? (doppio inserimento: succede facilmente)
          const gia = await get(`entrate?select=totale_cent&data=eq.${giorno}&descrizione=like.Totale di giornata*`).catch(() => []);
          if (gia.length && !(await conferma(`Per il ${dataIt(giorno)} hai già registrato un totale di giornata (${eur(gia.reduce((a, x) => a + x.totale_cent, 0))}). Registrarne un altro?`, 'Registra lo stesso', false))) return;
          // tutti i metodi insieme: o si salva tutto o niente (prima, un errore a metà lasciava solo una parte)
          await rpc('registra_giornata', { p: { data: giorno, categoria_id: Number(f.cat.value) || null, aliquota_iva: Number(f.iva.value),
            numero_documento: f.doc.value, importi: Object.fromEntries(veri) } });
          toast('Totale di giornata registrato', 'ok'); FG.vai('cassa/incassi');
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      });
    };
  }

  // ------------------------------------------------------------ elenco incassi
  const F = { da: oggi(), a: oggi(), metodo: '', cat: '' };
  async function incassi() {
    if (!isOwner()) return mieVendite();
    // i pagamenti "altro" (buoni regalo) hanno una contabilità a parte: pagina Altro (clic sul fiore)
    if (FG.separato(F.metodo)) F.metodo = '';
    let q = `entrate_vista?data=gte.${F.da}&data=lte.${F.a}&order=data.desc,id.desc&metodo=not.ilike.altro`;
    if (F.metodo) q += '&metodo=eq.' + encodeURIComponent(F.metodo);
    if (F.cat) q += '&categoria_id=eq.' + F.cat;
    const righe = await getTutti(q);
    incassi.righe = righe;
    const tot = righe.reduce((a, r) => a + r.totale_cent, 0);
    const perMetodo = {}; for (const r of righe) perMetodo[r.metodo] = (perMetodo[r.metodo] || 0) + r.totale_cent;
    return `<header class="testa"><h1>Cassa</h1></header>${tabs('incassi')}
      <form class="filtri" id="fi">
        <label class="f"><span>Dal</span><input type="date" name="da" value="${F.da}"></label>
        <label class="f"><span>Al</span><input type="date" name="a" value="${F.a}"></label>${FG.cercaDate}
        <label class="f"><span>Metodo</span><select name="metodo"><option value="">Tutti</option>${S.imp.metodi_incasso.filter((m) => !FG.separato(m)).map((m) => `<option${m === F.metodo ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
        <label class="f"><span>Tipo</span><select name="cat"><option value="">Tutti</option>${catDi('entrata', false).map((c) => `<option value="${c.id}"${String(c.id) === F.cat ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
        <div class="rapidi"><button type="button" class="chip" data-p="oggi">Oggi</button><button type="button" class="chip" data-p="ieri">Ieri</button><button type="button" class="chip" data-p="mese">Questo mese</button></div>
        <button type="button" class="btn sm" id="fi-csv"${righe.length ? '' : ' disabled'}>Scarica CSV</button>
      </form>
      <section class="kpi"><div class="kpi-box"><span>Totale</span><b>${esc(eur(tot))}</b><small>${righe.length} incassi</small></div>
        ${Object.entries(perMetodo).map(([m, t]) => `<div class="kpi-box"><span>${esc(cap(m))}</span><b>${esc(eur(t))}</b></div>`).join('')}</section>
      ${notaRighe(righe)}${righe.length ? `<div class="tabella"><table><thead><tr><th>Data</th><th>Cosa</th><th>Tipo</th><th>Pagamento</th><th class="n">Importo</th></tr></thead><tbody>
        ${righeVisibili(righe).map((r) => `<tr data-id="${r.id}" tabindex="0"><td>${esc(dataIt(r.data))}<br><small class="muted">${esc(new Date(r.creato_il).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }))}</small></td>
          <td>${esc(r.articoli || r.descrizione || '—')}${r.cliente ? `<br><small class="muted">${esc(r.cliente)}</small>` : ''}${r.ordine_numero ? `<br><small class="muted">ordine ${esc(r.ordine_numero)}</small>` : ''}</td>
          <td>${FG.pallino(r.categoria_colore)}${esc(r.categoria || '—')}</td><td>${esc(r.metodo)}<br><small class="muted">${esc(r.documento)}${r.numero_documento ? ' ' + esc(r.numero_documento) : ''}</small></td>
          <td class="n"><b>${esc(eur(r.totale_cent))}</b>${r.sconto_cent ? `<br><small class="muted">sconto ${esc(eur(r.sconto_cent))}</small>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : vuoto('Nessun incasso nel periodo scelto.')}`;
  }
  // commesso: le proprie vendite di oggi, senza totali, filtri né CSV
  async function mieVendite() {
    const righe = await get(`entrate_vista?data=eq.${oggi()}&creato_da=eq.${S.user.id}&order=id.desc`);
    return `<header class="testa"><h1>Cassa</h1></header>${tabs('incassi')}
      ${righe.length ? `<div class="tabella"><table><thead><tr><th>Ora</th><th>Cosa</th><th>Pagamento</th><th class="n">Importo</th></tr></thead><tbody>
        ${righe.map((r) => `<tr data-id="${r.id}" tabindex="0"><td>${esc(new Date(r.creato_il).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }))}</td>
          <td>${esc(r.articoli || r.descrizione || '—')}${r.cliente ? `<br><small class="muted">${esc(r.cliente)}</small>` : ''}</td>
          <td>${esc(r.metodo)}<br><small class="muted">${esc(r.documento)}</small></td><td class="n"><b>${esc(eur(r.totale_cent))}</b></td></tr>`).join('')}
        </tbody></table></div>` : vuoto('Oggi non hai ancora registrato vendite.')}`;
  }
  function collegaIncassi(v) {
    if (!isOwner()) { $$('tr[data-id]', v).forEach((tr) => (tr.onclick = tr.onkeydown = (e) => { if (e.type === 'keydown' && e.key !== 'Enter') return; dettaglio(Number(tr.dataset.id)); })); return; }
    const f = $('#fi', v);
    f.onchange = () => { F.da = f.da.value || oggi(); F.a = f.a.value || F.da; F.metodo = f.metodo.value; F.cat = f.cat.value; render(); };
    $$('[data-p]', f).forEach((b) => (b.onclick = () => {
      const t = oggi();
      if (b.dataset.p === 'oggi') { F.da = F.a = t; } else if (b.dataset.p === 'ieri') { F.da = F.a = FG.addGiorni(t, -1); } else { F.da = t.slice(0, 8) + '01'; F.a = t; }
      render();
    }));
    $('#fi-csv').onclick = () => csv(`incassi_${F.da}_${F.a}`, ['Data', 'Descrizione', 'Tipo', 'Cliente', 'Metodo', 'Documento', 'Numero', 'Totale', 'IVA', 'Sconto', 'Nota'],
      incassi.righe.map((r) => [r.data, r.articoli || r.descrizione || '', r.categoria || '', r.cliente || '', r.metodo, r.documento, r.numero_documento || '', eurCsv(r.totale_cent), eurCsv(r.iva_cent), eurCsv(r.sconto_cent), r.nota || '']));
    $$('tr[data-id]', v).forEach((tr) => (tr.onclick = tr.onkeydown = (e) => { if (e.type === 'keydown' && e.key !== 'Enter') return; dettaglio(Number(tr.dataset.id)); }));
  }

  async function dettaglio(id) {
    const [[e], righe] = await Promise.all([get('entrate_vista?id=eq.' + id), get('entrata_righe?entrata_id=eq.' + id + '&order=id&select=id,descrizione,quantita,prezzo_unit_cent,totale_cent')]);
    if (!e) return;
    const puoAnnullare = isOwner() || (S.imp.staff_annulla && e.creato_da === S.user.id && e.data === oggi());
    const d = apri(`<h2>Incasso del ${esc(dataIt(e.data))} <small class="muted">${esc(quando(e.creato_il))}</small></h2>
      ${righe.length ? `<table class="mini"><tbody>${righe.map((r) => `<tr><td>${esc(r.descrizione)}</td><td class="n">${esc(num(r.quantita))} × ${esc(eur(r.prezzo_unit_cent))}</td><td class="n">${esc(eur(r.totale_cent))}</td></tr>`).join('')}</tbody></table>` : `<p>${esc(e.descrizione || 'Importo libero')}</p>`}
      <p class="carr-totale"><span>Totale${e.sconto_cent ? ` (sconto ${esc(eur(e.sconto_cent))})` : ''}</span><b>${esc(eur(e.totale_cent))}</b></p>
      <p class="muted">IVA compresa: ${esc(eur(e.iva_cent))} · ${esc(e.metodo)} · ${esc(e.documento)}${e.numero_documento ? ' n. ' + esc(e.numero_documento) : ''}${e.cliente ? ' · ' + esc(e.cliente) : ''}${e.nota ? '<br>Nota: ' + esc(e.nota) : ''}</p>
      ${isOwner() ? `<form novalidate class="grid-form" id="de">
        <label class="f w2"><span>Data</span><input type="date" name="data" value="${esc(e.data)}"></label>
        <label class="f w2"><span>Tipo</span><select name="categoria_id">${catDi('entrata', false).map((c) => `<option value="${c.id}"${c.id === e.categoria_id ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
        <label class="f w2"><span>Metodo</span><select name="metodo">${[...new Set([...S.imp.metodi_incasso, e.metodo])].map((m) => `<option${m === e.metodo ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
        <label class="f w2"><span>Documento</span><select name="documento">${DOC.map(([k, t]) => `<option value="${k}"${k === e.documento ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="f w2"><span>Numero documento</span><input name="numero_documento" value="${esc(e.numero_documento || '')}" maxlength="60"></label>
        <label class="f w2"><span>Nota</span><input name="nota" value="${esc(e.nota || '')}" maxlength="1000"></label></form>` : ''}
      <div class="azioni">${puoAnnullare ? '<button class="btn danger ghost" type="button" data-annulla>Annulla incasso</button><span class="spazio"></span>' : ''}
        <button class="btn" type="button" data-chiudi>Chiudi</button>${isOwner() ? '<button class="btn primary" type="button" data-salva>Salva modifiche</button>' : ''}</div>`);
    d.querySelector('[data-chiudi]').onclick = chiudi;
    const s = d.querySelector('[data-salva]');
    if (s) s.onclick = () => occupato(s, async () => {
      const f = d.querySelector('#de');
      if (!f.data.value) return toast('Scegli la data', 'err');
      try {
        await rest('PATCH', 'entrate?id=eq.' + id, { data: f.data.value, categoria_id: Number(f.categoria_id.value) || null, metodo: f.metodo.value,
          documento: f.documento.value, numero_documento: f.numero_documento.value.trim() || null, nota: f.nota.value.trim() || null });
        chiudi(); toast('Salvato'); render(true);
      } catch (ex) { toast(ex.message, 'err'); }
    });
    const a = d.querySelector('[data-annulla]');
    if (a) a.onclick = async () => {
      if (!(await conferma(`Annullare l'incasso di ${eur(e.totale_cent)}? La merce torna in magazzino.`, 'Annulla incasso'))) return;
      try { await rpc('annulla_entrata', { p_id: id }); toast('Incasso annullato'); render(true); } catch (ex) { toast(ex.message, 'err'); }
    };
  }

  FG.dettaglioIncasso = dettaglio;

  // ------------------------------------------------------------ chiusura di cassa
  async function chiusura(data) {
    // incassi del giorno per metodo dal database (il commesso non legge gli incassi, e solo la cassa di oggi)
    const [ch, cg, storico] = await Promise.all([
      get('chiusure?data=eq.' + data), rpc('cassa_giorno', { p_data: data }), isOwner() ? get('chiusure?order=data.desc&limit=31') : [],
    ]);
    const c = ch[0] || null, per = cg.metodi || {};
    const diff = c ? c.contati_cent - c.attesi_cent : null;
    return `<header class="testa"><h1>Cassa</h1></header>${tabs('chiusura')}
      <div class="colonne2"><section class="card"><h2>Chiusura del ${esc(dataIt(data))}</h2>
      ${isOwner() ? `<div class="filtri"><label class="f"><span>Giorno</span><input type="date" id="ch-data" value="${data}" max="${oggi()}"></label>${FG.cercaDate}</div>` : ''}
      <ul class="lista compatta">${Object.entries(per).map(([m, t]) => `<li>${esc(cap(m))} <b>${esc(eur(t))}</b></li>`).join('') || '<li class="muted">Nessun incasso registrato in questo giorno.</li>'}</ul>
      <form id="ch" novalidate class="grid-form">
        <label class="f w2"><span>Fondo cassa a inizio giornata</span><div class="euro"><input name="fondo" inputmode="decimal" value="${esc(euroInput(c ? c.fondo_cent : cg.fondo_proposto || 0))}"><span>€</span></div></label>
        <label class="f w2"><span>Contanti tolti o versati in banca</span><div class="euro"><input name="versati" inputmode="decimal" value="${esc(euroInput(c ? c.versati_cent : 0))}"><span>€</span></div></label>
        <label class="f w2"><span>Contanti contati ora *</span><div class="euro"><input name="contati" inputmode="decimal" value="${esc(c ? euroInput(c.contati_cent) : '')}" required><span>€</span></div></label>
        <label class="f"><span>Nota</span><input name="nota" value="${esc(c?.nota || '')}" maxlength="1000"></label>
        <p class="alert err" hidden></p><div class="azioni"><button class="btn primary" type="submit">${c ? 'Aggiorna' : 'Salva la chiusura'}</button></div></form>
      ${c ? `<div class="esito ${diff === 0 ? 'pos' : 'neg'}"><span>Contanti attesi ${esc(eur(c.attesi_cent))} · contati ${esc(eur(c.contati_cent))}</span>
        <b>${diff === 0 ? 'Cassa giusta ✓' : diff > 0 ? `Avanzano ${esc(eur(diff))}` : `Mancano ${esc(eur(-diff))}`}</b>
        <small>Attesi = fondo + incassi in contanti − spese pagate in contanti − contanti tolti. Pagamenti elettronici del giorno: ${esc(eur(c.pos_cent))} (da confrontare con la chiusura del POS).</small></div>` : ''}
      </section>
      ${isOwner() ? `<section class="card"><h2>Ultime chiusure</h2>${storico.length ? `<table class="mini"><thead><tr><th>Giorno</th><th class="n">Attesi</th><th class="n">Contati</th><th class="n">Differenza</th></tr></thead><tbody>
        ${storico.map((x) => `<tr><td><a href="#/cassa/chiusura/${x.data}">${esc(dataIt(x.data))}</a></td><td class="n">${esc(eur(x.attesi_cent))}</td><td class="n">${esc(eur(x.contati_cent))}</td>
        <td class="n ${x.contati_cent === x.attesi_cent ? '' : 'neg'}">${esc(eur(x.contati_cent - x.attesi_cent))}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Ancora nessuna chiusura.</p>'}</section>` : ''}</div>`;
  }
  function collegaChiusura(v, data) {
    if ($('#ch-data', v)) $('#ch-data', v).onchange = (e) => FG.vai('cassa/chiusura/' + (e.target.value || oggi()));
    const f = $('#ch', v), err = f.querySelector('.alert');
    f.onsubmit = (e) => {
      e.preventDefault();
      occupato(f.querySelector('[type=submit]'), async () => {
        const fondo = cent(f.fondo.value) || 0, versati = cent(f.versati.value) || 0, contati = cent(f.contati.value);
        if ([fondo, versati, contati].some((x) => Number.isNaN(x) || x < 0) || contati == null) { err.textContent = 'Controlla gli importi (es. 120,50)'; err.hidden = false; return; }
        const dati = { fondo_cent: fondo, versati_cent: versati, contati_cent: contati, nota: f.nota.value.trim() || null };
        try {
          const c = await get('chiusure?select=id&data=eq.' + data);
          if (c.length) await rest('PATCH', 'chiusure?id=eq.' + c[0].id, dati); else await rest('POST', 'chiusure', { data, ...dati });
          toast('Chiusura salvata', 'ok'); render(true);
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      });
    };
  }

  // pulsante "+ Vendita" in alto (telefono)
  document.getElementById('nuova-vendita').onclick = () => FG.vai('cassa');
})();
