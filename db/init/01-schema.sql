-- Gestionale del fiorista: magazzino (piante, fiori, vasi, accessori), vendite e incassi, ordini dei clienti,
-- spese di gestione (affitto, TARI, utenze, merce...), spese ricorrenti, allegati, registro delle modifiche, statistiche.
-- Login e utenti: schema "auth" minimo, gestito dal servizio backend/ (come negli altri siti di plateslab).
--
-- Importi in CENTESIMI di euro. Spese e incassi sono LORDI (quanto si paga/incassa davvero), con l'IVA a parte.
-- Il prezzo di acquisto degli articoli è IVA ESCLUSA (come nelle fatture dei fornitori), quello di vendita IVA INCLUSA.
-- Quantità con due decimali (steli, mazzi, kg di terriccio...). Fuso orario: Europe/Rome.
--
-- Ruoli: "owner" (titolare) vede e fa tutto; "staff" (commessi) lavora su cassa, ordini, clienti e magazzino
-- ma NON vede spese, statistiche economiche, registro e impostazioni. Le regole stanno qui (RLS), non nella pagina.
-- I visitatori anonimi non leggono nulla.

do $$ begin execute format('alter database %I set timezone to %L', current_database(), 'Europe/Rome'); end $$;

-- ---------------------------------------------------------------- auth ---
create schema auth;

create table auth.users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create function auth.uid() returns uuid
  language sql stable as
$$ select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid $$;

create function auth.role() returns text
  language sql stable as
$$ select nullif(current_setting('request.jwt.claims', true)::json ->> 'role', '') $$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid(), auth.role() to anon, authenticated;

create table public.staff_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner','staff')),
  nome       text check (length(nome) <= 60),
  created_at timestamptz not null default now()
);

create function public.is_staff() returns boolean
  language sql stable security definer set search_path to 'public' as
$$ select exists (select 1 from public.staff_roles where user_id = auth.uid()) $$;

create function public.is_owner() returns boolean
  language sql stable security definer set search_path to 'public' as
$$ select exists (select 1 from public.staff_roles where user_id = auth.uid() and role = 'owner') $$;

create function public.set_aggiornato_il() returns trigger
  language plpgsql as
$$ begin new.aggiornato_il := now(); return new; end; $$;

create function public.aliquota_ok(a numeric) returns numeric
  language sql immutable as
$$ select case when a in (0, 4, 5, 10, 22) then a else null end $$;

-- IVA contenuta in un importo lordo
create function public.iva_di(lordo numeric, aliquota numeric) returns integer
  language sql immutable as
$$ select round(lordo - lordo / (1 + coalesce(aliquota, 0) / 100))::int $$;

-- ----------------------------------------------------------- impostazioni ---
-- Una sola riga (id = 1): dati dell'attività.
create table public.impostazioni (
  id               smallint primary key default 1 check (id = 1),
  nome_attivita    text not null default 'Il Fiorista' check (length(nome_attivita) between 2 and 80),
  ragione_sociale  text check (length(ragione_sociale) <= 120),
  partita_iva      text check (length(partita_iva) <= 20),
  codice_fiscale   text check (length(codice_fiscale) <= 20),
  indirizzo        text check (length(indirizzo) <= 200),
  telefono         text check (length(telefono) <= 40),
  email            text check (length(email) <= 120),
  -- ordinario = IVA da versare (si mostra il riepilogo IVA); forfettario = niente IVA nelle statistiche
  regime           text not null default 'ordinario' check (regime in ('ordinario','forfettario')),
  scorta_minima    numeric(12,2) not null default 2 check (scorta_minima >= 0), -- valore usato se l'articolo non ne ha una sua
  aliquota_default numeric(4,2) not null default 10 check (aliquota_default in (0, 4, 5, 10, 22)),
  note             text check (length(note) <= 2000),
  -- Aspetto e liste modificabili dal titolare (Impostazioni)
  colore_tema      text not null default '#2f5d50' check (colore_tema ~ '^#[0-9a-fA-F]{6}$'),
  colore_accento   text not null default '#d9737f' check (colore_accento ~ '^#[0-9a-fA-F]{6}$'),
  metodi_incasso   text[] not null default '{contanti,carta,bancomat,satispay,bonifico,assegno,altro}'
                   check (cardinality(metodi_incasso) between 1 and 20),
  metodi_spesa     text[] not null default '{bonifico,rid,carta,bancomat,contanti,f24,assegno,altro}'
                   check (cardinality(metodi_spesa) between 1 and 20),
  unita            text[] not null default '{pz,stelo,mazzo,vaso,conf,kg,l,m}' check (cardinality(unita) between 1 and 30),
  -- Sezioni del menu attive (le altre spariscono dal gestionale, i dati restano)
  moduli           text[] not null default '{cassa,ordini,magazzino,ricette,spese,statistiche,clienti,fornitori,registro}',
  -- Obiettivi e calcoli
  obiettivo_mese_cent integer check (obiettivo_mese_cent between 0 and 100000000),
  giorni_apertura  smallint not null default 26 check (giorni_apertura between 1 and 31), -- giorni di apertura al mese (punto di pareggio)
  ricarico         numeric(5,2) not null default 2.5 check (ricarico between 1 and 20), -- prezzo consigliato = costo × ricarico
  -- Cosa possono fare i commessi
  staff_sconti     boolean not null default true,  -- possono fare sconti in cassa
  staff_annulla    boolean not null default true,  -- possono annullare i propri incassi di oggi
  condizioni_preventivo text not null default 'Preventivo valido 30 giorni. Acconto del 30% alla conferma, saldo alla consegna. Fiori e colori possono variare secondo la stagione e la disponibilità, mantenendo stile e valore della composizione.'
                   check (length(condizioni_preventivo) <= 2000),
  check (cardinality(array_remove(metodi_incasso || metodi_spesa || unita, null)) = cardinality(metodi_incasso || metodi_spesa || unita))
);
insert into public.impostazioni (id) values (1);

-- -------------------------------------------------------------- anagrafiche ---
-- Categorie per tre usi: articoli del magazzino, spese, incassi. Si cambiano dal gestionale.
create table public.categorie (
  id        bigint generated always as identity primary key,
  ambito    text not null check (ambito in ('prodotto','spesa','entrata')),
  nome      text not null check (length(trim(nome)) between 2 and 60),
  tipo      text check (tipo in ('fissa','variabile')),       -- solo spese: costo fisso (affitto, TARI...) o variabile
  colore    text not null default '#6b8f71' check (colore ~ '^#[0-9a-fA-F]{6}$'),
  aliquota  numeric(4,2) check (aliquota in (0, 4, 5, 10, 22)), -- solo articoli: IVA proposta per i nuovi articoli
  ordine    smallint not null default 0,
  attiva    boolean not null default true,
  check (ambito = 'spesa' or tipo is null)
);
create unique index categorie_nome_idx on public.categorie (ambito, lower(nome));

create table public.fornitori (
  id          bigint generated always as identity primary key,
  nome        text not null check (length(trim(nome)) between 2 and 120),
  partita_iva text check (length(partita_iva) <= 20),
  referente   text check (length(referente) <= 80),
  telefono    text check (length(telefono) <= 40),
  email       text check (length(email) <= 120),
  indirizzo   text check (length(indirizzo) <= 200),
  iban        text check (length(iban) <= 40),
  note        text check (length(note) <= 2000),
  attivo      boolean not null default true,
  creato_il   timestamptz not null default now()
);

create table public.clienti (
  id          bigint generated always as identity primary key,
  nome        text not null check (length(trim(nome)) between 2 and 120),
  tipo        text not null default 'privato' check (tipo in ('privato','azienda','ente')),
  telefono    text check (length(telefono) <= 40),
  email       text check (length(email) <= 120),
  indirizzo   text check (length(indirizzo) <= 200),
  cf_piva     text check (length(cf_piva) <= 20),
  note        text check (length(note) <= 2000),
  creato_il   timestamptz not null default now()
);

-- --------------------------------------------------------------- magazzino ---
create table public.prodotti (
  id                  bigint generated always as identity primary key,
  nome                text not null check (length(trim(nome)) between 2 and 120),
  codice              text check (length(codice) <= 40),
  categoria_id        bigint references public.categorie(id) on delete set null,
  fornitore_id        bigint references public.fornitori(id) on delete set null,
  unita               text not null default 'pz' check (length(trim(unita)) between 1 and 12),
  prezzo_acquisto_cent integer not null default 0 check (prezzo_acquisto_cent between 0 and 100000000), -- IVA esclusa
  prezzo_vendita_cent  integer not null default 0 check (prezzo_vendita_cent between 0 and 100000000),  -- IVA inclusa
  aliquota_iva        numeric(4,2) not null default 10 check (aliquota_iva in (0, 4, 5, 10, 22)),
  a_magazzino         boolean not null default true,  -- false = servizio (consegna, confezione): niente giacenza
  giacenza            numeric(12,2) not null default 0, -- la scrive SOLO il registro dei movimenti
  scorta_minima       numeric(12,2) check (scorta_minima >= 0),
  riordino            numeric(12,2) check (riordino > 0),   -- quantità che si ordina di solito (lista di riordino)
  deperibile          boolean not null default false, -- fiori recisi, verde: avviso dopo "giorni_vita" dall'ultimo arrivo
  giorni_vita         smallint check (giorni_vita between 1 and 365),
  ultimo_carico       date,
  nome_botanico       text check (length(nome_botanico) <= 120),
  posizione           text check (posizione in ('interno','esterno','entrambi')),
  luce                text check (luce in ('sole','mezzombra','ombra')),
  acqua               text check (acqua in ('poca','media','molta')),
  note                text check (length(note) <= 2000),
  attivo              boolean not null default true,
  creato_il           timestamptz not null default now(),
  aggiornato_il       timestamptz not null default now()
);
create unique index prodotti_codice_idx on public.prodotti (lower(codice)) where codice is not null and codice <> '';
create index prodotti_categoria_idx on public.prodotti (categoria_id);
create trigger prodotti_aggiornato before update on public.prodotti
  for each row execute function public.set_aggiornato_il();

