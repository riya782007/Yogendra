-- A retail/online order stores the CHOSEN colour so place_order can pick the exact variant. The storefront
-- was passing a COMPOSITE label ("Gold · Gold" = colour · size · polish) instead of the raw colour ("Gold"),
-- so the exact match `lower(v.color) = lower(colour)` failed and place_order raised "Colour not available".
-- On an ONLINE order the payment is already captured at that point, so the order was silently lost.
-- The storefront now sends the raw colour, but to protect any already-stored carts / other callers we make
-- the match TOLERANT: prefer an exact colour match, else fall back to the first token before " · ".
create or replace function public.place_order(p_items jsonb, p_customer jsonb, p_channel text default 'retail'::text, p_payment text default 'cod'::text, p_allow_oversell boolean default false, p_tier text default 'retail'::text, p_backorder boolean default false, p_cod_hold boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_order_id uuid := uuid_generate_v4(); v_total int := 0; it jsonb; v_r record;
        v_unit int; v_line int; v_qty int; v_bal int; v_sku text; v_vid uuid;
begin
  insert into orders(id, channel, retailer_id, status, total, payment_mode, customer_name, customer_phone, created_at)
    values (v_order_id, p_channel::order_channel, null, 'completed', 0, p_payment, nullif(p_customer->>'name',''), nullif(p_customer->>'phone',''), now());
  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::int;
    select * into v_r from resolve_sku(it->>'sku');
    if v_r.product_id is null then raise exception 'unknown sku %', it->>'sku'; end if;
    if v_r.variant_id is null and coalesce(it->>'color','') <> ''
       and exists(select 1 from variants where product_id = v_r.product_id) then
      select v.product_id, v.id as variant_id, p.base_wholesale, v.qty as avail,
             coalesce(v.wholesale_override, p.wholesale_override) as w_override,
             coalesce(v.retail_override, p.retail_override) as r_override
        into v_r
      from variants v join products p on p.id = v.product_id
      where v.product_id = v_r.product_id
        and (
          lower(v.color) = lower(it->>'color')                              -- exact colour ("Gold")
          or lower(v.color) = lower(split_part(it->>'color', ' · ', 1))     -- composite label ("Gold · Gold")
        )
      order by (lower(v.color) = lower(it->>'color')) desc                  -- prefer an exact match
      limit 1;
      if v_r.variant_id is null then
        raise exception 'Colour "%" is not available for %', it->>'color', upper(it->>'sku');
      end if;
    end if;
    if not p_allow_oversell and not p_backorder and v_r.avail < v_qty then
      raise exception 'Only % in stock for % % — you billed %. Add stock or enable backorder.', v_r.avail, upper(it->>'sku'), coalesce(it->>'color',''), v_qty;
    end if;
    v_unit := case when p_tier='wholesale' then coalesce(v_r.w_override, bd_price(v_r.base_wholesale,'wholesale'))
                   else coalesce(v_r.r_override, bd_price(v_r.base_wholesale,'retail')) end;
    v_line := v_unit * v_qty; v_total := v_total + v_line;

    v_vid := v_r.variant_id;
    if v_vid is null then
      select v.id into v_vid from variants v
      where v.product_id = v_r.product_id
      order by (v.id = (select default_variant_id from products where id = v_r.product_id)) desc nulls last, v.qty desc, v.id
      limit 1;
    end if;

    insert into order_items(order_id, product_id, variant_id, qty, unit_price, line_total)
      values (v_order_id, v_r.product_id, v_vid, v_qty, v_unit, v_line);

    if not p_backorder and not p_cod_hold then
      v_sku := upper(it->>'sku');
      if v_vid is not null then
        update variants set qty = greatest(0, qty - v_qty) where id = v_vid;
        select upper(sku) into v_sku from variants where id = v_vid;
        update products set last_movement_at = now() where id = v_r.product_id;
      else
        update products set qty = greatest(0, qty - v_qty), last_movement_at = now() where id = v_r.product_id;
      end if;
      insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
        values (v_r.product_id, v_vid, v_sku, -v_qty, 'sale', concat(initcap(p_channel),' sale'), concat('Sold ', v_qty), v_order_id, now());
    end if;
  end loop;
  update orders set total = v_total where id = v_order_id;
  if p_backorder then
    update orders set is_backorder = true where id = v_order_id;
  elsif p_cod_hold then
    update orders set cod_hold = true where id = v_order_id;
  else
    select coalesce(max(balance),0) into v_bal from ledger;
    insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
      values ('sales', v_order_id, 0, v_total, v_bal + v_total, concat(initcap(p_channel),' sale ', coalesce(p_customer->>'name','')), now());
  end if;
  return jsonb_build_object('order_id', v_order_id, 'total', v_total);
end; $function$;
