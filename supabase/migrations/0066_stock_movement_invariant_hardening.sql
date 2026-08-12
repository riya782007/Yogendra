-- STOCK-MOVEMENT INVARIANT HARDENING (the rule Yogendra cares about: the movement log always sums to
-- real stock, and stock never goes negative). Four paths could previously floor qty at 0 while recording
-- the FULL requested amount in the ledger — harmless today (nothing is oversold) but a latent drift the
-- moment an oversell/partial happens. Each now records EXACTLY what actually moved. Normal in-stock
-- behaviour is unchanged.
--   1) bd_deduct_stock   — record the applied delta, not the requested qty.
--   2) delete_purchase   — reverse only units still on hand.
--   3) record_purchase_return — cannot return more than physically in stock (guard).
--   4) cancel_order      — put back exactly what is still out (net of sale + prior returns), not billed qty.

create or replace function public.bd_deduct_stock(p_product uuid, p_variant uuid, p_qty integer, p_sku text, p_kind text, p_source text, p_reason text, p_ref uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_vid uuid := p_variant; v_sku text := p_sku; v_old int; v_applied int;
begin
  if v_vid is null then
    select v.id into v_vid from variants v
    where v.product_id = p_product
    order by (v.id = (select default_variant_id from products where id = p_product)) desc nulls last, v.qty desc, v.id
    limit 1;
  end if;
  if v_vid is not null then
    select qty into v_old from variants where id = v_vid;
    v_applied := least(p_qty, greatest(0, coalesce(v_old,0)));
    if v_applied > 0 then update variants set qty = greatest(0, qty - p_qty) where id = v_vid; end if;
    select upper(sku) into v_sku from variants where id = v_vid;
    update products set qty = (select coalesce(sum(qty),0) from variants where product_id = p_product), last_movement_at = now() where id = p_product;
  else
    select qty into v_old from products where id = p_product;
    v_applied := least(p_qty, greatest(0, coalesce(v_old,0)));
    if v_applied > 0 then update products set qty = greatest(0, qty - p_qty), last_movement_at = now() where id = p_product; end if;
  end if;
  if v_applied > 0 then
    insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
      values (p_product, v_vid, coalesce(v_sku, p_sku), -v_applied, p_kind, p_source, p_reason, p_ref, now());
  end if;
  return v_vid;
end $function$;

create or replace function public.delete_purchase(p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare r record; v_total int; v_bal int; v_bill text; v_sku text; v_old int; v_applied int;
begin
  select total, bill_no into v_total, v_bill from purchases where id = p_id;
  if not found then raise exception 'purchase not found'; end if;

  for r in select mapped_product_id, variant_id, qty from purchase_items
           where purchase_id = p_id and mapped_product_id is not null and coalesce(qty,0) > 0 loop
    if r.variant_id is not null then
      select qty into v_old from variants where id = r.variant_id;
      v_applied := least(r.qty, greatest(0, coalesce(v_old,0)));
      if v_applied > 0 then update variants set qty = greatest(0, qty - r.qty) where id = r.variant_id; end if;
      update products set qty = (select coalesce(sum(qty),0) from variants where product_id = r.mapped_product_id),
             last_movement_at = now() where id = r.mapped_product_id;
      select upper(sku) into v_sku from variants where id = r.variant_id;
    else
      select qty into v_old from products where id = r.mapped_product_id;
      v_applied := least(r.qty, greatest(0, coalesce(v_old,0)));
      if v_applied > 0 then update products set qty = greatest(0, qty - r.qty), last_movement_at = now() where id = r.mapped_product_id; end if;
      select upper(sku) into v_sku from products where id = r.mapped_product_id;
    end if;
    if v_applied > 0 then
      insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
        values (r.mapped_product_id, r.variant_id, v_sku, -v_applied, 'purchase_return',
                'Purchase deleted', concat('Purchase bill ', coalesce(v_bill,''), ' deleted — ', v_applied, ' reversed'), p_id, now());
    end if;
  end loop;

  delete from purchase_items where purchase_id = p_id;
  delete from purchases where id = p_id;
  select coalesce(max(balance),0) into v_bal from ledger;
  insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
    values ('purchase', p_id, 0, coalesce(v_total,0), v_bal + coalesce(v_total,0), 'Purchase deleted — stock reversed', now());
  return jsonb_build_object('ok', true, 'reversed', coalesce(v_total,0));
end; $function$;

create or replace function public.record_purchase_return(p_purchase_id uuid, p_reason text, p_items jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_id uuid := uuid_generate_v4(); it jsonb; v_qty int:=0; v_amt int:=0; v_bal int;
        v_prod uuid; v_variant uuid; v_cost int; v_sku text; v_iqty int;
        v_bought int; v_returned int; v_bill text; v_avail int;
begin
  select bill_no into v_bill from purchases where id = p_purchase_id;
  if not found then raise exception 'Purchase not found'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_prod := (it->>'product_id')::uuid;
    v_variant := nullif(it->>'variant_id','')::uuid;
    v_iqty := (it->>'qty')::int;
    if v_iqty is null or v_iqty <= 0 then continue; end if;

    select coalesce(sum(qty),0) into v_bought from purchase_items
      where purchase_id = p_purchase_id and mapped_product_id = v_prod
        and ((v_variant is null and variant_id is null) or variant_id = v_variant);
    select coalesce(sum(abs(delta)),0) into v_returned from stock_adjustments
      where ref_id = p_purchase_id and kind = 'purchase_return' and product_id = v_prod
        and ((v_variant is null and variant_id is null) or variant_id = v_variant);
    if v_bought = 0 then raise exception 'That line is not on this purchase bill (check the variant).'; end if;
    if v_returned + v_iqty > v_bought then
      raise exception 'Only % of % can still be returned to the supplier on this bill (% already returned).',
        greatest(0, v_bought - v_returned), v_bought, v_returned;
    end if;

    -- Physical-stock guard: cannot return pieces that are no longer on hand (already sold).
    if v_variant is not null then select qty into v_avail from variants where id = v_variant;
    else select qty into v_avail from products where id = v_prod; end if;
    if coalesce(v_avail,0) < v_iqty then
      raise exception 'Only % in stock to return for this item — you tried to return %. Sold pieces cannot be sent back.', coalesce(v_avail,0), v_iqty;
    end if;

    select unit_cost into v_cost from purchase_items
      where purchase_id = p_purchase_id and mapped_product_id = v_prod
        and ((v_variant is null and variant_id is null) or variant_id = v_variant) limit 1;
    if v_cost is null then
      select unit_cost into v_cost from purchase_items where purchase_id = p_purchase_id and mapped_product_id = v_prod limit 1;
    end if;

    if v_variant is not null then
      update variants set qty = qty - v_iqty where id = v_variant;
      update products set qty = (select coalesce(sum(qty),0) from variants where product_id = v_prod), last_movement_at = now() where id = v_prod;
      select upper(sku) into v_sku from variants where id = v_variant;
    else
      update products set qty = qty - v_iqty, last_movement_at = now() where id = v_prod;
      select upper(sku) into v_sku from products where id = v_prod;
    end if;

    v_qty := v_qty + v_iqty;
    v_amt := v_amt + coalesce(v_cost,0) * v_iqty;
    insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, return_id, created_at)
      values (v_prod, v_variant, v_sku, -v_iqty, 'purchase_return', 'Purchase return',
              concat('Returned ', v_iqty, ' to supplier', case when coalesce(v_bill,'') <> '' then concat(' (bill ', v_bill, ')') else '' end, coalesce(' — ' || nullif(p_reason,''), '')), p_purchase_id, v_id, now());
  end loop;

  if v_qty = 0 then raise exception 'Nothing to return.'; end if;

  insert into returns(id, kind, ref_order_id, reason, qty, amount, created_at)
    values (v_id, 'purchase', p_purchase_id, p_reason, v_qty, v_amt, now());
  select coalesce(max(balance),0) into v_bal from ledger;
  insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
    values ('purchase', v_id, 0, v_amt, v_bal + v_amt, concat('Purchase return (debit note): ', coalesce(p_reason,'')), now());
  insert into audit_log(actor, action, ref, detail) values('staff','purchase_return', v_id::text, concat(coalesce(p_reason,''), ' · ₹', (v_amt/100)::text));
  return jsonb_build_object('return_id', v_id, 'qty', v_qty, 'amount', v_amt);
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

  select exists(select 1 from stock_adjustments where ref_id = p_order_id and kind = 'sale') into v_deducted;
  if not v_deducted then
    update orders set status = 'cancelled', is_backorder = false, cod_hold = false where id = p_order_id;
    insert into audit_log(actor, action, ref, detail)
      values ('owner','order_cancel', p_order_id::text, coalesce(p_reason,'') || ' (no stock/revenue moved — nothing to restock)');
    return jsonb_build_object('order_id', p_order_id, 'no_restock', true, 'amount', 0);
  end if;

  -- Put back exactly what is STILL out per product/variant: net = sale (negative) + any prior returns.
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
