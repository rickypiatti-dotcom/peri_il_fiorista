# Migrazioni del database

Ogni modifica allo schema (nuova tabella, colonna, funzione, regola RLS...) è un file
`NNN_descrizione.sql`, numerato in ordine: `001_aggiungi_note_tavoli.sql`, `002_...`.

- Le applica il servizio `auth` **all'avvio**, in ordine, **una sola volta** ciascuna
  (registro nella tabella `auth.schema_migrations`). Un file già applicato non si modifica:
  se serve correggere, si scrive una migrazione nuova.
- Ogni file gira in una transazione: se un comando fallisce, il file non viene applicato
  e il servizio non parte (si vede nel log di Coolify). Non scrivere `BEGIN`/`COMMIT`
  e non usare `CREATE INDEX CONCURRENTLY`.
- Le migrazioni girano come utente `postgres`: per le tabelle nuove aggiungi tu i permessi
  (`grant ... to anon, authenticated`) e la RLS (`alter table ... enable row level security`
  con le sue `create policy`), come in `db/init/01-schema.sql`.
- `db/init/` contiene lo schema di partenza e vale solo per i database nuovi.
  Un database nuovo esegue prima `init/` e poi tutte le migrazioni.
- Prima di una migrazione che cancella o riscrive dati, fai un backup del database.
