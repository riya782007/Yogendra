-- 0031_colours_master_fixed.sql
-- The colours master is FIXED: 75 approved colours, each with its scanner barcode code.
-- "Oxidised" is a POLISH/finish, not a colour. Idempotent — safe to re-run.

begin;

-- 0) Ensure the barcode_code column exists (some environments never applied the 0015 column add).
alter table public.variant_options add column if not exists barcode_code text;

-- 1) Oxidised (either spelling) must never be a colour; it is a polish.
delete from public.variant_options where kind = 'color' and lower(value) in ('oxidised','oxidized');
insert into public.variant_options (kind, value) values ('polish', 'Oxidised')
  on conflict (kind, value) do nothing;

-- 2) Drop the legacy mis-spelling so the canonical name below is the only one.
delete from public.variant_options where kind = 'color' and lower(value) = 'rumi mint';

-- 3) Lock the canonical colour list + barcode codes (insert missing, correct any drifted code).
insert into public.variant_options (kind, value, barcode_code) values
  ('color', 'Red', 'RED'),
  ('color', 'Green', 'GREEN'),
  ('color', 'Yellow', 'YELLOW'),
  ('color', 'Black', 'BLACK'),
  ('color', 'White', 'WHITE'),
  ('color', 'Wine', 'WINE'),
  ('color', 'Purple', 'PURPLE'),
  ('color', 'Mint', 'MINT'),
  ('color', 'Peach', 'PEACH'),
  ('color', 'Multicolor 1', 'MULTI1'),
  ('color', 'Multicolor 2', 'MULTI2'),
  ('color', 'Sky Blue', 'SBLUE'),
  ('color', 'Royal Blue', 'RBLUE'),
  ('color', 'Navy Blue', 'NBLUE'),
  ('color', 'Maroon', 'MAROON'),
  ('color', 'Peacock Green', 'PGREEN'),
  ('color', 'Silver', 'SILVER'),
  ('color', 'Golden', 'GOLD'),
  ('color', 'Lavender', 'LAV'),
  ('color', 'Blush Pink', 'PINK'),
  ('color', 'Magenta', 'RANI'),
  ('color', 'Orange', 'ORANGE'),
  ('color', 'Ruby', 'RUBY'),
  ('color', 'Mehndi', 'MEH'),
  ('color', 'Pink Mint', 'PMINT'),
  ('color', 'Grey', 'GREY'),
  ('color', 'Gajri', 'GAJRI'),
  ('color', 'Peacock Blue', 'PBLUE'),
  ('color', 'Baby Pink', 'BPINK'),
  ('color', 'Maroon Green', 'MGREEN'),
  ('color', 'White Maroon', 'WMAROON'),
  ('color', 'White Green', 'WGREEN'),
  ('color', 'White Magenta', 'WRANI'),
  ('color', 'White Red', 'WRED'),
  ('color', 'White Pink Mint', 'WPMINT'),
  ('color', 'White Multi', 'WMULTI'),
  ('color', 'Rose Gold', 'RGOLD'),
  ('color', 'Teal Green', 'TGREEN'),
  ('color', 'Green Red', 'GRED'),
  ('color', 'Ruby Green', 'RGREEN'),
  ('color', 'Brown', 'BROWN'),
  ('color', 'All', 'ALL'),
  ('color', 'Lemon', 'LEMON'),
  ('color', 'Mustard', 'MUSTARD'),
  ('color', 'Off White', 'OWHITE'),
  ('color', 'Matte Gold', 'MGOLD'),
  ('color', 'Rainbow', 'RAIN'),
  ('color', 'Pearl', 'PEARL'),
  ('color', 'Matte Silver', 'MSLVER'),
  ('color', 'Multicolor 3', 'MULTI3'),
  ('color', 'Multicolor 4', 'MULTI4'),
  ('color', 'Multicolor 5', 'MULTI5'),
  ('color', 'Golden 2', 'GOLD2'),
  ('color', 'Silver 2', 'SILVER2'),
  ('color', 'Ocean Blue', 'OBLUE'),
  ('color', 'Move', 'MOVE'),
  ('color', 'Peach 2', 'PEACH2'),
  ('color', 'Peach 3', 'PEACH3'),
  ('color', 'Gajri 2', 'GAJRI2'),
  ('color', 'Gajri 3', 'GAJRI3'),
  ('color', 'Golden 3', 'GOLD3'),
  ('color', 'Golden 4', 'GOLD4'),
  ('color', 'Silver 3', 'SILVER3'),
  ('color', 'Silver 4', 'SILVER4'),
  ('color', 'Mint 2', 'MINT2'),
  ('color', 'Dual Tone', 'DTONE'),
  ('color', 'Red 2', 'RED2'),
  ('color', 'Lavender 2', 'LAV2'),
  ('color', 'Golden 5', 'GOLD5'),
  ('color', 'Light Golden', 'LGOLD'),
  ('color', 'Feroji', 'FEROJI'),
  ('color', 'Black and White', 'BWHITE'),
  ('color', 'Ruby Mint', 'RMINT'),
  ('color', 'Ruby 2', 'RUBY2'),
  ('color', 'Green Mint', 'GMINT')
on conflict (kind, value) do update set barcode_code = excluded.barcode_code;

commit;
