-- Dati di ESEMPIO per far vedere il gestionale (un anno di negozio finto), caricabili e cancellabili dal titolare
-- (Impostazioni > I tuoi dati). Si caricano solo a gestionale vuoto (nessun articolo).
-- Tutto ciò che crea ha lo stesso istante di creazione (now() della transazione), salvato in dati_esempio:
-- così cancella_dati_esempio() toglie esattamente quelle righe e nient'altro.

create table public.dati_esempio (
  id          smallint primary key default 1 check (id = 1),
  caricati_il timestamptz not null
);
alter table public.dati_esempio enable row level security;
create policy dati_esempio_select on public.dati_esempio for select to authenticated using (public.is_owner());
grant select on public.dati_esempio to authenticated;

create function public.carica_dati_esempio() returns jsonb
  language plpgsql security definer set search_path to 'public' as
$$
declare
  t0 timestamptz := now(); oggi date := current_date; d date; i int; k int; n int; r record;
  f_fiori bigint; f_vivai bigint; f_vasi bigint; f_enel bigint; f_comune bigint; f_immob bigint; f_comm bigint;
  righe jsonb; prod bigint[]; pesi numeric[]; ric bigint[];
  molt numeric; met text; cli bigint[]; o bigint; c_id bigint;
  cat_prod jsonb := (select jsonb_object_agg(nome, id) from public.categorie where ambito = 'prodotto');
  cat_spesa jsonb := (select jsonb_object_agg(nome, id) from public.categorie where ambito = 'spesa');
  cat_ent jsonb := (select jsonb_object_agg(nome, id) from public.categorie where ambito = 'entrata');
