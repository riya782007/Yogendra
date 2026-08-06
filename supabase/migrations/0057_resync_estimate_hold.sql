-- Keep a HELD estimate's stock reservation exactly equal to its CURRENT line quantities. Called after any
-- edit to a held estimate (owner changes 3→4, removes a line, adds one). Previously the reservation was a
-- snapshot frozen at hold time, so editing a held estimate left "Reserved" out of sync with the estimate
-- (owner: changed to 4 but it held 5). This reconciles per product/variant: releases surplus back to
-- sellable stock, or reserves the shortfall (never taking stock below zero). Idempotent.
create or replace function public.resync_estimate_hold(p_estimate_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $function$
declare r record; v_name text; d int; actual int; s int; adjusted int := 0;
begin
  if coalesce((select status from estimates where id = p_estimate_id)::text, '') <> 'held' then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;
  select customer_name into v_name from estimates where id = p_estimate_id;

  for r in
    with want as (
      select product_id, variant_id, sum(qty)::int as desired
      from estimate_items where estimate_id = p_estimate_id
      group by product_id, variant_id
    ),
    have as (
      select product_id, variant_id, (-sum(delta))::int as reserved
      from stock_adjustments where ref_id = p_estimate_id and kind in ('reserve','release')
      group by product_id, variant_id
    )
    select coalesce(w.product_id, h.product_id) as product_id,
           coalesce(w.variant_id, h.variant_id) as variant_id,
           coalesce(w.desired, 0) as desired,
           coalesce(h.reserved, 0) as reserved
    from want w
    full outer join have h on w.product_id = h.product_id and w.variant_id is not distinct from h.variant_id
  loop
    d := r.desired - r.reserved;
    if d = 0 then continue; end if;
    if d > 0 then
      if r.variant_id is not null then
        select qty into s from variants where id = r.variant_id;
        actual := least(d, greatest(0, coalesce(s, 0)));
        if actual > 0 then update variants set qty = qty - actual where id = r.variant_id; end if;
      else
        select qty into s from products where id = r.product_id;
        actual := least(d, greatest(0, coalesce(s, 0)));
        if actual > 0 then update products set qty = qty - actual, last_movement_at = now() where id = r.product_id; end if;
      end if;
      if actual > 0 then
        insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
        values (r.product_id, r.variant_id,
                coalesce((select upper(sku) from variants where id = r.variant_id), (select upper(sku) from products where id = r.product_id)),
                -actual, 'reserve', 'Estimate hold sync', concat('Hold increased for ', coalesce(v_name,'customer')), p_estimate_id, now());
        adjusted := adjusted + 1;
      end if;
    else
      actual := -d;
      if r.variant_id is not null then update variants set qty = qty + actual where id = r.variant_id;
      else update products set qty = qty + actual, last_movement_at = now() where id = r.product_id; end if;
      insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
      values (r.product_id, r.variant_id,
              coalesce((select upper(sku) from variants where id = r.variant_id), (select upper(sku) from products where id = r.product_id)),
              actual, 'release', 'Estimate hold sync', concat('Hold reduced for ', coalesce(v_name,'customer')), p_estimate_id, now());
      adjusted := adjusted + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'adjusted', adjusted);
end $function$;