-- ------------------------------------------------------------------ ricette ---
-- Composizioni (bouquet, centrotavola, corone...) descritte come "ricetta" di articoli del magazzino.
-- Vendendo una ricetta il magazzino scala ogni componente e il costo (quindi il margine) è la somma dei componenti.
create table public.ricette (
  id                  bigint generated always as identity primary key,
  nome                text not null check (length(trim(nome)) between 2 and 120),
  categoria_id        bigint references public.categorie(id) on delete set null, -- categoria articoli (es. Composizioni)
  prezzo_vendita_cent integer not null default 0 check (prezzo_vendita_cent between 0 and 100000000), -- IVA inclusa
  aliquota_iva        numeric(4,2) not null default 10 check (aliquota_iva in (0, 4, 5, 10, 22)),
  manodopera_cent     integer not null default 0 check (manodopera_cent between 0 and 10000000), -- costo del lavoro stimato
  minuti              smallint check (minuti between 0 and 6000),
  note                text check (length(note) <= 2000),
  attiva              boolean not null default true,
  creato_il           timestamptz not null default now(),
  aggiornato_il       timestamptz not null default now()
);
create trigger ricette_aggiornato before update on public.ricette
  for each row execute function public.set_aggiornato_il();

create table public.ricetta_righe (
  id          bigint generated always as identity primary key,
  ricetta_id  bigint not null references public.ricette(id) on delete cascade,
  prodotto_id bigint not null references public.prodotti(id) on delete cascade,
  quantita    numeric(12,2) not null check (quantita > 0 and quantita <= 10000),
  unique (ricetta_id, prodotto_id)
);

-- ------------------------------------------------------------------- spese ---
create table public.ricorrenti (
  id            bigint generated always as identity primary key,
  descrizione   text not null check (length(trim(descrizione)) between 2 and 160),
  categoria_id  bigint references public.categorie(id) on delete set null,
  fornitore_id  bigint references public.fornitori(id) on delete set null,
  importo_cent  integer not null check (importo_cent between 0 and 100000000),
  iva_cent      integer not null default 0 check (iva_cent >= 0 and iva_cent <= importo_cent),
  ogni_mesi     smallint not null default 1 check (ogni_mesi in (1, 2, 3, 4, 6, 12)),
  prossima      date not null,
  metodo        text not null default 'bonifico' check (length(trim(metodo)) between 1 and 30),
  attiva        boolean not null default true,
  nota          text check (length(nota) <= 1000),
  creato_il     timestamptz not null default now()
);

create table public.spese (
  id               bigint generated always as identity primary key,
  data             date not null default current_date,
  categoria_id     bigint references public.categorie(id) on delete set null,
  fornitore_id     bigint references public.fornitori(id) on delete set null,
  descrizione      text not null check (length(trim(descrizione)) between 2 and 200),
  numero_documento text check (length(numero_documento) <= 60),
  importo_cent     integer not null check (importo_cent between 0 and 100000000),   -- totale pagato, IVA compresa
  iva_cent         integer not null default 0 check (iva_cent >= 0 and iva_cent <= importo_cent),
  metodo           text not null default 'bonifico' check (length(trim(metodo)) between 1 and 30),
  pagata           boolean not null default true,
  scadenza         date,              -- per le spese ancora da pagare (bollette, fatture a 30 giorni...)
  ricorrente_id    bigint references public.ricorrenti(id) on delete set null,
  nota             text check (length(nota) <= 2000),
  creato_da        uuid default auth.uid(),
  creato_il        timestamptz not null default now(),
  aggiornato_il    timestamptz not null default now()
);
create index spese_data_idx on public.spese (data desc);
create index spese_categoria_idx on public.spese (categoria_id);
create trigger spese_aggiornato before update on public.spese
  for each row execute function public.set_aggiornato_il();

-- ------------------------------------------------------------------- ordini ---
-- Lavori su ordinazione: matrimoni, funerali, bouquet da consegnare, abbonamenti aziende...
-- Un PREVENTIVO è un ordine in stato "preventivo": si stampa (PDF) e, se il cliente accetta, diventa "da fare".
-- Gli acconti e il saldo sono incassi (tabella entrate) collegati all'ordine.
create table public.ordini (
  id              bigint generated always as identity primary key,
  numero          text unique,          -- 2026-0001, lo assegna il database
  cliente_id      bigint references public.clienti(id) on delete set null,
  categoria_id    bigint references public.categorie(id) on delete set null, -- categoria di incasso (Matrimoni, Funerali...)
  descrizione     text not null check (length(trim(descrizione)) between 2 and 2000),
  data_consegna   date not null,
  ora_consegna    time,
  consegna        text not null default 'ritiro' check (consegna in ('ritiro','domicilio','evento')),
  indirizzo       text check (length(indirizzo) <= 200),
  destinatario    text check (length(destinatario) <= 120),
  telefono_dest   text check (length(telefono_dest) <= 40),
  biglietto       text check (length(biglietto) <= 600),
  totale_cent     integer not null default 0 check (totale_cent between 0 and 100000000),
  stato           text not null default 'da_fare'
                  check (stato in ('preventivo','rifiutato','da_fare','in_lavorazione','pronto','consegnato','annullato')),
  valido_fino     date,                 -- solo preventivi
  creato_da_preventivo boolean not null default false, -- per sapere quanti preventivi vengono accettati
  condizioni      text check (length(condizioni) <= 2000), -- testo del preventivo (acconto, tempi, cosa è incluso)
  note            text check (length(note) <= 2000),
  creato_il       timestamptz not null default now(),
  aggiornato_il   timestamptz not null default now()
);
create index ordini_consegna_idx on public.ordini (data_consegna);

-- Voci dell'ordine/preventivo (es. "Bouquet sposa", "12 centrotavola", "Addobbo chiesa"). Il totale lo calcola il database.
create table public.ordine_righe (
  id               bigint generated always as identity primary key,
  ordine_id        bigint not null references public.ordini(id) on delete cascade,
  descrizione      text not null check (length(trim(descrizione)) between 1 and 300),
  quantita         numeric(12,2) not null default 1 check (quantita > 0 and quantita <= 100000),
  prezzo_unit_cent integer not null default 0 check (prezzo_unit_cent between 0 and 100000000), -- IVA inclusa
  ricetta_id       bigint references public.ricette(id) on delete set null,
  ordine           smallint not null default 0
);
create index ordine_righe_ordine_idx on public.ordine_righe (ordine_id);

create function public.ordine_totale() returns trigger
  language plpgsql security definer set search_path to 'public' as
$$
declare v_id bigint := coalesce(new.ordine_id, old.ordine_id);
begin
  update public.ordini set totale_cent = coalesce((select round(sum(quantita * prezzo_unit_cent)) from public.ordine_righe where ordine_id = v_id), 0)
   where id = v_id;
  return null;
end;
$$;
create trigger ordine_righe_totale after insert or update or delete on public.ordine_righe
  for each row execute function public.ordine_totale();
create trigger ordini_aggiornato before update on public.ordini
  for each row execute function public.set_aggiornato_il();

create function public.numero_ordine() returns trigger
  language plpgsql security definer set search_path to 'public' as
$$
declare v_anno text := to_char(current_date, 'YYYY'); v_n int;
begin
  perform pg_advisory_xact_lock(727300);
  select coalesce(max(split_part(numero, '-', 2)::int), 0) + 1 into v_n
    from public.ordini where numero like v_anno || '-%';
  new.numero := v_anno || '-' || lpad(v_n::text, 4, '0');
  return new;
end;
$$;
create trigger ordini_numero before insert on public.ordini
  for each row execute function public.numero_ordine();

-- ------------------------------------------------------------------ incassi ---
create table public.entrate (
  id               bigint generated always as identity primary key,
  data             date not null default current_date,
  categoria_id     bigint references public.categorie(id) on delete set null,
  cliente_id       bigint references public.clienti(id) on delete set null,
  ordine_id        bigint references public.ordini(id) on delete set null,
  descrizione      text check (length(descrizione) <= 200),
  totale_cent      integer not null check (totale_cent between 0 and 100000000),    -- incassato, IVA compresa
  iva_cent         integer not null default 0 check (iva_cent >= 0),
  sconto_cent      integer not null default 0 check (sconto_cent >= 0),
  metodo           text not null default 'contanti' check (length(trim(metodo)) between 1 and 30),
  documento        text not null default 'scontrino' check (documento in ('scontrino','fattura','ricevuta')),
  numero_documento text check (length(numero_documento) <= 60),
  nota             text check (length(nota) <= 1000),
  creato_da        uuid default auth.uid(),
  creato_il        timestamptz not null default now()
);
create index entrate_data_idx on public.entrate (data desc);
create index entrate_ordine_idx on public.entrate (ordine_id);

