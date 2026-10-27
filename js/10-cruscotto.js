/* Cruscotto: la giornata a colpo d'occhio, cosa scade, cosa manca, feste in arrivo, punto di pareggio. */
'use strict';
(() => {
  const { esc, eur, eur0, num, perc, oggi, iso, giorno, addGiorni, dataBreve, dataIt, giorniTra, get, rpc, isOwner, S, modulo, VIEWS } = FG;

  // Pasqua (algoritmo gregoriano anonimo)
  function pasqua(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
  }
  // data di una festa del calendario in un certo anno (stringa AAAA-MM-GG)
  FG.dataFesta = (f, anno) => {
    let d;
    if (f.regola === 'pasqua') { d = pasqua(anno); d.setDate(d.getDate() + (f.scarto || 0)); }
    else if (f.regola === 'festa_mamma') { d = new Date(anno, 4, 1); d.setDate(1 + ((7 - d.getDay()) % 7) + 7); d.setDate(d.getDate() + (f.scarto || 0)); }
    else { d = new Date(anno, f.mese - 1, f.giorno); d.setDate(d.getDate() + (f.scarto || 0)); }
    return iso(d);
  };
  // prossima volta (da oggi in poi)
  FG.prossimaFesta = (f) => { const y = new Date().getFullYear(); const a = FG.dataFesta(f, y); return a >= oggi() ? a : FG.dataFesta(f, y + 1); };
  FG.prossimaRicorrenza = (r) => {
    const y = new Date().getFullYear(); const t = oggi();
    const mk = (yy) => iso(new Date(yy, r.mese - 1, Math.min(r.giorno, new Date(yy, r.mese, 0).getDate())));
    return mk(y) >= t ? mk(y) : mk(y + 1);
  };

  const tra = (d) => { const n = giorniTra(oggi(), d); return n === 0 ? 'oggi' : n === 1 ? 'domani' : n < 0 ? `${-n} giorni fa` : `tra ${n} giorni`; };
  const STATI_ORD = { da_fare: 'Da fare', in_lavorazione: 'In lavorazione', pronto: 'Pronto', consegnato: 'Consegnato', annullato: 'Annullato' };
  FG.STATI_ORD = STATI_ORD;

  VIEWS.cruscotto = async () => {
    const [c, feste, ric] = await Promise.all([
      rpc('cruscotto'),
      get('calendario?attivo=is.true&order=nome'),
      modulo('clienti') ? get('ricorrenze?select=*,clienti(id,nome,telefono)') : Promise.resolve([]),
    ]);
    const t = oggi();
    // feste entro il preavviso, con l'incasso della stessa settimana dell'anno scorso
    const vicine = feste.map((f) => ({ ...f, quando: FG.prossimaFesta(f) })).filter((f) => giorniTra(t, f.quando) <= f.preavviso).sort((a, b) => (a.quando < b.quando ? -1 : 1));
    await Promise.all(vicine.map(async (f) => {
      const y = Number(f.quando.slice(0, 4)) - 1, d = FG.dataFesta(f, y);
      try {
        const r = await get(`entrate?select=totale_cent&data=gte.${addGiorni(d, -6)}&data=lte.${d}`);
        f.anno_scorso = r.reduce((a, x) => a + x.totale_cent, 0);
      } catch { f.anno_scorso = null; }
    }));
    const ricVicine = ric.map((r) => ({ ...r, quando: FG.prossimaRicorrenza(r) })).filter((r) => giorniTra(t, r.quando) <= r.preavviso).sort((a, b) => (a.quando < b.quando ? -1 : 1));

    const ora = new Date().getHours();
    const saluto = ora < 13 ? 'Buongiorno' : ora < 18 ? 'Buon pomeriggio' : 'Buonasera';
    const metodi = Object.entries(c.oggi_metodi || {}).map(([m, v]) => `${esc(m)} ${esc(eur(v))}`).join(' · ');
    let h = `<header class="testa"><div><h1>${saluto}</h1><p class="muted">${esc(giorno(t).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</p></div>
      ${modulo('cassa') ? '<a class="btn primary" href="#/cassa">+ Nuova vendita</a>' : ''}</header>`;

    h += '<section class="kpi">';
    h += kpi('Incassato oggi', eur(c.oggi.totale), `${c.oggi.n} ${c.oggi.n === 1 ? 'incasso' : 'incassi'}${metodi ? ' · ' + metodi : ''}`);
    h += kpi('Incassato nel mese', eur(c.mese_entrate), isOwner() && c.mese_anno_scorso ? `anno scorso nello stesso mese: ${eur(c.mese_anno_scorso)}` : '');
    if (isOwner()) {
      h += kpi('Uscite del mese', eur(c.mese_uscite), `costi fissi: circa ${eur0(c.costi_fissi_mese)} al mese`);
      const utile = c.mese_entrate - c.mese_uscite;
      h += kpi('Risultato del mese', eur(utile), 'incassi meno spese registrate', utile < 0 ? 'neg' : 'pos');
    }
    h += '</section>';

    if (isOwner()) h += pareggio(c);

    const box = [];
    if (vicine.length) box.push(`<section class="card"><h2>🎉 Feste in arrivo</h2><ul class="lista">${vicine.map((f) => `<li><div><b>${esc(f.nome)}</b> <span class="muted">${esc(dataBreve(f.quando))} · ${esc(tra(f.quando))}</span>
      ${f.nota ? `<br><small>${esc(f.nota)}</small>` : ''}${f.anno_scorso ? `<br><small class="muted">L'anno scorso, nella settimana prima: ${esc(eur(f.anno_scorso))}</small>` : ''}</div></li>`).join('')}</ul>
      ${modulo('magazzino') ? '<a class="link" href="#/magazzino/riordino">Prepara la lista di riordino →</a>' : ''}</section>`);
    if (modulo('ordini')) box.push(`<section class="card"><h2>💐 Ordini dei prossimi 7 giorni</h2>${c.ordini.length ? `<ul class="lista">${c.ordini.map((o) => `<li><a href="#/ordini/${o.id}">
      <b>${esc(dataBreve(o.data_consegna))}${o.ora_consegna ? ' ' + esc(o.ora_consegna.slice(0, 5)) : ''}</b> · ${esc(o.descrizione.slice(0, 80))}${o.cliente ? ` <span class="muted">(${esc(o.cliente)})</span>` : ''}</a>
      ${FG.pill(STATI_ORD[o.stato], o.stato)}${o.data_consegna < t ? FG.pill('in ritardo', 'neg') : ''}${o.totale_cent > o.incassato_cent ? ` <small class="muted">da incassare ${esc(eur(o.totale_cent - o.incassato_cent))}</small>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Nessun ordine in consegna.</p>'}
      <a class="link" href="#/ordini">Tutti gli ordini →</a></section>`);
    if (ricVicine.length) box.push(`<section class="card"><h2>🎂 Ricorrenze dei clienti</h2><ul class="lista">${ricVicine.map((r) => `<li><div><b>${esc(r.clienti?.nome || '')}</b>: ${esc(r.descrizione)}
      <span class="muted">${esc(dataBreve(r.quando))} · ${esc(tra(r.quando))}</span>${r.clienti?.telefono ? `<br><a href="tel:${esc(r.clienti.telefono.replace(/\s/g, ''))}">${esc(r.clienti.telefono)}</a>` : ''}</div></li>`).join('')}</ul>
      <p class="muted"><small>Un messaggio o una telefonata qualche giorno prima: spesso diventa un ordine.</small></p></section>`);
    if (isOwner() && (c.da_pagare.length || c.ricorrenti.length)) box.push(`<section class="card"><h2>🧾 Da pagare</h2><ul class="lista">
      ${c.da_pagare.map((s) => `<li><a href="#/spese/da-pagare">${esc(s.descrizione)}</a> <b>${esc(eur(s.importo_cent))}</b> ${s.scadenza ? `<span class="${s.scadenza < t ? 'neg' : 'muted'}">scade ${esc(dataBreve(s.scadenza))}</span>` : ''}</li>`).join('')}
      ${c.ricorrenti.map((s) => `<li><a href="#/spese/ricorrenti">${esc(s.descrizione)}</a> <b>${esc(eur(s.importo_cent))}</b> <span class="${s.prossima < t ? 'neg' : 'muted'}">${s.prossima < t ? 'da registrare dal' : 'prevista'} ${esc(dataBreve(s.prossima))}</span> ${FG.pill('ricorrente')}</li>`).join('')}
      </ul></section>`);
    if (modulo('magazzino') && (c.n_sotto_scorta || c.da_controllare.length)) box.push(`<section class="card"><h2>🌿 Magazzino</h2>
      ${c.n_sotto_scorta ? `<p><b>${c.n_sotto_scorta}</b> ${c.n_sotto_scorta === 1 ? 'articolo sotto la scorta minima' : 'articoli sotto la scorta minima'}</p><ul class="lista compatta">${c.sotto_scorta.slice(0, 8).map((p) => `<li>${esc(p.nome)} <span class="${p.giacenza <= 0 ? 'neg' : 'muted'}">${esc(num(p.giacenza))} ${esc(p.unita)} (minimo ${esc(num(p.scorta))})</span></li>`).join('')}</ul>
      <a class="btn sm" href="#/magazzino/riordino">Lista di riordino</a>` : ''}
      ${c.da_controllare.length ? `<p class="mt"><b>Da controllare</b> (fiori e verde arrivati da più giorni del previsto):</p><ul class="lista compatta">${c.da_controllare.map((p) => `<li>${esc(p.nome)} <span class="neg">arrivati da ${esc(p.giorni_da_carico)} giorni</span> <span class="muted">(durata ${esc(p.giorni_vita)})</span></li>`).join('')}</ul>
      <a class="btn sm" href="#/magazzino/movimenti">Registra uno scarto</a>` : ''}
      ${isOwner() && c.bolle_da_fatturare ? `<p class="mt">📦 <a href="#/bolle">${c.bolle_da_fatturare} ${c.bolle_da_fatturare === 1 ? 'bolla' : 'bolle'} senza fattura collegata</a></p>` : ''}</section>`);
    h += `<div class="colonne2">${box.join('')}</div>`;

    if (isOwner() && c.mesi) {
      h += `<section class="card"><h2>Ultimi 12 mesi</h2>${FG.colonne(c.mesi.map((m) => FG.meseIt(m.mese)), [
        { nome: 'Incassi', colore: S.imp.colore_tema, valori: c.mesi.map((m) => m.entrate) },
        { nome: 'Spese', colore: S.imp.colore_accento, valori: c.mesi.map((m) => m.uscite) },
      ], { linea: { nome: 'Risultato', colore: '#e0a96d', valori: c.mesi.map((m) => m.entrate - m.uscite) } })}
      <p class="muted"><small>Valore del magazzino (al costo d'acquisto): <b>${esc(eur(c.valore_magazzino))}</b></small></p></section>`;
    }
    return h;
  };

  function kpi(titolo, valore, nota = '', cls = '') {
    return `<div class="kpi-box ${cls}"><span>${esc(titolo)}</span><b>${esc(valore)}</b>${nota ? `<small>${nota.includes('<') ? nota : esc(nota)}</small>` : ''}</div>`;
  }

  // Quanto serve incassare per coprire le spese, e dove si arriva a fine mese a questo ritmo
  function pareggio(c) {
    const fabbisogno = Math.max(c.spesa_media_mese || 0, c.costi_fissi_mese || 0);
    const obiettivo = c.obiettivo_mese || 0;
    const giorniApertura = c.giorni_apertura || 26;
    const alGiorno = fabbisogno / giorniApertura;
    const media = c.giorni_con_incassi ? c.mese_entrate / c.giorni_con_incassi : 0;
    const restanti = Math.max(0, Math.round(((c.giorni_mese - c.giorno_mese) * giorniApertura) / c.giorni_mese));
    const previsione = c.mese_entrate + media * restanti;
    if (!fabbisogno && !obiettivo) {
      return `<section class="card nota"><h2>⚖️ Punto di pareggio</h2><p class="muted">Registra le spese (o le spese ricorrenti: affitto, TARI, luce...) e qui vedrai quanto serve incassare ogni giorno per coprirle, con la previsione di fine mese.</p></section>`;
    }
    const meta = Math.max(fabbisogno, obiettivo);
    return `<section class="card"><h2>⚖️ Punto di pareggio e previsione</h2>
      <div class="pareggio">
        <div><span>Per coprire le spese servono circa</span><b>${esc(eur0(fabbisogno))}</b><small>al mese · ${esc(eur0(alGiorno))} per ogni giorno di apertura (${giorniApertura} al mese)</small></div>
        <div><span>A questo ritmo a fine mese</span><b class="${previsione >= fabbisogno ? 'pos' : 'neg'}">${esc(eur0(previsione))}</b><small>media ${esc(eur0(media))} per giorno con incassi · ancora circa ${restanti} giorni di apertura</small></div>
        ${obiettivo ? `<div><span>Obiettivo del mese</span><b>${esc(eur0(obiettivo))}</b><small>raggiunto il ${esc(perc(c.mese_entrate / obiettivo))}</small></div>` : ''}
      </div>
      ${FG.avanzamento(c.mese_entrate, meta, previsione >= fabbisogno ? 'ok' : '')}
      <p class="muted"><small>${previsione >= fabbisogno ? 'Bene: con questo andamento le spese del mese sono coperte.' : `Mancano circa ${esc(eur0(Math.max(0, fabbisogno - c.mese_entrate)))} per coprire le spese medie del mese.`}
      La spesa media è quella degli ultimi 12 mesi (o le spese ricorrenti, se più alte). Obiettivo e giorni di apertura si cambiano in Impostazioni.</small></p></section>`;
  }
})();
