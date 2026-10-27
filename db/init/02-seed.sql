-- Categorie di partenza: si cambiano, si aggiungono o si spengono dal gestionale (Anagrafiche > Categorie).
-- Nessun articolo, spesa o cliente: il database del cliente parte vuoto.

-- Articoli del magazzino (IVA proposta: piante e fiori 10%, vasi/accessori/concimi 22%)
insert into public.categorie (ambito, nome, colore, aliquota, ordine) values
  ('prodotto', 'Fiori recisi',              '#d9737f', 10, 1),
  ('prodotto', 'Piante da interno',         '#4f7d5c', 10, 2),
  ('prodotto', 'Piante da esterno',         '#7fa05a', 10, 3),
  ('prodotto', 'Piante grasse e succulente','#a3b86c', 10, 4),
  ('prodotto', 'Orchidee',                  '#b07cc6', 10, 5),
  ('prodotto', 'Piante aromatiche e orto',  '#5f9e8f', 10, 6),
  ('prodotto', 'Bulbi e sementi',           '#c49a4a', 10, 7),
  ('prodotto', 'Verde ornamentale',         '#3f6b4a', 10, 8),
  ('prodotto', 'Vasi e cachepot',           '#a0785a', 22, 9),
  ('prodotto', 'Terricci e concimi',        '#7a5c43', 22, 10),
  ('prodotto', 'Nastri, carta e imballi',   '#e0a96d', 22, 11),
  ('prodotto', 'Decorazioni e oggettistica','#8c8c9e', 22, 12),
  ('prodotto', 'Servizi (consegna, confezione)', '#6c8ebf', 22, 13),
  ('prodotto', 'Composizioni (ricette)',    '#e07a9a', 10, 14);

-- Spese: fisse (ogni mese/anno più o meno uguali) e variabili
insert into public.categorie (ambito, nome, tipo, colore, ordine) values
  ('spesa', 'Affitto',                         'fissa',     '#8e5b4a', 1),
  ('spesa', 'TARI (rifiuti)',                  'fissa',     '#7a8a5a', 2),
  ('spesa', 'IMU e altre imposte locali',      'fissa',     '#6d6d4f', 3),
  ('spesa', 'Luce',                            'fissa',     '#e0b84a', 4),
  ('spesa', 'Gas e riscaldamento',             'fissa',     '#d08a3c', 5),
  ('spesa', 'Acqua',                           'fissa',     '#5a9ac6', 6),
  ('spesa', 'Telefono e internet',             'fissa',     '#6c7fbf', 7),
  ('spesa', 'Stipendi',                        'fissa',     '#4a6b8e', 8),
  ('spesa', 'Contributi INPS e INAIL',         'fissa',     '#5b5b8e', 9),
  ('spesa', 'Commercialista',                  'fissa',     '#7c5c9e', 10),
  ('spesa', 'Assicurazioni',                   'fissa',     '#5c8e7c', 11),
  ('spesa', 'Leasing e finanziamenti',         'fissa',     '#8e7c5c', 12),
  ('spesa', 'Canoni e abbonamenti (POS, software, cassa)', 'fissa', '#9e8a6c', 13),
  ('spesa', 'Acquisto merce',                  'variabile', '#4f7d5c', 20),
  ('spesa', 'Trasporti e carburante',          'variabile', '#a06c4a', 21),
  ('spesa', 'Manutenzione e riparazioni',      'variabile', '#7a7a7a', 22),
  ('spesa', 'Attrezzatura',                    'variabile', '#5a6b7a', 23),
  ('spesa', 'Imballaggi e materiali di consumo','variabile','#c49a6c', 24),
  ('spesa', 'Pubblicità e social',             'variabile', '#d9737f', 25),
  ('spesa', 'Commissioni bancarie e POS',      'variabile', '#6c6c9e', 26),
  ('spesa', 'Tasse e imposte (IVA, IRPEF, F24)','variabile','#9e4a4a', 27),
  ('spesa', 'Fiere, mercati e formazione',     'variabile', '#4a9e8a', 28),
  ('spesa', 'Altre spese',                     'variabile', '#999999', 99);

-- Incassi
insert into public.categorie (ambito, nome, colore, ordine) values
  ('entrata', 'Vendita al banco',          '#4f7d5c', 1),
  ('entrata', 'Composizioni e bouquet',    '#d9737f', 2),
  ('entrata', 'Matrimoni ed eventi',       '#b07cc6', 3),
  ('entrata', 'Funerali e cerimonie',      '#6c7a8e', 4),
  ('entrata', 'Consegne a domicilio',      '#6c8ebf', 5),
  ('entrata', 'Aziende e abbonamenti',     '#c49a4a', 6),
  ('entrata', 'Manutenzione del verde',    '#7fa05a', 7),
  ('entrata', 'Altri incassi',             '#999999', 99);

-- Feste che contano per il fiorista (preavviso = quanti giorni prima il cruscotto inizia ad avvisare)
insert into public.calendario (nome, regola, giorno, mese, scarto, preavviso, nota) values
  ('San Valentino',            'fissa',       14, 2,  0, 30, 'Rose rosse: ordinare con largo anticipo, i prezzi salgono'),
  ('Festa della donna',        'fissa',        8, 3,  0, 21, 'Mimosa'),
  ('Festa del papà',           'fissa',       19, 3,  0, 14, null),
  ('Pasqua',                   'pasqua',    null, null, 0, 21, 'Piante fiorite, ulivo per la domenica delle Palme'),
  ('Domenica delle Palme',     'pasqua',    null, null, -7, 14, 'Rametti di ulivo'),
  ('Festa della mamma',        'festa_mamma', null, null, 0, 21, 'Seconda domenica di maggio: ortensie, rose, orchidee'),
  ('Festa dei nonni',          'fissa',        2, 10, 0, 14, null),
  ('Ognissanti e Defunti',     'fissa',        1, 11, 0, 40, 'Crisantemi e composizioni per i cimiteri: il periodo più intenso'),
  ('Natale',                   'fissa',       25, 12, 0, 45, 'Stelle di Natale, abeti, centrotavola, agrifoglio'),
  ('Capodanno',                'fissa',       31, 12, 0, 14, null),
  ('Stagione dei matrimoni',   'fissa',        1, 5,  0, 45, 'Da maggio a settembre: confermare i preventivi');
