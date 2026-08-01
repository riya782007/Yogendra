-- Wholesale COD orders must ALSO be held (stock checked but NOT deducted, no revenue posted) until the
-- owner confirms dispatch + receipt — exactly like retail COD (0052). Previously only the retail
-- storefront path set cod_hold, so wholesale COD orders posted straight into Sales (owner: "cod orders
-- are directly going in sales and not in COD order section"). This adds p_cod_hold to the wholesale RPC.
-- The shared /admin/cod page and confirm_cod_order already work for any channel.
CREATE OR REPLACE FUNCTION public.place_wholesale_order(p_customer uuid, p_items jsonb, p_allow_oversell boolean DEFAULT false, p_tiers jsonb DEFAULT '[]'::jsonb, p_cod_hold boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_order uuid := uuid_generate_v4(); v_total int := 0; it jsonb; v_r record;
        v_unit int; v_line int; v_qty int; v_bal int; v_name text; v_min int := 300000;
        t jsonb; v_pct numeric;
begin
  select name into v_name from customers where id = p_customer;
  insert into orders(id, channel, status, total, payment_mode, customer_id, customer_name, bill_type, created_at)
    values (v_order, 'wholesale', 'completed', 0, 'pending', p_customer, coalesce(v_name,'Wholesale'), 'gst', now());
  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::int;
    select * into v_r from resolve_sku(it->>'sku');
    if v_r.product_id is null then continue; end if;
    if v_r.variant_id is null and coalesce(it->>'color','') <> '' and exists(select 1 from variants where product_id = v_r.product_id) then
      select v.product_id, v.id as variant_id, p.base_wholesale, v.qty as avail,
             coalesce(v.wholesale_override, p.wholesale_override) as w_override,
             coalesce(v.retail_override, p.retail_override) as r_override
        into v_r from variants v join products p on p.id = v.product_id
      where v.product_id = v_r.product_id and lower(v.color) = lower(it->>'color') limit 1;
      if v_r.variant_id is null then raise exception 'Colour "%" is not available for %', it->>'color', upper(it->>'sku'); end if;
    end if;
    if not p_allow_oversell and v_r.avail < v_qty then
      raise exception 'Only % in stock for % % — you ordered %. Add stock or enable backorder.', v_r.avail, upper(it->>'sku'), coalesce(it->>'color',''), v_qty;
    end if;
    v_unit := coalesce(v_r.w_override, bd_price(v_r.base_wholesale,'wholesale'));
    v_pct := 0;
    if p_tiers is not null then
      for t in select * from jsonb_array_elements(p_tiers) loop
        if v_qty >= coalesce((t->>'min_qty')::int, 2147483647) and coalesce((t->>'pct_off')::numeric,0) > v_pct then
          v_pct := (t->>'pct_off')::numeric;
        end if;
      end loop;
    end if;
    if v_pct > 0 then v_unit := greatest(0, round(v_unit * (1 - v_pct/100.0))); end if;
    v_line := v_unit * v_qty; v_total := v_total + v_line;
    insert into order_items(order_id, product_id, variant_id, qty, unit_price, line_total)
      values (v_order, v_r.product_id, v_r.variant_id, v_qty, v_unit, v_line);
    -- COD-HOLD: inventory is NOT touched until the owner confirms dispatch + receipt on /admin/cod.
    if not p_cod_hold then
      perform bd_deduct_stock(v_r.product_id, v_r.variant_id, v_qty, upper(it->>'sku'), 'sale', 'Wholesale sale', concat('Sold ', v_qty), v_order);
    end if;
  end loop;
  if v_total < v_min then raise exception 'Minimum wholesale order is Rs %. This order totals Rs %.', (v_min/100), (v_total/100); end if;
  update orders set total = v_total where id = v_order;
  if p_cod_hold then
    update orders set cod_hold = true where id = v_order;
  else
    select coalesce(max(balance),0) into v_bal from ledger;
    insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
      values ('sales', v_order, 0, v_total, v_bal + v_total, concat('Wholesale order ', coalesce(v_name,'')), now());
  end if;
  return jsonb_build_object('order_id', v_order, 'total', v_total);
end; $function$;

-- Remove the previous 4-arg overload so callers resolve to the new cod_hold-aware version.
drop function if exists public.place_wholesale_order(uuid, jsonb, boolean, jsonb);
