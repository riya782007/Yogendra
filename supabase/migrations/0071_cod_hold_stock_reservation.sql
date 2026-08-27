-- COD / held-order STOCK RESERVATION.
-- Owner: "COD order agar h to product quantity hold nhi ho rhi" — a Cash-on-Delivery (or any
-- storefront hold) used to check stock but leave sellable qty untouched, so KR52 with 12 pcs
-- could still be sold to someone else. Held orders now RESERVE like estimates: qty leaves
-- sellable stock as kind='reserve' (NO revenue). Confirm converts the reservation into a sale
-- (net qty unchanged). Cancel/reject RELEASES it back. Admin edits of a still-held order
-- adjust the reservation only.

create or replace function public.bd_add_stock(p_product uuid, p_variant uuid, p_qty integer, p_sku text, p_kind text, p_source text, p_reason text, p_ref uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_sku text := p_sku;
begin
  if coalesce(p_qty, 0) <= 0 then return; end if;
  if p_variant is not null then
    update variants set qty = qty + p_qty where id = p_variant;
    update products set qty = (select coalesce(sum(qty),0) from variants where product_id = p_product), last_movement_at = now() where id = p_product;
    select upper(sku) into v_sku from variants where id = p_variant;
  else
    update products set qty = qty + p_qty, last_movement_at = now() where id = p_product;
    select upper(sku) into v_sku from products where id = p_product;
  end if;
  insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
    values (p_product, p_variant, coalesce(v_sku, p_sku), p_qty, p_kind, p_source, p_reason, p_ref, now());
end; $function$;

-- Put reserved units for a held order back into sellable stock. Idempotent (no-op if nothing reserved).
create or replace function public.release_held_order_stock(p_order_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare it record; v_name text;
begin
  select customer_name into v_name from orders where id = p_order_id;
  for it in
    select product_id, variant_id, (-sum(delta))::int as reserved
    from stock_adjustments
    where ref_id = p_order_id and kind in ('reserve','release')
    group by product_id, variant_id
    having (-sum(delta)) > 0
  loop
    perform public.bd_add_stock(it.product_id, it.variant_id, it.reserved, null,
      'release', 'Held order released', concat('Released hold — ', coalesce(v_name,'customer')), p_order_id);
  end loop;
  return jsonb_build_object('ok', true);
end; $function$;

-- Reserve any order_items not already covered by reserve/release for this order.
-- p_strict=true (default) raises if stock is short; false takes whatever is on the shelf (backfill).
create or replace function public.reserve_held_order_stock(p_order_id uuid, p_strict boolean default true)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare it record; v_already int; v_need int; v_avail int; v_sku text; v_name text; v_short text := '';
begin
  select customer_name into v_name from orders where id = p_order_id;
  for it in
    select oi.product_id, oi.variant_id, sum(oi.qty)::int as qty
    from order_items oi where oi.order_id = p_order_id
    group by oi.product_id, oi.variant_id
  loop
    if coalesce(it.qty,0) <= 0 then continue; end if;
    select coalesce(-sum(delta),0)::int into v_already
      from stock_adjustments
      where ref_id = p_order_id and kind in ('reserve','release')
        and product_id = it.product_id
        and ((it.variant_id is null and variant_id is null) or variant_id = it.variant_id);
    v_need := it.qty - coalesce(v_already, 0);
    if v_need <= 0 then continue; end if;
    if it.variant_id is not null then select qty, upper(sku) into v_avail, v_sku from variants where id = it.variant_id;
    else select qty, upper(sku) into v_avail, v_sku from products where id = it.product_id; end if;
    v_avail := coalesce(v_avail, 0);
    if v_avail < v_need then
      if p_strict then
        v_short := v_short || coalesce(v_sku,'?') || ' (' || v_avail || ' left, need ' || v_need || '); ';
        continue;
      end if;
      v_need := v_avail;
    end if;
    if v_need > 0 then
      perform public.bd_deduct_stock(it.product_id, it.variant_id, v_need, v_sku, 'reserve',
        'Order hold', concat('Reserved for ', coalesce(v_name,'customer')), p_order_id);
    end if;
  end loop;
  if v_short <> '' then
    raise exception 'Not enough stock to hold: %', v_short;
  end if;
  return jsonb_build_object('ok', true);
end; $function$;

create or replace function public.place_order(p_items jsonb, p_customer jsonb, p_channel text default 'retail'::text, p_payment text default 'cod'::text, p_allow_oversell boolean default false, p_tier text default 'retail'::text, p_backorder boolean default false, p_cod_hold boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_order_id uuid := uuid_generate_v4(); v_total int := 0; it jsonb; v_r record;
        v_unit int; v_line int; v_qty int; v_bal int; v_sku text; v_vid uuid; v_old int; v_applied int;
begin
  insert into orders(id, channel, retailer_id, status, total, payment_mode, customer_name, customer_phone, created_at)
    values (v_order_id, p_channel::order_channel, null, 'completed', 0, p_payment, nullif(p_customer->>'name',''), nullif(p_customer->>'phone',''), now());
  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::int;
    select * into v_r from resolve_sku(it->>'sku');
    if v_r.product_id is null then raise exception 'unknown sku %', it->>'sku'; end if;

    if v_r.variant_id is null and exists(select 1 from variants where product_id = v_r.product_id) then
      if coalesce(it->>'color','') <> '' then
        select v.product_id, v.id as variant_id, p.base_wholesale, v.qty as avail,
               coalesce(v.wholesale_override, p.wholesale_override) as w_override,
               coalesce(v.retail_override, p.retail_override) as r_override
          into v_r
        from variants v join products p on p.id = v.product_id
        where v.product_id = v_r.product_id
          and ( lower(v.color) = lower(it->>'color') or lower(v.color) = lower(split_part(it->>'color', ' · ', 1)) )
        order by (lower(v.color) = lower(it->>'color')) desc
        limit 1;
        if v_r.variant_id is null then
          raise exception 'Colour "%" is not available for %', it->>'color', upper(it->>'sku');
        end if;
      else
        select v.product_id, v.id as variant_id, p.base_wholesale, v.qty as avail,
               coalesce(v.wholesale_override, p.wholesale_override) as w_override,
               coalesce(v.retail_override, p.retail_override) as r_override
          into v_r
        from variants v join products p on p.id = v.product_id
        where v.product_id = v_r.product_id
        order by (v.qty > 0) desc, (v.id = p.default_variant_id) desc nulls last, v.qty desc, v.id
        limit 1;
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
      order by (v.qty > 0) desc, (v.id = (select default_variant_id from products where id = v_r.product_id)) desc nulls last, v.qty desc, v.id
      limit 1;
    end if;

    insert into order_items(order_id, product_id, variant_id, qty, unit_price, line_total)
      values (v_order_id, v_r.product_id, v_vid, v_qty, v_unit, v_line);

    if not p_backorder then
      if p_cod_hold then
        perform public.bd_deduct_stock(v_r.product_id, v_vid, v_qty,
          coalesce((select upper(sku) from variants where id = v_vid), upper(it->>'sku')),
          'reserve', concat(initcap(p_channel),' hold'),
          concat('Reserved ', v_qty, ' pending accept/dispatch'), v_order_id);
      else
        if v_vid is not null then
          select qty into v_old from variants where id = v_vid;
          v_applied := least(v_qty, greatest(0, coalesce(v_old,0)));
          if v_applied > 0 then update variants set qty = greatest(0, qty - v_qty) where id = v_vid; end if;
          select upper(sku) into v_sku from variants where id = v_vid;
          update products set last_movement_at = now() where id = v_r.product_id;
        else
          select qty into v_old from products where id = v_r.product_id;
          v_applied := least(v_qty, greatest(0, coalesce(v_old,0)));
          if v_applied > 0 then update products set qty = greatest(0, qty - v_qty), last_movement_at = now() where id = v_r.product_id; end if;
          v_sku := upper(it->>'sku');
        end if;
        if v_applied > 0 then
          insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
            values (v_r.product_id, v_vid, v_sku, -v_applied, 'sale', concat(initcap(p_channel),' sale'), concat('Sold ', v_qty), v_order_id, now());
        end if;
      end if;
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

create or replace function public.place_wholesale_order(p_customer uuid, p_items jsonb, p_allow_oversell boolean default false, p_tiers jsonb default '[]'::jsonb, p_cod_hold boolean default false)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp'
as $function$
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
    if p_cod_hold then
      perform bd_deduct_stock(v_r.product_id, v_r.variant_id, v_qty, upper(it->>'sku'), 'reserve', 'Wholesale hold', concat('Reserved ', v_qty), v_order);
    else
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

-- Confirm: release the reservation then deduct as a real sale in the same transaction (net qty
-- unchanged when a hold existed). Legacy un-reserved holds still deduct from live stock.
create or replace function public.confirm_cod_order(p_order_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare it record; v_avail int; v_sku text; v_total int := 0; v_bal int; v_hold boolean; v_ordertotal int;
begin
  select cod_hold, total into v_hold, v_ordertotal from orders where id = p_order_id;
  if v_hold is null then raise exception 'Order not found'; end if;
  if not v_hold then return jsonb_build_object('order_id', p_order_id, 'already', true); end if;
  perform public.release_held_order_stock(p_order_id);
  for it in select oi.product_id, oi.variant_id, oi.qty from order_items oi where oi.order_id = p_order_id loop
    if it.variant_id is not null then select qty, upper(sku) into v_avail, v_sku from variants where id = it.variant_id;
    else select qty, upper(sku) into v_avail, v_sku from products where id = it.product_id; end if;
    if coalesce(v_avail,0) < it.qty then raise exception 'Only % left in stock for % — update inventory before dispatching.', coalesce(v_avail,0), coalesce(v_sku,'?'); end if;
  end loop;
  for it in select oi.product_id, oi.variant_id, oi.qty, coalesce(oi.line_total, oi.unit_price*oi.qty) as line_total from order_items oi where oi.order_id = p_order_id loop
    perform public.bd_deduct_stock(it.product_id, it.variant_id, it.qty, null, 'sale', 'COD dispatched', concat('Sold ', it.qty, ' (hold confirmed)'), p_order_id);
    v_total := v_total + coalesce(it.line_total,0);
  end loop;
  select coalesce(max(balance),0) into v_bal from ledger;
  insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
    values ('sales', p_order_id, 0, v_total, v_bal + v_total, 'Held order confirmed → sale', now());
  update orders set cod_hold = false, amount_paid = coalesce(v_ordertotal, v_total) where id = p_order_id;
  return jsonb_build_object('order_id', p_order_id, 'amount', v_total);
end; $function$;

create or replace function public.cancel_order(p_order_id uuid, p_reason text default 'Cancelled'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_status text; v_amt int := 0; v_bal int; g record; v_sku text; v_deducted boolean; v_pay int; v_unit int; v_put int;
begin
  select status into v_status from orders where id = p_order_id;
  if v_status is null then raise exception 'Order not found'; end if;
  if v_status in ('cancelled','refunded') then
    return jsonb_build_object('order_id', p_order_id, 'already', true);
  end if;

  insert into payment_method_transactions(method_id, txn_type, direction, amount, ref_type, ref_id, note, created_by, created_at)
    select method_id, 'refund', 'out', amount, 'order', p_order_id, 'Order cancelled — payment reversed', 'owner', now()
    from payment_method_transactions where ref_id = p_order_id and direction = 'in';
  select coalesce(sum(credit),0) - coalesce(sum(debit),0) into v_pay from ledger where ref_id = p_order_id and kind = 'payment';
  if coalesce(v_pay,0) > 0 then
    select coalesce(max(balance),0) into v_bal from ledger;
    insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
      values ('payment', p_order_id, v_pay, 0, v_bal - v_pay, 'Order cancelled — payment reversed', now());
  end if;
  update orders set amount_paid = 0, pay_cash = 0, pay_bank = 0 where id = p_order_id;

  -- Release any still-held reservation FIRST so a rejected COD never leaves stock missing
  -- (and never restocks something that was never a sale).
  perform public.release_held_order_stock(p_order_id);

  select exists(select 1 from stock_adjustments where ref_id = p_order_id and kind = 'sale') into v_deducted;
  if not v_deducted then
    update orders set status = 'cancelled', is_backorder = false, cod_hold = false where id = p_order_id;
    insert into audit_log(actor, action, ref, detail)
      values ('owner','order_cancel', p_order_id::text, coalesce(p_reason,'') || ' (hold released — no sale to reverse)');
    return jsonb_build_object('order_id', p_order_id, 'no_restock', true, 'amount', 0);
  end if;

  for g in
    select sa.product_id, sa.variant_id, sum(sa.delta) as net
    from stock_adjustments sa
    where sa.ref_id = p_order_id and sa.kind in ('sale','return')
    group by sa.product_id, sa.variant_id
    having sum(sa.delta) < 0
  loop
    v_put := -g.net;
    if g.variant_id is not null then
      update variants set qty = qty + v_put where id = g.variant_id;
      update products set qty = (select coalesce(sum(qty),0) from variants where product_id = g.product_id), last_movement_at = now() where id = g.product_id;
      select upper(sku) into v_sku from variants where id = g.variant_id;
    else
      update products set qty = qty + v_put, last_movement_at = now() where id = g.product_id;
      select upper(sku) into v_sku from products where id = g.product_id;
    end if;
    select unit_price into v_unit from order_items
      where order_id = p_order_id and product_id = g.product_id
        and ((g.variant_id is null and variant_id is null) or variant_id = g.variant_id) limit 1;
    v_amt := v_amt + coalesce(v_unit,0) * v_put;
    insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
      values (g.product_id, g.variant_id, v_sku, v_put, 'return', 'Order cancelled', coalesce(nullif(p_reason,''),'Cancelled'), p_order_id, now());
  end loop;

  if v_amt > 0 then
    select coalesce(max(balance),0) into v_bal from ledger;
    insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
      values ('sales', p_order_id, v_amt, 0, v_bal - v_amt, concat('Order cancelled: ', coalesce(nullif(p_reason,''),'')), now());
  end if;

  update orders set status = 'cancelled', is_backorder = false, cod_hold = false where id = p_order_id;
  insert into audit_log(actor, action, ref, detail) values ('owner','order_cancel', p_order_id::text, coalesce(p_reason,''));
  return jsonb_build_object('order_id', p_order_id, 'amount', v_amt);
end; $function$;

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
    perform public.bd_deduct_stock(p_product_id, p_variant_id, v_qty, v_sku, 'reserve', 'Held order edited', 'Line added to a held order', p_order_id);
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

create or replace function public.edit_order_line(p_order_id uuid, p_item_id uuid, p_new_qty integer)
 returns jsonb language plpgsql as $function$
declare
  v_status text; v_bo boolean; v_hold boolean; v_touched boolean;
  it record; v_new int; v_delta int; v_sku text; v_avail int;
  v_old_line int; v_new_line int; v_rev_delta int; v_total int; v_bal int;
  v_channel text; v_billtype text;
begin
  select status, is_backorder, coalesce(cod_hold,false) into v_status, v_bo, v_hold from orders where id = p_order_id;
  if v_status is null then raise exception 'Order not found'; end if;
  if v_status in ('cancelled','refunded') then raise exception 'This bill is cancelled — nothing to edit.'; end if;
  select product_id, variant_id, qty, unit_price, coalesce(line_total, unit_price*qty) as line_total
    into it from order_items where id = p_item_id and order_id = p_order_id;
  if it.product_id is null then raise exception 'Line not found on this bill'; end if;
  v_new := greatest(0, coalesce(p_new_qty, 0));
  v_delta := v_new - it.qty;
  v_old_line := coalesce(it.line_total, 0);
  v_new_line := it.unit_price * v_new;

  if v_hold and v_delta <> 0 then
    if it.variant_id is not null then select qty, upper(sku) into v_avail, v_sku from variants where id = it.variant_id;
    else select qty, upper(sku) into v_avail, v_sku from products where id = it.product_id; end if;
    if v_delta > 0 and coalesce(v_avail,0) < v_delta then
      raise exception 'Only % more in stock for % — reduce the quantity or add stock first.', coalesce(v_avail,0), coalesce(v_sku,'?');
    end if;
    if v_delta > 0 then
      perform public.bd_deduct_stock(it.product_id, it.variant_id, v_delta, v_sku, 'reserve', 'Held order edited', concat('Qty ', it.qty, ' → ', v_new), p_order_id);
    else
      perform public.bd_add_stock(it.product_id, it.variant_id, -v_delta, v_sku, 'release', 'Held order edited', concat('Qty ', it.qty, ' → ', v_new), p_order_id);
    end if;
  end if;

  select exists(select 1 from stock_adjustments where ref_id = p_order_id and kind = 'sale') into v_touched;
  v_touched := (not v_hold) and (v_touched or coalesce(v_bo,false) = false);
  if v_delta <> 0 and v_touched then
    if it.variant_id is not null then select qty, upper(sku) into v_avail, v_sku from variants where id = it.variant_id;
    else select qty, upper(sku) into v_avail, v_sku from products where id = it.product_id; end if;
    if v_delta > 0 and coalesce(v_avail,0) < v_delta then
      raise exception 'Only % more in stock for % — reduce the quantity or add stock first.', coalesce(v_avail,0), coalesce(v_sku,'?');
    end if;
    if it.variant_id is not null then
      update variants set qty = qty - v_delta where id = it.variant_id;
      update products set qty = (select coalesce(sum(qty),0) from variants where product_id = it.product_id), last_movement_at = now() where id = it.product_id;
    else
      update products set qty = qty - v_delta, last_movement_at = now() where id = it.product_id;
    end if;
    insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
      values (it.product_id, it.variant_id, v_sku, -v_delta,
              case when v_delta > 0 then 'sale' else 'return' end,
              'Bill edited', concat('Qty ', it.qty, ' → ', v_new, ' (bill corrected)'), p_order_id, now());
  end if;
  if v_new = 0 then delete from order_items where id = p_item_id;
  else update order_items set qty = v_new, line_total = v_new_line where id = p_item_id; end if;
  select coalesce(sum(coalesce(line_total, unit_price*qty)),0) into v_total from order_items where order_id = p_order_id;
  select lower(coalesce(channel::text,'')), lower(coalesce(bill_type,'')) into v_channel, v_billtype from orders where id = p_order_id;
  if v_channel = 'wholesale' and v_billtype = 'gst' then v_total := round(v_total * 1.03); end if;
  v_total := v_total + coalesce((select coalesce(extra_packing,0) + coalesce(extra_courier,0) + coalesce(extra_adjustment,0) from orders where id = p_order_id), 0);
  update orders set total = v_total where id = p_order_id;
  if v_touched then
    v_rev_delta := v_new_line - v_old_line;
    if v_rev_delta <> 0 then
      select coalesce(max(balance),0) into v_bal from ledger;
      if v_rev_delta > 0 then
        insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
          values ('sales', p_order_id, 0, v_rev_delta, v_bal + v_rev_delta, 'Bill edited — revenue increased', now());
      else
        insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
          values ('sales', p_order_id, -v_rev_delta, 0, v_bal + v_rev_delta, 'Bill edited — revenue reduced', now());
      end if;
    end if;
  end if;
  insert into audit_log(actor, action, ref, detail)
    values ('owner','order_line_edit', p_order_id::text, concat('item ', p_item_id, ': qty ', it.qty, ' → ', v_new));
  return jsonb_build_object('order_id', p_order_id, 'total', v_total, 'removed', v_new = 0);
end; $function$;

-- Backfill live holds that were placed before this reservation existed (KR52 × 12 sitting un-held).
-- Non-strict: take whatever is on the shelf so the migration never aborts; remaining shortage
-- still shows when they try to confirm.
do $$
declare o record;
begin
  for o in
    select id from orders
    where coalesce(cod_hold, false) = true
      and coalesce(status::text,'') not in ('cancelled','refunded')
    order by created_at
  loop
    perform public.reserve_held_order_stock(o.id, false);
  end loop;
end $$;
