/* Grafici disegnati a mano in SVG/HTML (niente librerie esterne): colonne a coppie, barre orizzontali, ciambella. */
'use strict';
(() => {
  const { esc, eur, eur0, perc } = FG;
  const colore = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#999999');

  // Colonne affiancate per mese: serie = [{ nome, colore, valori: [] }], etichette = [], linea = { nome, colore, valori } facoltativa.
  // Qui si prepara solo il posto: il disegno vero lo fa FG.disegnaGrafici() con la LARGHEZZA REALE del riquadro
  // (prima l'SVG era piccolo e veniva ingrandito: scritte e barre enormi e sgranate).
  const SPEC = new Map(); let nSpec = 0;
  FG.colonne = (etichette, serie, { altezza = 230, linea } = {}) => {
    if (!etichette.length) return '<p class="muted">Nessun dato.</p>';
    const id = 'g' + ++nSpec;
    SPEC.set(id, { etichette, serie, linea, altezza });
    if (SPEC.size > 40) SPEC.delete(SPEC.keys().next().value); // si tengono solo i grafici recenti
    const leg = [...serie, ...(linea ? [linea] : [])].map((x) => `<span><i class="${x === linea ? 'trattino' : 'dot'}" style="background:${colore(x.colore)}"></i>${esc(x.nome)}</span>`).join('');
    return `<div class="grafico" data-gr="${id}"><div class="gr-area" style="height:${altezza}px"></div><div class="gr-info" hidden></div><div class="legenda">${leg}</div></div>`;
  };

  // importi brevi per l'asse: 0 €, 850 €, 1,5k €, 12k €
  const breve = (c) => { const e = Number(c) / 100, a = Math.abs(e); return (a >= 1000 ? (e / 1000).toLocaleString('it-IT', { maximumFractionDigits: a >= 10000 ? 0 : 1 }) + 'k' : Math.round(e).toLocaleString('it-IT')) + ' €'; };
  // passo "tondo" per la griglia (1, 2, 2,5, 5 × 10^n)
  function passoTondo(intervallo, righe) {
    const grezzo = intervallo / righe, p = 10 ** Math.floor(Math.log10(grezzo || 1)), r = grezzo / p;
    return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p;
  }

  function disegna(box, sp) {
    const area = box.querySelector('.gr-area'), info = box.querySelector('.gr-info');
    const W = Math.max(260, Math.floor(area.clientWidth)), H = sp.altezza;
    const n = sp.etichette.length, sinistra = 46, destra = 8, sopra = 10, sotto = 24;
    const tutti = [...sp.serie.flatMap((x) => x.valori), ...(sp.linea ? sp.linea.valori : [])].map(Number);
    const passo = passoTondo(Math.max(1, Math.max(0, ...tutti) - Math.min(0, ...tutti)), 4);
    const max = Math.max(passo, Math.ceil(Math.max(0, ...tutti) / passo) * passo), min = Math.floor(Math.min(0, ...tutti) / passo) * passo;
    const y = (v) => sopra + (1 - (v - min) / (max - min)) * (H - sopra - sotto);
    const largo = (W - sinistra - destra) / n, cx = (i) => sinistra + largo * (i + 0.5);
    const barra = Math.max(3, Math.min(14, (largo * 0.62) / sp.serie.length - 2)), spazio = 2;
    const ogni = largo < 34 ? 2 : 1; // al telefono si scrive un mese sì e uno no
    let g = '';
    for (let v = min; v <= max + 1e-6; v += passo) {
      const yy = Math.round(y(v)) + 0.5;
      g += `<line x1="${sinistra}" x2="${W - destra}" y1="${yy}" y2="${yy}" class="${v === 0 ? 'zero' : 'griglia'}"/><text x="${sinistra - 6}" y="${yy + 3.5}" class="asse" text-anchor="end">${esc(breve(v))}</text>`;
    }
    sp.etichette.forEach((et, i) => {
      const gruppo = sp.serie.length * barra + (sp.serie.length - 1) * spazio, x0 = cx(i) - gruppo / 2;
      sp.serie.forEach((x, j) => {
        const v = Number(x.valori[i] || 0); if (!v) return;
        const y0 = y(0), y1 = y(v), alto = Math.max(1, Math.abs(y0 - y1));
        g += `<rect x="${(x0 + j * (barra + spazio)).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${barra.toFixed(1)}" height="${alto.toFixed(1)}" rx="${Math.min(3, barra / 2)}" fill="${colore(x.colore)}" class="gr-barra"/>`;
      });
      if (i % ogni === (n - 1) % ogni) g += `<text x="${cx(i).toFixed(1)}" y="${H - 7}" class="asse" text-anchor="middle">${esc(et)}</text>`;
    });
    if (sp.linea) {
      const pts = sp.linea.valori.map((v, i) => `${cx(i).toFixed(1)},${y(Number(v)).toFixed(1)}`).join(' ');
      g += `<polyline points="${pts}" fill="none" stroke="${colore(sp.linea.colore)}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/>`;
      sp.linea.valori.forEach((v, i) => { g += `<circle cx="${cx(i).toFixed(1)}" cy="${y(Number(v)).toFixed(1)}" r="2.6" fill="#fff" stroke="${colore(sp.linea.colore)}" stroke-width="1.5"/>`; });
    }
    g += `<rect class="gr-evid" x="0" y="${sopra}" width="${largo}" height="${H - sopra - sotto}" style="display:none"/>`;
    area.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafico">${g}</svg>`;

    // riquadro con i valori del mese sotto il dito o il mouse
    const svg = area.firstElementChild, evid = svg.querySelector('.gr-evid');
    const mostra = (clientX) => {
      const r = svg.getBoundingClientRect(), i = Math.floor((clientX - r.left - sinistra) / largo);
      if (i < 0 || i >= n) return nascondi();
      evid.setAttribute('x', sinistra + largo * i); evid.style.display = '';
      const righe = [...sp.serie, ...(sp.linea ? [sp.linea] : [])].map((x) => `<div><i class="dot" style="background:${colore(x.colore)}"></i>${esc(x.nome)} <b class="${x === sp.linea && x.valori[i] < 0 ? 'neg' : ''}">${esc(eur(x.valori[i] || 0))}</b></div>`).join('');
      info.innerHTML = `<b>${esc(sp.etichette[i])}</b>${righe}`; info.hidden = false;
      const sx = cx(i) + 12 + info.offsetWidth > W ? cx(i) - 12 - info.offsetWidth : cx(i) + 12;
      info.style.left = Math.max(0, sx) + 'px'; info.style.top = '8px';
    };
    const nascondi = () => { info.hidden = true; evid.style.display = 'none'; };
    svg.onpointermove = (e) => mostra(e.clientX);
    svg.onpointerdown = (e) => mostra(e.clientX);
    svg.onpointerleave = (e) => { if (e.pointerType === 'mouse') nascondi(); };
  }

  FG.disegnaGrafici = (root = document) => {
    for (const box of root.querySelectorAll('.grafico[data-gr]')) { const sp = SPEC.get(box.dataset.gr); if (sp) disegna(box, sp); }
  };
  let attesa = null;
  window.addEventListener('resize', () => { clearTimeout(attesa); attesa = setTimeout(() => FG.disegnaGrafici(), 150); });

  // Barre orizzontali: voci = [{ nome, valore, colore, nota }]
  FG.barre = (voci, { totale, formato = eur, max } = {}) => {
    if (!voci.length) return '<p class="muted">Nessun dato nel periodo.</p>';
    const tot = totale ?? voci.reduce((a, v) => a + Number(v.valore || 0), 0);
    const m = max ?? Math.max(1, ...voci.map((v) => Number(v.valore || 0)));
    return `<ul class="barre">${voci.map((v) => `<li><div class="riga"><span>${esc(v.nome)}${v.nota ? ` <small class="muted">${esc(v.nota)}</small>` : ''}</span><b>${esc(formato(v.valore))}${tot ? ` <small class="muted">${esc(perc(v.valore / tot))}</small>` : ''}</b></div>
      <div class="traccia"><i style="width:${Math.max(0.5, (Number(v.valore || 0) / m) * 100)}%;background:${colore(v.colore)}"></i></div></li>`).join('')}</ul>`;
  };

  // Ciambella con legenda
  FG.ciambella = (voci, { centro = '' } = {}) => {
    const tot = voci.reduce((a, v) => a + Math.max(0, Number(v.valore || 0)), 0);
    if (!tot) return '<p class="muted">Nessun dato nel periodo.</p>';
    const R = 62, C = 2 * Math.PI * R; let off = 0, g = '';
    for (const v of voci) {
      const l = (Math.max(0, v.valore) / tot) * C;
      g += `<circle r="${R}" cx="80" cy="80" fill="none" stroke="${colore(v.colore)}" stroke-width="14" stroke-dasharray="${Math.max(0, l - 1.5)} ${C - Math.max(0, l - 1.5)}" stroke-dashoffset="${-off}"><title>${esc(v.nome)}: ${esc(eur(v.valore))} (${esc(perc(v.valore / tot))})</title></circle>`;
      off += l;
    }
    return `<div class="ciambella"><svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="Ripartizione"><g transform="rotate(-90 80 80)">${g}</g>
      <text x="80" y="78" text-anchor="middle" class="centro-et">totale</text><text x="80" y="96" text-anchor="middle" class="centro">${esc(centro)}</text></svg>
      <ul>${voci.slice(0, 10).map((v) => `<li><i class="dot" style="background:${colore(v.colore)}"></i>${esc(v.nome)} <b>${esc(perc(v.valore / tot))}</b></li>`).join('')}</ul></div>`;
  };

  // Barra di avanzamento (obiettivo, pareggio)
  FG.avanzamento = (valore, obiettivo, cls = '') => {
    const p = obiettivo > 0 ? Math.min(1, valore / obiettivo) : 0;
    return `<div class="avanz ${cls}"><i style="width:${(p * 100).toFixed(1)}%"></i></div>`;
  };
})();
