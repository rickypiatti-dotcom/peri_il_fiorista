-- Incassi con metodo di pagamento "altro" (buoni regalo): contabilità SEPARATA.
-- Non entrano in cruscotto, statistiche, chiusura di cassa (pagamenti elettronici) né nei totali degli incassi:
-- si vedono solo nella pagina "Altro" (clic sul fiore accanto al nome del negozio).
-- Restano incassi veri per tutto il resto (ordini pagati, magazzino, esportazione completa dei dati).

create function public.metodo_separato(m text) returns boolean
  language sql immutable as
$$ select lower(trim(coalesce(m, ''))) = 'altro' $$;
grant execute on function public.metodo_separato(text) to authenticated;

-- ------------------------------------------------------------ chiusura di cassa ---
create or replace function public.chiusura_calcola() returns trigger
  language plpgsql security definer set search_path to 'public' as
$$
begin
  new.attesi_cent := new.fondo_cent
    + coalesce((select sum(totale_cent) from public.entrate where data = new.data and metodo = 'contanti'), 0)
    - coalesce((select sum(importo_cent) from public.spese where data = new.data and metodo = 'contanti' and pagata), 0)
    - new.versati_cent;
  new.pos_cent := coalesce((select sum(totale_cent) from public.entrate
                             where data = new.data and metodo <> 'contanti' and not public.metodo_separato(metodo)), 0);
  return new;
end;
$$;

create or replace function public.cassa_giorno(p_data date) returns jsonb
  language plpgsql stable security definer set search_path to 'public' as
$$
begin
  if not public.is_staff() then raise exception 'Accesso negato' using errcode = '42501'; end if;
  if not public.is_owner() and p_data is distinct from current_date then
    raise exception 'Il commesso vede solo la cassa di oggi' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'metodi', (select coalesce(jsonb_object_agg(metodo, t), '{}') from
                 (select metodo, sum(totale_cent) t from public.entrate
                   where data = p_data and not public.metodo_separato(metodo) group by metodo) x),
    'fondo_proposto', (select greatest(contati_cent, 0) from public.chiusure where data < p_data order by data desc limit 1));
end;
$$;

