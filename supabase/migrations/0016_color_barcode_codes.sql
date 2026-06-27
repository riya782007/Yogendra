-- Pillar 7 / Pillar 11 — Canonical colour catalog with scanner-friendly barcode codes.
--
-- Adds `barcode_code` to variant_options so every standardised colour has a short suffix
-- (RED, MULTI1, SBLUE, RGOLD…) that prints on the barcode label and forms the variant
-- SKU. Full printed barcode for a variant becomes `{productSku}-{barcode_code}` —
-- e.g. BD2024-RED for a red variant of product BD2024.
--
-- The seed below is the 75-colour master Yogendra runs the storefront on. Re-running is
-- safe — the `on conflict (kind, value)` clause refreshes `barcode_code` and `sort` only,
-- so any custom hex swatch the owner has set on a row is preserved.
--
-- Variants created BEFORE this migration keep their existing SKUs; the cascade is on
-- new auto-generated variant SKUs only (see app/actions/variants.ts addVariantAction).

alter table public.variant_options add column if not exists barcode_code text;

-- Faster lookups when the app resolves "what code does Red have?" during variant creation.
create index if not exists idx_variant_options_color_code on public.variant_options(kind, barcode_code) where kind = 'color';

-- Seed (or refresh) the 75-colour master.
insert into public.variant_options (kind, value, barcode_code, sort) values
  ('color', 'Red',             'RED',     1),
  ('color', 'Green',           'GREEN',   2),
  ('color', 'Yellow',          'YELLOW',  3),
  ('color', 'Black',           'BLACK',   4),
  ('color', 'White',           'WHITE',   5),
  ('color', 'Wine',            'WINE',    6),
  ('color', 'Purple',          'PURPLE',  7),
  ('color', 'Mint',            'MINT',    8),
  ('color', 'Peach',           'PEACH',   9),
  ('color', 'Multicolor 1',    'MULTI1', 10),
  ('color', 'Multicolor 2',    'MULTI2', 11),
  ('color', 'Sky Blue',        'SBLUE',  12),
  ('color', 'Royal Blue',      'RBLUE',  13),
  ('color', 'Navy Blue',       'NBLUE',  14),
  ('color', 'Maroon',          'MAROON', 15),
  ('color', 'Peacock Green',   'PGREEN', 16),
  ('color', 'Silver',          'SILVER', 17),
  ('color', 'Golden',          'GOLD',   18),
  ('color', 'Lavender',        'LAV',    19),
  ('color', 'Blush Pink',      'PINK',   20),
  ('color', 'Magenta',         'RANI',   21),
  ('color', 'Orange',          'ORANGE', 22),
  ('color', 'Ruby',            'RUBY',   23),
  ('color', 'Mehndi',          'MEH',    24),
  ('color', 'Pink Mint',       'PMINT',  25),
  ('color', 'Grey',            'GREY',   26),
  ('color', 'Gajri',           'GAJRI',  27),
  ('color', 'Peacock Blue',    'PBLUE',  28),
  ('color', 'Baby Pink',       'BPINK',  29),  -- distinct from Blush Pink (was duplicated as PINK in the source list)
  ('color', 'Maroon Green',    'MGREEN', 30),
  ('color', 'White Maroon',    'WMAROON',31),
  ('color', 'White Green',     'WGREEN', 32),
  ('color', 'White Magenta',   'WRANI',  33),
  ('color', 'White Red',       'WRED',   34),
  ('color', 'White Pink Mint', 'WPMINT', 35),
  ('color', 'White Multi',     'WMULTI', 36),
  ('color', 'Rose Gold',       'RGOLD',  37),
  ('color', 'Teal Green',      'TGREEN', 38),
  ('color', 'Green Red',       'GRED',   39),
  ('color', 'Ruby Green',      'RGREEN', 40),
  ('color', 'Brown',           'BROWN',  41),
  ('color', 'All',             'ALL',    42),
  ('color', 'Lemon',           'LEMON',  43),
  ('color', 'Mustard',         'MUSTARD',44),
  ('color', 'Off White',       'OWHITE', 45),
  ('color', 'Matte Gold',      'MGOLD',  46),
  ('color', 'Rainbow',         'RAIN',   47),
  ('color', 'Pearl',           'PEARL',  48),
  ('color', 'Matte Silver',    'MSLVER', 49),
  ('color', 'Multicolor 3',    'MULTI3', 50),
  ('color', 'Multicolor 4',    'MULTI4', 51),
  ('color', 'Multicolor 5',    'MULTI5', 52),
  ('color', 'Golden 2',        'GOLD2',  53),
  ('color', 'Silver 2',        'SILVER2',54),
  ('color', 'Ocean Blue',      'OBLUE',  55),
  ('color', 'Move',            'MOVE',   56),
  ('color', 'Peach 2',         'PEACH2', 57),
  ('color', 'Peach 3',         'PEACH3', 58),
  ('color', 'Gajri 2',         'GAJRI2', 59),
  ('color', 'Gajri 3',         'GAJRI3', 60),
  ('color', 'Golden 3',        'GOLD3',  61),
  ('color', 'Golden 4',        'GOLD4',  62),
  ('color', 'Silver 3',        'SILVER3',63),
  ('color', 'Silver 4',        'SILVER4',64),
  ('color', 'Mint 2',          'MINT2',  65),
  ('color', 'Dual Tone',       'DTONE',  66),
  ('color', 'Red 2',           'RED2',   67),
  ('color', 'Lavender 2',      'LAV2',   68),
  ('color', 'Golden 5',        'GOLD5',  69),
  ('color', 'Light Golden',    'LGOLD',  70),
  ('color', 'Feroji',          'FEROJI', 71),
  ('color', 'Black and White', 'BWHITE', 72),
  ('color', 'Rumi Mint',       'RMINT',  73),
  ('color', 'Ruby 2',          'RUBY2',  74),
  ('color', 'Green Mint',      'GMINT',  75)
on conflict (kind, value) do update set
  barcode_code = excluded.barcode_code,
  sort         = excluded.sort;
