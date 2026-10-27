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
| `node cassa.test.mjs` | suite completa della CASSA (39 controlli, computer + telefono con tocco): riquadri, ricerca, codice a barre, quantità/prezzo/sconto scritti a mano (selezione al tocco, totali in diretta, valori sbagliati), metodi e resto, importo libero, scontrino salvato, doppio tocco, aggiornamenti da altri dispositivi, totale di giornata, incassi (filtri, CSV, modifica, annullo), chiusura di cassa, permessi del commesso |
| `node browser.test.mjs` | Chromium vero dietro nginx vero con la configurazione del sito: tutto il percorso del titolare, telefono (nessuna pagina più larga dello schermo), commesso; fallisce a qualsiasi errore JavaScript; schermate in `shots/` |

`browser.test.mjs` vuole queste variabili (niente sudo: tutto scaricato in una cartella temporanea):
- `PW` = cartella di `playwright-core` (sul server: `~/.local/opt/playwright-mcp/node_modules/playwright-core`)
- `CHROME` = `~/.cache/ms-playwright/chromium-1247/chrome-linux64/chrome`, `LD_LIBRARY_PATH=~/.local/opt/pw-libs/usr/lib/x86_64-linux-gnu`
- `NGINX` e `MIME` = `nginx` e `mime.types` estratti con `apt-get download nginx nginx-common` + `dpkg -x`

`ambiente.mjs` prepara stack + nginx + Chromium per le prove nel browser (riusabile per altre suite).

Lezioni: la CSP del sito vieta `eval`, quindi niente `page.waitForFunction` (si usano `waitForSelector` ed `evaluate`);
negli inserimenti multipli PostgREST vuole gli stessi campi in tutte le righe.
Nelle prove: dopo un incasso si aspetta la riga nuova nel database, non l'avviso a schermo (quello precedente può essere ancora visibile);
dopo una modifica fatta direttamente nel database si ricarica la pagina.