-- ------------------------------------------------------------------ cruscotto ---
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
      'oggi', (select jsonb_build_object('totale', coalesce(sum(totale_cent), 0), 'n', count(*)) from public.entrate
                where data = current_date and not public.metodo_separato(metodo)),
      'oggi_metodi', (select coalesce(jsonb_object_agg(metodo, t), '{}') from (select metodo, sum(totale_cent) t from public.entrate
                       where data = current_date and not public.metodo_separato(metodo) group by metodo) x),
      'mese_entrate', (select coalesce(sum(totale_cent), 0) from public.entrate
                        where data >= v_mese and data <= current_date and not public.metodo_separato(metodo)),
      'mese_uscite', (select coalesce(sum(importo_cent), 0) from public.spese where data >= v_mese and data <= current_date),
      'costi_fissi_mese', (select coalesce(round(sum(importo_cent::numeric / ogni_mesi)), 0) from public.ricorrenti where attiva),
      'da_pagare', (select coalesce(jsonb_agg(x order by x.scadenza nulls last), '[]') from
          (select id, descrizione, importo_cent, scadenza, categoria from public.spese_vista where not pagata order by scadenza nulls last limit 30) x),
      'ricorrenti', (select coalesce(jsonb_agg(x order by x.prossima), '[]') from
          (select id, descrizione, importo_cent, prossima from public.ricorrenti where attiva and prossima <= current_date + 30 order by prossima limit 30) x),
      'mesi', (select jsonb_agg(jsonb_build_object('mese', to_char(m, 'YYYY-MM'),
                 'entrate', (select coalesce(sum(totale_cent), 0) from public.entrate
                              where date_trunc('month', data) = m and not public.metodo_separato(metodo)),
                 'uscite', (select coalesce(sum(importo_cent), 0) from public.spese where date_trunc('month', data) = m)) order by m)
               from generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') m),
      'bolle_da_fatturare', (select count(*) from public.bolle where spesa_id is null),
      'valore_magazzino', (select coalesce(sum(valore_cent), 0) from public.prodotti_vista where attivo),
      'spesa_media_mese', (select coalesce(round(sum(importo_cent)::numeric / greatest(1, least(12,
                              (extract(year from age(date_trunc('month', current_date), date_trunc('month', min(data)))) * 12
                               + extract(month from age(date_trunc('month', current_date), date_trunc('month', min(data)))) + 1)::int))), 0)
                            from public.spese where data > current_date - interval '12 months' and data <= current_date),
      'giorni_apertura', (select giorni_apertura from public.impostazioni where id = 1),
      'obiettivo_mese', (select obiettivo_mese_cent from public.impostazioni where id = 1),
      'mese_anno_scorso', (select coalesce(sum(totale_cent), 0) from public.entrate
                            where data >= (v_mese - interval '1 year')::date and data < (v_mese - interval '1 year' + interval '1 month')::date
                              and not public.metodo_separato(metodo)),
      'giorno_mese', extract(day from current_date)::int,
      'giorni_mese', extract(day from (v_mese + interval '1 month - 1 day'))::int,
      'giorni_con_incassi', (select count(distinct data) from public.entrate
                              where data >= v_mese and data <= current_date and not public.metodo_separato(metodo))
    );
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------- statistiche ---
create or replace function public.statistiche(p_da date, p_a date) returns jsonb
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
        'entrate', coalesce((select sum(totale_cent) from public.entrate where data between v_da and v_a and not public.metodo_separato(metodo)), 0),
        'iva_entrate', coalesce((select sum(iva_cent) from public.entrate where data between v_da and v_a and not public.metodo_separato(metodo)), 0),
        'n_incassi', (select count(*) from public.entrate where data between v_da and v_a and not public.metodo_separato(metodo)),
        'uscite', coalesce((select sum(importo_cent) from public.spese where data between v_da and v_a), 0),
        'iva_uscite', coalesce((select sum(iva_cent) from public.spese where data between v_da and v_a), 0),
        'n_spese', (select count(*) from public.spese where data between v_da and v_a),
        'fisse', coalesce((select sum(s.importo_cent) from public.spese s join public.categorie c on c.id = s.categoria_id
                           where s.data between v_da and v_a and c.tipo = 'fissa'), 0),
        'da_pagare', coalesce((select sum(importo_cent) from public.spese where not pagata), 0),
        'giorni', v_a - v_da + 1)),
    'precedente', (select jsonb_build_object('da', v_prev_da, 'a', v_prev_a,
        'entrate', coalesce((select sum(totale_cent) from public.entrate where data between v_prev_da and v_prev_a and not public.metodo_separato(metodo)), 0),
        'uscite', coalesce((select sum(importo_cent) from public.spese where data between v_prev_da and v_prev_a), 0))),
    'mesi', (select coalesce(jsonb_agg(jsonb_build_object('mese', to_char(m, 'YYYY-MM'),
               'entrate', (select coalesce(sum(totale_cent), 0) from public.entrate
                            where data between greatest(m::date, v_da) and least((m + interval '1 month - 1 day')::date, v_a) and not public.metodo_separato(metodo)),
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
          where e.data between v_da and v_a and not public.metodo_separato(e.metodo) group by c.nome, c.colore) x),
    'metodi', (select coalesce(jsonb_agg(x order by x.totale desc), '[]') from
        (select metodo nome, sum(totale_cent) totale, count(*) n from public.entrate
          where data between v_da and v_a and not public.metodo_separato(metodo) group by metodo) x),
    'settimana', (select coalesce(jsonb_agg(x order by x.giorno), '[]') from
        (select extract(isodow from data)::int giorno, sum(totale_cent) totale, count(*) n from public.entrate
          where data between v_da and v_a and not public.metodo_separato(metodo) group by 1) x),
    'articoli_categorie', (select coalesce(jsonb_agg(x order by x.ricavo desc), '[]') from
        (select coalesce(c.nome, 'Senza categoria') nome, coalesce(c.colore, '#999999') colore,
                sum(r.totale_cent) ricavo,
                round(sum(r.totale_cent - public.iva_di(r.totale_cent, r.aliquota_iva)))::bigint ricavo_netto,
                round(sum(r.quantita * r.costo_unit_cent))::bigint costo, sum(r.quantita) quantita
           from public.entrata_righe r join public.entrate e on e.id = r.entrata_id
           left join public.categorie c on c.id = r.categoria_id
          where e.data between v_da and v_a and not public.metodo_separato(e.metodo) group by c.nome, c.colore) x),
    'top_articoli', (select coalesce(jsonb_agg(x order by x.ricavo desc), '[]') from
        (select r.descrizione nome, sum(r.quantita) quantita, sum(r.totale_cent) ricavo,
                round(sum(r.totale_cent - public.iva_di(r.totale_cent, r.aliquota_iva)) - sum(r.quantita * r.costo_unit_cent))::bigint margine
           from public.entrata_righe r join public.entrate e on e.id = r.entrata_id
          where e.data between v_da and v_a and not public.metodo_separato(e.metodo)
          group by r.descrizione order by sum(r.totale_cent) desc limit 20) x),
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

notify pgrst, 'reload schema';