begin
  if not public.is_owner() then raise exception 'Accesso negato' using errcode = '42501'; end if;
  if exists (select 1 from public.prodotti) or exists (select 1 from public.entrate) then
    raise exception 'I dati di esempio si caricano solo a gestionale vuoto (ci sono già articoli o incassi)' using errcode = '22023';
  end if;
  perform setseed(0.42);

  -- fornitori
  insert into public.fornitori (nome, referente, telefono, email, note) values
    ('Flora Mercato Srl', 'Paolo', '02 9876543', 'ordini@floramercato.example', 'Fiori recisi e verde. Consegna martedì e venerdì, ordine entro le 18 del giorno prima.') returning id into f_fiori;
  insert into public.fornitori (nome, referente, telefono, note) values ('Vivai Lombardi', 'Sara', '0331 112233', 'Piante da interno ed esterno, consegna mensile') returning id into f_vivai;
  insert into public.fornitori (nome, telefono, note) values ('Casa & Vaso Spa', '02 5554433', 'Vasi, cachepot, carta, nastri, candele') returning id into f_vasi;
  insert into public.fornitori (nome) values ('Enel Energia') returning id into f_enel;
  insert into public.fornitori (nome) values ('Comune - Ufficio Tributi') returning id into f_comune;
  insert into public.fornitori (nome, referente) values ('Immobiliare Saronno', 'sig. Galli') returning id into f_immob;
  insert into public.fornitori (nome) values ('Studio Rossi Commercialisti') returning id into f_comm;

  -- articoli: nome, categoria, unità, costo (IVA esclusa), prezzo (IVA inclusa), IVA, fornitore, deperibile, giorni, scorta, botanico, posizione, luce, acqua
  insert into public.prodotti (nome, categoria_id, unita, prezzo_acquisto_cent, prezzo_vendita_cent, aliquota_iva, fornitore_id, deperibile, giorni_vita, scorta_minima, nome_botanico, posizione, luce, acqua, a_magazzino)
  select x.nome, (cat_prod ->> x.cat)::bigint, x.u, x.c, x.pv, x.iva, case x.f when 'fiori' then f_fiori when 'vivai' then f_vivai else f_vasi end,
         x.dep, x.gv, x.sc, x.bot, x.pos, x.luce, x.acqua, x.mag
  from (values
    ('Rosa rossa «Freedom»',   'Fiori recisi', 'stelo', 85, 300, 10, 'fiori', true, 7, 40, 'Rosa', null, null, null, true),
    ('Rosa bianca «Avalanche»','Fiori recisi', 'stelo', 80, 300, 10, 'fiori', true, 7, 30, 'Rosa', null, null, null, true),
    ('Tulipano misto',         'Fiori recisi', 'stelo', 45, 180, 10, 'fiori', true, 5, 30, 'Tulipa', null, null, null, true),
    ('Girasole',               'Fiori recisi', 'stelo', 70, 250, 10, 'fiori', true, 6, 15, 'Helianthus annuus', null, null, null, true),
    ('Lilium bianco',          'Fiori recisi', 'stelo', 160, 500, 10, 'fiori', true, 8, 15, 'Lilium longiflorum', null, null, null, true),
    ('Gerbera',                'Fiori recisi', 'stelo', 55, 200, 10, 'fiori', true, 6, 20, 'Gerbera jamesonii', null, null, null, true),
    ('Ranuncolo',              'Fiori recisi', 'stelo', 90, 300, 10, 'fiori', true, 6, 20, 'Ranunculus asiaticus', null, null, null, true),
    ('Peonia',                 'Fiori recisi', 'stelo', 220, 650, 10, 'fiori', true, 4, 10, 'Paeonia lactiflora', null, null, null, true),
    ('Crisantemo',             'Fiori recisi', 'stelo', 60, 220, 10, 'fiori', true, 10, 30, 'Chrysanthemum', null, null, null, true),
    ('Mimosa',                 'Fiori recisi', 'mazzo', 300, 800, 10, 'fiori', true, 3, 5, 'Acacia dealbata', null, null, null, true),
    ('Eucalipto',              'Verde ornamentale', 'stelo', 35, 120, 10, 'fiori', true, 12, 20, 'Eucalyptus cinerea', null, null, null, true),
    ('Ruscus',                 'Verde ornamentale', 'stelo', 20, 80, 10, 'fiori', true, 14, 20, 'Ruscus aculeatus', null, null, null, true),
    ('Orchidea Phalaenopsis',  'Orchidee', 'vaso', 750, 2200, 10, 'vivai', false, null, 4, 'Phalaenopsis', 'interno', 'mezzombra', 'poca', true),
    ('Monstera deliciosa',     'Piante da interno', 'vaso', 1200, 3500, 10, 'vivai', false, null, 2, 'Monstera deliciosa', 'interno', 'mezzombra', 'media', true),
    ('Ficus lyrata',           'Piante da interno', 'vaso', 1800, 4900, 10, 'vivai', false, null, 2, 'Ficus lyrata', 'interno', 'sole', 'media', true),
    ('Pothos',                 'Piante da interno', 'vaso', 400, 1250, 10, 'vivai', false, null, 4, 'Epipremnum aureum', 'interno', 'ombra', 'poca', true),
    ('Sansevieria',            'Piante da interno', 'vaso', 600, 1800, 10, 'vivai', false, null, 3, 'Dracaena trifasciata', 'interno', 'ombra', 'poca', true),
    ('Spathiphyllum',          'Piante da interno', 'vaso', 500, 1500, 10, 'vivai', false, null, 3, 'Spathiphyllum wallisii', 'interno', 'mezzombra', 'molta', true),
    ('Ortensia',               'Piante da esterno', 'vaso', 650, 1800, 10, 'vivai', false, null, 4, 'Hydrangea macrophylla', 'esterno', 'mezzombra', 'molta', true),
    ('Lavanda',                'Piante da esterno', 'vaso', 220, 650, 10, 'vivai', false, null, 6, 'Lavandula angustifolia', 'esterno', 'sole', 'poca', true),
    ('Gelsomino',              'Piante da esterno', 'vaso', 450, 1300, 10, 'vivai', false, null, 3, 'Trachelospermum jasminoides', 'esterno', 'sole', 'media', true),
    ('Olivo in vaso',          'Piante da esterno', 'vaso', 2500, 6900, 10, 'vivai', false, null, 1, 'Olea europaea', 'esterno', 'sole', 'poca', true),
    ('Succulenta mix',         'Piante grasse e succulente', 'vaso', 120, 450, 10, 'vivai', false, null, 10, null, 'interno', 'sole', 'poca', true),
    ('Cactus',                 'Piante grasse e succulente', 'vaso', 200, 600, 10, 'vivai', false, null, 6, null, 'entrambi', 'sole', 'poca', true),
    ('Basilico',               'Piante aromatiche e orto', 'vaso', 80, 250, 10, 'vivai', true, 10, 10, 'Ocimum basilicum', 'esterno', 'sole', 'molta', true),
    ('Rosmarino',              'Piante aromatiche e orto', 'vaso', 150, 450, 10, 'vivai', false, null, 6, 'Salvia rosmarinus', 'esterno', 'sole', 'poca', true),
    ('Vaso ceramica 14 cm',    'Vasi e cachepot', 'pz', 350, 1200, 22, 'vasi', false, null, 6, null, null, null, null, true),
    ('Cachepot zinco',         'Vasi e cachepot', 'pz', 500, 1600, 22, 'vasi', false, null, 4, null, null, null, null, true),
    ('Vaso terracotta 20 cm',  'Vasi e cachepot', 'pz', 280, 900, 22, 'vasi', false, null, 8, null, null, null, null, true),
    ('Terriccio universale 20 l', 'Terricci e concimi', 'conf', 320, 890, 22, 'vasi', false, null, 6, null, null, null, null, true),
    ('Concime liquido',        'Terricci e concimi', 'conf', 250, 750, 22, 'vasi', false, null, 5, null, null, null, null, true),
    ('Carta kraft',            'Nastri, carta e imballi', 'm', 15, 50, 22, 'vasi', false, null, 30, null, null, null, null, true),
    ('Nastro raso',            'Nastri, carta e imballi', 'm', 8, 30, 22, 'vasi', false, null, 30, null, null, null, null, true),
    ('Candela profumata',      'Decorazioni e oggettistica', 'pz', 400, 1400, 22, 'vasi', false, null, 4, null, null, null, null, true),
    ('Consegna a domicilio',   'Servizi (consegna, confezione)', 'pz', 0, 800, 22, 'vasi', false, null, null, null, null, null, null, false),
    ('Confezione regalo',      'Servizi (consegna, confezione)', 'pz', 0, 300, 22, 'vasi', false, null, null, null, null, null, null, false)
  ) as x(nome, cat, u, c, pv, iva, f, dep, gv, sc, bot, pos, luce, acqua, mag);
  update public.prodotti set fornitore_id = null where a_magazzino = false;

  -- composizioni
  insert into public.ricette (nome, categoria_id, prezzo_vendita_cent, aliquota_iva, manodopera_cent, minuti, note) values
    ('Bouquet 12 rose rosse', (cat_prod ->> 'Composizioni (ricette)')::bigint, 4500, 10, 500, 15, 'Il classico di San Valentino: rose a spirale, eucalipto, carta kraft e nastro.'),
    ('Mazzo di tulipani',     (cat_prod ->> 'Composizioni (ricette)')::bigint, 2500, 10, 300, 10, 'Primavera: 10 tulipani misti con ruscus.'),
    ('Bouquet di campo',      (cat_prod ->> 'Composizioni (ricette)')::bigint, 3500, 10, 400, 15, 'Girasoli, gerbere e ranuncoli: colori allegri.'),
    ('Centrotavola elegante', (cat_prod ->> 'Composizioni (ricette)')::bigint, 4000, 10, 600, 25, 'Rose bianche e ranuncoli con candela.'),
    ('Cuscino funebre',       (cat_prod ->> 'Composizioni (ricette)')::bigint, 12000, 10, 2000, 60, 'Crisantemi e lilium su base, nastro con scritta a parte.');
  insert into public.ricetta_righe (ricetta_id, prodotto_id, quantita)
  select rc.id, pr.id, x.q from (values
      ('Bouquet 12 rose rosse', 'Rosa rossa «Freedom»', 12), ('Bouquet 12 rose rosse', 'Eucalipto', 3), ('Bouquet 12 rose rosse', 'Carta kraft', 1), ('Bouquet 12 rose rosse', 'Nastro raso', 1),
      ('Mazzo di tulipani', 'Tulipano misto', 10), ('Mazzo di tulipani', 'Ruscus', 2), ('Mazzo di tulipani', 'Carta kraft', 1), ('Mazzo di tulipani', 'Nastro raso', 1),
      ('Bouquet di campo', 'Girasole', 3), ('Bouquet di campo', 'Gerbera', 4), ('Bouquet di campo', 'Ranuncolo', 3), ('Bouquet di campo', 'Eucalipto', 3), ('Bouquet di campo', 'Carta kraft', 1),
      ('Centrotavola elegante', 'Rosa bianca «Avalanche»', 5), ('Centrotavola elegante', 'Ranuncolo', 3), ('Centrotavola elegante', 'Eucalipto', 2), ('Centrotavola elegante', 'Candela profumata', 1),
      ('Cuscino funebre', 'Crisantemo', 25), ('Cuscino funebre', 'Lilium bianco', 6), ('Cuscino funebre', 'Ruscus', 10), ('Cuscino funebre', 'Nastro raso', 2)
    ) as x(rn, pn, q) join public.ricette rc on rc.nome = x.rn join public.prodotti pr on pr.nome = x.pn;

  -- clienti e ricorrenze (alcune nei prossimi giorni, così il cruscotto le ricorda)
  insert into public.clienti (nome, tipo, telefono, email, indirizzo, note) values
    ('Maria Rossi', 'privato', '333 1234567', 'maria.rossi@example.com', 'Via Roma 12, Saronno', 'Ama le peonie. Allergica ai gigli.'),
    ('Luca Bianchi', 'privato', '347 7654321', null, 'Via Varese 3, Caronno', null),
    ('Hotel Villa Fiorita', 'azienda', '02 9600111', 'reception@villafiorita.example', 'Viale Europa 50, Saronno', 'Fiori freschi in reception ogni lunedì.'),
    ('Parrocchia San Pietro', 'ente', '02 9601222', null, 'Piazza Libertà 1, Saronno', 'Addobbi per le feste e i matrimoni in chiesa.'),
    ('Giulia Verdi', 'privato', '320 5558899', 'giulia.verdi@example.com', null, null),
    ('Studio Dentistico Ferri', 'azienda', '02 9602333', null, 'Corso Italia 8, Saronno', 'Pianta in sala d''attesa: controllo mensile.');
  select array_agg(id order by id) into cli from public.clienti where creato_il = t0;
  insert into public.ricorrenze (cliente_id, descrizione, giorno, mese, preavviso) values
    (cli[1], 'Anniversario di matrimonio', extract(day from oggi + 4)::int, extract(month from oggi + 4)::int, 7),
    (cli[2], 'Compleanno della moglie', extract(day from oggi + 9)::int, extract(month from oggi + 9)::int, 10),
    (cli[5], 'Compleanno della mamma', 12, 3, 7);

  -- spese ricorrenti (le spese degli ultimi 12 mesi si generano sotto)
  insert into public.ricorrenti (descrizione, categoria_id, fornitore_id, importo_cent, iva_cent, ogni_mesi, prossima, metodo, nota) values
    ('Affitto negozio', (cat_spesa ->> 'Affitto')::bigint, f_immob, 120000, 0, 1, (date_trunc('month', oggi) + interval '1 month')::date + 4, 'bonifico', 'Entro il 5 del mese'),
    ('Luce', (cat_spesa ->> 'Luce')::bigint, f_enel, 18000, 1636, 2, oggi + 6, 'rid', null),
    ('TARI (rifiuti)', (cat_spesa ->> 'TARI (rifiuti)')::bigint, f_comune, 21000, 0, 3, oggi + 25, 'f24', '4 rate all''anno'),
    ('Telefono e internet', (cat_spesa ->> 'Telefono e internet')::bigint, null, 3500, 631, 1, oggi + 12, 'rid', null),
    ('Commercialista', (cat_spesa ->> 'Commercialista')::bigint, f_comm, 30500, 5500, 3, oggi + 40, 'bonifico', null),
    ('Assicurazione negozio', (cat_spesa ->> 'Assicurazioni')::bigint, null, 48000, 0, 12, oggi + 120, 'bonifico', null),
    ('Canone POS', (cat_spesa ->> 'Canoni e abbonamenti (POS, software, cassa)')::bigint, null, 1800, 325, 1, oggi + 3, 'rid', null);
  for r in select * from public.ricorrenti where creato_il = t0 loop
    d := r.prossima - make_interval(months => r.ogni_mesi);
    while d > oggi - 365 loop
      insert into public.spese (data, categoria_id, fornitore_id, descrizione, importo_cent, iva_cent, metodo, pagata, ricorrente_id)
      values (d, r.categoria_id, r.fornitore_id, r.descrizione || ' ' || to_char(d, 'MM/YYYY'),
              round(r.importo_cent * case when r.descrizione = 'Luce' then 0.8 + random() * 0.5 else 1 end), r.iva_cent, r.metodo, true, r.id);
      d := d - make_interval(months => r.ogni_mesi);
    end loop;
  end loop;
  -- altre spese varie
  for i in 1..24 loop
    d := oggi - (random() * 360)::int;
    insert into public.spese (data, categoria_id, descrizione, importo_cent, iva_cent, metodo, pagata)
    select d, (cat_spesa ->> x.cat)::bigint, x.descr, x.imp, round(x.imp - x.imp / 1.22), x.pag, true
    from (values ('Trasporti e carburante', 'Gasolio furgone', (4000 + random() * 3000)::int, 'carta'),
                 ('Imballaggi e materiali di consumo', 'Spugna floreale e filo', (2500 + random() * 2500)::int, 'carta'),
                 ('Pubblicità e social', 'Sponsorizzata Instagram', 3000, 'carta')) as x(cat, descr, imp, pag)
    offset (i % 3) limit 1;
  end loop;
  insert into public.spese (data, categoria_id, descrizione, importo_cent, iva_cent, metodo, pagata, scadenza) values
    (oggi - 4, (cat_spesa ->> 'Manutenzione e riparazioni')::bigint, 'Riparazione cella frigo', 38000, 6852, 'bonifico', false, oggi + 10),
    (oggi - 2, (cat_spesa ->> 'Tasse e imposte (IVA, IRPEF, F24)')::bigint, 'F24 acconto IVA', 95000, 0, 'f24', false, oggi + 14);

  -- arrivi di merce: fiori ogni martedì e venerdì, piante e vasi una volta al mese
  select array_agg(id) into prod from public.prodotti where fornitore_id = f_fiori and creato_il = t0;
  d := oggi - 364;
  while d <= oggi loop
    if extract(isodow from d) in (2, 5) then
      molt := case when to_char(d, 'MM-DD') between '02-08' and '02-13' then 3.5 when to_char(d, 'MM-DD') between '10-25' and '10-31' then 3.5
                   when to_char(d, 'MM') = '12' then 1.6 when to_char(d, 'MM') in ('04', '05') then 1.4 when to_char(d, 'MM') in ('07', '08') then 0.6 else 1 end;
      righe := (select jsonb_agg(jsonb_build_object('prodotto_id', p.id, 'quantita',
                  ceil(case when p.nome like 'Crisantemo%' and molt < 3 then 10 when p.unita = 'mazzo' then 3 else 18 end
                       * case when p.nome like 'Rosa rossa%' and to_char(d, 'MM-DD') between '02-08' and '02-13' then 4 * molt
                              when p.nome like 'Crisantemo%' and to_char(d, 'MM-DD') between '10-25' and '10-31' then 6 * molt
                              when p.nome like 'Mimosa%' and to_char(d, 'MM-DD') not between '02-25' and '03-08' then 0 else molt end * (0.8 + random() * 0.4)),
                  'costo_unit_cent', round(p.prezzo_acquisto_cent * (0.95 + random() * 0.1))))
                from public.prodotti p where p.id = any(prod) and not (p.nome like 'Peonia%' and to_char(d, 'MM') not in ('04', '05', '06')));
      righe := (select jsonb_agg(e) from jsonb_array_elements(righe) e where (e ->> 'quantita')::numeric > 0);
      perform public.registra_carico(jsonb_build_object('fornitore_id', f_fiori, 'numero_documento', 'DDT ' || to_char(d, 'YYMMDD'), 'data_documento', d, 'data', d, 'righe', righe));
    end if;
    if extract(day from d) = 3 then
      perform public.registra_carico(jsonb_build_object('fornitore_id', f_vivai, 'numero_documento', 'VL-' || to_char(d, 'YYMM'), 'data_documento', d - 1, 'data', d,
        'righe', (select jsonb_agg(jsonb_build_object('prodotto_id', id, 'quantita', greatest(1, round(coalesce(scorta_minima, 2) * (1.5 + random()))), 'costo_unit_cent', prezzo_acquisto_cent))
                  from public.prodotti where fornitore_id = f_vivai and creato_il = t0),
        'spesa', jsonb_build_object('categoria_id', cat_spesa ->> 'Acquisto merce', 'metodo', 'bonifico', 'pagata', true)));
      perform public.registra_carico(jsonb_build_object('fornitore_id', f_vasi, 'numero_documento', 'CV-' || to_char(d, 'YYMM'), 'data_documento', d - 2, 'data', d,
        'righe', (select jsonb_agg(jsonb_build_object('prodotto_id', id, 'quantita', case when unita = 'm' then 80 else greatest(2, round(coalesce(scorta_minima, 2) * 2)) end, 'costo_unit_cent', prezzo_acquisto_cent))
                  from public.prodotti where fornitore_id = f_vasi and creato_il = t0 and a_magazzino),
        'spesa', jsonb_build_object('categoria_id', cat_spesa ->> 'Acquisto merce', 'metodo', 'bonifico', 'pagata', true)));
    end if;
    d := d + 1;
  end loop;
  -- fatture riepilogative di Flora Mercato a fine mese (il mese in corso resta da fatturare: si vede «bolle da collegare»)
  for r in select date_trunc('month', data_arrivo)::date m, array_agg(id) ids from public.bolle
            where fornitore_id = f_fiori and creato_il = t0 and data_arrivo < date_trunc('month', oggi) group by 1 loop
    perform public.fattura_bolle(r.ids, jsonb_build_object('data', (r.m + interval '1 month - 1 day')::date, 'numero_documento', 'FT ' || to_char(r.m, 'MM/YYYY'),
      'metodo', 'bonifico', 'pagata', true));
  end loop;

  -- vendite al banco: ogni giorno tranne la domenica, più gente nelle feste
  select array_agg(id order by id), array_agg(case when categoria_id = (cat_prod ->> 'Fiori recisi')::bigint then 3 when a_magazzino = false then 0.6 else 1 end order by id)
    into prod, pesi from public.prodotti where creato_il = t0;
  select array_agg(id order by id) into ric from public.ricette where creato_il = t0;
  d := oggi - 364;
  while d <= oggi loop
    if extract(isodow from d) <> 7 then
      molt := case when to_char(d, 'MM-DD') between '02-12' and '02-14' then 4 when to_char(d, 'MM-DD') between '10-28' and '11-02' then 4.5
                   when to_char(d, 'MM-DD') = '03-08' then 3 when to_char(d, 'MM') = '12' and extract(day from d) between 15 and 24 then 2.2
                   when to_char(d, 'MM') = '05' and extract(isodow from d) = 6 then 1.8 when to_char(d, 'MM') in ('07', '08') then 0.6
                   when extract(isodow from d) = 6 then 1.5 else 1 end;
      n := greatest(1, round((4 + random() * 6) * molt));
      for i in 1..n loop
        righe := '[]'::jsonb;
        if random() < 0.35 then
          k := 1 + floor(random() * array_length(ric, 1))::int;
          if to_char(d, 'MM-DD') between '02-12' and '02-14' then k := 1; elsif to_char(d, 'MM-DD') between '10-28' and '11-02' and random() < 0.6 then k := 5; end if;
          righe := righe || jsonb_build_object('ricetta_id', ric[k], 'quantita', 1, 'prezzo_unit_cent', (select prezzo_vendita_cent from public.ricette where id = ric[k]));
        end if;
        for k in 1..(case when random() < 0.6 then 1 else 2 end) loop
          -- estrazione pesata: ogni articolo esce in proporzione al suo peso (fiori recisi 3, servizi 0,6, il resto 1)
          select x.id into c_id from unnest(prod, pesi) as x(id, w) order by -ln(1 - random()) / x.w limit 1;
          righe := righe || (select jsonb_build_object('prodotto_id', id, 'quantita', case when unita in ('stelo') then 1 + floor(random() * 9) when unita = 'm' then 2 else 1 end,
                                                       'prezzo_unit_cent', prezzo_vendita_cent) from public.prodotti where id = c_id);
        end loop;
        met := case when random() < 0.55 then 'carta' when random() < 0.9 then 'contanti' else 'satispay' end;
        perform public.registra_vendita(jsonb_build_object('data', d, 'metodo', met,
          'categoria_id', case when jsonb_path_exists(righe, '$[*].ricetta_id') then cat_ent ->> 'Composizioni e bouquet' else cat_ent ->> 'Vendita al banco' end,
          'documento', case when random() < 0.04 then 'fattura' else 'scontrino' end,
          'cliente_id', case when random() < 0.08 then cli[1 + floor(random() * 6)::int] end,
          'righe', righe));
      end loop;
      -- scarti del sabato: fiori che non hanno retto
      if extract(isodow from d) = 6 then
        insert into public.movimenti (prodotto_id, tipo, quantita, data, motivo)
        select id, 'scarto', -(1 + floor(random() * 5)), d, 'Appassiti' from public.prodotti where id = any(prod) and deperibile and random() < 0.4;
      end if;
    end if;
    d := d + 1;
  end loop;

  -- ordini e preventivi
  insert into public.ordini (cliente_id, categoria_id, descrizione, data_consegna, ora_consegna, consegna, indirizzo, destinatario, telefono_dest, biglietto, stato)
  values (cli[3], (cat_ent ->> 'Aziende e abbonamenti')::bigint, 'Composizione per la reception (settimanale)', oggi + 1, '08:30', 'domicilio', 'Viale Europa 50, Saronno', 'Reception', '02 9600111', null, 'da_fare')
  returning id into o;
  insert into public.ordine_righe (ordine_id, descrizione, quantita, prezzo_unit_cent) values (o, 'Composizione alta di stagione', 1, 6000), (o, 'Consegna', 1, 800);
  insert into public.ordini (cliente_id, categoria_id, descrizione, data_consegna, ora_consegna, consegna, indirizzo, destinatario, telefono_dest, biglietto, stato)
  values (cli[1], (cat_ent ->> 'Consegne a domicilio')::bigint, 'Bouquet di peonie per l''anniversario', oggi + 4, '18:00', 'domicilio', 'Via Roma 12, Saronno', 'Maria Rossi', '333 1234567',
          'Vent''anni e ancora ti scelgo ogni giorno. Tuo Marco', 'in_lavorazione') returning id into o;
  insert into public.ordine_righe (ordine_id, descrizione, quantita, prezzo_unit_cent) values (o, 'Bouquet di peonie rosa', 1, 6500), (o, 'Consegna a domicilio', 1, 800);
  perform public.registra_vendita(jsonb_build_object('data', oggi - 3, 'ordine_id', o, 'cliente_id', cli[1], 'categoria_id', cat_ent ->> 'Consegne a domicilio', 'metodo', 'carta',
    'descrizione', 'Ordine - acconto', 'importo_cent', 2000));
  insert into public.ordini (cliente_id, categoria_id, descrizione, data_consegna, consegna, stato)
  values (cli[5], (cat_ent ->> 'Composizioni e bouquet')::bigint, 'Mazzo di tulipani da ritirare', oggi, 'ritiro', 'pronto') returning id into o;
  insert into public.ordine_righe (ordine_id, descrizione, quantita, prezzo_unit_cent) values (o, 'Mazzo di tulipani', 1, 2500);
  insert into public.ordini (cliente_id, categoria_id, descrizione, data_consegna, ora_consegna, consegna, indirizzo, stato, valido_fino, condizioni)
  values (cli[4], (cat_ent ->> 'Matrimoni ed eventi')::bigint, 'Matrimonio Colombo-Galli: chiesa e ricevimento', oggi + 75, '15:00', 'evento', 'Chiesa di San Pietro e Villa Rosa',
          'preventivo', oggi + 20, (select condizioni_preventivo from public.impostazioni where id = 1)) returning id into o;
  insert into public.ordine_righe (ordine_id, descrizione, quantita, prezzo_unit_cent, ordine) values
    (o, 'Bouquet sposa (peonie e rose bianche)', 1, 18000, 0), (o, 'Bouttonniere sposo e testimoni', 3, 1500, 1), (o, 'Addobbo panche chiesa', 12, 2500, 2),
    (o, 'Composizioni altare', 2, 15000, 3), (o, 'Centrotavola ricevimento', 15, 4500, 4), (o, 'Allestimento e ritiro', 1, 25000, 5);
  insert into public.ordini (cliente_id, categoria_id, descrizione, data_consegna, consegna, stato, creato_da_preventivo)
  values (cli[3], (cat_ent ->> 'Matrimoni ed eventi')::bigint, 'Cena aziendale di fine anno: 20 centrotavola', oggi - 40, 'evento', 'consegnato', true) returning id into o;
  insert into public.ordine_righe (ordine_id, descrizione, quantita, prezzo_unit_cent) values (o, 'Centrotavola elegante', 20, 4000), (o, 'Allestimento', 1, 15000);
  perform public.registra_vendita(jsonb_build_object('data', oggi - 55, 'ordine_id', o, 'cliente_id', cli[3], 'categoria_id', cat_ent ->> 'Matrimoni ed eventi', 'metodo', 'bonifico',
    'documento', 'fattura', 'descrizione', 'Ordine - acconto', 'importo_cent', 30000));
  perform public.registra_vendita(jsonb_build_object('data', oggi - 38, 'ordine_id', o, 'cliente_id', cli[3], 'categoria_id', cat_ent ->> 'Matrimoni ed eventi', 'metodo', 'bonifico',
    'documento', 'fattura', 'descrizione', 'Ordine - saldo', 'importo_cent', 65000));

  -- chiusure di cassa delle ultime due settimane
  for i in 1..14 loop
    d := oggi - i;
    continue when extract(isodow from d) = 7;
    insert into public.chiusure (data, fondo_cent, versati_cent, contati_cent)
    values (d, 15000, 0, 0);
    update public.chiusure set contati_cent = attesi_cent + case when random() < 0.75 then 0 else (round((random() - 0.5) * 6) * 50)::int end where data = d;
  end loop;

  -- inventario finale: giacenze realistiche (alcune sotto scorta per la lista di riordino) e peonie da controllare
  for r in select id, nome, coalesce(scorta_minima, 2) sc, deperibile, giorni_vita, ultimo_carico from public.prodotti where creato_il = t0 and a_magazzino loop
    perform public.imposta_giacenza(r.id, (case
      when r.deperibile and r.ultimo_carico < oggi - coalesce(r.giorni_vita, 7) and r.nome not like 'Peonia%' then 0 -- fuori stagione: finiti
      when random() < 0.2 then floor(r.sc * random()) else ceil(r.sc * (1.3 + random() * 2)) end)::numeric, 'Inventario di esempio'::text);
  end loop;
  update public.prodotti set ultimo_carico = oggi - 9 where creato_il = t0 and nome = 'Peonia';

  insert into public.dati_esempio (id, caricati_il) values (1, t0) on conflict (id) do update set caricati_il = excluded.caricati_il;
  return jsonb_build_object('articoli', (select count(*) from public.prodotti where creato_il = t0),
                            'incassi', (select count(*) from public.entrate where creato_il = t0),
                            'bolle', (select count(*) from public.bolle where creato_il = t0),
                            'spese', (select count(*) from public.spese where creato_il = t0));
