-- Separate customer-facing merchandising labels (New, Bestseller, Sale) from internal admin notes
-- (e.g. "inventory updated") that were leaking into the storefront "Quick" filters.
alter table public.labels add column if not exists storefront boolean not null default true;
-- Hide obvious internal note-style labels from the storefront by default (owner can re-enable later).
update public.labels set storefront = false
where storefront = true and (
  name ilike '%updated%' or name ilike '%sorted%' or name ilike '%images%' or name ilike '%image %'
  or name ilike '%pending%' or name ilike '%todo%' or name ilike '%to do%' or name ilike '%done%'
  or name ilike '%check%' or name ilike '%wip%' or name ilike '%draft%' or name ilike '%internal%'
);
