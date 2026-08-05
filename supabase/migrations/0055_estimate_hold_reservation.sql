-- ESTIMATE HOLD = STOCK RESERVATION (owner's real workflow: a regular customer commits to buy and takes
-- goods aside to collect/pay within ~15 days). Putting an estimate ON HOLD reserves the committed pieces
-- out of sellable stock — so they can't be sold to anyone else and don't show as available — but posts NO
-- revenue (it is not a sale yet). Resume/Deny release the reservation. Billing releases the full hold then
-- charges only the quantity actually taken, so any untaken remainder returns to stock ("committed 50,
-- took 20, 30 comes back"). Modeled as non-revenue 'reserve' / 'release' stock movements for full audit.
-- products.qty is auto-synced from variants by triggers, so these only touch variants.qty (or products.qty
-- for plain, variant-less items).

-- 'held' status for estimates.
alter type estimate_status add value if not exists 'held';

-- Put an estimate on hold: reserve every committed line out of sellable stock (blocks if stock is short).
create or replace function public.hold_estimate(p_estimate_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $function$
declare it record; v_name text; v_short text := '';
begin
  if (select status from estimates where id = p_estimate_id) = 'held' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  select customer_name into v_name from estimates where id = p_estimate_id;

  for it in
    select ei.product_id, ei.variant_id, sum(ei.qty)::int as qty,
           coalesce(upper(v.sku), upper(p.sku)) as sku,
           coalesce(v.qty, p.qty, 0) as avail
    from estimate_items ei
    join products p on p.id = ei.product_id
    left join variants v on v.id = ei.variant_id
    where ei.estimate_id = p_estimate_id
    group by ei.product_id, ei.variant_id, v.sku, p.sku, v.qty, p.qty
  loop
    if it.avail < it.qty then
      v_short := v_short || it.sku || ' (' || it.avail || ' left, need ' || it.qty || '); ';
    end if;
  end loop;
  if v_short <> '' then
    raise exception 'Not enough stock to hold: %', v_short;
  end if;

  for it in
    select ei.product_id, ei.variant_id, sum(ei.qty)::int as qty
    from estimate_items ei where ei.estimate_id = p_estimate_id
    group by ei.product_id, ei.variant_id
  loop
    if coalesce(it.qty,0) <= 0 then continue; end if;
    if it.variant_id is not null then
      update variants set qty = qty - it.qty where id = it.variant_id;
      insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
        values (it.product_id, it.variant_id, (select upper(sku) from variants where id = it.variant_id),
                -it.qty, 'reserve', 'Estimate hold', concat('Reserved for ', coalesce(v_name,'customer')), p_estimate_id, now());
    else
      update products set qty = qty - it.qty, last_movement_at = now() where id = it.product_id;
      insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
        values (it.product_id, null, (select upper(sku) from products where id = it.product_id),
                -it.qty, 'reserve', 'Estimate hold', concat('Reserved for ', coalesce(v_name,'customer')), p_estimate_id, now());
    end if;
  end loop;

  update estimates set status = 'held' where id = p_estimate_id;
  return jsonb_build_object('ok', true);
end $function$;

-- Release a hold: return whatever is still reserved for this estimate to sellable stock. Idempotent.
create or replace function public.release_estimate_hold(p_estimate_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $function$
declare it record; v_name text;
begin
  select customer_name into v_name from estimates where id = p_estimate_id;
  for it in
    select product_id, variant_id, (-sum(delta))::int as reserved
    from stock_adjustments
    where ref_id = p_estimate_id and kind in ('reserve','release')
    group by product_id, variant_id
    having (-sum(delta)) > 0
  loop
    if it.variant_id is not null then
      update variants set qty = qty + it.reserved where id = it.variant_id;
      insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
        values (it.product_id, it.variant_id, (select upper(sku) from variants where id = it.variant_id),
                it.reserved, 'release', 'Estimate hold released', concat('Released from hold — ', coalesce(v_name,'customer')), p_estimate_id, now());
    else
      update products set qty = qty + it.reserved, last_movement_at = now() where id = it.product_id;
      insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
        values (it.product_id, null, (select upper(sku) from products where id = it.product_id),
                it.reserved, 'release', 'Estimate hold released', concat('Released from hold — ', coalesce(v_name,'customer')), p_estimate_id, now());
    end if;
  end loop;
  return jsonb_build_object('ok', true);
end $function$;
