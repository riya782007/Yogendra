-- COD-HOLD: retail Cash-on-Delivery orders are HELD — stock checked but NOT deducted and no revenue
-- posted — until the owner confirms dispatch + receipt on /admin/cod. Then confirm_cod_order() moves
-- stock, posts the sale, and marks it paid. Keeps unshipped COD off inventory and out of sales records.
alter table public.orders add column if not exists cod_hold boolean not null default false;
create index if not exists orders_cod_hold_idx on public.orders (cod_hold) where cod_hold = true;

-- Replace place_order with a version that adds a p_cod_hold mode (checks stock but defers the deduction
-- and revenue, flagging cod_hold). Drop the previous 7-arg overload so only this version remains.
drop function if exists public.place_order(jsonb, jsonb, text, text, boolean, text, boolean);

CREATE OR REPLACE FUNCTION public.place_order(p_items jsonb, p_customer jsonb, p_channel text DEFAULT 'retail'::text, p_payment text DEFAULT 'cod'::text, p_allow_oversell boolean DEFAULT false, p_tier text DEFAULT 'retail'::text, p_backorder boolean DEFAULT false, p_cod_hold boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_order_id uuid := uuid_generate_v4(); v_total int := 0; it jsonb; v_r record;
        v_unit int; v_line int; v_qty int; v_bal int; v_sku text; v_vid uuid;
begin
  insert into orders(id, channel, retailer_id, status, total, payment_mode, customer_name, customer_phone, created_at)
    values (v_order_id, p_channel::order_channel, null, 'completed', 0, p_payment, nullif(p_customer->>'name',''), nullif(p_customer->>'phone',''), now());
  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::int;
    select * into v_r from resolve_sku(it->>'sku');
    if v_r.product_id is null then raise exception 'unknown sku %', it->>'sku'; end if;
    if v_r.variant_id is null and coalesce(it->>'color','') <> '' and exists(select 1 from variants where product_id = v_r.product_id) then
      select v.product_id, v.id as variant_id, p.base_wholesale, v.qty as avail,
             coalesce(v.wholesale_override, p.wholesale_override) as w_override,
             coalesce(v.retail_override, p.retail_override) as r_override
        into v_r
      from variants v join products p on p.id = v.product_id
      where v.product_id = v_r.product_id and lower(v.color) = lower(it->>'color') limit 1;
      if v_r.variant_id is null then raise exception 'Colour "%" is not available for %', it->>'color', upper(it->>'sku'); end if;
    end if;
    if not p_allow_oversell and not p_backorder and v_r.avail < v_qty then
      raise exception 'Only % in stock for % % — you billed %. Add stock or enable backorder.', v_r.avail, upper(it->>'sku'), coalesce(it->>'color',''), v_qty;
    end if;
    v_unit := case when p_tier='wholesale' then coalesce(v_r.w_override, bd_price(v_r.base_wholesale,'wholesale'))
                   else coalesce(v_r.r_override, bd_price(v_r.base_wholesale,'retail')) end;
    v_line := v_unit * v_qty; v_total := v_total + v_line;
    v_vid := v_r.variant_id;
    if v_vid is null then
      select v.id into v_vid from variants v where v.product_id = v_r.product_id
      order by (v.id = (select default_variant_id from products where id = v_r.product_id)) desc nulls last, v.qty desc, v.id limit 1;
    end if;
    insert into order_items(order_id, product_id, variant_id, qty, unit_price, line_total)
      values (v_order_id, v_r.product_id, v_vid, v_qty, v_unit, v_line);
    -- BACKORDER or COD-HOLD: inventory NOT touched, no movement logged (deferred to fulfilment).
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

-- Confirm a held COD order on dispatch + receipt: re-check stock, move it, post the sale, mark paid.
CREATE OR REPLACE FUNCTION public.confirm_cod_order(p_order_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare it record; v_avail int; v_sku text; v_total int := 0; v_bal int; v_hold boolean; v_ordertotal int;
begin
  select cod_hold, total into v_hold, v_ordertotal from orders where id = p_order_id;
  if v_hold is null then raise exception 'Order not found'; end if;
  if not v_hold then return jsonb_build_object('order_id', p_order_id, 'already', true); end if;
  for it in select oi.product_id, oi.variant_id, oi.qty from order_items oi where oi.order_id = p_order_id loop
    if it.variant_id is not null then select qty, upper(sku) into v_avail, v_sku from variants where id = it.variant_id;
    else select qty, upper(sku) into v_avail, v_sku from products where id = it.product_id; end if;
    if coalesce(v_avail,0) < it.qty then raise exception 'Only % left in stock for % — update inventory before dispatching.', coalesce(v_avail,0), coalesce(v_sku,'?'); end if;
  end loop;
  for it in select oi.product_id, oi.variant_id, oi.qty, coalesce(oi.line_total, oi.unit_price*oi.qty) as line_total from order_items oi where oi.order_id = p_order_id loop
    if it.variant_id is not null then
      update variants set qty = qty - it.qty where id = it.variant_id;
      update products set qty = (select coalesce(sum(qty),0) from variants where product_id = it.product_id), last_movement_at = now() where id = it.product_id;
      select upper(sku) into v_sku from variants where id = it.variant_id;
    else
      update products set qty = qty - it.qty, last_movement_at = now() where id = it.product_id;
      select upper(sku) into v_sku from products where id = it.product_id;
    end if;
    v_total := v_total + coalesce(it.line_total,0);
    insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
      values (it.product_id, it.variant_id, v_sku, -it.qty, 'sale', 'COD dispatched', concat('Sold ', it.qty, ' (COD confirmed)'), p_order_id, now());
  end loop;
  select coalesce(max(balance),0) into v_bal from ledger;
  insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
    values ('sales', p_order_id, 0, v_total, v_bal + v_total, 'COD dispatched → sale', now());
  update orders set cod_hold = false, amount_paid = coalesce(v_ordertotal, v_total) where id = p_order_id;
  return jsonb_build_object('order_id', p_order_id, 'amount', v_total);
end; $function$;