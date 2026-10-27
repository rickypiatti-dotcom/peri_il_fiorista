-- Commesso (ruolo staff) senza contabilità: lavora su cassa, ordini, clienti, fornitori, magazzino, bolle e composizioni,
-- ma NON vede incassi (tranne le sue vendite di oggi e i pagamenti degli ordini), spese, statistiche, costi d'acquisto e margini.
-- Le regole stanno nel database: anche chiamando l'API a mano il commesso non legge quei dati.
--
-- Come: le colonne di costo non sono più leggibili direttamente dalle tabelle (prodotti, ricette, movimenti, entrata_righe);
-- il titolare le legge dalle viste, che per il commesso le restituiscono vuote (null). Le viste girano con i permessi del
-- loro proprietario, quindi ripetono a mano le regole di accesso (is_staff / regole degli incassi).

-- --------------------------------------------------------------- incassi ---
drop policy entrate_select on public.entrate;
create policy entrate_select on public.entrate for select to authenticated
  using (public.is_owner() or (public.is_staff() and (ordine_id is not null or (creato_da = auth.uid() and data = current_date))));
drop policy righe_select on public.entrata_righe;
create policy righe_select on public.entrata_righe for select to authenticated
  using (exists (select 1 from public.entrate e where e.id = entrata_id));  -- la regola di entrate vale anche qui

-- chiusure: il commesso vede e fa solo quella di oggi (niente storico delle casse)
drop policy chiusure_select on public.chiusure;
create policy chiusure_select on public.chiusure for select to authenticated
  using (public.is_owner() or (public.is_staff() and data = current_date));

-- incassi del giorno per metodo e fondo cassa proposto, per la chiusura di cassa (il commesso solo oggi)
create function public.cassa_giorno(p_data date) returns jsonb
  language plpgsql stable security definer set search_path to 'public' as
$$
begin
  if not public.is_staff() then raise exception 'Accesso negato' using errcode = '42501'; end if;
  if not public.is_owner() and p_data is distinct from current_date then
    raise exception 'Il commesso vede solo la cassa di oggi' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'metodi', (select coalesce(jsonb_object_agg(metodo, t), '{}') from
                 (select metodo, sum(totale_cent) t from public.entrate where data = p_data group by metodo) x),
    'fondo_proposto', (select greatest(contati_cent, 0) from public.chiusure where data < p_data order by data desc limit 1));
end;
$$;

-- ------------------------------------------------- colonne di costo nascoste ---
do $$
declare coppia text[]; t text; nascosta text; cols text;
begin
  foreach coppia slice 1 in array array[['prodotti','prezzo_acquisto_cent'], ['ricette','manodopera_cent'],
                                     ['movimenti','costo_unit_cent'], ['entrata_righe','costo_unit_cent']] loop
    t := coppia[1]; nascosta := coppia[2];
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns where table_schema = 'public' and table_name = t and column_name <> nascosta;
    execute format('revoke select on public.%I from authenticated', t);
    execute format('grant select (%s) on public.%I to authenticated', cols, t);
  end loop;
end $$;

-- il commesso non scrive i costi: articoli nuovi a costo 0 (lo mette il titolare), modifiche lasciano il costo com'era
create function public.prodotti_costo_titolare() returns trigger
  language plpgsql security definer set search_path to 'public' as
$$
begin
  if auth.uid() is not null and not public.is_owner() then
    new.prezzo_acquisto_cent := case when tg_op = 'INSERT' then 0 else old.prezzo_acquisto_cent end;
  end if;
  return new;
end;
$$;
create trigger prodotti_costo_titolare before insert or update on public.prodotti
  for each row execute function public.prodotti_costo_titolare();

create function public.ricette_costo_titolare() returns trigger
  language plpgsql security definer set search_path to 'public' as
$$
begin
  if auth.uid() is not null and not public.is_owner() then
    new.manodopera_cent := case when tg_op = 'INSERT' then 0 else old.manodopera_cent end;
  end if;
  return new;
end;
$$;
create trigger ricette_costo_titolare before insert or update on public.ricette
  for each row execute function public.ricette_costo_titolare();

