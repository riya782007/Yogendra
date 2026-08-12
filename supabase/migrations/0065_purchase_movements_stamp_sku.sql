-- STOCK-MOVEMENT LOG HYGIENE. Every movement row must carry the SKU it belongs to, so the owner can
-- filter the movement history by any SKU/variant and see EVERY in/out — including stock-in from
-- purchases. The two purchase paths (record_purchase, map_purchase_line) were the only functions that
-- inserted stock_adjustments without a sku, leaving purchase-in rows blank in the per-SKU log. This
-- patch resolves the sku from the variant (or product) and stamps it, exactly like every other path.
-- (Existing blank rows were backfilled once from their linked variant/product in the same change.)

create or replace function public.record_purchase(p_supplier_id uuid, p_bill_no text, p_items jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_id uuid := uuid_generate_v4(); it jsonb; v_total int:=0; v_line int; v_bal int; v_mapped uuid; v_variant uuid; v_qadd int; v_sku text;
begin
  insert into purchases(id, supplier_id, bill_no, total, created_at) values (v_id, p_supplier_id, p_bill_no, 0, now());
  for it in select * from jsonb_array_elements(p_items) loop
    v_qadd := (it->>'qty')::int;
    v_line := (it->>'unit_cost')::int * v_qadd;
    v_total := v_total + v_line;
    v_mapped := nullif(it->>'mapped_product_id','')::uuid;
    v_variant := nullif(it->>'variant_id','')::uuid;
    if v_variant is not null then select product_id into v_mapped from variants where id = v_variant; end if;
    insert into purchase_items(purchase_id, supplier_sku, mapped_product_id, variant_id, qty, unit_cost)
      values (v_id, it->>'supplier_sku', v_mapped, v_variant, v_qadd, (it->>'unit_cost')::int);
    if v_variant is not null then
      update variants set qty = qty + v_qadd where id = v_variant;
      update products set qty = (select coalesce(sum(qty),0) from variants where product_id = v_mapped), last_movement_at = now() where id = v_mapped;
    elsif v_mapped is not null then
      update products set qty = qty + v_qadd, last_movement_at = now() where id = v_mapped;
    end if;
    if v_mapped is not null then
      -- Stamp the SKU so this stock-in shows up in the item's movement history.
      if v_variant is not null then select upper(sku) into v_sku from variants where id = v_variant;
      else select upper(sku) into v_sku from products where id = v_mapped; end if;
      insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
        values (v_mapped, v_variant, v_sku, v_qadd, 'purchase', concat('Purchase ', coalesce(nullif(p_bill_no,''),'(no bill no)')),
                concat('Bought ', v_qadd, ' @ ₹', ((it->>'unit_cost')::int/100)::text), v_id, now());
    end if;
  end loop;
  update purchases set total = v_total where id = v_id;
  select coalesce(max(balance),0) into v_bal from ledger;
  insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
    values('purchase', v_id, v_total, 0, v_bal - v_total, concat('Purchase bill ', coalesce(p_bill_no,'')), now());
  return jsonb_build_object('purchase_id', v_id, 'total', v_total);
end; $function$;

create or replace function public.map_purchase_line(p_line_id uuid, p_product uuid, p_variant uuid default null::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_qty int; v_cost int; v_existing uuid; v_bill text; v_prod uuid := p_product; v_var uuid := p_variant; v_sku text;
begin
  select pi.qty, pi.unit_cost, pi.mapped_product_id, p.bill_no
    into v_qty, v_cost, v_existing, v_bill
    from purchase_items pi join purchases p on p.id = pi.purchase_id
    where pi.id = p_line_id;
  if v_qty is null then raise exception 'Purchase line not found'; end if;
  if v_existing is not null then
    return jsonb_build_object('line_id', p_line_id, 'already', true);
  end if;
  -- If a variant was chosen, its product wins.
  if v_var is not null then select product_id into v_prod from variants where id = v_var; end if;
  if v_prod is null then raise exception 'Choose a product to map to'; end if;

  update purchase_items set mapped_product_id = v_prod, variant_id = v_var where id = p_line_id;

  if v_var is not null then
    update variants set qty = qty + v_qty where id = v_var;
    update products set qty = (select coalesce(sum(qty),0) from variants where product_id = v_prod), last_movement_at = now() where id = v_prod;
  else
    update products set qty = qty + v_qty, last_movement_at = now() where id = v_prod;
  end if;

  -- Stamp the SKU so this mapped stock-in shows up in the item's movement history.
  if v_var is not null then select upper(sku) into v_sku from variants where id = v_var;
  else select upper(sku) into v_sku from products where id = v_prod; end if;

  insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
    values (v_prod, v_var, v_sku, v_qty, 'purchase', concat('Purchase ', coalesce(nullif(v_bill,''),'(no bill no)'), ' — mapped later'),
            concat('Mapped ', v_qty, ' @ Rs', (v_cost/100)::text), (select purchase_id from purchase_items where id = p_line_id), now());

  return jsonb_build_object('line_id', p_line_id, 'qty', v_qty, 'product', v_prod);
end; $function$;
