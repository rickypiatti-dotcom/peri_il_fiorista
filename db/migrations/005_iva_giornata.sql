-- Totale di giornata con l'IVA divisa per aliquota (richiesta di Riccardo, 28 ott 2026).
-- Prima: un'unica «IVA media» per tutto il totale. Ora: righe per aliquota (es. 100 € al 10%, 50 € al 22%)
-- più gli importi per metodo di pagamento come prima; i due totali devono coincidere.
-- Si registra un incasso per ogni coppia metodo × aliquota (importo libero, NIENTE righe di vendita: il totale
-- di giornata non deve comparire tra gli «articoli venduti» delle statistiche). La quota di ogni aliquota si divide
-- tra i metodi in proporzione; gli arrotondamenti sono sistemati in modo che tornino esatti al centesimo:
--   - il totale di ogni METODO (chiusura di cassa),
--   - il totale di ogni ALIQUOTA e la sua IVA (quella calcolata sul totale dell'aliquota, come il registratore).
--  p = { data, categoria_id, numero_documento, importi: { metodo: centesimi }, iva: [{ aliquota, importo_cent }] }
--  senza «iva» (o vuoto): come prima, con un'unica aliquota_iva.

create or replace function public.registra_giornata(p jsonb) returns int
  language plpgsql security definer set search_path to 'public' as
$$
declare
  m text; c jsonb; r jsonb; v_n int := 0; i int; j int; k int; n int; x numeric; v_a numeric; v_c bigint; v_id bigint;
  v_met text[] := '{}'; v_imp bigint[] := '{}'; v_tot bigint := 0;     -- metodi e importi
  v_al numeric[] := '{}'; v_ia bigint[] := '{}'; v_tot_iva bigint := 0; -- aliquote e importi
  v_res bigint[];   -- quanto resta da assegnare a ogni metodo
  v_q bigint[];     -- matrice metodi × aliquote: cella (i, j) = v_q[(i - 1) * n + j]
  v_resti numeric[]; v_base bigint; v_mancano bigint; v_best int;
  v_eid bigint[] := '{}'; v_ej int[] := '{}'; v_iva bigint;
  v_eur text;
begin
  if not public.is_staff() then raise exception 'Accesso negato' using errcode = '42501'; end if;
  if jsonb_typeof(p -> 'importi') is distinct from 'object' then raise exception 'Importi non validi' using errcode = '22023'; end if;
  for m, c in select * from jsonb_each(p -> 'importi') loop
    if jsonb_typeof(c) <> 'number' or (c #>> '{}')::numeric <> round((c #>> '{}')::numeric) or (c #>> '{}')::numeric < 0 then
      raise exception 'Importo non valido (%)', m using errcode = '22023';
    end if;
    continue when (c #>> '{}')::numeric = 0;
    v_met := v_met || m; v_imp := v_imp || (c #>> '{}')::bigint; v_tot := v_tot + (c #>> '{}')::bigint;
  end loop;
  k := coalesce(array_length(v_met, 1), 0);
  if k = 0 then raise exception 'Inserisci almeno un importo' using errcode = '22023'; end if;

  -- senza divisione per aliquota: come prima (un incasso per metodo con l'aliquota scelta)
  if jsonb_typeof(p -> 'iva') is distinct from 'array' or jsonb_array_length(p -> 'iva') = 0 then
    for i in 1 .. k loop
      perform public.registra_vendita(jsonb_build_object('data', p -> 'data', 'categoria_id', p -> 'categoria_id', 'metodo', v_met[i], 'documento', 'scontrino',
        'numero_documento', p -> 'numero_documento', 'descrizione', 'Totale di giornata (' || v_met[i] || ')',
        'importo_cent', v_imp[i], 'aliquota_iva', p -> 'aliquota_iva'));
    end loop;
    return k;
  end if;

  -- righe per aliquota (la stessa aliquota due volte = si sommano)
  if jsonb_array_length(p -> 'iva') > 10 then raise exception 'Troppe righe IVA' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p -> 'iva') loop
    v_a := public.aliquota_ok((r ->> 'aliquota')::numeric);
    if v_a is null then raise exception 'Aliquota IVA non valida' using errcode = '22023'; end if;
    if jsonb_typeof(r -> 'importo_cent') <> 'number' or (r ->> 'importo_cent')::numeric <> round((r ->> 'importo_cent')::numeric)
       or (r ->> 'importo_cent')::numeric < 0 then
      raise exception 'Importo non valido nelle righe IVA' using errcode = '22023';
    end if;
    v_c := (r ->> 'importo_cent')::bigint;
    continue when v_c = 0;
    j := array_position(v_al, v_a);
    if j is null then v_al := v_al || v_a; v_ia := v_ia || v_c; else v_ia[j] := v_ia[j] + v_c; end if;
    v_tot_iva := v_tot_iva + v_c;
  end loop;
  n := coalesce(array_length(v_al, 1), 0);
  if n = 0 then raise exception 'Inserisci almeno un importo nelle righe IVA' using errcode = '22023'; end if;
  if v_tot_iva <> v_tot then
    v_eur := replace(to_char(v_tot_iva / 100.0, 'FM999999990.00'), '.', ',');
    raise exception 'Le righe IVA fanno % € ma i pagamenti fanno % €: devono essere uguali', v_eur,
      replace(to_char(v_tot / 100.0, 'FM999999990.00'), '.', ',') using errcode = '22023';
  end if;

  -- divisione: ogni aliquota (tranne l'ultima) si divide tra i metodi in proporzione a quanto resta a ciascun metodo,
  -- con il metodo dei resti più grandi; l'ultima aliquota prende quello che resta a ogni metodo.
  -- Così ogni colonna (aliquota) e ogni riga (metodo) tornano esatte e nessuna cella è negativa.
  v_res := v_imp;
  v_q := array_fill(0::bigint, array[k * n]);
  for j in 1 .. n - 1 loop
    v_base := (select sum(x0) from unnest(v_res) x0);
    v_resti := array_fill(0::numeric, array[k]);
    v_mancano := v_ia[j];
    for i in 1 .. k loop
      x := v_ia[j]::numeric * v_res[i] / v_base;
      v_q[(i - 1) * n + j] := floor(x);
      v_resti[i] := x - floor(x);
      v_mancano := v_mancano - floor(x);
    end loop;
    while v_mancano > 0 loop
      v_best := null;
      for i in 1 .. k loop
        if v_q[(i - 1) * n + j] < v_res[i] and (v_best is null or v_resti[i] > v_resti[v_best]) then v_best := i; end if;
      end loop;
      exit when v_best is null; -- non succede: la somma di quanto resta ai metodi è sempre >= quota dell'aliquota
      v_q[(v_best - 1) * n + j] := v_q[(v_best - 1) * n + j] + 1;
      v_resti[v_best] := -1;
      v_mancano := v_mancano - 1;
    end loop;
    for i in 1 .. k loop v_res[i] := v_res[i] - v_q[(i - 1) * n + j]; end loop;
  end loop;
  for i in 1 .. k loop v_q[(i - 1) * n + n] := v_res[i]; end loop;

  for i in 1 .. k loop
    for j in 1 .. n loop
      continue when v_q[(i - 1) * n + j] <= 0;
      v_id := public.registra_vendita(jsonb_build_object('data', p -> 'data', 'categoria_id', p -> 'categoria_id', 'metodo', v_met[i], 'documento', 'scontrino',
        'numero_documento', p -> 'numero_documento',
        'descrizione', 'Totale di giornata (' || v_met[i] || case when n > 1 then ' · IVA ' || rtrim(to_char(v_al[j], 'FM990.##'), '.') || '%' else '' end || ')',
        'importo_cent', v_q[(i - 1) * n + j], 'aliquota_iva', v_al[j]));
      v_eid := v_eid || v_id; v_ej := v_ej || j; v_n := v_n + 1;
    end loop;
  end loop;

  -- IVA di ogni aliquota = quella del suo totale (come sul registratore): la differenza di arrotondamento delle quote
  -- va sull'incasso più grande di quell'aliquota
  for j in 1 .. n loop
    select coalesce(sum(e.iva_cent), 0) into v_iva from public.entrate e
      join unnest(v_eid, v_ej) as t(eid, jj) on t.eid = e.id where t.jj = j;
    if v_iva <> public.iva_di(v_ia[j], v_al[j]) then
      update public.entrate set iva_cent = iva_cent + (public.iva_di(v_ia[j], v_al[j]) - v_iva)
       where id = (select e.id from public.entrate e join unnest(v_eid, v_ej) as t(eid, jj) on t.eid = e.id
                    where t.jj = j order by e.totale_cent desc, e.id limit 1);
    end if;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.registra_giornata(jsonb) from public, anon;
grant execute on function public.registra_giornata(jsonb) to authenticated;

notify pgrst, 'reload schema';
