/* =========================================================
   Gestionale del fiorista: base comune a tutte le sezioni.
   Login (servizio /auth), dati con PostgREST (/rest/v1) usando il token, aggiornamenti in diretta (SSE).
   Le regole (chi vede cosa) stanno nel database: qui si decide solo cosa mostrare.
   Tutto ciò che arriva dal database passa da esc() prima di finire nella pagina.
   ========================================================= */
'use strict';
window.FG = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');

  // ------------------------------------------------------------ numeri e date
  const eur = (c) => (c == null || c === '' ? '—' : (Number(c) / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }));
  const eur0 = (c) => (Number(c || 0) / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const euroInput = (c) => (c == null || c === '' ? '' : (Number(c) / 100).toFixed(2).replace('.', ','));
  const num = (q, d = 2) => (q == null ? '—' : Number(q).toLocaleString('it-IT', { maximumFractionDigits: d }));
  const perc = (x) => (x == null || !isFinite(x) ? '—' : (x * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + '%');
  // Importo scritto a mano ("1.890,00", "1890.5", "24") -> centesimi. null se vuoto, NaN se sbagliato.
  function cent(v) {
    let s = String(v ?? '').replace(/[€\s]/g, '').replace(/[.,]$/, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return NaN;
    return Math.round(Number(s) * 100);
  }
  // Quantità ("1,5", "12") -> numero. null se vuoto, NaN se sbagliato.
  function qty(v) {
    const s = String(v ?? '').trim().replace(/[.,]$/, '').replace(',', '.');
    if (!s) return null;
    if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return NaN;
    return Number(s);
  }
  // Date in ora locale (MAI toISOString: tra mezzanotte e le 2 darebbe il giorno prima)
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const oggi = () => iso(new Date());
  const giorno = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const addGiorni = (s, n) => { const d = giorno(s); d.setDate(d.getDate() + n); return iso(d); };
  const dataIt = (s) => (s ? giorno(s).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
  const dataBreve = (s) => (s ? giorno(s).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }) : '—');
  const quando = (d) => (d ? new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const MESI_LUNGHI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const meseIt = (ym) => { const [y, m] = ym.split('-').map(Number); return MESI[m - 1] + ' ' + String(y).slice(2); };
  const giorniTra = (a, b) => Math.round((giorno(b) - giorno(a)) / 86400000);
  const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

  // ------------------------------------------------------------ stato
  const TOK = 'fg_sessione';
  const S = { token: null, user: null, role: null, imp: null, cats: [], fornitori: [], route: 'cruscotto', args: [] };
  const isOwner = () => S.role === 'owner';
  // metodo di pagamento con contabilità separata (buoni regalo); stessa regola di public.metodo_separato()
  const separato = (m) => String(m || '').trim().toLowerCase() === 'altro';

  function toast(msg, kind = '') {
    const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg;
    const box = $('#toasts'); box.appendChild(t); while (box.children.length > 3) box.firstElementChild.remove();
    setTimeout(() => t.remove(), kind === 'err' ? 8000 : 3500);
  }

  // ------------------------------------------------------------ rete
  const ERRORI = {
    '23505': 'Esiste già un elemento con lo stesso nome o codice',
    '23514': 'Un valore non è valido: controlla i campi',
    '23502': 'Manca un valore obbligatorio: controlla i campi',
    '23503': 'Elemento usato altrove: non si può cancellare (puoi disattivarlo)',
    '42501': 'Non hai il permesso per questa operazione',
    '22P02': 'Un valore non è nel formato giusto',
  };
  // Tabelle con colonne di costo nascoste (migrazione 002): «select *» non è permesso, quindi dopo un salvataggio
  // si chiedono indietro solo queste colonne (le letture usano le viste o un select esplicito)
  const LEGGIBILI = {
    prodotti: 'id,nome,codice,categoria_id,fornitore_id,unita,prezzo_vendita_cent,aliquota_iva,a_magazzino,giacenza,scorta_minima,riordino,deperibile,giorni_vita,ultimo_carico,nome_botanico,posizione,luce,acqua,note,attivo',
    ricette: 'id,nome,categoria_id,prezzo_vendita_cent,aliquota_iva,minuti,note,attiva',
  };
  async function rest(method, path, body, prefer = 'return=representation') {
    const headers = { Accept: 'application/json', Authorization: 'Bearer ' + S.token };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers.Prefer = prefer; }
    const tab = path.split('?')[0];
    if (body !== undefined && prefer === 'return=representation' && LEGGIBILI[tab] && !/[?&]select=/.test(path)) path += (path.includes('?') ? '&' : '?') + 'select=' + LEGGIBILI[tab];
    const r = await fetch('/rest/v1/' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 401) { logout(); throw new Error('Sessione scaduta: rientra.'); }
    const j = r.status === 204 ? null : await r.json().catch(() => null);
    if (!r.ok) {
      let m = (j && j.message) || 'Operazione non riuscita (' + r.status + ')';
      if (j && ERRORI[j.code] && !(j.code === '42501' && j.message && !/permission denied|row-level/i.test(j.message))) m = ERRORI[j.code];
      if (j && j.code === '22023') m = j.message;
      throw new Error(m);
    }
    return j;
  }
  const get = (path) => rest('GET', path);
  // Tutte le righe, a pagine: il server ne dà al massimo 5000 per richiesta (PGRST_DB_MAX_ROWS) e le altre sparirebbero
  // in silenzio da totali e CSV (es. incassi di un anno intero). path senza limit/offset; serve un "order" stabile.
  async function getTutti(path) {
    const out = [], passo = 5000;
    for (let da = 0; ; da += passo) {
      const r = await get(`${path}${path.includes('?') ? '&' : '?'}limit=${passo}&offset=${da}`);
      out.push(...r); if (r.length < passo) return out;
    }
  }
  // Tabelle lunghe: si disegnano al massimo MAX_RIGHE righe (il telefono resta veloce); totali e CSV usano tutto.
  const MAX_RIGHE = 1000;
  const righeVisibili = (lista) => lista.slice(0, MAX_RIGHE);
  const notaRighe = (lista) => (lista.length > MAX_RIGHE ? `<p class="muted"><small>Qui sotto le prime ${MAX_RIGHE} righe di ${lista.length}: totali e CSV le contano tutte. Restringi le date per vederle tutte.</small></p>` : '');
  const rpc = (fn, args) => rest('POST', 'rpc/' + fn, args || {});
  async function api(method, path, body, raw) {
    const headers = { Authorization: 'Bearer ' + S.token };
    if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
    const r = await fetch(path, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    if (r.status === 401) { logout(); throw new Error('Sessione scaduta: rientra.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Operazione non riuscita (' + r.status + ')');
    return j;
  }
  // allegato: si scarica col token e si apre in una scheda nuova
  async function apriAllegato(id) {
    const w = window.open('', '_blank');
    try {
      const r = await fetch('/api/allegati/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + S.token } });
      if (!r.ok) throw new Error('Allegato non disponibile');
      const url = URL.createObjectURL(await r.blob());
      if (w) w.location.href = url; else location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { if (w) w.close(); toast(e.message, 'err'); }
  }
  async function caricaAllegato(file, dove, id) {
    if (file.size > 8 * 1024 * 1024) throw new Error('File troppo grande (massimo 8 MB)');
    return api('POST', `/api/allegati?${dove}=${encodeURIComponent(id)}&nome=${encodeURIComponent(file.name)}`, file, true);
  }

  // ------------------------------------------------------------ sessione
  async function login(email, password) {
    const r = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Accesso non riuscito');
    if (!j.user.role) throw new Error('Questo utente non ha accesso al gestionale');
    return j;
  }
  let refreshTimer = null;
  function setSession(j) {
    S.token = j.access_token; S.user = j.user; S.role = j.user.role;
    try { localStorage.setItem(TOK, JSON.stringify(j)); } catch { /* ok */ }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(rinnova, Math.max(60_000, (j.expires_at * 1000 - Date.now()) - 10 * 60_000));
  }
  async function rinnova() {
    try {
      const r = await fetch('/auth/refresh', { method: 'POST', headers: { Authorization: 'Bearer ' + S.token } });
      if (!r.ok) throw new Error('scaduta');
      setSession(await r.json()); apriStream();
    } catch { logout(); }
  }
  function sessioneSalvata() {
    try { const j = JSON.parse(localStorage.getItem(TOK) || 'null'); if (j && j.expires_at * 1000 > Date.now() + 60_000) return j; } catch { /* ok */ }
    return null;
  }
  function logout() {
    S.token = null; S.user = null; S.role = null; clearTimeout(refreshTimer);
    if (stream) { stream.close(); stream = null; }
    try { localStorage.removeItem(TOK); } catch { /* ok */ }
    $('#app').hidden = true; $('#login').hidden = false; $('#l-pass').value = ''; chiudi();
  }

  // ------------------------------------------------------------ dati comuni (impostazioni, categorie, fornitori)
  async function caricaComuni() {
    const [imp, cats, forn] = await Promise.all([get('impostazioni?id=eq.1'), get('categorie?order=ambito,ordine,nome'), get('fornitori?order=nome')]);
    S.imp = imp[0]; S.cats = cats; S.fornitori = forn;
    applicaAspetto();
  }
  const catDi = (ambito, soloAttive = true) => S.cats.filter((c) => c.ambito === ambito && (!soloAttive || c.attiva));
  const catNome = (id) => (S.cats.find((c) => c.id === id) || {}).nome || '';
  const modulo = (m) => !S.imp || (S.imp.moduli || []).includes(m);

  function applicaAspetto() {
    const i = S.imp; if (!i) return;
    const r = document.documentElement.style;
    r.setProperty('--tema', i.colore_tema); r.setProperty('--accento', i.colore_accento);
    r.setProperty('--tema-chiaro', mescola(i.colore_tema, '#ffffff', 0.88));
    r.setProperty('--accento-chiaro', mescola(i.colore_accento, '#ffffff', 0.85));
    document.querySelector('meta[name=theme-color]').content = i.colore_tema;
    for (const id of ['brand-nome', 'top-nome', 'login-nome']) $('#' + id).textContent = i.nome_attivita;
    document.title = i.nome_attivita + ' · Gestionale';
    try { localStorage.setItem('fg_aspetto', JSON.stringify({ n: i.nome_attivita, t: i.colore_tema, a: i.colore_accento })); } catch { /* ok */ }
  }
  function mescola(a, b, t) {
    const h = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
    const [p, q] = [h(a), h(b)];
    return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }

  // ------------------------------------------------------------ tempo reale
  let stream = null, rerenderTimer = null;
  const ascoltatori = new Set();
  function apriStream() {
    if (stream) stream.close();
    if (typeof EventSource === 'undefined') return;
    stream = new EventSource('/realtime/stream?token=' + encodeURIComponent(S.token));
    let primo = true;
    stream.onopen = () => { if (!primo) aggiornaVista(); primo = false; };
    stream.onmessage = (e) => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      for (const f of ascoltatori) try { f(d); } catch { /* ok */ }
      if (d.table === 'impostazioni') caricaComuni().then(costruisciMenu).catch(() => {});
      aggiornaVista();
    };
  }
  // ridisegna la sezione aperta (non se si sta scrivendo o c'è una finestra aperta)
  function aggiornaVista() {
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(() => {
      const a = document.activeElement;
      if (!$('#modal').hidden || (a && a.closest('#view') && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) return;
      if ($('#view .cerca-date.primary')) return; // date cambiate ma non ancora cercate: non si buttano via
      render(true);
    }, 500);
  }

  // ------------------------------------------------------------ campi numerici: al tocco si seleziona tutto, così si scrive sopra
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.inputMode !== 'decimal' && t.inputMode !== 'numeric') return;
    t._selezionaAlClic = true;
    setTimeout(() => { if (document.activeElement === t) t.select(); }, 0);
  });
  // il rilascio del clic (o del dito) sposterebbe il cursore dove si è toccato: per il primo tocco lo si impedisce
  const riseleziona = (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !t._selezionaAlClic) return;
    if (e.type === 'mouseup') e.preventDefault();
    t.select();
    if (e.type === 'click') { t._selezionaAlClic = false; setTimeout(() => { if (document.activeElement === t) t.select(); }, 0); }
  };
  document.addEventListener('mouseup', riseleziona, true);
  document.addEventListener('click', riseleziona, true);
  document.addEventListener('keydown', (e) => { if (e.target instanceof HTMLInputElement) e.target._selezionaAlClic = false; }, true);

  // ------------------------------------------------------------ date dei filtri: si cerca SOLO col pulsante «Cerca» (o Invio)
  // Con una data già piena il browser manda «change» a ogni cifra scritta e la pagina si ridisegnava prima di poter scrivere il mese
  // (28 ott). Richiesta di Riccardo: le date si cambiano con calma e la ricerca parte col pulsante accanto (`FG.cercaDate`).
  // Il «change» delle date dentro `.filtri` è trattenuto; «Cerca» lo rimanda al gestore della pagina, che rilegge tutti i campi.
  const DATA_FILTRO = '.filtri input[type=date]';
  const cercaDate = '<button type="button" class="btn cerca-date">🔍 Cerca</button>';
  const dataFinita = (v) => /^(19|20)\d\d-\d\d-\d\d$/.test(v);
  const segnaDaCercare = (box) => {
    const b = box && box.querySelector('.cerca-date'); if (!b) return;
    b.classList.toggle('primary', [...box.querySelectorAll('input[type=date]')].some((i) => i.value !== i.defaultValue));
  };
  function cercaConDate(box) {
    const date = [...box.querySelectorAll('input[type=date]')];
    const rotta = date.find((i) => !dataFinita(i.value));
    if (rotta) { toast('Scrivi la data completa: giorno, mese e anno (4 cifre).', 'err'); rotta.focus(); return; }
    const da = date.find((i) => i.name === 'da'), a = date.find((i) => i.name === 'a');
    if (da && a && a.value < da.value) [da.value, a.value] = [a.value, da.value];
    const el = date[0]; el._passa = true;
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } finally { el._passa = false; }
  }
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || !el.matches(DATA_FILTRO) || el._passa) return;
    e.stopImmediatePropagation();
    segnaDaCercare(el.closest('.filtri'));
  }, true);
  document.addEventListener('input', (e) => { const el = e.target; if (el instanceof HTMLInputElement && el.matches(DATA_FILTRO)) segnaDaCercare(el.closest('.filtri')); }, true);
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key !== 'Enter' || !(el instanceof HTMLInputElement) || !el.matches(DATA_FILTRO)) return;
    e.preventDefault(); cercaConDate(el.closest('.filtri'));
  }, true);
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('.cerca-date'); if (b) cercaConDate(b.closest('.filtri')); });

  // ------------------------------------------------------------ finestre
  function apri(html, cls = '') {
    if (rispostaConferma) { const r = rispostaConferma; rispostaConferma = null; r(false); }
    const m = $('#modal');
    m.innerHTML = `<div class="dialog ${cls}" role="dialog" aria-modal="true"><button class="x" type="button" aria-label="Chiudi">×</button>${html}</div>`;
    m.hidden = false; m.scrollTop = 0; document.body.classList.add('no-scroll');
    const f = m.querySelector('input:not([type=hidden]):not([type=checkbox]),select,textarea'); if (f && matchMedia('(pointer:fine)').matches) f.focus();
    return m.firstElementChild;
  }
  // una conferma chiusa con ×, Esc o tocco fuori vale «no» (prima restava in sospeso e il pulsante che l'aveva aperta restava su «Attendi…»)
  let rispostaConferma = null;
  function chiudi() {
    const m = $('#modal'); m.hidden = true; m.innerHTML = ''; document.body.classList.remove('no-scroll');
    if (rispostaConferma) { const r = rispostaConferma; rispostaConferma = null; r(false); }
  }
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('.x')) chiudi(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) chiudi(); });
  function conferma(testo, si = 'Conferma', pericolo = true) {
    return new Promise((ok) => {
      const d = apri(`<h2>Sei sicuro?</h2><p>${esc(testo)}</p><div class="azioni"><button class="btn" data-no type="button">Annulla</button><button class="btn ${pericolo ? 'danger' : 'primary'}" data-si type="button">${esc(si)}</button></div>`, 'piccolo');
      rispostaConferma = ok;
      d.querySelector('[data-si]').onclick = () => { rispostaConferma = null; chiudi(); ok(true); };
      d.querySelector('[data-no]').onclick = () => chiudi();
    });
  }
  // un pulsante che salva: niente doppio tocco, errore mostrato nella finestra
  async function occupato(btn, fn) {
    if (btn.disabled) return;
    btn.disabled = true; const t = btn.textContent; btn.textContent = 'Attendi…';
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = t; }
  }

  // ------------------------------------------------------------ moduli generici
  // campo: { k, l (etichetta), t: text|textarea|money|qty|int|date|time|select|bool|color|email|tel, o: [[valore, testo]], req, help, w (larghezza: 2 = mezza) }
  function campo(f, v) {
    const id = 'f_' + f.k, req = f.req ? ' required' : '', ph = f.ph ? ` placeholder="${esc(f.ph)}"` : '';
    let inp;
    if (f.t === 'textarea') inp = `<textarea id="${id}" name="${f.k}" rows="${f.rows || 3}"${req}${ph}>${esc(v ?? '')}</textarea>`;
    else if (f.t === 'select') inp = `<select id="${id}" name="${f.k}"${req}>${f.vuoto !== false ? `<option value="">${esc(f.vuoto || '—')}</option>` : ''}${(f.o || []).map(([a, b]) => `<option value="${esc(a)}"${String(a) === String(v ?? '') ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>`;
    else if (f.t === 'bool') return `<label class="check${f.w ? ' w' + f.w : ''}"><input type="checkbox" id="${id}" name="${f.k}"${v ? ' checked' : ''}> <span>${esc(f.l)}</span>${f.help ? `<small>${esc(f.help)}</small>` : ''}</label>`;
    else if (f.t === 'money') inp = `<div class="euro"><input id="${id}" name="${f.k}" inputmode="decimal" value="${esc(euroInput(v))}"${req}${ph}><span>€</span></div>`;
    else if (f.t === 'qty' || f.t === 'int') inp = `<input id="${id}" name="${f.k}" inputmode="decimal" value="${esc(v == null ? '' : String(v).replace('.', ','))}"${req}${ph}>`;
    else inp = `<input id="${id}" name="${f.k}" type="${{ date: 'date', time: 'time', color: 'color', email: 'email', tel: 'tel' }[f.t] || 'text'}" value="${esc(f.t === 'time' && v ? String(v).slice(0, 5) : v ?? '')}"${req}${ph}${f.max ? ` maxlength="${f.max}"` : ''}>`;
    return `<label class="f${f.w ? ' w' + f.w : ''}" for="${id}"><span>${esc(f.l)}${f.req ? ' *' : ''}</span>${inp}${f.help ? `<small>${esc(f.help)}</small>` : ''}</label>`;
  }
  const campi = (fields, vals = {}) => `<div class="grid-form">${fields.map((f) => (f.sez ? `<h3 class="sez">${esc(f.sez)}</h3>` : campo(f, vals[f.k]))).join('')}</div>`;
  function leggi(root, fields) {
    const out = {};
    for (const f of fields) {
      if (f.sez || f.solo_vista) continue;
      const el = root.querySelector(`[name="${f.k}"]`); if (!el) continue;
      let v;
      if (f.t === 'bool') v = el.checked;
      else if (f.t === 'money') { v = cent(el.value); if (Number.isNaN(v)) throw new Error(`${f.l}: importo non valido (es. 12,50)`); }
      else if (f.t === 'qty') { v = qty(el.value); if (Number.isNaN(v)) throw new Error(`${f.l}: numero non valido`); }
      else if (f.t === 'int') { v = qty(el.value); if (Number.isNaN(v) || (v != null && !Number.isInteger(v))) throw new Error(`${f.l}: numero intero non valido`); }
      else if (f.t === 'select' && f.num) v = el.value ? Number(el.value) : null;
      else v = el.value.trim() || null;
      if (f.req && (v == null || v === '')) throw new Error(`${f.l}: obbligatorio`);
      out[f.k] = v;
    }
    return out;
  }
  // Finestra di modifica pronta: salva in una tabella (insert o update per id)
  function scheda({ titolo, tabella, fields, vals = {}, dopo, cancella = true, extra = '', prima }) {
    const nuovo = !vals.id;
    const d = apri(`<h2>${esc(titolo)}</h2><form novalidate>${campi(fields, vals)}${extra}
      <p class="alert err" hidden></p>
      <div class="azioni">${!nuovo && cancella ? '<button class="btn danger ghost" type="button" data-del>Elimina</button><span class="spazio"></span>' : ''}
      <button class="btn" type="button" data-annulla>Annulla</button><button class="btn primary" type="submit">Salva</button></div></form>`);
    const form = d.querySelector('form'), err = d.querySelector('.alert');
    d.querySelector('[data-annulla]').onclick = chiudi;
    form.onsubmit = (e) => {
      e.preventDefault();
      occupato(form.querySelector('[type=submit]'), async () => {
        try {
          let dati = leggi(form, fields);
          if (prima) dati = (await prima(dati, form)) || dati;
          const r = nuovo ? await rest('POST', tabella, dati) : await rest('PATCH', `${tabella}?id=eq.${vals.id}`, dati);
          chiudi(); toast('Salvato'); if (dopo) await dopo(r && r[0]); else render();
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      });
    };
    const del = d.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      if (!(await conferma('Eliminare questo elemento? Non si può annullare.', 'Elimina'))) { scheda({ titolo, tabella, fields, vals, dopo, cancella, extra, prima }); return; }
      try { await rest('DELETE', `${tabella}?id=eq.${vals.id}`); toast('Eliminato'); if (dopo) await dopo(null); else render(); }
      catch (ex) { toast(ex.message, 'err'); }
    };
    return d;
  }

  // ------------------------------------------------------------ CSV (si apre con Excel: separatore ; e BOM)
  function csv(nome, intest, righe) {
    const cell = (v) => { const s = v == null ? '' : String(v); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const testo = '﻿' + [intest, ...righe].map((r) => r.map(cell).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([testo], { type: 'text/csv;charset=utf-8' }));
    a.download = nome.replace(/[^\w.-]+/g, '_') + '.csv'; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const eurCsv = (c) => (c == null ? '' : (Number(c) / 100).toFixed(2).replace('.', ','));
  const numCsv = (q) => (q == null ? '' : String(q).replace('.', ','));

  // stampa di un pezzo di pagina (giro consegne, bigliettini, lista di riordino, statistiche)
  // Il riquadro resta nella pagina finché il browser non dice di aver stampato (a schermo è nascosto): su iPad e telefono
  // window.print() non aspetta, e toglierlo dopo 2 secondi poteva far stampare la pagina sbagliata. Si toglie alla stampa dopo.
  function stampa(html, titolo = 'Stampa') {
    const vecchio = $('#stampa'); if (vecchio) vecchio.remove();
    const box = document.createElement('div'); box.id = 'stampa'; box.innerHTML = `<h1>${esc(titolo)}</h1>${html}`;
    document.body.appendChild(box); document.body.classList.add('stampando');
    const fine = () => { document.body.classList.remove('stampando'); box.remove(); window.removeEventListener('afterprint', fine); };
    window.addEventListener('afterprint', fine); window.print();
  }
  async function copia(testo) {
    try { await navigator.clipboard.writeText(testo); toast('Copiato: ora puoi incollarlo (WhatsApp, email...)'); }
    catch { apri(`<h2>Copia il testo</h2><textarea rows="14" class="mono">${esc(testo)}</textarea>`); }
  }

  // ------------------------------------------------------------ navigazione
  const VIEWS = {};
  const MENU = [
    ['cruscotto', '🏠', 'Cruscotto', null],
    ['cassa', '💶', 'Cassa', 'cassa'],
    ['ordini', '💐', 'Ordini', 'ordini'],
    ['magazzino', '🌿', 'Magazzino', 'magazzino'],
    ['bolle', '📦', 'Arrivi e bolle', 'magazzino'],
    ['ricette', '🌸', 'Composizioni', 'ricette'],
    ['spese', '🧾', 'Spese', 'spese', true],
    ['statistiche', '📊', 'Statistiche', 'statistiche', true],
    ['clienti', '👥', 'Clienti', 'clienti'],
    ['fornitori', '🚚', 'Fornitori', 'fornitori'],
    ['impostazioni', '⚙️', 'Impostazioni', null, true],
  ];
  function costruisciMenu() {
    $('#nav').innerHTML = MENU.filter(([, , , mod, soloTit]) => (!mod || modulo(mod)) && (!soloTit || isOwner()))
      .map(([r, ico, nome]) => `<a href="#/${r}" data-r="${r}"><span class="ico" aria-hidden="true">${ico}</span>${esc(nome)}</a>`).join('');
    segnaMenu();
    $('#who').textContent = S.user ? S.user.email + (isOwner() ? ' · titolare' : '') : '';
    $('#nuova-vendita').hidden = !modulo('cassa');
  }
  function segnaMenu() { $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === S.route)); }
  function vai(r) { if (location.hash === '#/' + r) render(); else location.hash = '#/' + r; }
  function leggiRotta() {
    let h = location.hash.replace(/^#\/?/, ''); try { h = decodeURIComponent(h); } catch { /* indirizzo storpiato: si usa com'è */ }
    const parti = h.split('/').filter(Boolean);
    S.route = VIEWS[parti[0]] ? parti[0] : 'cruscotto'; S.args = parti.slice(1);
  }
  let renderN = 0;
  async function render(silenzioso) {
    if (!S.token) return;
    leggiRotta(); segnaMenu();
    const v = $('#view'), n = ++renderN;
    if (!silenzioso) v.innerHTML = '<p class="muted carica">Carico…</p>';
    try {
      const html = await VIEWS[S.route](S.args);
      if (n !== renderN) return; // nel frattempo si è cambiata pagina
      if (typeof html === 'string') v.innerHTML = html;
      const dopo = VIEWS[S.route].dopo; if (dopo) dopo(v, S.args);
      if (FG.disegnaGrafici) FG.disegnaGrafici(v);
    } catch (e) {
      if (n === renderN) v.innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
    }
    if (!silenzioso) { window.scrollTo(0, 0); }
  }
  window.addEventListener('hashchange', () => { render(); document.body.classList.remove('menu-aperto'); });

  // intestazione di sezione con schede (sottopagine)
  function schede(base, voci, attiva) {
    return `<nav class="tabs">${voci.map(([k, t]) => `<a href="#/${base}${k ? '/' + k : ''}" class="${k === attiva ? 'on' : ''}">${esc(t)}</a>`).join('')}</nav>`;
  }
  const vuoto = (testo, azione = '') => `<div class="vuoto"><p>${esc(testo)}</p>${azione}</div>`;
  const pill = (t, cls = '') => `<span class="pill ${cls}">${esc(t)}</span>`;
  const pallino = (c) => `<i class="dot" style="background:${/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#999'}"></i>`;

  return {
    $, $$, esc, pad, eur, eur0, euroInput, num, perc, cent, qty, iso, oggi, giorno, addGiorni, dataIt, dataBreve, quando, MESI, MESI_LUNGHI, meseIt, giorniTra, cap,
    S, isOwner, separato, cercaDate, toast, rest, get, getTutti, righeVisibili, notaRighe, rpc, api, apriAllegato, caricaAllegato, login, setSession, sessioneSalvata, logout,
    caricaComuni, catDi, catNome, modulo, applicaAspetto, apriStream, ascoltatori, aggiornaVista,
    apri, chiudi, conferma, occupato, campo, campi, leggi, scheda, csv, eurCsv, numCsv, stampa, copia,
    VIEWS, costruisciMenu, vai, render, schede, vuoto, pill, pallino,
  };
})();