create table public.entrata_righe (
  id              bigint generated always as identity primary key,
  entrata_id      bigint not null references public.entrate(id) on delete cascade,
  prodotto_id     bigint references public.prodotti(id) on delete set null,
  ricetta_id      bigint references public.ricette(id) on delete set null,
  categoria_id    bigint references public.categorie(id) on delete set null, -- categoria dell'articolo al momento della vendita
  descrizione     text not null,
  quantita        numeric(12,2) not null check (quantita > 0),
  prezzo_unit_cent integer not null check (prezzo_unit_cent >= 0),  -- IVA inclusa
  costo_unit_cent integer not null default 0,                        -- costo d'acquisto (IVA esclusa) in quel momento
  aliquota_iva    numeric(4,2) not null,
  totale_cent     integer not null
);
create index entrata_righe_entrata_idx on public.entrata_righe (entrata_id);

-- ------------------------------------------------------------------- bolle ---
-- Ogni arrivo di merce è una bolla (documento di trasporto): numero e data del fornitore, giorno in cui è arrivata.
-- La fattura del fornitore (una spesa) può raggruppare più bolle (fattura riepilogativa di fine mese).
create table public.bolle (
  id             bigint generated always as identity primary key,
  fornitore_id   bigint references public.fornitori(id) on delete set null,
  numero         text check (length(numero) <= 60),
  data_documento date,
  data_arrivo    date not null default current_date,
  nota           text check (length(nota) <= 1000),
  spesa_id       bigint references public.spese(id) on delete set null,  -- fattura collegata
  creato_da      uuid default auth.uid(),
  creato_il      timestamptz not null default now()
);
create index bolle_arrivo_idx on public.bolle (data_arrivo desc);
create index bolle_fornitore_idx on public.bolle (fornitore_id);

-- ------------------------------------------------------- movimenti magazzino ---
-- Ogni arrivo, vendita, scarto (fiori appassiti, piante rovinate), uso interno (composizioni), reso al fornitore
-- o correzione d'inventario. La giacenza dell'articolo è la somma dei movimenti (la tiene aggiornata un trigger).
create table public.movimenti (
  id              bigint generated always as identity primary key,
  prodotto_id     bigint not null references public.prodotti(id) on delete restrict,
  tipo            text not null check (tipo in ('carico','vendita','scarto','uso','reso','rettifica')),
  quantita        numeric(12,2) not null check (quantita <> 0),   -- positiva = entra, negativa = esce
  costo_unit_cent integer check (costo_unit_cent >= 0),           -- IVA esclusa
  data            date not null default current_date,
  motivo          text check (length(motivo) <= 200),
  entrata_id      bigint references public.entrate(id) on delete set null,
  spesa_id        bigint references public.spese(id) on delete set null,
  bolla_id        bigint references public.bolle(id) on delete cascade,
  utente          uuid default auth.uid(),
  creato_il       timestamptz not null default now(),
  check ((tipo = 'carico' and quantita > 0) or (tipo in ('vendita','scarto','uso','reso') and quantita < 0) or tipo = 'rettifica')
);
create index movimenti_prodotto_idx on public.movimenti (prodotto_id, data desc);
create index movimenti_data_idx on public.movimenti (data desc, tipo);
create index movimenti_bolla_idx on public.movimenti (bolla_id);

create function public.movimenti_prima() returns trigger
  language plpgsql security definer set search_path to 'public' as
$$
begin
  -- il costo serve a dare un valore agli scarti e alle vendite: se non è indicato si usa quello dell'articolo
  if new.costo_unit_cent is null then
    select prezzo_acquisto_cent into new.costo_unit_cent from public.prodotti where id = new.prodotto_id;
  end if;
  return new;
end;
$$;
create trigger movimenti_prima before insert on public.movimenti
  for each row execute function public.movimenti_prima();

create function public.movimenti_giacenza() returns trigger
  language plpgsql security definer set search_path to 'public' as
$$
begin
  if tg_op = 'INSERT' then
    update public.prodotti set
      giacenza = giacenza + new.quantita,
      prezzo_acquisto_cent = case when new.tipo = 'carico' and new.costo_unit_cent > 0 then new.costo_unit_cent else prezzo_acquisto_cent end,
      ultimo_carico = case when new.tipo = 'carico' then greatest(coalesce(ultimo_carico, new.data), new.data) else ultimo_carico end
    where id = new.prodotto_id;
    return new;
  end if;
  update public.prodotti set giacenza = giacenza - old.quantita where id = old.prodotto_id;
  return old;
end;
$$;
create trigger movimenti_giacenza after insert or delete on public.movimenti
  for each row execute function public.movimenti_giacenza();

-- ---------------------------------------------------------------- allegati ---
-- Foto o PDF di fatture, bollette, F24, scontrini. Stanno NEL DATABASE, così finiscono nel backup notturno.
-- Li carica e li serve il servizio auth (/api/allegati), solo al titolare.
create table public.allegati (
  id         uuid primary key default gen_random_uuid(),
  spesa_id   bigint references public.spese(id) on delete cascade,
  bolla_id   bigint references public.bolle(id) on delete cascade,
  nome       text not null check (length(nome) between 1 and 160),
  tipo       text not null check (tipo in ('application/pdf','image/jpeg','image/png','image/webp')),
  dimensione integer not null,
  dati       bytea not null check (octet_length(dati) <= 8 * 1024 * 1024),
  creato_il  timestamptz not null default now()
);
create index allegati_spesa_idx on public.allegati (spesa_id);
create index allegati_bolla_idx on public.allegati (bolla_id);
alter table public.allegati add check (num_nonnulls(spesa_id, bolla_id) = 1);

-- ----------------------------------------------------------- automatismi ---
-- Ricorrenze dei clienti (anniversari, compleanni...): il cruscotto le ricorda qualche giorno prima.
create table public.ricorrenze (
  id          bigint generated always as identity primary key,
  cliente_id  bigint not null references public.clienti(id) on delete cascade,
  descrizione text not null check (length(trim(descrizione)) between 2 and 120),
  giorno      smallint not null check (giorno between 1 and 31),
  mese        smallint not null check (mese between 1 and 12),
  preavviso   smallint not null default 7 check (preavviso between 0 and 60)
);
create index ricorrenze_cliente_idx on public.ricorrenze (cliente_id);

-- Calendario delle feste che contano per il fiorista: il cruscotto avvisa in anticipo (per ordinare la merce)
-- e mostra quanto si era incassato nella stessa settimana dell'anno prima.
-- regola: fissa (giorno/mese), pasqua (giorni di scarto dalla Pasqua), festa_mamma (seconda domenica di maggio).
create table public.calendario (
  id         bigint generated always as identity primary key,
  nome       text not null check (length(trim(nome)) between 2 and 80),
  regola     text not null default 'fissa' check (regola in ('fissa','pasqua','festa_mamma')),
  giorno     smallint check (giorno between 1 and 31),
  mese       smallint check (mese between 1 and 12),
  scarto     smallint not null default 0 check (scarto between -60 and 60),
  preavviso  smallint not null default 21 check (preavviso between 1 and 120),
  nota       text check (length(nota) <= 500),
  attivo     boolean not null default true,
  check (regola <> 'fissa' or (giorno is not null and mese is not null))
);

-- Chiusura di cassa del giorno: contanti contati contro quelli attesi (fondo + incassi in contanti - uscite in contanti - versamenti).
create table public.chiusure (
  id            bigint generated always as identity primary key,
  data          date not null unique default current_date,
  fondo_cent    integer not null default 0 check (fondo_cent between 0 and 10000000),
  versati_cent  integer not null default 0 check (versati_cent between 0 and 100000000), -- portati in banca / tolti dal cassetto
  contati_cent  integer not null check (contati_cent between 0 and 100000000),
  attesi_cent   integer not null default 0,
  pos_cent      integer not null default 0,   -- incassi elettronici del giorno (per confronto con lo scontrino del POS)
  nota          text check (length(nota) <= 1000),
  creato_da     uuid default auth.uid(),
  creato_il     timestamptz not null default now()
);

create function public.chiusura_calcola() returns trigger
  language plpgsql security definer set search_path to 'public' as
$$
begin
  new.attesi_cent := new.fondo_cent
    + coalesce((select sum(totale_cent) from public.entrate where data = new.data and metodo = 'contanti'), 0)
    - coalesce((select sum(importo_cent) from public.spese where data = new.data and metodo = 'contanti' and pagata), 0)
    - new.versati_cent;
  new.pos_cent := coalesce((select sum(totale_cent) from public.entrate where data = new.data and metodo <> 'contanti'), 0);
  return new;
end;
$$;
create trigger chiusure_calcola before insert or update on public.chiusure
  for each row execute function public.chiusura_calcola();

