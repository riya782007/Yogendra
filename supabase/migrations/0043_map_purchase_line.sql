-- Map a previously-unmapped purchase line to a product (and optional variant), applying the stock
-- that was never added at purchase time. Money is untouched (the bill total already counted this line).
-- Idempotent: mapping an already-mapped line does nothing (prevents double-adding stock).
create or replace function public.map_purchase_line(p_line_id uuid, p_product uuid, p_variant uuid default null)
  returns jsonb
  language plpgsql
  security definer
as $function$
declare v_qty int; v_cost int; v_existing uuid; v_bill text; v_prod uuid := p_product; v_var uuid := p_variant;
begin
  select pi.qty, pi.unit_cost, pi.mapped_product_id, p.bill_no
    into v_qty, v_cost, v_existing, v_bill
    from purchase_items pi join purchases p on p.id = pi.purchase_id
    where pi.id = p_line_id;
  if v_qty is null then raise exception 'Purchase line not found'; end if;
  if v_existing is not null then
    return jsonb_build_object('line_id', p_line_id, 'already', true);
  end if;
  if v_var is not null then select product_id into v_prod from variants where id = v_var; end if;
  if v_prod is null then raise exception 'Choose a product to map to'; end if;

  update purchase_items set mapped_product_id = v_prod, variant_id = v_var where id = p_line_id;

  if v_var is not null then
    update variants set qty = qty + v_qty where id = v_var;
    update products set qty = (select coalesce(sum(qty),0) from variants where product_id = v_prod), last_movement_at = now() where id = v_prod;
  else
    update products set qty = qty + v_qty, last_movement_at = now() where id = v_prod;
  end if;

  insert into stock_adjustments(product_id, variant_id, delta, kind, source, reason, ref_id, created_at)
    values (v_prod, v_var, v_qty, 'purchase', concat('Purchase ', coalesce(nullif(v_bill,''),'(no bill no)'), ' — mapped later'),
            concat('Mapped ', v_qty, ' @ Rs', (v_cost/100)::text), (select purchase_id from purchase_items where id = p_line_id), now());

  return jsonb_build_object('line_id', p_line_id, 'qty', v_qty, 'product', v_prod);
end; $function$;
