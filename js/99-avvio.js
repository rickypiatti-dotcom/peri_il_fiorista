/* Avvio: login, sessione salvata, menu su telefono. */
'use strict';
(() => {
  const { $, S, login, setSession, sessioneSalvata, logout, caricaComuni, costruisciMenu, apriStream, render } = FG;

  // nome e colori dell'ultima volta già sulla pagina di login (prima di avere i dati)
  try {
    const a = JSON.parse(localStorage.getItem('fg_aspetto') || 'null');
    if (a) {
      document.documentElement.style.setProperty('--tema', a.t); document.documentElement.style.setProperty('--accento', a.a);
      $('#login-nome').textContent = a.n; document.title = a.n + ' · Gestionale';
    }
  } catch { /* ok */ }

  async function entra() {
    await caricaComuni();
    costruisciMenu();
    $('#login').hidden = true; $('#app').hidden = false;
    apriStream();
    await render();
  }

  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const b = $('#l-btn'), err = $('#l-err');
    b.disabled = true; err.hidden = true;
    try {
      setSession(await login($('#l-email').value.trim(), $('#l-pass').value));
      $('#l-pass').value = '';
      await entra();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; logout(); }
    finally { b.disabled = false; }
  };
  $('#logout').onclick = () => logout();

  // menu a scomparsa sul telefono
  const mb = $('#menu-btn');
  mb.onclick = () => { const aperto = document.body.classList.toggle('menu-aperto'); mb.setAttribute('aria-expanded', String(aperto)); };
  document.addEventListener('click', (e) => {
    if (document.body.classList.contains('menu-aperto') && !e.target.closest('#side') && !e.target.closest('#menu-btn')) { document.body.classList.remove('menu-aperto'); mb.setAttribute('aria-expanded', 'false'); }
  });

  const s = sessioneSalvata();
  if (s) { setSession(s); entra().catch(() => logout()); } else { $('#login').hidden = false; }
  // tornando sulla scheda dopo tanto tempo: dati freschi
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token) FG.aggiornaVista(); });
})();
