-- 0074 — MOVE STOCK between two SKUs in one atomic step (owner, Oct 2026).
--
-- "Agar WT1052 me 3 pcs hain par asli stock WT1050 ka hai, to WT1052 se remove aur WT1050 me add karne
--  ki jagah seedha move kar do. Isse staff ko Adjust-stock ka module nahi dena padega aur rectification
--  staff kar payega."
--
-- A move never changes the shop's total pieces: it takes N pcs off one SKU and puts the same N on another,
-- inside ONE transaction (both rows locked), and writes a linked pair of 'move' rows to the stock ledger
-- (same ref_id) so the history shows "Moved to WT1050" / "Moved from WT1052" with who did it and why.
-- A SKU can be a colour (variant) SKU or a simple product's SKU. A parent SKU of a product with several
-- colours is refused (we can't guess which colour) — with one colour it is used automatically.
-- Only the server (service role) may call it; the app checks the inventory.move permission first.

create or replace function public.move_stock(p_from text, p_to text, p_qty int, p_note text default null, p_by text default null)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  f_pid uuid; f_vid uuid; f_sku text; f_qty int; f_name text;
  t_pid uuid; t_vid uuid; t_sku text; t_qty int; t_name text;
  n int; link uuid := gen_random_uuid();
begin
  if p_qty is null or p_qty < 1 then raise exception 'Enter how many pieces to move (1 or more).'; end if;

  -- resolve FROM
  select v.product_id, v.id, v.sku, coalesce(v.qty,0), trim(coalesce(p.name,'') || ' ' || coalesce(v.color,''))
    into f_pid, f_vid, f_sku, f_qty, f_name
    from variants v join products p on p.id = v.product_id
   where upper(v.sku) = upper(trim(p_from)) limit 1 for update of v;
  if f_vid is null then
    select p.id, p.sku, coalesce(p.qty,0), p.name into f_pid, f_sku, f_qty, f_name
      from products p where upper(p.sku) = upper(trim(p_from)) limit 1 for update;
    if f_pid is null then raise exception 'SKU % was not found.', upper(trim(p_from)); end if;
    select count(*) into n from variants where product_id = f_pid;
    if n > 1 then raise exception '% has % colours — pick the colour SKU to move from.', f_sku, n; end if;
    if n = 1 then
      select v.id, v.sku, coalesce(v.qty,0), trim(f_name || ' ' || coalesce(v.color,'')) into f_vid, f_sku, f_qty, f_name
        from variants v where v.product_id = f_pid for update;
    end if;
  end if;

  -- resolve TO
  select v.product_id, v.id, v.sku, coalesce(v.qty,0), trim(coalesce(p.name,'') || ' ' || coalesce(v.color,''))
    into t_pid, t_vid, t_sku, t_qty, t_name
    from variants v join products p on p.id = v.product_id
   where upper(v.sku) = upper(trim(p_to)) limit 1 for update of v;
  if t_vid is null then
    select p.id, p.sku, coalesce(p.qty,0), p.name into t_pid, t_sku, t_qty, t_name
      from products p where upper(p.sku) = upper(trim(p_to)) limit 1 for update;
    if t_pid is null then raise exception 'SKU % was not found.', upper(trim(p_to)); end if;
    select count(*) into n from variants where product_id = t_pid;
    if n > 1 then raise exception '% has % colours — pick the colour SKU to move to.', t_sku, n; end if;
    if n = 1 then
      select v.id, v.sku, coalesce(v.qty,0), trim(t_name || ' ' || coalesce(v.color,'')) into t_vid, t_sku, t_qty, t_name
        from variants v where v.product_id = t_pid for update;
    end if;
  end if;

  if f_pid = t_pid and f_vid is not distinct from t_vid then raise exception 'From and To are the same SKU.'; end if;
  if f_qty < p_qty then raise exception '% has only % pcs in stock — cannot move %.', f_sku, f_qty, p_qty; end if;

  -- take off FROM (variant trigger rolls the product total up)
  if f_vid is not null then update variants set qty = qty - p_qty where id = f_vid;
  else update products set qty = qty - p_qty where id = f_pid; end if;
  -- put on TO
  if t_vid is not null then update variants set qty = coalesce(qty,0) + p_qty where id = t_vid;
  else update products set qty = coalesce(qty,0) + p_qty where id = t_pid; end if;
  update products set last_movement_at = now() where id in (f_pid, t_pid);

  insert into stock_adjustments (product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_by) values
    (f_pid, f_vid, f_sku, -p_qty, 'move', 'Moved to ' || t_sku, nullif(trim(coalesce(p_note,'')), ''), link, p_by),
    (t_pid, t_vid, t_sku,  p_qty, 'move', 'Moved from ' || f_sku, nullif(trim(coalesce(p_note,'')), ''), link, p_by);

  return jsonb_build_object('moved', p_qty, 'from_sku', f_sku, 'from_name', f_name, 'from_qty', f_qty - p_qty,
                            'to_sku', t_sku, 'to_name', t_name, 'to_qty', t_qty + p_qty);
end; $$;

revoke all on function public.move_stock(text, text, int, text, text) from public, anon, authenticated;
grant execute on function public.move_stock(text, text, int, text, text) to service_role;
