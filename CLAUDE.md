# Gestionale del fiorista (`~/fiorista`) — plateslab

Gestionale (non un sito vetrina) per un negozio di fiori e piante: cassa, ordini e preventivi, magazzino con bolle,
composizioni, spese con allegati, spese ricorrenti, statistiche, clienti, fornitori. Tutto modificabile dal titolare da **Impostazioni**.
Repository: `rickypiatti-dotcom/peri_il_fiorista` (privato). Deploy key `~/.ssh/deploy_fiorista`, alias `github-fiorista`, remote `github`.
Nome mostrato di default: «Il Fiorista» (si cambia da Impostazioni; il repository fa pensare a «Peri il Fiorista»: da confermare).

## Stack (come Sienna Saddlery / fac_simile)
- `db` PostgreSQL 17 (database `fiorista`), `postgrest` v12.2.3, `auth` (Node: login, utenti, allegati, SSE, migrazioni), `web` nginx (pagina unica senza compilazione), `adminer`.
- Porte: web `127.0.0.1:8094` (solo server), Adminer `100.112.89.10:8089` (solo Tailscale).
- Variabili in Coolify: `SERVICE_PASSWORD_POSTGRES`, `SERVICE_PASSWORD_AUTHENTICATOR`, `SERVICE_PASSWORD_64_JWT` (lunghe, "Do not interpolate"), `ADMIN_EMAIL`, `ADMIN_PASSWORD` (almeno 10 caratteri).
- Database NUOVO e VUOTO alla partenza: solo categorie (articoli, spese, incassi) e calendario feste di esempio, tutto modificabile.

