# Prove del gestionale del fiorista

Servono Node 22, `npm install` in questa cartella (embedded-postgres, pg) e il programma PostgREST (non è nel repository):
```
curl -L -o postgrest.tar.xz https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
tar xf postgrest.tar.xz   # crea ./postgrest
```
(Sul server plateslab `node_modules` e `postgrest` sono collegamenti a quelli di `~/equitazione/tests`.)

| Comando | Cosa prova |
|---|---|
| `node stack.test.mjs` | stack vero (PostgreSQL temporaneo + PostgREST + servizio auth): 45 controlli su calcoli (magazzino, bolle, IVA, margini, composizioni, cassa, chiusura, statistiche) e permessi (titolare, commesso, anonimo) |
| `node browser.test.mjs` | Chromium vero dietro nginx vero con la configurazione del sito: tutto il percorso del titolare, telefono (nessuna pagina più larga dello schermo), commesso; fallisce a qualsiasi errore JavaScript; schermate in `shots/` |

`browser.test.mjs` vuole queste variabili (niente sudo: tutto scaricato in una cartella temporanea):
- `PW` = cartella di `playwright-core` (sul server: `~/.local/opt/playwright-mcp/node_modules/playwright-core`)
- `CHROME` = `~/.cache/ms-playwright/chromium-1247/chrome-linux64/chrome`, `LD_LIBRARY_PATH=~/.local/opt/pw-libs/usr/lib/x86_64-linux-gnu`
- `NGINX` e `MIME` = `nginx` e `mime.types` estratti con `apt-get download nginx nginx-common` + `dpkg -x`

Lezioni: la CSP del sito vieta `eval`, quindi niente `page.waitForFunction` (si usano `waitForSelector` ed `evaluate`);
negli inserimenti multipli PostgREST vuole gli stessi campi in tutte le righe.