end;
$$;

-- Toglie tutto ciò che è stato creato da carica_dati_esempio() (stesso istante di creazione). Le categorie e le feste restano.
create function public.cancella_dati_esempio() returns jsonb
  language plpgsql security definer set search_path to 'public' as
$$
declare t0 timestamptz := (select caricati_il from public.dati_esempio where id = 1); n int;
begin
  if not public.is_owner() then raise exception 'Accesso negato' using errcode = '42501'; end if;
  if t0 is null then raise exception 'Non ci sono dati di esempio da cancellare' using errcode = '22023'; end if;
  select count(*) into n from public.entrate where creato_il = t0;
  delete from public.movimenti where creato_il = t0;
  delete from public.entrate where creato_il = t0;
  delete from public.bolle where creato_il = t0;
  delete from public.ordini where creato_il = t0;
  delete from public.chiusure where creato_il = t0;
  delete from public.spese where creato_il = t0;
  delete from public.ricorrenti where creato_il = t0;
  delete from public.ricette where creato_il = t0;
  -- un articolo di esempio usato nel frattempo per qualcosa di vero resta (con la sua storia vera)
  delete from public.prodotti p where p.creato_il = t0 and not exists (select 1 from public.movimenti m where m.prodotto_id = p.id);
  delete from public.clienti c where c.creato_il = t0 and not exists (select 1 from public.ordini o where o.cliente_id = c.id);
  delete from public.fornitori f where f.creato_il = t0 and not exists (select 1 from public.prodotti p where p.fornitore_id = f.id);
  delete from public.dati_esempio where id = 1;
  return jsonb_build_object('incassi', n);
end;
$$;

revoke execute on function public.carica_dati_esempio(), public.cancella_dati_esempio() from public, anon;
grant execute on function public.carica_dati_esempio(), public.cancella_dati_esempio() to authenticated;
notify pgrst, 'reload schema';
