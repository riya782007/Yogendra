-- HELD ORDER EDIT must keep the RESERVATION in sync with the bill.
-- Owner: an item removed/swapped on a COD or prepaid order disappeared from the bill but kept
-- showing "reserved" in stock movements, so sellable qty stayed short.
--
-- Cause: the one-shot bill save (saveOrderBillAction, held branch) rewrites order_items directly
-- — delete / qty update / insert — on the assumption (true before 0071) that a held order never
-- moved stock. Since 0071 a held order reserves (kind='reserve'), so those direct writes left
-- the reserve untouched.
--
-- Fix (database-only, no app redeploy needed):
--   1) resync_held_order_stock(order): for every product/variant, reservation := billed qty.
--      Surplus → 'release' row (item removed / qty reduced). Shortfall → 'reserve' row.
--   2) Statement triggers on order_items call it for every live held order touched, so ANY
--      path that edits a held order's lines keeps stock + history correct.
--   3) add_order_line no longer reserves itself for held orders (the trigger does) — avoids a
--      double reserve. edit_order_line already reserves/releases before touching the row, so
--      the trigger finds it in sync and does nothing.
--   4) Heal live held orders already out of sync; integrity view so it cannot hide again.

create or replace function public.resync_held_order_stock(p_order_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_hold boolean; v_status text; v_name text; it record;
  v_avail int; v_sku text; v_need int; v_released int := 0; v_reserved int := 0;
begin
  -- Serialise concurrent edits of the same order.
  select coalesce(cod_hold, false), coalesce(status::text, ''), customer_name
    into v_hold, v_status, v_name
    from orders where id = p_order_id for update;
  if not found or not v_hold or v_status in ('cancelled', 'refunded') then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;

  for it in
    with billed as (
      select product_id, variant_id, sum(qty)::int as qty
      from order_items where order_id = p_order_id
      group by product_id, variant_id
    ), held as (
      select product_id, variant_id, (-sum(delta))::int as qty
      from stock_adjustments
      where ref_id = p_order_id and kind in ('reserve', 'release')
      group by product_id, variant_id
    )
    select coalesce(b.product_id, h.product_id) as product_id,
           coalesce(b.variant_id, h.variant_id) as variant_id,
           greatest(coalesce(b.qty, 0), 0) as billed,
           greatest(coalesce(h.qty, 0), 0) as held
    from billed b
    -- FULL JOIN needs a hash/merge-joinable condition, so compare variants via a sentinel.
    full outer join held h
      on h.product_id = b.product_id
     and coalesce(h.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(b.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  loop
    if it.held > it.billed then
      perform public.bd_add_stock(it.product_id, it.variant_id, it.held - it.billed, null,
        'release', 'Held order edited',
        case when it.billed = 0
             then concat('Removed from bill — hold released (', coalesce(v_name, 'customer'), ')')
             else concat('Qty ', it.held, ' → ', it.billed, ' — hold released (', coalesce(v_name, 'customer'), ')') end,
        p_order_id);
      v_released := v_released + (it.held - it.billed);
    elsif it.billed > it.held then
      if it.variant_id is not null then select qty, upper(sku) into v_avail, v_sku from variants where id = it.variant_id;
      else select qty, upper(sku) into v_avail, v_sku from products where id = it.product_id; end if;
      -- Non-strict: hold what is on the shelf; any shortage still blocks at confirm/dispatch.
      v_need := least(it.billed - it.held, greatest(coalesce(v_avail, 0), 0));
      if v_need > 0 then
        perform public.bd_deduct_stock(it.product_id, it.variant_id, v_need, v_sku,
          'reserve', 'Held order edited',
          concat('Qty ', it.held, ' → ', it.billed, ' — reserved for ', coalesce(v_name, 'customer')),
          p_order_id);
        v_reserved := v_reserved + v_need;
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'released', v_released, 'reserved', v_reserved);
end; $function$;

-- Statement-level triggers (one resync per affected order, after all rows of the statement).
create or replace function public.trg_order_items_resync_hold()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare r record;
begin
  if tg_op = 'INSERT' then
    for r in select distinct n.order_id from new_rows n
             join orders o on o.id = n.order_id and coalesce(o.cod_hold, false) loop
      perform public.resync_held_order_stock(r.order_id);
    end loop;
  elsif tg_op = 'DELETE' then
    for r in select distinct d.order_id from old_rows d
             join orders o on o.id = d.order_id and coalesce(o.cod_hold, false) loop
      perform public.resync_held_order_stock(r.order_id);
    end loop;
  else
    for r in select distinct x.order_id from (
               select order_id from new_rows union select order_id from old_rows) x
             join orders o on o.id = x.order_id and coalesce(o.cod_hold, false) loop
      perform public.resync_held_order_stock(r.order_id);
    end loop;
  end if;
  return null;
end; $function$;

drop trigger if exists trg_order_items_hold_ins on public.order_items;
drop trigger if exists trg_order_items_hold_upd on public.order_items;
drop trigger if exists trg_order_items_hold_del on public.order_items;

create trigger trg_order_items_hold_ins after insert on public.order_items
  referencing new table as new_rows
  for each statement execute function public.trg_order_items_resync_hold();
create trigger trg_order_items_hold_upd after update on public.order_items
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.trg_order_items_resync_hold();
create trigger trg_order_items_hold_del after delete on public.order_items
  referencing old table as old_rows
  for each statement execute function public.trg_order_items_resync_hold();

-- add_order_line: identical to 0071 except the held branch — the insert trigger now reserves.
create or replace function public.add_order_line(p_order_id uuid, p_product_id uuid, p_variant_id uuid, p_qty integer, p_unit_price integer, p_unit_mrp bigint default null::bigint, p_allow_oversell boolean default false)
 returns json language plpgsql as $function$
declare
  v_qty integer := greatest(1, coalesce(p_qty, 1));
  v_price integer := greatest(0, coalesce(p_unit_price, 0));
  v_sku text; v_have integer; v_charges integer; v_items integer; v_total integer; v_backorder boolean; v_hold boolean;
  v_channel text; v_billtype text;
begin
  if p_order_id is null or p_product_id is null then raise exception 'Missing bill or product'; end if;
  select coalesce(is_backorder, false), coalesce(cod_hold, false) into v_backorder, v_hold from orders where id = p_order_id;
  if p_variant_id is not null then
    select qty, sku into v_have, v_sku from variants where id = p_variant_id for update;
  else
    select qty, sku into v_have, v_sku from products where id = p_product_id for update;
  end if;
  if not p_allow_oversell and not v_backorder and coalesce(v_have, 0) < v_qty then
    raise exception 'Only % in stock for %', coalesce(v_have, 0), coalesce(v_sku, 'this item');
  end if;
  insert into order_items (order_id, product_id, variant_id, qty, unit_price, line_total, unit_mrp)
  values (p_order_id, p_product_id, p_variant_id, v_qty, v_price, v_price * v_qty, p_unit_mrp);
  if v_hold then
    null; -- reserved by trg_order_items_hold_ins → resync_held_order_stock
  elsif not v_backorder then
    if p_variant_id is not null then update variants set qty = coalesce(qty, 0) - v_qty where id = p_variant_id;
    else update products set qty = coalesce(qty, 0) - v_qty where id = p_product_id; end if;
    insert into stock_adjustments (product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_by)
    values (p_product_id, p_variant_id, v_sku, -v_qty, 'sale', 'Bill edited', 'Line added to an issued bill', p_order_id, 'owner');
  end if;
  select coalesce(sum(line_total), 0) into v_items from order_items where order_id = p_order_id;
  select coalesce(extra_packing,0) + coalesce(extra_courier,0) + coalesce(extra_adjustment,0),
         lower(coalesce(channel::text,'')), lower(coalesce(bill_type,''))
    into v_charges, v_channel, v_billtype from orders where id = p_order_id;
  if v_channel = 'wholesale' and v_billtype = 'gst' then v_items := round(v_items * 1.03); end if;
  v_total := v_items + coalesce(v_charges, 0);
  update orders set total = v_total where id = p_order_id;
  return json_build_object('total', v_total, 'sku', v_sku, 'qty', v_qty);
end; $function$;

-- Heal live held orders whose reservation drifted from the bill (items removed/swapped/edited).
do $$
declare o record;
begin
  for o in
    select id from orders
    where coalesce(cod_hold, false) = true
      and coalesce(status::text, '') not in ('cancelled', 'refunded')
    order by created_at
  loop
    perform public.resync_held_order_stock(o.id);
  end loop;
end $$;

-- Integrity: a live held order whose reservation exceeds what is on the bill.
drop view if exists public.system_integrity;
drop view if exists public.held_order_sync_integrity;

create view public.held_order_sync_integrity as
  with billed as (
    select order_id, product_id, variant_id, sum(qty)::int as qty
    from order_items group by order_id, product_id, variant_id
  ), held as (
    select ref_id as order_id, product_id, variant_id, (-sum(delta))::int as qty
    from stock_adjustments where kind in ('reserve', 'release') and ref_id is not null
    group by ref_id, product_id, variant_id
  )
  select o.id as order_id,
         coalesce(o.invoice_no, o.id::text) as what,
         coalesce(v.sku, p.sku, '?') as sku,
         coalesce(h.qty, 0) as reserved,
         coalesce(b.qty, 0) as billed
  from held h
  join orders o on o.id = h.order_id
  left join billed b on b.order_id = h.order_id and b.product_id = h.product_id
                    and b.variant_id is not distinct from h.variant_id
  left join products p on p.id = h.product_id
  left join variants v on v.id = h.variant_id
  where coalesce(o.cod_hold, false) = true
    and coalesce(o.status::text, '') not in ('cancelled', 'refunded')
    and coalesce(h.qty, 0) > coalesce(b.qty, 0);

create view public.system_integrity as
  select 'stock_ledger (qty <> movements, or negative)'::text as rule,
         (level || ' ' || coalesce(sku,'?')) as what, drift::text as detail
  from stock_integrity
  union all
  select 'estimate_hold (non-held estimate still holding stock)',
         (status || ' · ' || coalesce(customer_name,'')), pieces_still_held::text
  from estimate_hold_integrity
  union all
  select 'cancelled_order_stock (rejected order changed stock)',
         (coalesce(invoice_no, order_id::text) || ' · ' || status), net_stock_delta::text
  from order_stock_integrity
  union all
  select 'order_hold (cancelled/missing order still reserving stock)',
         (what || ' · ' || status), pieces_still_held::text
  from order_hold_integrity
  union all
  select 'held_order_sync (removed/reduced item still reserved)',
         (what || ' · ' || sku), (reserved || ' reserved, ' || billed || ' on bill')
  from held_order_sync_integrity;