## Regole del database (01-schema.sql) — le regole stanno qui, non nella pagina
- Ruoli: `owner` (titolare: tutto) e `staff` (commesso: cassa, ordini, clienti, fornitori, magazzino, bolle; NON spese, ricorrenti, statistiche, registro, impostazioni, utenti). Anonimi: niente.
- **Commesso senza contabilità (migrazione `002_permessi_commesso.sql`, 27 ott 2026, richiesta di Riccardo)**: vende, fa il totale di giornata e la chiusura di cassa di OGGI,
  ordini/preventivi con acconti, clienti, fornitori, magazzino, bolle, composizioni. NON vede: incassi (RLS di `entrate`: solo le sue vendite di oggi + i pagamenti degli ordini),
  chiusure passate, incassi nel cruscotto (`cruscotto()` li dà solo al titolare), «Ha speso» dei clienti, costi d'acquisto, lavoro, margini, valore del magazzino, totali delle bolle.
  - Colonne di costo NON leggibili dalle tabelle (`prodotti.prezzo_acquisto_cent`, `ricette.manodopera_cent`, `movimenti.costo_unit_cent`, `entrata_righe.costo_unit_cent`): grant di colonna.
    Quindi **`select *` su quelle 4 tabelle dà «permission denied» a TUTTI** (anche al titolare): leggere dalle viste o con `select=` esplicito; dopo POST/PATCH `rest()` chiede da solo le colonne leggibili (`LEGGIBILI` in 00-base.js).
  - Le viste `prodotti_vista`, `ricette_vista`, `movimenti_vista`, `bolle_vista`, `entrata_righe_vista` girano col proprietario (`security_invoker = false`): filtro `vede_personale()`, costi dietro `vede_costi()` (null al commesso).
    `current_user = 'postgres'` (Adminer, prove, funzioni definer) vede tutto: una funzione definer che legge queste viste NON deve restituire costi al commesso.
  - Scrittura: trigger che ignorano i costi scritti dal commesso (articolo nuovo a costo 0, modifica = costo di prima, lavoro delle composizioni idem, movimenti/arrivi col costo dell'articolo).
  - Chiusura di cassa: `cassa_giorno(data)` (incassi per metodo + fondo proposto; il commesso solo oggi).
- **Pagamenti «altro» = contabilità SEPARATA (migrazione `003_altro_separato.sql`, 27 ott 2026, richiesta di Riccardo per i buoni regalo, "esattamente così" per i responsabili)**: gli incassi con metodo `altro` (qualsiasi maiuscola, `public.metodo_separato()` / `FG.separato()`) NON entrano in `cruscotto()`, `statistiche()` (anche articoli venduti), `cassa_giorno()`, pagamenti elettronici della chiusura (`chiusura_calcola`, solo chiusure salvate da ora), elenco Incassi, CSV per il commercialista, festa dell'anno scorso nel cruscotto, "Ha speso" del cliente (nel sito: filtro `metodo=not.ilike.altro`). Si vedono SOLO nella pagina `#/altro` (`js/65-altro.js`, clic sul fiore accanto al nome, in alto a sinistra e nella barra del telefono; solo titolare). Restano incassi veri per ordini pagati, magazzino ed esportazione completa. Il commesso vede comunque le sue vendite «altro» di oggi in "Le mie vendite". Ogni nuova somma di incassi deve escludere «altro».
  - Utenti: si creano dal gestionale (Impostazioni > Utenti, ruolo Commesso). `ADMIN_EMAIL`/`ADMIN_PASSWORD` di Coolify creano solo il PRIMO titolare.
- Tutte le funzioni di `public` sono revocate a tutti e concesse una per una (PostgreSQL le dà a PUBLIC per default).
- Importi in centesimi. Incassi e spese LORDI con l'IVA a parte; costo d'acquisto degli articoli IVA ESCLUSA, prezzo di vendita IVA INCLUSA.
- Giacenza = somma dei movimenti (trigger): non si scrive a mano. Carichi solo da `registra_carico` (crea la BOLLA).
- Funzioni: `registra_vendita` (articoli, composizioni = scala ogni componente, voci libere, importo libero, sconto se permesso), `annulla_entrata`,
  `registra_carico` (bolla + eventuale spesa), `fattura_bolle` (fattura riepilogativa di più bolle), `annulla_bolla`, `imposta_giacenza` (inventario),
  `registra_ricorrente`, `cruscotto`, `statistiche(da, a)`.
- Documento dell'incasso: solo scontrino, fattura o ricevuta (la scelta "nessun documento" è stata tolta di proposito).
- Registro delle modifiche (`registro`) su tutte le tabelle importanti: chi, quando, prima/dopo. Lo legge solo il titolare.
- Allegati (foto/PDF fino a 8 MB) nel database (finiscono nel backup): spese = solo titolare, bolle = tutto il personale.
- Impostazioni modificabili: nome e dati fiscali, colori, regime (ordinario/forfettario), metodi di incasso e di spesa, unità, sezioni del menu,
  permessi dei commessi (sconti, annullare i propri incassi di oggi), obiettivo mensile, giorni di apertura, ricarico, scorta minima, condizioni dei preventivi.

## Pagina (`index.html`, `css/app.css`, `js/NN-*.js`)
- Un file per sezione: 00-base (rete, sessione, finestre, moduli, CSV, stampa), 05-grafici (SVG fatti a mano), 10-cruscotto (feste, ricorrenze, pareggio),
  20-cassa, 30-ordini, 40-magazzino (articoli, movimenti, inventario, riordino, bolle), 45-ricette, 50-spese, 60-statistiche, 70-anagrafiche, 80-impostazioni, 99-avvio.
- Tutto ciò che arriva dal database passa da `esc()`. CSP senza script esterni né `eval`.
- Date sempre in ora locale con `FG.iso()` / `FG.oggi()` (MAI `toISOString().slice(0,10)`).
- Stampa (preventivi, giro consegne, bigliettini, inventario, riordino, statistiche) con `FG.stampa()`: «Salva come PDF» del browser.

## Grafici (`05-grafici.js`)
- `FG.colonne()` prepara solo il posto (`.grafico[data-gr]`); il disegno lo fa `FG.disegnaGrafici()` (chiamato da `render()` e al ridimensionamento) con la LARGHEZZA REALE del riquadro.
  Prima l'SVG era piccolo e ingrandito: scritte e barre enormi («inguardabili», Riccardo 27 ott). Barre sottili, assi con numeri tondi (`breve()`: 1,5k €), zero evidenziato con mesi in perdita,
  riquadro dei valori al passaggio del mouse/tocco, al telefono un mese sì e uno no sull'asse. Ciambelle con anello sottile.
- `tests/grafici-anteprima.mjs` riempie 12 mesi di dati finti e fotografa i grafici (`tests/shots/grafici-*.png`).

## Dati di esempio (migrazione `001_dati_esempio.sql`)
- `carica_dati_esempio()` (solo titolare, solo a gestionale vuoto: nessun articolo né incasso): un anno di negozio finto in ~5 s
  (36 articoli, 5 composizioni, 7 fornitori, 6 clienti con ricorrenze, ~130 bolle martedì/venerdì + mensili con fatture riepilogative, ~2.450 vendite con picchi
  di San Valentino/8 marzo/Festa della mamma/Defunti/Natale, scarti, ordini e un preventivo di matrimonio, spese e ricorrenti, chiusure di cassa, inventario finale con articoli sotto scorta e peonie «da controllare»).
- Tutto ha lo stesso `creato_il` (= `now()` della transazione) salvato in `dati_esempio`: `cancella_dati_esempio()` toglie esattamente quelle righe
  (un articolo/cliente di esempio usato per qualcosa di vero resta). Pulsanti in Impostazioni > I tuoi dati.
- Trappole incontrate scrivendola: in PL/pgSQL un alias di tabella o una colonna con lo stesso nome di una variabile (`r`, `d`) dà «record not assigned» o «ambiguous»;
  l'estrazione pesata giusta è `order by -ln(1 - random()) / peso` (non `random() * peso`, che sceglie quasi sempre la categoria più pesante).
- PostgREST e il servizio auth partono insieme: l'avviso `notify pgrst, 'reload schema'` della migrazione poteva arrivare prima che PostgREST ascoltasse.
  Il servizio auth lo ripete a 3, 15 e 60 s dall'avvio (`server.js`). Ogni migrazione con tabelle/funzioni nuove deve comunque finire con `notify pgrst, 'reload schema'`.

## Guida in PDF (`docs/`)
- `docs/Guida-gestionale-fiorista.pdf` (48 pagine, A4, indice cliccabile per sezioni, schermate vere con i dati di esempio, numeri di pagina).
- Sorgenti: `docs/guida/guida.html` (testo), `docs/guida/schermate.mjs` (avvia lo stack in locale, carica i dati di esempio col pulsante, fotografa ogni sezione in `docs/guida/img/`),
  `docs/guida/pdf.mjs` (stampa con Chromium). Se cambia una pagina del gestionale: rifare schermate e PDF (comandi in `tests/README.md`).
- Controllo a vista del PDF: `pdftoppm` estratto nello scratchpad con `apt-get download poppler-utils libpoppler134 liblcms2-2 libnss3 libnspr4 libopenjp2-7 libgpgme11t64 libassuan0` + `dpkg -x`.
- Le finestre più alte dello schermo vanno fotografate allungando il viewport (`scatta(..., { el })`), altrimenti la parte fuori schermo esce vuota; Chromium con `--lang=it-IT` per date/ore italiane.

## Prove
`tests/README.md`: `stack.test.mjs` (47, anche dati di esempio), `commesso.test.mjs` (14, permessi del commesso via API; senza la migrazione 002 ne falliscono 10), `browser.test.mjs` (30, percorso completo) `cassa.test.mjs` (40, tutta la cassa anche al telefono + commesso a schermo), `altro.test.mjs` (7, contabilità «altro» separata via API) e `altro-browser.test.mjs` (10, pagina Altro dal fiore, computer/telefono/commesso). Prima di ogni push: tutte verdi.
- `tests/ambiente.mjs` = stack + nginx + Chromium riusabile per altre suite (`avvia(porta)`, `nuova({ telefono })`, `entra`, `vai` (usa `FG.vai`, ridisegna anche la pagina già aperta), `utente`).
- Se una prova si interrompe a metà può restare acceso PostgREST sulla 3110: le prove successive parlano con quello VECCHIO (funzioni nuove «non trovate»). `stack.mjs` ora si ferma e dice la porta occupata.
- Nelle prove: dopo un incasso si aspetta la riga nuova nel database (non l'avviso: quello precedente può essere ancora a schermo).
- Campi numerici (`inputmode="decimal"`): al primo tocco/clic si seleziona tutto (`00-base.js`), così si scrive sopra. Bug del 27 ott: toccando il prezzo il cursore finiva in mezzo («3,00» + «4,50» = «3,4,5000»), il valore veniva scartato in silenzio e tornava il vecchio.
- Scontrino: quantità, prezzo e sconto aggiornano i totali MENTRE si scrive, senza ridisegnare (un ridisegno sul «change» faceva perdere il tocco su «Incassa»). Un valore sbagliato resta, in rosso, con messaggio, e blocca l'incasso.

## Stato (27 ott 2026, notte)
- IN PROVA su http://fiorista.100.112.89.10.sslip.io (solo VPN), app Coolify `peri_il_fiorista` uuid `6hmdqlqmpqlgua97mkgkkm2j`. Deploy automatico dopo ogni push (autorizzazione permanente di Riccardo).
- Commit in produzione (codici dopo la riscrittura della storia del 27 ott): f3a9e13 (completo) → 025050b (riquadro «Risultato del mese»: la classe colore `.pos` era anche l'impaginazione della cassa, ora `.banco-layout`)
  → 7a6cde2 (prezzo in cassa che scompariva + suite cassa) → 6d9ca78 (grafici fini) → 592592c (dati di esempio + guida PDF) → 1a29713 (commesso senza contabilità, migrazione 002). Tutti verificati dopo il deploy.
- Dati di esempio: NON ancora caricati in produzione (li carica Riccardo dal pulsante; da cancellare prima di consegnare al cliente).
- Da decidere col cliente: nome del negozio (default «Il Fiorista»; il repository dice «peri_il_fiorista»), dati fiscali, categorie e feste davvero utili, chi sono i commessi.
- Idee scartate o rimandate: avvisi Telegram, abbonamenti aziende, etichette prezzo (non scelte da Riccardo il 27 ott).
