-- RELIABLE out-of-stock hiding, from the root. The app already refreshes the cached storefront on a stock
-- change, but a DIRECT database change (a data fix, an import, anything outside the app) would leave a
-- sold-out design showing until the 15-min cache expired. This makes the DATABASE itself ping the
-- storefront's refresh endpoint (/api/revalidate) whenever ANY product crosses the in-stock ↔ out-of-stock
-- line — so it never depends on which path moved the stock. Statement-level + a zero-crossing check means
-- it fires only on the rare visibility change, so it's cheap. Requires the pg_net extension.
create extension if not exists pg_net with schema extensions;

create or replace function public.bd_revalidate_on_stock_flip()
returns trigger language plpgsql security definer
set search_path to 'public','extensions','net','pg_temp' as $function$
begin
  if exists (
    select 1 from bd_new n join bd_old o on o.id = n.id
    where (coalesce(o.qty,0) > 0) is distinct from (coalesce(n.qty,0) > 0)
  ) then
    perform net.http_get(
      url := 'https://blythediva.com/api/revalidate',
      headers := jsonb_build_object('x-revalidate-token','bd-revalidate-7k2p9x')
    );
  end if;
  return null;
end $function$;

drop trigger if exists trg_bd_revalidate_stock on products;
create trigger trg_bd_revalidate_stock
  after update on products
  referencing old table as bd_old new table as bd_new
  for each statement execute function public.bd_revalidate_on_stock_flip();
