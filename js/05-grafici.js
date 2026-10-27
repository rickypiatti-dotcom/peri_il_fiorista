/* Grafici disegnati a mano in SVG/HTML (niente librerie esterne): colonne a coppie, barre orizzontali, ciambella. */
'use strict';
(() => {
  const { esc, eur, eur0, perc } = FG;
  const colore = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#999999');

  // Colonne affiancate per mese: serie = [{ nome, colore, valori: [] }], etichette = []
  FG.colonne = (etichette, serie, { altezza = 220, linea } = {}) => {
    if (!etichette.length) return '<p class="muted">Nessun dato.</p>';
    const max = Math.max(1, ...serie.flatMap((s) => s.valori.map((v) => Math.abs(v))), ...(linea ? linea.valori.map(Math.abs) : []));
    const W = Math.max(320, etichette.length * (serie.length * 14 + 16)), H = altezza, base = H - 26, top = 10;
    const passo = W / etichette.length, larg = Math.min(26, (passo - 10) / serie.length);
    const y = (v) => base - (Math.max(0, v) / max) * (base - top);
    let g = '';
    for (let k = 0; k <= 4; k++) {
      const v = (max * k) / 4, yy = y(v);
      g += `<line x1="0" x2="${W}" y1="${yy}" y2="${yy}" class="griglia"/><text x="2" y="${yy - 3}" class="asse">${esc(eur0(v))}</text>`;
    }
    etichette.forEach((et, i) => {
      const x0 = i * passo + (passo - larg * serie.length) / 2;
      serie.forEach((s, j) => {
        const v = s.valori[i] || 0, yy = y(v);
        g += `<rect x="${x0 + j * larg}" y="${yy}" width="${larg - 2}" height="${Math.max(0, base - yy)}" rx="3" fill="${colore(s.colore)}"><title>${esc(et)} · ${esc(s.nome)}: ${esc(eur(v))}</title></rect>`;
      });
      g += `<text x="${i * passo + passo / 2}" y="${H - 8}" class="asse" text-anchor="middle">${esc(et)}</text>`;
    });
    if (linea) {
      const pts = linea.valori.map((v, i) => `${i * passo + passo / 2},${base - (v / max) * (base - top)}`).join(' ');
      g += `<polyline points="${pts}" fill="none" stroke="${colore(linea.colore)}" stroke-width="2.5" stroke-linejoin="round"/>`;
      linea.valori.forEach((v, i) => { g += `<circle cx="${i * passo + passo / 2}" cy="${base - (v / max) * (base - top)}" r="3.5" fill="${colore(linea.colore)}"><title>${esc(etichette[i])} · ${esc(linea.nome)}: ${esc(eur(v))}</title></circle>`; });
      g += `<line x1="0" x2="${W}" y1="${base}" y2="${base}" class="zero"/>`;
    }
    const leg = [...serie, ...(linea ? [linea] : [])].map((s) => `<span><i class="dot" style="background:${colore(s.colore)}"></i>${esc(s.nome)}</span>`).join('');
    return `<div class="grafico"><div class="scorri"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Grafico">${g}</svg></div><div class="legenda">${leg}</div></div>`;
  };

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
    const R = 60, C = 2 * Math.PI * R; let off = 0, g = '';
    for (const v of voci) {
      const l = (Math.max(0, v.valore) / tot) * C;
      g += `<circle r="${R}" cx="80" cy="80" fill="none" stroke="${colore(v.colore)}" stroke-width="26" stroke-dasharray="${l} ${C - l}" stroke-dashoffset="${-off}"><title>${esc(v.nome)}: ${esc(eur(v.valore))} (${esc(perc(v.valore / tot))})</title></circle>`;
      off += l;
    }
    return `<div class="ciambella"><svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="Ripartizione"><g transform="rotate(-90 80 80)">${g}</g>
      <text x="80" y="84" text-anchor="middle" class="centro">${esc(centro)}</text></svg>
      <ul>${voci.slice(0, 10).map((v) => `<li><i class="dot" style="background:${colore(v.colore)}"></i>${esc(v.nome)} <b>${esc(perc(v.valore / tot))}</b></li>`).join('')}</ul></div>`;
  };

  // Barra di avanzamento (obiettivo, pareggio)
  FG.avanzamento = (valore, obiettivo, cls = '') => {
    const p = obiettivo > 0 ? Math.min(1, valore / obiettivo) : 0;
    return `<div class="avanz ${cls}"><i style="width:${(p * 100).toFixed(1)}%"></i></div>`;
  };
})();
