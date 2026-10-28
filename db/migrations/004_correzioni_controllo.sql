-- Correzioni dal controllo completo del 28 ott 2026.
--  1. Il commesso registra incassi solo con la data di OGGI (prima, chiamando l'API, poteva scriverli nei giorni passati:
--     cambiava la contabilità vecchia e poi non li vedeva più né poteva annullarli).
--  2. Totale di giornata in UNA transazione (registra_giornata): prima un incasso per metodo, uno alla volta;
--     se il secondo falliva, il primo restava e riprovando si registrava due volte.
--  3. Categorie e fornitori già usati non si cancellano (si spengono): prima la cancellazione riusciva e toglieva
--     in silenzio la categoria/il fornitore da articoli, incassi, spese e bolle vecchie (statistiche falsate).
--     Vale per le cancellazioni fatte dal gestionale (ruolo authenticated); le funzioni interne (dati di esempio) restano libere.

-- ------------------------------------------------------------ 1. incassi del commesso solo di oggi
create or replace function public.registra_vendita(p jsonb) returns bigint
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
  if v_data <> current_date and not public.is_owner() then
    raise exception 'Il commesso registra solo incassi di oggi' using errcode = '22023';
  end if;
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

-- ------------------------------------------------------------ 2. totale di giornata tutto insieme
--  p = { data, categoria_id, aliquota_iva, numero_documento, importi: { metodo: centesimi, ... } }
create function public.registra_giornata(p jsonb) returns int
  language plpgsql security definer set search_path to 'public' as
$$
declare m text; c jsonb; v_n int := 0;
begin
  if not public.is_staff() then raise exception 'Accesso negato' using errcode = '42501'; end if;
  if jsonb_typeof(p -> 'importi') is distinct from 'object' then raise exception 'Importi non validi' using errcode = '22023'; end if;
  for m, c in select * from jsonb_each(p -> 'importi') loop
    if jsonb_typeof(c) <> 'number' or (c #>> '{}')::numeric <> round((c #>> '{}')::numeric) or (c #>> '{}')::numeric < 0 then
      raise exception 'Importo non valido (%)', m using errcode = '22023';
    end if;
    continue when (c #>> '{}')::numeric = 0;
    perform public.registra_vendita(jsonb_build_object('data', p -> 'data', 'categoria_id', p -> 'categoria_id', 'metodo', m, 'documento', 'scontrino',
      'numero_documento', p -> 'numero_documento', 'descrizione', 'Totale di giornata (' || m || ')',
      'importo_cent', c, 'aliquota_iva', p -> 'aliquota_iva'));
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Inserisci almeno un importo' using errcode = '22023'; end if;
  return v_n;
end;
$$;
revoke execute on function public.registra_giornata(jsonb) from public, anon;
grant execute on function public.registra_giornata(jsonb) to authenticated;

-- ------------------------------------------------------------ 3. categorie e fornitori usati: non si cancellano
-- quanto è usato: gira come proprietario (il commesso non legge spese e incassi, ma il controllo deve vederli)
create function public.gia_usato(p_tabella text, p_id bigint) returns boolean
  language sql stable security definer set search_path to 'public' as
$$
  select case p_tabella
    when 'categorie' then exists (select 1 from public.prodotti where categoria_id = p_id) or exists (select 1 from public.ricette where categoria_id = p_id)
          or exists (select 1 from public.spese where categoria_id = p_id) or exists (select 1 from public.ricorrenti where categoria_id = p_id)
          or exists (select 1 from public.entrate where categoria_id = p_id) or exists (select 1 from public.entrata_righe where categoria_id = p_id)
          or exists (select 1 from public.ordini where categoria_id = p_id)
    when 'fornitori' then exists (select 1 from public.prodotti where fornitore_id = p_id) or exists (select 1 from public.spese where fornitore_id = p_id)
          or exists (select 1 from public.ricorrenti where fornitore_id = p_id) or exists (select 1 from public.bolle where fornitore_id = p_id)
    else false end
$$;
revoke execute on function public.gia_usato(text, bigint) from public, anon;
grant execute on function public.gia_usato(text, bigint) to authenticated;

-- il trigger NON è security definer: current_user = chi cancella. Dal gestionale è "authenticated";
-- le funzioni interne (es. cancella_dati_esempio) girano come proprietario e restano libere.
create function public.blocca_cancellazione_usati() returns trigger
  language plpgsql as
$$
begin
  if current_user = 'authenticated' and public.gia_usato(tg_table_name, old.id) then
    raise exception 'Già usato in articoli, incassi, spese o bolle: non si può cancellare. Togli la spunta «Attiva/Attivo» per spegnerlo.' using errcode = '22023';
  end if;
  return old;
end;
$$;
revoke execute on function public.blocca_cancellazione_usati() from public, anon, authenticated;
create trigger categorie_usate before delete on public.categorie for each row execute function public.blocca_cancellazione_usati();
create trigger fornitori_usati before delete on public.fornitori for each row execute function public.blocca_cancellazione_usati();

notify pgrst, 'reload schema';
