-- WHOLESALE GST bills carry the 3% GST INSIDE orders.total (wholesale line rates are pre-tax; the order
-- flow adds 3% to the goods — total_goods = items × 1.03). But add_order_line / edit_order_line rebuilt the
-- total as sum(lines)+charges, which STRIPPED that 3% whenever a wholesale bill was edited — so a ₹4,815
-- bill printed ₹5,235 instead of ₹5,379 (owner's "calculation error"). Re-apply the wholesale-GST markup
-- on recompute so an edit can never silently drop the GST. Retail/cash bills are unaffected (their prices
-- already include GST, so no markup is applied). Data repair for the one affected bill (YII/2026-27/0232)
-- was applied separately.

create or replace function public.add_order_line(p_order_id uuid, p_product_id uuid, p_variant_id uuid, p_qty integer, p_unit_price integer, p_unit_mrp bigint default null::bigint, p_allow_oversell boolean default false)
 returns json language plpgsql as $function$
declare
  v_qty integer := greatest(1, coalesce(p_qty, 1));
  v_price integer := greatest(0, coalesce(p_unit_price, 0));
  v_sku text; v_have integer; v_charges integer; v_items integer; v_total integer; v_backorder boolean;
  v_channel text; v_billtype text;
begin
  if p_order_id is null or p_product_id is null then raise exception 'Missing bill or product'; end if;
  select coalesce(is_backorder, false) into v_backorder from orders where id = p_order_id;
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
  if not v_backorder then
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
  v_status text; v_bo boolean; v_touched boolean;
  it record; v_new int; v_delta int; v_sku text; v_avail int;
  v_old_line int; v_new_line int; v_rev_delta int; v_total int; v_bal int;
  v_channel text; v_billtype text;
begin
  select status, is_backorder into v_status, v_bo from orders where id = p_order_id;
  if v_status is null then raise exception 'Order not found'; end if;
  if v_status in ('cancelled','refunded') then raise exception 'This bill is cancelled — nothing to edit.'; end if;
  select product_id, variant_id, qty, unit_price, coalesce(line_total, unit_price*qty) as line_total
    into it from order_items where id = p_item_id and order_id = p_order_id;
  if it.product_id is null then raise exception 'Line not found on this bill'; end if;
  v_new := greatest(0, coalesce(p_new_qty, 0));
  v_delta := v_new - it.qty;
  v_old_line := coalesce(it.line_total, 0);
  v_new_line := it.unit_price * v_new;
  select exists(select 1 from stock_adjustments where ref_id = p_order_id and kind = 'sale') into v_touched;
  v_touched := v_touched or coalesce(v_bo,false) = false;
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
