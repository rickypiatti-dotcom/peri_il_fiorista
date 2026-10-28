/* Impostazioni (titolare): tutto ciò che il cliente può cambiare da solo.
   Attività e aspetto, liste (metodi di pagamento, unità), sezioni del menu e permessi dei commessi, categorie, feste,
   utenti, registro delle modifiche, esportazione completa. Cambio password per tutti (#/password). */
'use strict';
(() => {
  const { $, $$, esc, eur, num, cent, qty, oggi, dataIt, quando, get, rest, api, S, isOwner, toast, apri, chiudi, conferma, occupato,
    campi, leggi, schede, vuoto, render, VIEWS, euroInput, pill, caricaComuni, costruisciMenu, MESI_LUNGHI, pallino } = FG;
  const tabs = (a) => schede('impostazioni', [['', 'Attività'], ['liste', 'Liste e permessi'], ['categorie', 'Categorie'], ['feste', 'Feste'], ['utenti', 'Utenti'], ['registro', 'Registro'], ['dati', 'I tuoi dati']], a);
  const MODULI = [['cassa', 'Cassa'], ['ordini', 'Ordini e preventivi'], ['magazzino', 'Magazzino, arrivi e bolle'], ['ricette', 'Composizioni'], ['spese', 'Spese'],
    ['statistiche', 'Statistiche'], ['clienti', 'Clienti'], ['fornitori', 'Fornitori'], ['registro', 'Registro delle modifiche']];
  const ricarica = async () => { await caricaComuni(); costruisciMenu(); render(true); };

  VIEWS.impostazioni = async (args) => {
    if (!isOwner()) return vuoto('Le impostazioni le cambia il titolare.');
    const t = args[0] || '';
    if (t === 'liste') return liste();
    if (t === 'categorie') return categorie();
    if (t === 'feste') return feste();
    if (t === 'utenti') return utenti();
    if (t === 'registro') return registro();
    if (t === 'dati') return dati();
    return attivita();
  };
  VIEWS.impostazioni.dopo = (v, args) => {
    if (!isOwner()) return;
    ({ '': collegaAttivita, liste: collegaListe, categorie: collegaCategorie, feste: collegaFeste, utenti: collegaUtenti, registro: collegaRegistro, dati: collegaDati }[args[0] || ''] || (() => {}))(v);
  };

  // ------------------------------------------------------------ attività e aspetto
  const CAMPI_ATT = [
    { sez: 'Dati dell\'attività (si stampano su preventivi e documenti)' },
    { k: 'nome_attivita', l: 'Nome del negozio', req: true, max: 80, w: 2 }, { k: 'ragione_sociale', l: 'Ragione sociale', max: 120, w: 2 },
    { k: 'partita_iva', l: 'Partita IVA', max: 20, w: 2 }, { k: 'codice_fiscale', l: 'Codice fiscale', max: 20, w: 2 },
    { k: 'indirizzo', l: 'Indirizzo', max: 200 }, { k: 'telefono', l: 'Telefono', t: 'tel', max: 40, w: 2 }, { k: 'email', l: 'Email', t: 'email', max: 120, w: 2 },
    { sez: 'Aspetto' },
    { k: 'colore_tema', l: 'Colore principale', t: 'color', w: 3 }, { k: 'colore_accento', l: 'Colore secondario', t: 'color', w: 3 },
    { sez: 'Conti e obiettivi' },
    { k: 'regime', l: 'Regime fiscale', t: 'select', vuoto: false, o: [['ordinario', 'Ordinario (mostra l\'IVA)'], ['forfettario', 'Forfettario (niente IVA)']], w: 2 },
    { k: 'aliquota_default', l: 'IVA proposta', t: 'select', num: true, vuoto: false, o: [[10, '10%'], [22, '22%'], [4, '4%'], [5, '5%'], [0, '0%']], w: 2 },
    { k: 'obiettivo_mese_cent', l: 'Obiettivo di incasso al mese', t: 'money', w: 3, help: 'facoltativo: barra nel cruscotto' },
    { k: 'giorni_apertura', l: 'Giorni di apertura al mese', t: 'int', req: true, w: 3, help: 'per il punto di pareggio' },
    { k: 'ricarico', l: 'Ricarico per il prezzo consigliato', t: 'qty', req: true, w: 3, help: 'es. 2,5 = costo × 2,5' },
    { k: 'scorta_minima', l: 'Scorta minima predefinita', t: 'qty', req: true, w: 3, help: 'per gli articoli senza una propria' },
    { sez: 'Preventivi' },
    { k: 'condizioni_preventivo', l: 'Condizioni proposte nei nuovi preventivi', t: 'textarea', rows: 3 },
    { k: 'note', l: 'Note interne', t: 'textarea', rows: 2 },
  ];
  function attivita() {
    return `<header class="testa"><h1>Impostazioni</h1></header>${tabs('')}<form id="ia" class="card" novalidate>${campi(CAMPI_ATT, S.imp)}
      <p class="alert err" hidden></p><div class="azioni"><button class="btn primary" type="submit">Salva</button></div></form>`;
  }
  function collegaAttivita(v) {
    const f = $('#ia', v), err = f.querySelector('.alert');
    // anteprima dei colori mentre si sceglie
    for (const k of ['colore_tema', 'colore_accento']) f[k].oninput = () => document.documentElement.style.setProperty(k === 'colore_tema' ? '--tema' : '--accento', f[k].value);
    f.onsubmit = (e) => {
      e.preventDefault();
      occupato(f.querySelector('[type=submit]'), async () => {
        err.hidden = true;
        try {
          const d = leggi(f, CAMPI_ATT);
          if (!(d.giorni_apertura >= 1 && d.giorni_apertura <= 31)) throw new Error('Giorni di apertura: da 1 a 31');
          if (!(d.ricarico >= 1 && d.ricarico <= 20)) throw new Error('Ricarico: tra 1 e 20');
          if (d.obiettivo_mese_cent != null && d.obiettivo_mese_cent < 0) throw new Error('Obiettivo non valido');
          d.condizioni_preventivo = d.condizioni_preventivo || '';
          await rest('PATCH', 'impostazioni?id=eq.1', d); toast('Impostazioni salvate', 'ok'); await ricarica();
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      });
    };
  }

  // ------------------------------------------------------------ liste e permessi
  const lista = (nome, valori, help) => `<label class="f w3"><span>${esc(nome)}</span><textarea name="${nome}" rows="8">${esc(valori.join('\n'))}</textarea><small>${esc(help)}</small></label>`;
  function liste() {
    const i = S.imp;
    return `<header class="testa"><h1>Impostazioni</h1></header>${tabs('liste')}<form id="il" class="card" novalidate>
      <h3 class="sez">Liste (una voce per riga, la prima è quella proposta)</h3><div class="grid-form">
        ${lista('Metodi di incasso', i.metodi_incasso, 'es. contanti, carta, satispay, buoni regalo')}
        ${lista('Metodi di pagamento delle spese', i.metodi_spesa, 'es. bonifico, rid, f24, carta aziendale')}
        ${lista('Unità di misura', i.unita, 'es. pz, stelo, mazzo, vaso, kg, m')}</div>
      <p class="muted"><small>Se togli una voce già usata, le registrazioni vecchie la tengono: semplicemente non la proponi più. Nelle statistiche e nella chiusura di cassa «contanti» è riconosciuto per nome.</small></p>
      <h3 class="sez">Sezioni del gestionale</h3><p class="muted">Quelle spente spariscono dal menu (i dati restano).</p>
      <div class="grid-form">${MODULI.map(([k, t]) => `<label class="check w3"><input type="checkbox" name="mod_${k}"${i.moduli.includes(k) ? ' checked' : ''}> <span>${esc(t)}</span></label>`).join('')}</div>
      <h3 class="sez">Cosa possono fare i commessi</h3><p class="muted">I commessi lavorano su cassa, ordini, clienti e magazzino; non vedono spese, statistiche, registro e impostazioni.</p>
      <div class="grid-form"><label class="check w2"><input type="checkbox" name="staff_sconti"${i.staff_sconti ? ' checked' : ''}> <span>Possono fare sconti in cassa</span></label>
        <label class="check w2"><input type="checkbox" name="staff_annulla"${i.staff_annulla ? ' checked' : ''}> <span>Possono annullare i propri incassi di oggi</span></label></div>
      <p class="alert err" hidden></p><div class="azioni"><button class="btn primary" type="submit">Salva</button></div></form>`;
  }
  function collegaListe(v) {
    const f = $('#il', v), err = f.querySelector('.alert');
    const righe = (n) => [...new Set(f.querySelector(`[name="${n}"]`).value.split('\n').map((x) => x.trim().toLowerCase()).filter(Boolean))];
    f.onsubmit = (e) => {
      e.preventDefault();
      occupato(f.querySelector('[type=submit]'), async () => {
        err.hidden = true;
        try {
          const mi = righe('Metodi di incasso'), ms = righe('Metodi di pagamento delle spese'), un = righe('Unità di misura');
          for (const [n, l, max] of [['Metodi di incasso', mi, 30], ['Metodi delle spese', ms, 30], ['Unità', un, 12]]) {
            if (!l.length) throw new Error(n + ': serve almeno una voce');
            if (l.length > (n === 'Unità' ? 30 : 20)) throw new Error(n + ': troppe voci');
            const lunga = l.find((x) => x.length > max); if (lunga) throw new Error(`${n}: «${lunga}» è troppo lunga (massimo ${max} caratteri)`);
          }
          const moduli = MODULI.map(([k]) => k).filter((k) => f['mod_' + k].checked);
          await rest('PATCH', 'impostazioni?id=eq.1', { metodi_incasso: mi, metodi_spesa: ms, unita: un, moduli, staff_sconti: f.staff_sconti.checked, staff_annulla: f.staff_annulla.checked });
          toast('Salvato', 'ok'); await ricarica();
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      });
    };
  }

  // ------------------------------------------------------------ categorie
  const AMBITI = [['prodotto', 'Articoli del magazzino'], ['spesa', 'Spese'], ['entrata', 'Incassi']];
  async function categorie() {
    await caricaComuni();
    return `<header class="testa"><h1>Impostazioni</h1></header>${tabs('categorie')}
      <p class="muted">Le categorie danno forma alle statistiche. Rinominale, cambia colore, aggiungine o spegni quelle che non usi (quelle già usate non si cancellano: si spengono).</p>
      <div class="colonne3">${AMBITI.map(([a, t]) => `<section class="card"><h2>${esc(t)}</h2><ul class="lista compatta">
        ${S.cats.filter((c) => c.ambito === a).map((c) => `<li class="${c.attiva ? '' : 'spenta'}"><button type="button" class="link" data-cat="${c.id}">${pallino(c.colore)}${esc(c.nome)}</button>
          ${c.tipo ? `<small class="muted">${esc(c.tipo)}</small>` : ''}${c.aliquota != null ? `<small class="muted">IVA ${esc(num(c.aliquota))}%</small>` : ''}${c.attiva ? '' : ' <small class="muted">spenta</small>'}</li>`).join('')}</ul>
        <button type="button" class="btn sm" data-nuova="${a}">+ Categoria</button></section>`).join('')}</div>`;
  }
  function collegaCategorie(v) {
    const campiCat = (a) => [
      { k: 'nome', l: 'Nome', req: true, max: 60 }, { k: 'colore', l: 'Colore', t: 'color', w: 2 }, { k: 'ordine', l: 'Posizione', t: 'int', w: 2 },
      ...(a === 'spesa' ? [{ k: 'tipo', l: 'Tipo', t: 'select', vuoto: false, o: [['fissa', 'Fissa (affitto, TARI, utenze...)'], ['variabile', 'Variabile']] }] : []),
      ...(a === 'prodotto' ? [{ k: 'aliquota', l: 'IVA proposta per i nuovi articoli', t: 'select', num: true, o: [[10, '10%'], [22, '22%'], [4, '4%'], [5, '5%'], [0, '0%']] }] : []),
      { k: 'attiva', l: 'Attiva', t: 'bool' }];
    const dopo = async () => { await caricaComuni(); render(true); };
    $$('[data-cat]', v).forEach((b) => (b.onclick = () => { const c = S.cats.find((x) => x.id === Number(b.dataset.cat)); FG.scheda({ titolo: 'Categoria', tabella: 'categorie', fields: campiCat(c.ambito), vals: c, dopo }); }));
    $$('[data-nuova]', v).forEach((b) => (b.onclick = () => { const a = b.dataset.nuova; FG.scheda({ titolo: 'Nuova categoria', tabella: 'categorie', fields: campiCat(a),
      vals: { colore: '#6b8f71', attiva: true, ordine: 50, tipo: a === 'spesa' ? 'variabile' : null }, prima: (d) => ({ ...d, ambito: a, ordine: d.ordine ?? 50 }), dopo }); }));
  }

  // ------------------------------------------------------------ feste
  async function feste() {
    const lista = await get('calendario?order=attivo.desc,nome');
    VIEWS.impostazioni.feste = lista;
    return `<header class="testa"><h1>Impostazioni</h1><button class="btn primary" type="button" id="fe-nuova">+ Festa o periodo</button></header>${tabs('feste')}
      <p class="muted">Il cruscotto avvisa in anticipo (per ordinare la merce) e mostra quanto si era incassato la settimana prima l'anno scorso. Aggiungi le feste del paese, la fiera, il patrono…</p>
      <div class="tabella"><table><thead><tr><th>Festa</th><th>Quando</th><th class="n">Avviso</th><th>Prossima</th></tr></thead><tbody>
      ${lista.map((f) => `<tr data-id="${f.id}" tabindex="0" class="${f.attivo ? '' : 'spenta'}"><td><b>${esc(f.nome)}</b>${f.nota ? `<br><small class="muted">${esc(f.nota)}</small>` : ''}</td>
        <td>${f.regola === 'pasqua' ? (f.scarto ? `${Math.abs(f.scarto)} giorni ${f.scarto < 0 ? 'prima di' : 'dopo'} Pasqua` : 'Pasqua') : f.regola === 'festa_mamma' ? 'Seconda domenica di maggio' : `${f.giorno} ${esc(MESI_LUNGHI[f.mese - 1])}`}</td>
        <td class="n">${f.preavviso} giorni prima</td><td>${f.attivo ? esc(dataIt(FG.prossimaFesta(f))) : 'spenta'}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function collegaFeste(v) {
    const campiF = [{ k: 'nome', l: 'Nome', req: true, max: 80 },
      { k: 'regola', l: 'Data', t: 'select', vuoto: false, o: [['fissa', 'Giorno fisso'], ['pasqua', 'Legata alla Pasqua'], ['festa_mamma', 'Festa della mamma (2ª domenica di maggio)']], w: 2 },
      { k: 'giorno', l: 'Giorno', t: 'int', w: 3 }, { k: 'mese', l: 'Mese', t: 'select', num: true, o: MESI_LUNGHI.map((m, i) => [i + 1, m]), w: 3 },
      { k: 'scarto', l: 'Giorni prima (−) o dopo (+)', t: 'int', w: 3, help: 'per le feste legate alla Pasqua' }, { k: 'preavviso', l: 'Avvisa quanti giorni prima', t: 'int', req: true, w: 3 },
      { k: 'nota', l: 'Promemoria (cosa ordinare)', t: 'textarea', rows: 2 }, { k: 'attivo', l: 'Attiva', t: 'bool' }];
    const prima = (d) => { d.scarto = d.scarto || 0; if (d.regola === 'fissa' && !(d.mese && d.giorno >= 1 && d.giorno <= new Date(2024, d.mese, 0).getDate())) throw new Error('Indica giorno e mese (un giorno che esiste in quel mese)'); if (d.regola !== 'fissa') { d.giorno = d.giorno || null; } return d; };
    $('#fe-nuova', v).onclick = () => FG.scheda({ titolo: 'Nuova festa', tabella: 'calendario', fields: campiF, vals: { regola: 'fissa', preavviso: 21, attivo: true, scarto: 0 }, prima });
    $$('tr[data-id]', v).forEach((tr) => (tr.onclick = () => FG.scheda({ titolo: 'Festa', tabella: 'calendario', fields: campiF, vals: VIEWS.impostazioni.feste.find((f) => f.id === Number(tr.dataset.id)), prima })));
  }

  // ------------------------------------------------------------ utenti
  async function utenti() {
    const lista = await api('GET', '/api/utenti');
    VIEWS.impostazioni.utenti = lista;
    return `<header class="testa"><h1>Impostazioni</h1><button class="btn primary" type="button" id="u-nuovo">+ Utente</button></header>${tabs('utenti')}
      <p class="muted">Ognuno entra con la sua email e password: nel registro si vede chi ha fatto cosa. Il titolare vede tutto; il commesso lavora su cassa, ordini, clienti e magazzino.</p>
      <div class="tabella"><table><thead><tr><th>Utente</th><th>Ruolo</th><th>Dal</th><th></th></tr></thead><tbody>
      ${lista.map((u) => `<tr><td><b>${esc(u.nome || '')}</b><br><small>${esc(u.email)}</small>${u.id === S.user.id ? ' <small class="muted">(tu)</small>' : ''}</td><td>${u.role === 'owner' ? pill('titolare', 'pos') : pill('commesso')}</td>
        <td>${esc(dataIt(u.created_at.slice(0, 10)))}</td><td class="n"><button type="button" class="btn sm" data-u="${esc(u.id)}">Modifica</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  function collegaUtenti(v) {
    $('#u-nuovo', v).onclick = () => {
      const d = apri(`<h2>Nuovo utente</h2><form novalidate class="grid-form">
        <label class="f w2"><span>Nome</span><input name="nome" maxlength="60"></label><label class="f w2"><span>Ruolo</span><select name="role"><option value="staff">Commesso</option><option value="owner">Titolare</option></select></label>
        <label class="f"><span>Email *</span><input name="email" type="email" required></label>
        <label class="f"><span>Password provvisoria * (almeno 10 caratteri)</span><input name="password" type="text" minlength="10" required autocomplete="off"><small>Dalla a voce o su un foglio: poi la persona la cambia da «Cambia password».</small></label>
        <p class="alert err" hidden></p><div class="azioni"><button class="btn" type="button" data-no>Annulla</button><button class="btn primary" type="submit">Crea</button></div></form>`, 'piccolo');
      const f = d.querySelector('form'); d.querySelector('[data-no]').onclick = chiudi;
      f.onsubmit = (e) => { e.preventDefault(); occupato(f.querySelector('[type=submit]'), async () => {
        try { await api('POST', '/api/utenti', { nome: f.nome.value, role: f.role.value, email: f.email.value.trim(), password: f.password.value }); chiudi(); toast('Utente creato', 'ok'); render(true); }
        catch (ex) { const a = f.querySelector('.alert'); a.textContent = ex.message; a.hidden = false; } }); };
    };
    $$('[data-u]', v).forEach((b) => (b.onclick = () => {
      const u = VIEWS.impostazioni.utenti.find((x) => x.id === b.dataset.u), io = u.id === S.user.id;
      const d = apri(`<h2>${esc(u.email)}</h2><form novalidate class="grid-form" id="ue">
        <label class="f w2"><span>Nome</span><input name="nome" value="${esc(u.nome || '')}" maxlength="60"></label>
        <label class="f w2"><span>Ruolo</span><select name="role"${io ? ' disabled' : ''}><option value="staff"${u.role === 'staff' ? ' selected' : ''}>Commesso</option><option value="owner"${u.role === 'owner' ? ' selected' : ''}>Titolare</option></select></label>
        <div class="azioni w1"><button class="btn primary" type="submit">Salva</button></div></form>
        ${io ? '' : `<form novalidate class="grid-form" id="up"><label class="f"><span>Nuova password (almeno 10 caratteri)</span><input name="password" type="text" minlength="10" autocomplete="off"></label>
        <div class="azioni w1"><button class="btn" type="submit">Imposta la password</button></div></form>
        <div class="azioni"><button class="btn danger ghost" type="button" data-del>Elimina utente</button></div>`}`, 'piccolo');
      const fe = d.querySelector('#ue');
      fe.onsubmit = (e) => { e.preventDefault(); occupato(fe.querySelector('[type=submit]'), async () => {
        try { await api('POST', '/api/utenti/' + u.id, { nome: fe.nome.value, ...(io ? {} : { role: fe.role.value }) }); chiudi(); toast('Salvato'); render(true); } catch (ex) { toast(ex.message, 'err'); } }); };
      const fp = d.querySelector('#up');
      if (fp) fp.onsubmit = (e) => { e.preventDefault(); occupato(fp.querySelector('[type=submit]'), async () => {
        try { await api('POST', '/api/utenti/' + u.id + '/password', { password: fp.password.value }); chiudi(); toast('Password impostata', 'ok'); } catch (ex) { toast(ex.message, 'err'); } }); };
      const del = d.querySelector('[data-del]');
      if (del) del.onclick = async () => { if (!(await conferma(`Eliminare l'utente ${u.email}? Non potrà più entrare (quello che ha registrato resta).`, 'Elimina'))) return;
        try { await api('DELETE', '/api/utenti/' + u.id); toast('Utente eliminato'); render(true); } catch (ex) { toast(ex.message, 'err'); } };
    }));
  }

  // ------------------------------------------------------------ registro delle modifiche
  const NOMI_T = { impostazioni: 'Impostazioni', categorie: 'Categoria', fornitori: 'Fornitore', clienti: 'Cliente', prodotti: 'Articolo', ricette: 'Composizione', ricorrenti: 'Spesa ricorrente',
    spese: 'Spesa', ordini: 'Ordine', ordine_righe: 'Voce di ordine', entrate: 'Incasso', movimenti: 'Movimento di magazzino', allegati: 'Allegato', bolle: 'Bolla', chiusure: 'Chiusura di cassa', calendario: 'Festa', ricorrenze: 'Ricorrenza' };
  const AZ = { insert: 'creato', update: 'modificato', delete: 'eliminato' };
  const R = { tabella: '', da: FG.addGiorni(oggi(), -7) };
  async function registro() {
    let q = `registro?quando=gte.${R.da}&order=quando.desc&limit=500`;
    if (R.tabella) q += '&tabella=eq.' + R.tabella;
    const lista = await get(q);
    VIEWS.impostazioni.reg = lista;
    const titolo = (r) => { const x = r.dopo || r.prima || {}; return x.nome || x.descrizione || x.numero || x.nome_attivita || (x.totale_cent != null ? eur(x.totale_cent) : '') || (x.quantita != null ? num(x.quantita) : '') || ''; };
    return `<header class="testa"><h1>Impostazioni</h1></header>${tabs('registro')}
      <form class="filtri" id="rf"><label class="f"><span>Dal</span><input type="date" name="da" value="${R.da}"></label>${FG.cercaDate}
        <label class="f"><span>Cosa</span><select name="tabella"><option value="">Tutto</option>${Object.entries(NOMI_T).map(([k, t]) => `<option value="${k}"${k === R.tabella ? ' selected' : ''}>${t}</option>`).join('')}</select></label></form>
      ${lista.length ? `<div class="tabella"><table><thead><tr><th>Quando</th><th>Chi</th><th>Cosa</th></tr></thead><tbody>${lista.map((r) => `<tr data-id="${r.id}" tabindex="0"><td>${esc(quando(r.quando))}</td><td>${esc(r.email || 'sistema')}</td>
        <td>${esc(NOMI_T[r.tabella] || r.tabella)} <b>${esc(AZ[r.azione] || r.azione)}</b> <small class="muted">${esc(String(titolo(r)).slice(0, 80))}</small></td></tr>`).join('')}</tbody></table></div>` : vuoto('Nessuna modifica nel periodo.')}`;
  }
  function collegaRegistro(v) {
    const f = $('#rf', v);
    f.onchange = () => { R.da = f.da.value || R.da; R.tabella = f.tabella.value; render(true); };
    $$('tr[data-id]', v).forEach((tr) => (tr.onclick = () => {
      const r = VIEWS.impostazioni.reg.find((x) => x.id === Number(tr.dataset.id));
      const chiavi = [...new Set([...Object.keys(r.prima || {}), ...Object.keys(r.dopo || {})])].filter((k) => !['aggiornato_il', 'creato_il'].includes(k));
      const cambiate = r.azione === 'update' ? chiavi.filter((k) => JSON.stringify(r.prima[k]) !== JSON.stringify(r.dopo[k])) : chiavi;
      const val = (x) => (x == null ? '—' : typeof x === 'object' ? JSON.stringify(x) : String(x));
      apri(`<h2>${esc(NOMI_T[r.tabella] || r.tabella)} ${esc(AZ[r.azione] || r.azione)}</h2><p class="muted">${esc(quando(r.quando))} · ${esc(r.email || 'sistema')}</p>
        <table class="mini"><thead><tr><th>Campo</th>${r.azione !== 'insert' ? '<th>Prima</th>' : ''}${r.azione !== 'delete' ? '<th>Dopo</th>' : ''}</tr></thead><tbody>
        ${cambiate.map((k) => `<tr><td>${esc(k)}</td>${r.azione !== 'insert' ? `<td>${esc(val(r.prima?.[k]))}</td>` : ''}${r.azione !== 'delete' ? `<td>${esc(val(r.dopo?.[k]))}</td>` : ''}</tr>`).join('')}</tbody></table>`);
    }));
  }

  // ------------------------------------------------------------ i tuoi dati
  function dati() {
    return `<header class="testa"><h1>Impostazioni</h1></header>${tabs('dati')}
      <section class="card"><h2>Scarica tutti i dati</h2><p>Un file con tutto il contenuto del gestionale (articoli, incassi, spese, ordini, clienti, fornitori, bolle, movimenti, categorie...), per tenerlo da parte o portarlo altrove. Gli allegati (foto e PDF) restano nel gestionale.</p>
      <p class="muted">I dati sono comunque salvati ogni notte sul server e in una copia cifrata fuori casa.</p>
      <button class="btn primary" type="button" id="d-json">⬇ Scarica tutto (JSON)</button></section>
      <section class="card"><h2>🌷 Dati di esempio</h2>
      <p>Per far vedere come funziona: un anno di negozio finto (articoli, composizioni, bolle, vendite con i picchi delle feste, ordini, preventivi, spese, chiusure di cassa).
      Si caricano solo a gestionale vuoto e si cancellano con un tocco prima di iniziare a usarlo davvero (categorie e feste restano).</p>
      <div class="azioni sinistra"><button class="btn" type="button" id="d-esempio">Carica i dati di esempio</button>
      <button class="btn danger ghost" type="button" id="d-via">Cancella i dati di esempio</button></div></section>`;
  }
  function collegaDati(v) {
    const es = $('#d-esempio', v), via = $('#d-via', v);
    es.onclick = () => occupato(es, async () => {
      if (!(await conferma('Caricare un anno di dati finti? Ci vuole circa un minuto. Si possono cancellare quando vuoi.', 'Carica', false))) return;
      es.disabled = true; es.textContent = 'Carico… (circa un minuto)';
      try { const r = await FG.rpc('carica_dati_esempio'); await caricaComuni(); toast(`Caricati ${r.articoli} articoli, ${r.incassi} incassi, ${r.bolle} bolle, ${r.spese} spese`, 'ok'); FG.vai('cruscotto'); }
      catch (ex) { toast(ex.message, 'err'); }
    });
    via.onclick = () => occupato(via, async () => {
      if (!(await conferma('Cancellare tutti i dati di esempio? Quello che hai inserito tu resta.', 'Cancella'))) return;
      try { await FG.rpc('cancella_dati_esempio'); await caricaComuni(); toast('Dati di esempio cancellati', 'ok'); render(true); }
      catch (ex) { toast(ex.message, 'err'); }
    });
    const b = $('#d-json', v);
    b.onclick = () => occupato(b, async () => {
      const tabelle = ['impostazioni', 'categorie', 'fornitori', 'clienti', 'ricorrenze', 'prodotti', 'ricette', 'ricetta_righe', 'bolle', 'movimenti', 'entrate', 'entrata_righe',
        'ordini', 'ordine_righe', 'spese', 'ricorrenti', 'chiusure', 'calendario'];
      // tabelle con colonne di costo: le colonne complete (costi compresi) il titolare le legge dalle viste
      const VISTA = { prodotti: 'prodotti_vista', ricette: 'ricette_vista', movimenti: 'movimenti_vista', entrata_righe: 'entrata_righe_vista' };
      const out = { esportato_il: new Date().toISOString(), attivita: S.imp.nome_attivita };
      try {
        for (const t of tabelle) {
          out[t] = [];
          for (let da = 0; ; da += 5000) { const r = await get(`${VISTA[t] || t}?order=id&limit=5000&offset=${da}`); out[t].push(...r); if (r.length < 5000) break; }
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
        a.download = `gestionale_${oggi()}.json`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      } catch (ex) { toast(ex.message, 'err'); }
    });
  }

  // ------------------------------------------------------------ cambio password (tutti)
  VIEWS.password = () => `<header class="testa"><h1>Cambia password</h1></header><form id="pw" class="card stretta" novalidate>
    <label class="f"><span>Password attuale</span><input name="attuale" type="password" autocomplete="current-password" required></label>
    <label class="f"><span>Nuova password (almeno 10 caratteri)</span><input name="nuova" type="password" autocomplete="new-password" minlength="10" required></label>
    <label class="f"><span>Ripeti la nuova password</span><input name="ripeti" type="password" autocomplete="new-password" required></label>
    <p class="alert err" hidden></p><div class="azioni"><button class="btn primary" type="submit">Cambia</button></div></form>`;
  VIEWS.password.dopo = (v) => {
    const f = $('#pw', v), err = f.querySelector('.alert');
    f.onsubmit = (e) => { e.preventDefault(); occupato(f.querySelector('[type=submit]'), async () => {
      err.hidden = true;
      if (f.nuova.value !== f.ripeti.value) { err.textContent = 'Le due password nuove non coincidono'; err.hidden = false; return; }
      try { await api('POST', '/api/password', { attuale: f.attuale.value, nuova: f.nuova.value }); f.reset(); toast('Password cambiata', 'ok'); } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    }); };
  };
})();