-- movimenti (anche gli arrivi registrati dal commesso): il costo è sempre quello dell'articolo
create or replace function public.movimenti_prima() returns trigger
  language plpgsql security definer set search_path to 'public' as
$$
begin
  if auth.uid() is not null and not public.is_owner() then new.costo_unit_cent := null; end if;
  -- il costo serve a dare un valore agli scarti e alle vendite: se non è indicato si usa quello dell'articolo
  if new.costo_unit_cent is null then
    select prezzo_acquisto_cent into new.costo_unit_cent from public.prodotti where id = new.prodotto_id;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------------- viste ---
-- Chi vede cosa nelle viste. current_user = 'postgres' = Adminer, prove e funzioni "security definer" (che controllano da sole chi le chiama):
-- vedono tutto. Le viste qui sotto NON vanno lette da funzioni definer che restituiscono costi al commesso.
create function public.vede_personale() returns boolean language sql stable as
$$ select current_user = 'postgres' or public.is_staff() $$;
create function public.vede_costi() returns boolean language sql stable as
$$ select current_user = 'postgres' or public.is_owner() $$;

-- Stesse colonne di prima; i costi sono null per il commesso. security_invoker = false: le regole sono nel "where".
drop view public.prodotti_vista;
create view public.prodotti_vista with (security_invoker = false) as
select p.id, p.nome, p.codice, p.categoria_id, p.fornitore_id, p.unita,
       case when public.vede_costi() then p.prezzo_acquisto_cent end as prezzo_acquisto_cent,
       p.prezzo_vendita_cent, p.aliquota_iva, p.a_magazzino, p.giacenza, p.scorta_minima, p.riordino, p.deperibile, p.giorni_vita,
       p.ultimo_carico, p.nome_botanico, p.posizione, p.luce, p.acqua, p.note, p.attivo, p.creato_il, p.aggiornato_il,
       c.nome as categoria, c.colore as categoria_colore, f.nome as fornitore,
       coalesce(p.scorta_minima, i.scorta_minima) as scorta,
       (p.a_magazzino and p.attivo and p.giacenza <= coalesce(p.scorta_minima, i.scorta_minima)) as sotto_scorta,
       case when not public.vede_costi() then null
            when p.a_magazzino and p.giacenza > 0 then round(p.giacenza * p.prezzo_acquisto_cent)::bigint else 0 end as valore_cent,
       case when p.deperibile and p.ultimo_carico is not null then current_date - p.ultimo_carico end as giorni_da_carico,
       (p.deperibile and p.giorni_vita is not null and p.giacenza > 0 and p.ultimo_carico is not null
        and current_date - p.ultimo_carico > p.giorni_vita) as da_controllare
from public.prodotti p
left join public.categorie c on c.id = p.categoria_id
left join public.fornitori f on f.id = p.fornitore_id
cross join public.impostazioni i
where public.vede_personale();

drop view public.ricette_vista;
create view public.ricette_vista with (security_invoker = false) as
select r.id, r.nome, r.categoria_id, r.prezzo_vendita_cent, r.aliquota_iva,
       case when public.vede_costi() then r.manodopera_cent end as manodopera_cent,
       r.minuti, r.note, r.attiva, r.creato_il, r.aggiornato_il,
       c.nome as categoria,
       case when public.vede_costi() then coalesce(x.costo, 0)::bigint end as costo_materiali_cent,
       x.componenti, x.possibili,
       case when public.vede_costi() then
         (r.prezzo_vendita_cent - public.iva_di(r.prezzo_vendita_cent, r.aliquota_iva) - coalesce(x.costo, 0) - r.manodopera_cent)::bigint end as margine_cent,
       case when public.vede_costi() then
         round((coalesce(x.costo, 0) + r.manodopera_cent) * i.ricarico * (1 + r.aliquota_iva / 100) / 50) * 50 end as prezzo_consigliato_cent
