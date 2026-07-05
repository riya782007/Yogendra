-- Global quantity-break tiers for wholesale: [{"min_qty":12,"pct_off":5},{"min_qty":50,"pct_off":10}]
alter table public.pricing_settings add column if not exists wholesale_tiers jsonb not null default '[]'::jsonb;

-- Rebuild place_wholesale_order to apply a per-line global % discount based on that line's quantity.
-- Tiers are passed in by the server action (loaded from pricing_settings), keeping the engine generic.
create or replace function public.place_wholesale_order(
  p_customer uuid, p_items jsonb, p_allow_oversell boolean default false, p_tiers jsonb default '[]'::jsonb
) returns jsonb
  language plpgsql
  security definer
as $function$
declare v_order uuid := uuid_generate_v4(); v_total int := 0; it jsonb; v_r record;
        v_unit int; v_line int; v_qty int; v_bal int; v_name text; v_min int := 300000; v_sku text;
        t jsonb; v_pct numeric;
begin
  select name into v_name from customers where id = p_customer;
  insert into orders(id, channel, status, total, payment_mode, customer_id, customer_name, bill_type, created_at)
    values (v_order, 'wholesale', 'completed', 0, 'pending', p_customer, coalesce(v_name,'Wholesale'), 'gst', now());
  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::int;
    select * into v_r from resolve_sku(it->>'sku');
    if v_r.product_id is null then continue; end if;
    if v_r.variant_id is null and coalesce(it->>'color','') <> ''
       and exists(select 1 from variants where product_id = v_r.product_id) then
      select v.product_id, v.id as variant_id, p.base_wholesale, v.qty as avail,
             coalesce(v.wholesale_override, p.wholesale_override) as w_override,
             coalesce(v.retail_override, p.retail_override) as r_override
        into v_r
      from variants v join products p on p.id = v.product_id
      where v.product_id = v_r.product_id and lower(v.color) = lower(it->>'color')
      limit 1;
      if v_r.variant_id is null then
        raise exception 'Colour "%" is not available for %', it->>'color', upper(it->>'sku');
      end if;
    end if;
    if not p_allow_oversell and v_r.avail < v_qty then
      raise exception 'Only % in stock for % % — you ordered %. Add stock or enable backorder.', v_r.avail, upper(it->>'sku'), coalesce(it->>'color',''), v_qty;
    end if;
    v_unit := coalesce(v_r.w_override, bd_price(v_r.base_wholesale,'wholesale'));
    -- Global quantity break: highest % off among tiers this line's qty qualifies for.
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
    v_sku := upper(it->>'sku');
    if v_r.variant_id is not null then
      update variants set qty = greatest(0, qty - v_qty) where id = v_r.variant_id;
      select upper(sku) into v_sku from variants where id = v_r.variant_id;
    end if;
    update products set qty = greatest(0, qty - v_qty), last_movement_at = now() where id = v_r.product_id;
    insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
      values (v_r.product_id, v_r.variant_id, v_sku, -v_qty, 'sale', 'Wholesale sale', concat('Sold ', v_qty), v_order, now());
  end loop;
  if v_total < v_min then raise exception 'Minimum wholesale order is Rs %. This order totals Rs %.', (v_min/100), (v_total/100); end if;
  update orders set total = v_total where id = v_order;
  select coalesce(max(balance),0) into v_bal from ledger;
  insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
    values ('sales', v_order, 0, v_total, v_bal + v_total, concat('Wholesale order ', coalesce(v_name,'')), now());
  return jsonb_build_object('order_id', v_order, 'total', v_total);
end; $function$;