-- ------------------------------------------------------------------ registro ---
-- Chi ha cambiato cosa e quando (tutte le tabelle importanti). Lo legge solo il titolare.
create table public.registro (
  id       bigint generated always as identity primary key,
  quando   timestamptz not null default now(),
  utente   uuid,
  email    text,
  tabella  text not null,
  azione   text not null,
  riga_id  text,
  prima    jsonb,
  dopo     jsonb
);
create index registro_quando_idx on public.registro (quando desc);

create function public.registra_modifica() returns trigger
  language plpgsql security definer set search_path to 'public' as
$$
declare v_prima jsonb; v_dopo jsonb; v_claims json := nullif(current_setting('request.jwt.claims', true), '')::json;
begin
  if tg_op <> 'INSERT' then v_prima := to_jsonb(old) - 'dati'; end if;
  if tg_op <> 'DELETE' then v_dopo := to_jsonb(new) - 'dati'; end if;
  -- la giacenza cambia a ogni vendita: è già nei movimenti, non serve ripeterla qui
  if tg_op = 'UPDATE' and tg_table_name = 'ordini' and (v_prima - 'aggiornato_il' - 'totale_cent') = (v_dopo - 'aggiornato_il' - 'totale_cent') then
    return new; -- il totale lo ricalcola il database dalle voci: già nel registro delle voci
  end if;
  if tg_op = 'UPDATE' and (v_prima - 'aggiornato_il' - 'giacenza' - 'ultimo_carico' - 'prezzo_acquisto_cent')
                        = (v_dopo  - 'aggiornato_il' - 'giacenza' - 'ultimo_carico' - 'prezzo_acquisto_cent') then
    return new;
  end if;
  insert into public.registro (utente, email, tabella, azione, riga_id, prima, dopo)
  values (auth.uid(), v_claims ->> 'email', tg_table_name, lower(tg_op), coalesce(v_dopo ->> 'id', v_prima ->> 'id'), v_prima, v_dopo);
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['impostazioni','categorie','fornitori','clienti','prodotti','ricette','ricorrenti','spese','ordini','ordine_righe','entrate','movimenti','allegati','bolle','chiusure','calendario','ricorrenze'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.registra_modifica()', t || '_registro', t);
  end loop;
end $$;

-- ------------------------------------------------------------- tempo reale ---
-- Avvisa il servizio auth: le altre schede/dispositivi aperti si aggiornano da soli. Solo nome della tabella e tipo di modifica.
create function public.notify_change() returns trigger
  language plpgsql security definer set search_path to 'public' as
$$
begin
  perform pg_notify('db_changes', jsonb_build_object('table', tg_table_name, 'eventType', tg_op)::text);
  return null;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['entrate','ordini','movimenti','spese','prodotti','clienti','ricette','impostazioni','bolle','chiusure'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each statement execute function public.notify_change()', t || '_notify', t);
  end loop;
end $$;

-- ------------------------------------------------------------------- viste ---
create view public.prodotti_vista with (security_invoker = true) as
select p.*,
       c.nome as categoria, c.colore as categoria_colore, f.nome as fornitore,
       coalesce(p.scorta_minima, i.scorta_minima) as scorta,
       (p.a_magazzino and p.attivo and p.giacenza <= coalesce(p.scorta_minima, i.scorta_minima)) as sotto_scorta,
       case when p.a_magazzino and p.giacenza > 0 then round(p.giacenza * p.prezzo_acquisto_cent)::bigint else 0 end as valore_cent,
       case when p.deperibile and p.ultimo_carico is not null then current_date - p.ultimo_carico end as giorni_da_carico,
       (p.deperibile and p.giorni_vita is not null and p.giacenza > 0 and p.ultimo_carico is not null
        and current_date - p.ultimo_carico > p.giorni_vita) as da_controllare
from public.prodotti p
left join public.categorie c on c.id = p.categoria_id
left join public.fornitori f on f.id = p.fornitore_id
cross join public.impostazioni i;

-- Composizioni con costo dei materiali, margine e quante se ne possono fare con le scorte attuali
create view public.ricette_vista with (security_invoker = true) as
select r.*, c.nome as categoria,
       coalesce(x.costo, 0)::bigint as costo_materiali_cent,
       x.componenti, x.possibili,
       (r.prezzo_vendita_cent - public.iva_di(r.prezzo_vendita_cent, r.aliquota_iva) - coalesce(x.costo, 0) - r.manodopera_cent)::bigint as margine_cent,
       round((coalesce(x.costo, 0) + r.manodopera_cent) * i.ricarico * (1 + r.aliquota_iva / 100) / 50) * 50 as prezzo_consigliato_cent
from public.ricette r
left join public.categorie c on c.id = r.categoria_id
cross join public.impostazioni i
left join lateral (
  select round(sum(rr.quantita * p.prezzo_acquisto_cent)) as costo,
         count(*)::int as componenti,
         floor(min(case when p.a_magazzino then greatest(p.giacenza, 0) / rr.quantita end))::int as possibili
    from public.ricetta_righe rr join public.prodotti p on p.id = rr.prodotto_id where rr.ricetta_id = r.id
) x on true;

create view public.ordini_vista with (security_invoker = true) as
select o.*, cl.nome as cliente, cl.telefono as cliente_telefono, c.nome as categoria,
       coalesce((select sum(e.totale_cent) from public.entrate e where e.ordine_id = o.id), 0)::bigint as incassato_cent
from public.ordini o
left join public.clienti cl on cl.id = o.cliente_id
left join public.categorie c on c.id = o.categoria_id;

create view public.entrate_vista with (security_invoker = true) as
select e.*, c.nome as categoria, c.colore as categoria_colore, cl.nome as cliente, o.numero as ordine_numero,
       (select string_agg(r.descrizione || case when r.quantita <> 1 then ' ×' || trim(to_char(r.quantita, 'FM999990.##')) else '' end, ', ' order by r.id)
          from public.entrata_righe r where r.entrata_id = e.id) as articoli
from public.entrate e
left join public.categorie c on c.id = e.categoria_id
left join public.clienti cl on cl.id = e.cliente_id
left join public.ordini o on o.id = e.ordine_id;

create view public.bolle_vista with (security_invoker = true) as
select b.*, f.nome as fornitore,
       (select count(*) from public.movimenti m where m.bolla_id = b.id)::int as righe,
       (select coalesce(round(sum(m.quantita * coalesce(m.costo_unit_cent, 0))), 0) from public.movimenti m where m.bolla_id = b.id)::bigint as netto_cent,
       (select coalesce(round(sum(m.quantita * coalesce(m.costo_unit_cent, 0) * (1 + p.aliquota_iva / 100))), 0)
          from public.movimenti m join public.prodotti p on p.id = m.prodotto_id where m.bolla_id = b.id)::bigint as lordo_cent,
       (select count(*) from public.allegati a where a.bolla_id = b.id)::int as allegati
from public.bolle b
left join public.fornitori f on f.id = b.fornitore_id;

create view public.spese_vista with (security_invoker = true) as
select s.*, c.nome as categoria, c.colore as categoria_colore, c.tipo as categoria_tipo, f.nome as fornitore,
       (select count(*) from public.allegati a where a.spesa_id = s.id)::int as allegati,
       (select count(*) from public.bolle b where b.spesa_id = s.id)::int as bolle
from public.spese s
left join public.categorie c on c.id = s.categoria_id
left join public.fornitori f on f.id = s.fornitore_id;

create view public.movimenti_vista with (security_invoker = true) as
select m.*, p.nome as prodotto, p.unita, c.nome as categoria, b.numero as bolla_numero, f.nome as fornitore
from public.movimenti m
left join public.bolle b on b.id = m.bolla_id
left join public.fornitori f on f.id = b.fornitore_id
join public.prodotti p on p.id = m.prodotto_id
left join public.categorie c on c.id = p.categoria_id;

-- ---------------------------------------------------------------- funzioni ---
-- Registra un incasso. Con "righe" è una vendita (scarica il magazzino); senza, un importo libero.
-- Una riga può essere un articolo (prodotto_id), una composizione (ricetta_id: scala ogni componente) o testo libero.
--  p = { data, categoria_id, cliente_id, ordine_id, metodo, documento, numero_documento, descrizione, nota,
--        sconto_cent, righe: [{prodotto_id | ricetta_id, descrizione, quantita, prezzo_unit_cent, aliquota_iva}],
--        importo_cent, aliquota_iva }   (gli ultimi due solo senza righe)
create function public.registra_vendita(p jsonb) returns bigint
  language plpgsql security definer set search_path to 'public' as
$$
declare
  v_id bigint; r jsonb; v_tot bigint := 0; v_iva bigint := 0; v_sc int := coalesce((p ->> 'sconto_cent')::int, 0);
  v_q numeric; v_pu int; v_al numeric; v_rt int; v_prod public.prodotti%rowtype; v_ric public.ricette%rowtype;
  v_desc text; v_costo int; v_cat bigint;
  v_data date := coalesce((p ->> 'data')::date, current_date);
  v_righe jsonb := coalesce(p -> 'righe', '[]'::jsonb);
  v_imp public.impostazioni%rowtype;
begin
  if not public.is_staff() then raise exception 'Accesso negato' using errcode = '42501'; end if;
  select * into v_imp from public.impostazioni where id = 1;
  if jsonb_typeof(v_righe) <> 'array' then raise exception 'Righe non valide' using errcode = '22023'; end if;
  if jsonb_array_length(v_righe) > 200 then raise exception 'Troppe righe' using errcode = '22023'; end if;
  if v_data > current_date + 1 or v_data < current_date - 3650 then raise exception 'Data non valida' using errcode = '22023'; end if;
  if v_sc > 0 and not v_imp.staff_sconti and not public.is_owner() then
    raise exception 'Gli sconti li può fare solo il titolare' using errcode = '42501';
  end if;
  if (p ->> 'ordine_id') is not null and not exists (select 1 from public.ordini where id = (p ->> 'ordine_id')::bigint) then
    raise exception 'Ordine inesistente' using errcode = '22023';
  end if;

  insert into public.entrate (data, categoria_id, cliente_id, ordine_id, descrizione, totale_cent, metodo, documento, numero_documento, nota)
  values (v_data, (p ->> 'categoria_id')::bigint, (p ->> 'cliente_id')::bigint, (p ->> 'ordine_id')::bigint,
          nullif(trim(p ->> 'descrizione'), ''), 0, coalesce(nullif(trim(p ->> 'metodo'), ''), 'contanti'), coalesce(p ->> 'documento', 'scontrino'),
          nullif(trim(p ->> 'numero_documento'), ''), nullif(trim(p ->> 'nota'), ''))
  returning id into v_id;

  if jsonb_array_length(v_righe) = 0 then
    v_tot := (p ->> 'importo_cent')::int;
    if v_tot is null or v_tot <= 0 then raise exception 'Importo non valido' using errcode = '22023'; end if;
    v_iva := public.iva_di(v_tot, coalesce(public.aliquota_ok((p ->> 'aliquota_iva')::numeric), v_imp.aliquota_default));
  end if;

  for r in select * from jsonb_array_elements(v_righe) loop
    v_q := (r ->> 'quantita')::numeric;
    v_pu := (r ->> 'prezzo_unit_cent')::int;
    if v_q is null or v_q <= 0 or v_q > 100000 then raise exception 'Quantità non valida' using errcode = '22023'; end if;
    if v_pu is null or v_pu < 0 or v_pu > 100000000 then raise exception 'Prezzo non valido' using errcode = '22023'; end if;
    v_prod := null; v_ric := null;
    if (r ->> 'ricetta_id') is not null then
      select * into v_ric from public.ricette where id = (r ->> 'ricetta_id')::bigint;
      if not found then raise exception 'Composizione inesistente' using errcode = '22023'; end if;
      v_al := coalesce(public.aliquota_ok((r ->> 'aliquota_iva')::numeric), v_ric.aliquota_iva);
      v_costo := (select coalesce(round(sum(rr.quantita * pr.prezzo_acquisto_cent)), 0)
                    from public.ricetta_righe rr join public.prodotti pr on pr.id = rr.prodotto_id where rr.ricetta_id = v_ric.id);
      v_cat := v_ric.categoria_id;
      v_desc := left(coalesce(nullif(trim(r ->> 'descrizione'), ''), v_ric.nome), 200);
    else
      if (r ->> 'prodotto_id') is not null then
        select * into v_prod from public.prodotti where id = (r ->> 'prodotto_id')::bigint;
        if not found then raise exception 'Articolo inesistente' using errcode = '22023'; end if;
      end if;
      v_al := coalesce(public.aliquota_ok((r ->> 'aliquota_iva')::numeric), v_prod.aliquota_iva, v_imp.aliquota_default);
      v_costo := coalesce(v_prod.prezzo_acquisto_cent, 0);
      v_cat := v_prod.categoria_id;
      v_desc := left(coalesce(nullif(trim(r ->> 'descrizione'), ''), v_prod.nome, 'Articolo'), 200);
    end if;
    v_rt := round(v_q * v_pu);
    insert into public.entrata_righe (entrata_id, prodotto_id, ricetta_id, categoria_id, descrizione, quantita, prezzo_unit_cent, costo_unit_cent, aliquota_iva, totale_cent)
    values (v_id, v_prod.id, v_ric.id, v_cat, v_desc, v_q, v_pu, v_costo, v_al, v_rt);
    v_tot := v_tot + v_rt;
    v_iva := v_iva + public.iva_di(v_rt, v_al);
    if v_prod.id is not null and v_prod.a_magazzino then
      insert into public.movimenti (prodotto_id, tipo, quantita, data, entrata_id, motivo)
      values (v_prod.id, 'vendita', -v_q, v_data, v_id, 'Vendita');
    end if;
    if v_ric.id is not null then
      insert into public.movimenti (prodotto_id, tipo, quantita, data, entrata_id, motivo)
      select rr.prodotto_id, 'vendita', -(v_q * rr.quantita), v_data, v_id, left('Vendita: ' || v_ric.nome, 200)
        from public.ricetta_righe rr join public.prodotti pr on pr.id = rr.prodotto_id
       where rr.ricetta_id = v_ric.id and pr.a_magazzino;
    end if;
  end loop;

  if v_sc < 0 or v_sc > v_tot then raise exception 'Sconto non valido' using errcode = '22023'; end if;
  if v_sc > 0 and v_tot > 0 then
    v_iva := round(v_iva::numeric * (v_tot - v_sc) / v_tot);
    v_tot := v_tot - v_sc;
  end if;
  if v_tot > 100000000 then raise exception 'Importo troppo alto' using errcode = '22023'; end if;
  update public.entrate set totale_cent = v_tot, iva_cent = v_iva, sconto_cent = v_sc where id = v_id;
  return v_id;
end;
$$;

-- Annulla un incasso e rimette a magazzino la merce. Il titolare sempre; un commesso solo i suoi di oggi.
create function public.annulla_entrata(p_id bigint) returns void
  language plpgsql security definer set search_path to 'public' as
$$
declare e public.entrate%rowtype;
begin
  select * into e from public.entrate where id = p_id;
  if not found then raise exception 'Incasso inesistente' using errcode = '22023'; end if;
  if not (public.is_owner() or (public.is_staff() and e.creato_da = auth.uid() and e.data = current_date
          and (select staff_annulla from public.impostazioni where id = 1))) then
    raise exception 'Solo il titolare può annullare questo incasso' using errcode = '42501';
  end if;
  delete from public.movimenti where entrata_id = p_id;
  delete from public.entrate where id = p_id;
end;
$$;

-- Arrivo di merce: crea la BOLLA (numero e data del fornitore, giorno di arrivo) e carica gli articoli.
-- Facoltativamente registra subito anche la fattura/spesa (solo il titolare).
--  p = { fornitore_id, numero_documento, data_documento, data (arrivo), nota,
--        righe: [{prodotto_id, quantita, costo_unit_cent}],
--        spesa: { categoria_id, metodo, pagata, scadenza, importo_cent?, iva_cent? } }
create function public.registra_carico(p jsonb) returns jsonb
  language plpgsql security definer set search_path to 'public' as
$$
declare
  r jsonb; v_spesa bigint; v_bolla bigint; v_q numeric; v_c int; v_al numeric; v_netto numeric := 0; v_iva numeric := 0; v_n int := 0;
  v_data date := coalesce((p ->> 'data')::date, current_date);
  v_righe jsonb := coalesce(p -> 'righe', '[]'::jsonb);
  v_doc text := nullif(trim(p ->> 'numero_documento'), '');
  v_forn bigint := (p ->> 'fornitore_id')::bigint;
  s jsonb := p -> 'spesa';
begin
  if not public.is_staff() then raise exception 'Accesso negato' using errcode = '42501'; end if;
  if jsonb_typeof(v_righe) <> 'array' or jsonb_array_length(v_righe) = 0 then raise exception 'Nessun articolo' using errcode = '22023'; end if;
  if jsonb_array_length(v_righe) > 300 then raise exception 'Troppe righe' using errcode = '22023'; end if;
  if v_data > current_date + 1 then raise exception 'La data di arrivo non può essere nel futuro' using errcode = '22023'; end if;

  for r in select * from jsonb_array_elements(v_righe) loop
    v_q := (r ->> 'quantita')::numeric;
    v_c := (r ->> 'costo_unit_cent')::int;
    if v_q is null or v_q <= 0 or v_q > 1000000 then raise exception 'Quantità non valida' using errcode = '22023'; end if;
    if v_c is not null and (v_c < 0 or v_c > 100000000) then raise exception 'Costo non valido' using errcode = '22023'; end if;
    select aliquota_iva into v_al from public.prodotti where id = (r ->> 'prodotto_id')::bigint;
    if not found then raise exception 'Articolo inesistente' using errcode = '22023'; end if;
    v_netto := v_netto + v_q * coalesce(v_c, 0);
    v_iva := v_iva + v_q * coalesce(v_c, 0) * v_al / 100;
  end loop;

  if s is not null and jsonb_typeof(s) = 'object' then
    if not public.is_owner() then raise exception 'Solo il titolare registra le spese' using errcode = '42501'; end if;
    insert into public.spese (data, categoria_id, fornitore_id, descrizione, numero_documento, importo_cent, iva_cent, metodo, pagata, scadenza)
    values (coalesce((p ->> 'data_documento')::date, v_data),
            coalesce((s ->> 'categoria_id')::bigint, (select id from public.categorie where ambito = 'spesa' and lower(nome) = 'acquisto merce')),
            v_forn, left('Acquisto merce' || coalesce(' - ' || (select nome from public.fornitori where id = v_forn), ''), 200), v_doc,
            coalesce((s ->> 'importo_cent')::int, round(v_netto + v_iva)::int),
            coalesce((s ->> 'iva_cent')::int, round(v_iva)::int),
            coalesce(nullif(trim(s ->> 'metodo'), ''), 'bonifico'), coalesce((s ->> 'pagata')::boolean, true), (s ->> 'scadenza')::date)
    returning id into v_spesa;
  end if;

  insert into public.bolle (fornitore_id, numero, data_documento, data_arrivo, nota, spesa_id)
  values (v_forn, v_doc, (p ->> 'data_documento')::date, v_data, nullif(trim(p ->> 'nota'), ''), v_spesa)
  returning id into v_bolla;

  for r in select * from jsonb_array_elements(v_righe) loop
    insert into public.movimenti (prodotto_id, tipo, quantita, costo_unit_cent, data, spesa_id, bolla_id, motivo)
    values ((r ->> 'prodotto_id')::bigint, 'carico', (r ->> 'quantita')::numeric, (r ->> 'costo_unit_cent')::int, v_data, v_spesa, v_bolla,
            left(coalesce('Bolla ' || v_doc, 'Arrivo merce'), 200));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('bolla_id', v_bolla, 'spesa_id', v_spesa, 'righe', v_n);
end;
$$;

-- Fattura del fornitore che raggruppa una o più bolle: crea la spesa (o usa una già registrata) e la collega alle bolle.
--  p = { spesa_id }  oppure  { data, numero_documento, importo_cent, iva_cent, categoria_id, metodo, pagata, scadenza }
create function public.fattura_bolle(p_bolle bigint[], p jsonb) returns bigint
  language plpgsql security definer set search_path to 'public' as
$$
declare v_spesa bigint := (p ->> 'spesa_id')::bigint; v_forn bigint; v_netto numeric; v_iva numeric; v_n int;
begin
  if not public.is_owner() then raise exception 'Accesso negato' using errcode = '42501'; end if;
  if p_bolle is null or cardinality(p_bolle) = 0 then raise exception 'Nessuna bolla scelta' using errcode = '22023'; end if;
  select count(*), min(fornitore_id) into v_n, v_forn from public.bolle where id = any(p_bolle);
  if v_n <> cardinality(p_bolle) then raise exception 'Bolla inesistente' using errcode = '22023'; end if;
  if (select count(distinct coalesce(fornitore_id, 0)) from public.bolle where id = any(p_bolle)) > 1 then
    raise exception 'Le bolle devono essere dello stesso fornitore' using errcode = '22023';
  end if;
  if v_spesa is null then
    select coalesce(sum(m.quantita * coalesce(m.costo_unit_cent, 0)), 0), coalesce(sum(m.quantita * coalesce(m.costo_unit_cent, 0) * pr.aliquota_iva / 100), 0)
      into v_netto, v_iva
      from public.movimenti m join public.prodotti pr on pr.id = m.prodotto_id where m.bolla_id = any(p_bolle);
    insert into public.spese (data, categoria_id, fornitore_id, descrizione, numero_documento, importo_cent, iva_cent, metodo, pagata, scadenza)
    values (coalesce((p ->> 'data')::date, current_date),
            coalesce((p ->> 'categoria_id')::bigint, (select id from public.categorie where ambito = 'spesa' and lower(nome) = 'acquisto merce')),
            v_forn, left('Fattura ' || coalesce((select nome from public.fornitori where id = v_forn), 'fornitore')
                         || ' (' || cardinality(p_bolle) || ' bolle)', 200),
            nullif(trim(p ->> 'numero_documento'), ''),
            coalesce((p ->> 'importo_cent')::int, round(v_netto + v_iva)::int), coalesce((p ->> 'iva_cent')::int, round(v_iva)::int),
            coalesce(nullif(trim(p ->> 'metodo'), ''), 'bonifico'), coalesce((p ->> 'pagata')::boolean, false), (p ->> 'scadenza')::date)
    returning id into v_spesa;
  elsif not exists (select 1 from public.spese where id = v_spesa) then
    raise exception 'Spesa inesistente' using errcode = '22023';
  end if;
  update public.bolle set spesa_id = v_spesa where id = any(p_bolle);
  return v_spesa;
end;
$$;

-- Annulla una bolla inserita per sbaglio: toglie la merce dal magazzino. Solo il titolare (o chi l'ha inserita, oggi).
create function public.annulla_bolla(p_id bigint) returns void
  language plpgsql security definer set search_path to 'public' as
$$
declare b public.bolle%rowtype;
begin
  select * into b from public.bolle where id = p_id;
  if not found then raise exception 'Bolla inesistente' using errcode = '22023'; end if;
  if not (public.is_owner() or (public.is_staff() and b.creato_da = auth.uid() and b.creato_il::date = current_date)) then
    raise exception 'Solo il titolare può annullare questa bolla' using errcode = '42501';
  end if;
  delete from public.movimenti where bolla_id = p_id;
  delete from public.bolle where id = p_id;
end;
$$;

-- Inventario: porta la giacenza al valore contato (registra la differenza come rettifica).
create function public.imposta_giacenza(p_prodotto bigint, p_contati numeric, p_motivo text default null) returns numeric
  language plpgsql security definer set search_path to 'public' as
$$
declare v_att numeric; v_delta numeric;
begin
  if not public.is_staff() then raise exception 'Accesso negato' using errcode = '42501'; end if;
  if p_contati is null or p_contati < 0 or p_contati > 1000000 then raise exception 'Quantità non valida' using errcode = '22023'; end if;
  select giacenza into v_att from public.prodotti where id = p_prodotto for update;
  if not found then raise exception 'Articolo inesistente' using errcode = '22023'; end if;
  v_delta := p_contati - v_att;
  if v_delta <> 0 then
    insert into public.movimenti (prodotto_id, tipo, quantita, motivo)
    values (p_prodotto, 'rettifica', v_delta, left(coalesce(nullif(trim(p_motivo), ''), 'Inventario'), 200));
  end if;
  return v_delta;
end;
$$;

-- Registra la spesa di una voce ricorrente (affitto, TARI, luce...) e sposta in avanti la prossima scadenza.
create function public.registra_ricorrente(p_id bigint, p_data date default null, p_importo integer default null, p_pagata boolean default true)
  returns bigint
  language plpgsql security definer set search_path to 'public' as
$$
declare r public.ricorrenti%rowtype; v_id bigint; v_imp int;
begin
  if not public.is_owner() then raise exception 'Accesso negato' using errcode = '42501'; end if;
  select * into r from public.ricorrenti where id = p_id for update;
  if not found then raise exception 'Voce inesistente' using errcode = '22023'; end if;
  v_imp := coalesce(p_importo, r.importo_cent);
  if v_imp < 0 or v_imp > 100000000 then raise exception 'Importo non valido' using errcode = '22023'; end if;
  insert into public.spese (data, categoria_id, fornitore_id, descrizione, importo_cent, iva_cent, metodo, pagata, scadenza, ricorrente_id)
  values (coalesce(p_data, r.prossima), r.categoria_id, r.fornitore_id, r.descrizione, v_imp,
          case when r.importo_cent > 0 then least(v_imp, round(r.iva_cent::numeric * v_imp / r.importo_cent)::int) else 0 end,
          r.metodo,
          coalesce(p_pagata, true), case when coalesce(p_pagata, true) then null else r.prossima end, r.id)
  returning id into v_id;
  update public.ricorrenti set prossima = (prossima + make_interval(months => ogni_mesi))::date where id = p_id;
  return v_id;
end;
$$;

-- Riepilogo per la pagina iniziale. Le cifre economiche (spese, utile) solo al titolare.
create function public.cruscotto() returns jsonb
  language plpgsql stable security definer set search_path to 'public' as
$$
declare v jsonb; v_owner boolean := public.is_owner(); v_mese date := date_trunc('month', current_date)::date;
begin
  if not public.is_staff() then raise exception 'Accesso negato' using errcode = '42501'; end if;
  v := jsonb_build_object(
    'oggi', (select jsonb_build_object('totale', coalesce(sum(totale_cent), 0), 'n', count(*)) from public.entrate where data = current_date),
    'oggi_metodi', (select coalesce(jsonb_object_agg(metodo, t), '{}') from (select metodo, sum(totale_cent) t from public.entrate where data = current_date group by metodo) x),
    'mese_entrate', (select coalesce(sum(totale_cent), 0) from public.entrate where data >= v_mese and data <= current_date),
    'sotto_scorta', (select coalesce(jsonb_agg(x order by x.giacenza), '[]') from
        (select id, nome, giacenza, scorta, unita from public.prodotti_vista where sotto_scorta order by giacenza limit 30) x),
    'n_sotto_scorta', (select count(*) from public.prodotti_vista where sotto_scorta),
    'da_controllare', (select coalesce(jsonb_agg(x), '[]') from
        (select id, nome, giacenza, unita, giorni_da_carico, giorni_vita from public.prodotti_vista where da_controllare and attivo order by giorni_da_carico desc limit 30) x),
    'ordini', (select coalesce(jsonb_agg(x order by x.data_consegna, x.ora_consegna nulls last), '[]') from
        (select id, numero, descrizione, cliente, data_consegna, ora_consegna, stato, consegna, totale_cent, incassato_cent
           from public.ordini_vista where stato in ('da_fare','in_lavorazione','pronto') and data_consegna <= current_date + 7
           order by data_consegna, ora_consegna nulls last limit 40) x)
  );
  if v_owner then
    v := v || jsonb_build_object(
      'mese_uscite', (select coalesce(sum(importo_cent), 0) from public.spese where data >= v_mese and data <= current_date),
      'costi_fissi_mese', (select coalesce(round(sum(importo_cent::numeric / ogni_mesi)), 0) from public.ricorrenti where attiva),
      'da_pagare', (select coalesce(jsonb_agg(x order by x.scadenza nulls last), '[]') from
          (select id, descrizione, importo_cent, scadenza, categoria from public.spese_vista where not pagata order by scadenza nulls last limit 30) x),
      'ricorrenti', (select coalesce(jsonb_agg(x order by x.prossima), '[]') from
          (select id, descrizione, importo_cent, prossima from public.ricorrenti where attiva and prossima <= current_date + 30 order by prossima limit 30) x),
      'mesi', (select jsonb_agg(jsonb_build_object('mese', to_char(m, 'YYYY-MM'),
                 'entrate', (select coalesce(sum(totale_cent), 0) from public.entrate where date_trunc('month', data) = m),
                 'uscite', (select coalesce(sum(importo_cent), 0) from public.spese where date_trunc('month', data) = m)) order by m)
               from generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') m),
      'bolle_da_fatturare', (select count(*) from public.bolle where spesa_id is null),
      'valore_magazzino', (select coalesce(sum(valore_cent), 0) from public.prodotti_vista where attivo),
      -- Punto di pareggio: spese medie mensili degli ultimi 12 mesi (o le ricorrenti, se più alte) e incasso al giorno che serve
      'spesa_media_mese', (select coalesce(round(sum(importo_cent) / 12.0), 0) from public.spese
                            where data > current_date - interval '12 months' and data <= current_date),
      'giorni_apertura', (select giorni_apertura from public.impostazioni where id = 1),
      'obiettivo_mese', (select obiettivo_mese_cent from public.impostazioni where id = 1),
      'mese_anno_scorso', (select coalesce(sum(totale_cent), 0) from public.entrate
                            where data >= (v_mese - interval '1 year')::date and data < (v_mese - interval '1 year' + interval '1 month')::date),
      'giorno_mese', extract(day from current_date)::int,
      'giorni_mese', extract(day from (v_mese + interval '1 month - 1 day'))::int,
      'giorni_con_incassi', (select count(distinct data) from public.entrate where data >= v_mese and data <= current_date)
    );
  end if;
  return v;
end;
$$;

-- Statistiche di un periodo (solo titolare): totali, mesi, categorie di spesa e di incasso, articoli, margini, scarti, IVA...
create function public.statistiche(p_da date, p_a date) returns jsonb
  language plpgsql stable security definer set search_path to 'public' as
$$
declare v_da date := least(p_da, p_a); v_a date := greatest(p_da, p_a); v_prev_da date; v_prev_a date;
begin
  if not public.is_owner() then raise exception 'Accesso negato' using errcode = '42501'; end if;
  if v_a - v_da > 3660 then raise exception 'Periodo troppo lungo (massimo 10 anni)' using errcode = '22023'; end if;
  v_prev_da := (v_da - interval '1 year')::date; v_prev_a := (v_a - interval '1 year')::date;
  return jsonb_build_object(
    'da', v_da, 'a', v_a,
    'totali', (select jsonb_build_object(
        'entrate', coalesce((select sum(totale_cent) from public.entrate where data between v_da and v_a), 0),
        'iva_entrate', coalesce((select sum(iva_cent) from public.entrate where data between v_da and v_a), 0),
        'n_incassi', (select count(*) from public.entrate where data between v_da and v_a),
        'uscite', coalesce((select sum(importo_cent) from public.spese where data between v_da and v_a), 0),
        'iva_uscite', coalesce((select sum(iva_cent) from public.spese where data between v_da and v_a), 0),
        'n_spese', (select count(*) from public.spese where data between v_da and v_a),
        'fisse', coalesce((select sum(s.importo_cent) from public.spese s join public.categorie c on c.id = s.categoria_id
                           where s.data between v_da and v_a and c.tipo = 'fissa'), 0),
        'da_pagare', coalesce((select sum(importo_cent) from public.spese where not pagata), 0),
        'giorni', v_a - v_da + 1)),
    'precedente', (select jsonb_build_object('da', v_prev_da, 'a', v_prev_a,
        'entrate', coalesce((select sum(totale_cent) from public.entrate where data between v_prev_da and v_prev_a), 0),
        'uscite', coalesce((select sum(importo_cent) from public.spese where data between v_prev_da and v_prev_a), 0))),
    'mesi', (select coalesce(jsonb_agg(jsonb_build_object('mese', to_char(m, 'YYYY-MM'),
               'entrate', (select coalesce(sum(totale_cent), 0) from public.entrate where data between greatest(m::date, v_da) and least((m + interval '1 month - 1 day')::date, v_a)),
               'uscite', (select coalesce(sum(importo_cent), 0) from public.spese where data between greatest(m::date, v_da) and least((m + interval '1 month - 1 day')::date, v_a)),
               'fisse', (select coalesce(sum(s.importo_cent), 0) from public.spese s join public.categorie c on c.id = s.categoria_id
                          where c.tipo = 'fissa' and s.data between greatest(m::date, v_da) and least((m + interval '1 month - 1 day')::date, v_a))
             ) order by m), '[]')
             from generate_series(date_trunc('month', v_da), date_trunc('month', v_a), interval '1 month') m),
    'uscite_categorie', (select coalesce(jsonb_agg(x order by x.totale desc), '[]') from
        (select coalesce(c.nome, 'Senza categoria') nome, coalesce(c.colore, '#999999') colore, c.tipo, sum(s.importo_cent) totale, count(*) n
           from public.spese s left join public.categorie c on c.id = s.categoria_id
          where s.data between v_da and v_a group by c.nome, c.colore, c.tipo) x),
    'entrate_categorie', (select coalesce(jsonb_agg(x order by x.totale desc), '[]') from
        (select coalesce(c.nome, 'Senza categoria') nome, coalesce(c.colore, '#999999') colore, sum(e.totale_cent) totale, count(*) n
           from public.entrate e left join public.categorie c on c.id = e.categoria_id
          where e.data between v_da and v_a group by c.nome, c.colore) x),
    'metodi', (select coalesce(jsonb_agg(x order by x.totale desc), '[]') from
        (select metodo nome, sum(totale_cent) totale, count(*) n from public.entrate where data between v_da and v_a group by metodo) x),
    'settimana', (select coalesce(jsonb_agg(x order by x.giorno), '[]') from
        (select extract(isodow from data)::int giorno, sum(totale_cent) totale, count(*) n from public.entrate
          where data between v_da and v_a group by 1) x),
    -- Articoli venduti: ricavo al netto dell'IVA meno costo d'acquisto = margine
    'articoli_categorie', (select coalesce(jsonb_agg(x order by x.ricavo desc), '[]') from
        (select coalesce(c.nome, 'Senza categoria') nome, coalesce(c.colore, '#999999') colore,
                sum(r.totale_cent) ricavo,
                round(sum(r.totale_cent - public.iva_di(r.totale_cent, r.aliquota_iva)))::bigint ricavo_netto,
                round(sum(r.quantita * r.costo_unit_cent))::bigint costo, sum(r.quantita) quantita
           from public.entrata_righe r join public.entrate e on e.id = r.entrata_id
           left join public.categorie c on c.id = r.categoria_id
          where e.data between v_da and v_a group by c.nome, c.colore) x),
    'top_articoli', (select coalesce(jsonb_agg(x order by x.ricavo desc), '[]') from
        (select r.descrizione nome, sum(r.quantita) quantita, sum(r.totale_cent) ricavo,
                round(sum(r.totale_cent - public.iva_di(r.totale_cent, r.aliquota_iva)) - sum(r.quantita * r.costo_unit_cent))::bigint margine
           from public.entrata_righe r join public.entrate e on e.id = r.entrata_id
          where e.data between v_da and v_a group by r.descrizione order by sum(r.totale_cent) desc limit 20) x),
    -- Perdite: scarti (fiori appassiti, piante rovinate) e uso interno, valutati al costo
    'scarti', (select coalesce(jsonb_agg(x order by x.valore desc), '[]') from
        (select coalesce(c.nome, 'Senza categoria') nome, coalesce(c.colore, '#999999') colore, m.tipo,
                round(sum(-m.quantita * coalesce(m.costo_unit_cent, 0)))::bigint valore, sum(-m.quantita) quantita
           from public.movimenti m join public.prodotti p on p.id = m.prodotto_id left join public.categorie c on c.id = p.categoria_id
          where m.tipo in ('scarto','uso') and m.data between v_da and v_a group by c.nome, c.colore, m.tipo) x),
    'acquisti_merce', coalesce((select round(sum(quantita * coalesce(costo_unit_cent, 0)))::bigint from public.movimenti
                                where tipo = 'carico' and data between v_da and v_a), 0),
    'fornitori', (select coalesce(jsonb_agg(x order by x.totale desc), '[]') from
        (select f.nome, sum(s.importo_cent) totale, count(*) n from public.spese s join public.fornitori f on f.id = s.fornitore_id
          where s.data between v_da and v_a group by f.nome order by sum(s.importo_cent) desc limit 15) x),
    'magazzino', (select coalesce(jsonb_agg(x order by x.valore desc), '[]') from
        (select coalesce(categoria, 'Senza categoria') nome, coalesce(categoria_colore, '#999999') colore,
                sum(valore_cent) valore, round(sum(case when giacenza > 0 and a_magazzino then giacenza * prezzo_vendita_cent else 0 end))::bigint valore_vendita,
                count(*) articoli, count(*) filter (where sotto_scorta) sotto_scorta
           from public.prodotti_vista where attivo and a_magazzino group by categoria, categoria_colore) x),
    'ordini', (select jsonb_build_object('n', count(*) filter (where stato not in ('preventivo','rifiutato')),
                 'totale', coalesce(sum(totale_cent) filter (where stato not in ('preventivo','rifiutato','annullato')), 0),
                 'consegnati', count(*) filter (where stato = 'consegnato'), 'annullati', count(*) filter (where stato = 'annullato'),
                 'preventivi', count(*) filter (where stato in ('preventivo','rifiutato') or creato_da_preventivo),
                 'accettati', count(*) filter (where creato_da_preventivo and stato not in ('preventivo','rifiutato')))
               from public.ordini where data_consegna between v_da and v_a)
  );
end;
$$;

-- ---------------------------------------------------------------- sicurezza ---
alter table public.staff_roles   enable row level security;
alter table public.impostazioni  enable row level security;
alter table public.categorie     enable row level security;
alter table public.fornitori     enable row level security;
alter table public.clienti       enable row level security;
alter table public.prodotti      enable row level security;
alter table public.ricorrenti    enable row level security;
alter table public.ricette       enable row level security;
alter table public.ricetta_righe enable row level security;
alter table public.spese         enable row level security;
alter table public.ordini        enable row level security;
alter table public.entrate       enable row level security;
alter table public.entrata_righe enable row level security;
alter table public.movimenti     enable row level security;
alter table public.allegati      enable row level security;
alter table public.registro      enable row level security;
alter table public.bolle         enable row level security;
alter table public.ordine_righe  enable row level security;
alter table public.ricorrenze    enable row level security;
alter table public.calendario    enable row level security;
alter table public.chiusure      enable row level security;

create policy staff_roles_select on public.staff_roles for select to authenticated using (auth.uid() = user_id or public.is_owner());

create policy impostazioni_select on public.impostazioni for select to authenticated using (public.is_staff());
create policy impostazioni_update on public.impostazioni for update to authenticated using (public.is_owner()) with check (public.is_owner());

create policy categorie_select on public.categorie for select to authenticated using (public.is_staff());
-- i commessi possono creare/cambiare solo le categorie degli articoli
create policy categorie_write on public.categorie for all to authenticated
  using (public.is_owner() or (public.is_staff() and ambito = 'prodotto'))
  with check (public.is_owner() or (public.is_staff() and ambito = 'prodotto'));

create policy fornitori_all on public.fornitori for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy clienti_all   on public.clienti   for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy ordini_all    on public.ordini    for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy ordine_righe_all on public.ordine_righe for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy prodotti_select on public.prodotti for select to authenticated using (public.is_staff());
create policy prodotti_insert on public.prodotti for insert to authenticated with check (public.is_staff());
create policy prodotti_update on public.prodotti for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy prodotti_delete on public.prodotti for delete to authenticated using (public.is_owner());

create policy entrate_select on public.entrate for select to authenticated using (public.is_staff());
create policy entrate_update on public.entrate for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy righe_select   on public.entrata_righe for select to authenticated using (public.is_staff());

create policy movimenti_select on public.movimenti for select to authenticated using (public.is_staff());
create policy movimenti_insert on public.movimenti for insert to authenticated
  with check (public.is_staff() and tipo in ('scarto','uso','reso','rettifica') and entrata_id is null and spesa_id is null and bolla_id is null);
create policy movimenti_delete on public.movimenti for delete to authenticated using (public.is_owner() and entrata_id is null and bolla_id is null);

create policy ricette_all on public.ricette for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy ricetta_righe_all on public.ricetta_righe for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy ricorrenti_all on public.ricorrenti for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy spese_all      on public.spese      for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy allegati_all   on public.allegati   for all to authenticated using (public.is_owner()) with check (public.is_owner());
-- foto delle bolle: le vede e le toglie anche il personale (le carica il servizio auth)
create policy allegati_bolle on public.allegati   for select to authenticated using (public.is_staff() and bolla_id is not null);
create policy allegati_bolle_del on public.allegati for delete to authenticated using (public.is_staff() and bolla_id is not null);
create policy bolle_select   on public.bolle      for select to authenticated using (public.is_staff());
create policy bolle_update   on public.bolle      for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy ricorrenze_all on public.ricorrenze for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy calendario_select on public.calendario for select to authenticated using (public.is_staff());
create policy calendario_write  on public.calendario for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy chiusure_select on public.chiusure for select to authenticated using (public.is_staff());
create policy chiusure_insert on public.chiusure for insert to authenticated with check (public.is_staff() and (data = current_date or public.is_owner()));
create policy chiusure_update on public.chiusure for update to authenticated
  using (public.is_owner() or (public.is_staff() and data = current_date)) with check (public.is_owner() or (public.is_staff() and data = current_date));
create policy chiusure_delete on public.chiusure for delete to authenticated using (public.is_owner());
create policy registro_select on public.registro  for select to authenticated using (public.is_owner());

grant usage on schema public to anon, authenticated;
grant select on public.staff_roles, public.impostazioni, public.categorie, public.fornitori, public.clienti, public.prodotti,
  public.ricorrenti, public.spese, public.ordini, public.entrate, public.entrata_righe, public.movimenti, public.registro to authenticated;
grant select (id, spesa_id, bolla_id, nome, tipo, dimensione, creato_il) on public.allegati to authenticated;
grant select on public.bolle, public.ricorrenze, public.calendario, public.chiusure, public.ordine_righe to authenticated;
grant insert, update, delete on public.ordine_righe to authenticated;
grant update (fornitore_id, numero, data_documento, data_arrivo, nota) on public.bolle to authenticated;
grant insert, update, delete on public.ricorrenze, public.calendario to authenticated;
grant insert (data, fondo_cent, versati_cent, contati_cent, nota), update (fondo_cent, versati_cent, contati_cent, nota), delete on public.chiusure to authenticated;
grant delete on public.allegati to authenticated;
grant update (nome_attivita, ragione_sociale, partita_iva, codice_fiscale, indirizzo, telefono, email, regime, scorta_minima, aliquota_default, note,
  colore_tema, colore_accento, metodi_incasso, metodi_spesa, unita, moduli, obiettivo_mese_cent, giorni_apertura, ricarico, staff_sconti, staff_annulla, condizioni_preventivo)
  on public.impostazioni to authenticated;
grant insert, update, delete on public.categorie, public.fornitori, public.clienti, public.ricorrenti, public.spese, public.ricette, public.ricetta_righe to authenticated;
grant select on public.ricette, public.ricetta_righe to authenticated;
grant insert, delete on public.prodotti to authenticated;
grant update (nome, codice, categoria_id, fornitore_id, unita, prezzo_acquisto_cent, prezzo_vendita_cent, aliquota_iva, a_magazzino,
  scorta_minima, riordino, deperibile, giorni_vita, nome_botanico, posizione, luce, acqua, note, attivo) on public.prodotti to authenticated;
grant insert (cliente_id, categoria_id, descrizione, data_consegna, ora_consegna, consegna, indirizzo, destinatario, telefono_dest, biglietto, stato, valido_fino, condizioni, creato_da_preventivo, note),
  update (cliente_id, categoria_id, descrizione, data_consegna, ora_consegna, consegna, indirizzo, destinatario, telefono_dest, biglietto, stato, valido_fino, condizioni, creato_da_preventivo, note),
  delete on public.ordini to authenticated;
grant update (data, categoria_id, cliente_id, descrizione, metodo, documento, numero_documento, nota) on public.entrate to authenticated;
grant insert (prodotto_id, tipo, quantita, costo_unit_cent, data, motivo), delete on public.movimenti to authenticated;
grant usage on all sequences in schema public to authenticated;
grant select on public.prodotti_vista, public.ordini_vista, public.entrate_vista, public.spese_vista, public.movimenti_vista, public.ricette_vista, public.bolle_vista to authenticated;

-- Le funzioni di PostgreSQL sono richiamabili da CHIUNQUE per default: si toglie a tutti e si dà solo quello che serve.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_staff(), public.is_owner(), public.iva_di(numeric, numeric), public.aliquota_ok(numeric),
  public.registra_vendita(jsonb), public.annulla_entrata(bigint), public.registra_carico(jsonb),
  public.imposta_giacenza(bigint, numeric, text), public.registra_ricorrente(bigint, date, integer, boolean),
  public.cruscotto(), public.statistiche(date, date), public.fattura_bolle(bigint[], jsonb), public.annulla_bolla(bigint) to authenticated;
alter default privileges in schema public revoke execute on functions from public;