from public.ricette r
left join public.categorie c on c.id = r.categoria_id
cross join public.impostazioni i
left join lateral (
  select round(sum(rr.quantita * p.prezzo_acquisto_cent)) as costo,
         count(*)::int as componenti,
         floor(min(case when p.a_magazzino then greatest(p.giacenza, 0) / rr.quantita end))::int as possibili
    from public.ricetta_righe rr join public.prodotti p on p.id = rr.prodotto_id where rr.ricetta_id = r.id
) x on true
where public.vede_personale();

drop view public.bolle_vista;
create view public.bolle_vista with (security_invoker = false) as
select b.*, f.nome as fornitore,
       (select count(*) from public.movimenti m where m.bolla_id = b.id)::int as righe,
       case when public.vede_costi() then
         (select coalesce(round(sum(m.quantita * coalesce(m.costo_unit_cent, 0))), 0) from public.movimenti m where m.bolla_id = b.id)::bigint end as netto_cent,
       case when public.vede_costi() then
         (select coalesce(round(sum(m.quantita * coalesce(m.costo_unit_cent, 0) * (1 + p.aliquota_iva / 100))), 0)
            from public.movimenti m join public.prodotti p on p.id = m.prodotto_id where m.bolla_id = b.id)::bigint end as lordo_cent,
       (select count(*) from public.allegati a where a.bolla_id = b.id)::int as allegati
from public.bolle b
left join public.fornitori f on f.id = b.fornitore_id
where public.vede_personale();

drop view public.movimenti_vista;
create view public.movimenti_vista with (security_invoker = false) as
select m.id, m.prodotto_id, m.tipo, m.quantita,
       case when public.vede_costi() then m.costo_unit_cent end as costo_unit_cent,
       m.data, m.motivo, m.entrata_id, m.spesa_id, m.bolla_id, m.utente, m.creato_il,
       p.nome as prodotto, p.unita, c.nome as categoria, b.numero as bolla_numero, f.nome as fornitore
from public.movimenti m
left join public.bolle b on b.id = m.bolla_id
left join public.fornitori f on f.id = b.fornitore_id
join public.prodotti p on p.id = m.prodotto_id
left join public.categorie c on c.id = p.categoria_id
where public.vede_personale();

-- righe degli incassi con il costo (solo titolare): serve all'esportazione completa dei dati
create view public.entrata_righe_vista with (security_invoker = false) as
select r.* from public.entrata_righe r where public.vede_costi();

grant select on public.prodotti_vista, public.ricette_vista, public.bolle_vista, public.movimenti_vista, public.entrata_righe_vista to authenticated;

-- ------------------------------------------------- cruscotto: incassi solo al titolare ---
create or replace function public.cruscotto() returns jsonb
  language plpgsql stable security definer set search_path to 'public' as
$$
declare v jsonb; v_owner boolean := public.is_owner(); v_mese date := date_trunc('month', current_date)::date;
begin
  if not public.is_staff() then raise exception 'Accesso negato' using errcode = '42501'; end if;
  v := jsonb_build_object(
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
      'oggi', (select jsonb_build_object('totale', coalesce(sum(totale_cent), 0), 'n', count(*)) from public.entrate where data = current_date),
      'oggi_metodi', (select coalesce(jsonb_object_agg(metodo, t), '{}') from (select metodo, sum(totale_cent) t from public.entrate where data = current_date group by metodo) x),
      'mese_entrate', (select coalesce(sum(totale_cent), 0) from public.entrate where data >= v_mese and data <= current_date),
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
      -- media sui mesi davvero registrati (al massimo 12): con un mese solo di storico non si divide per 12
      'spesa_media_mese', (select coalesce(round(sum(importo_cent)::numeric / greatest(1, least(12,
                              (extract(year from age(date_trunc('month', current_date), date_trunc('month', min(data)))) * 12
                               + extract(month from age(date_trunc('month', current_date), date_trunc('month', min(data)))) + 1)::int))), 0)
                            from public.spese where data > current_date - interval '12 months' and data <= current_date),
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

revoke execute on function public.cassa_giorno(date), public.prodotti_costo_titolare(), public.ricette_costo_titolare(),
  public.vede_personale(), public.vede_costi() from public, anon, authenticated;
grant execute on function public.cassa_giorno(date), public.vede_personale(), public.vede_costi() to authenticated;

notify pgrst, 'reload schema';
