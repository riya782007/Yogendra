-- Live availability for a cart, using the SAME variant resolution as place_order, so the checkout can drop
-- an item that has gone out of stock (owner: "cart se product disappear ho jaye jab order place kare").
-- Returns one row per input item (in order): the qty currently sellable for the exact variant that would
-- be sold. A no-colour line reports the best IN-STOCK colour's qty (what place_order would sell).
create or replace function public.cart_availability(p_items jsonb)
 returns table(idx int, sku text, color text, available int)
 language plpgsql stable
 set search_path to 'public','extensions','pg_temp'
as $function$
declare it jsonb; i int := 0; r record; v_avail int;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    v_avail := 0;
    select * into r from resolve_sku(it->>'sku');
    if r.product_id is not null then
      if r.variant_id is null and exists(select 1 from variants v where v.product_id = r.product_id) then
        if coalesce(it->>'color','') <> '' then
          select v.qty into v_avail from variants v
          where v.product_id = r.product_id
            and ( lower(v.color) = lower(it->>'color')
               or lower(v.color) = lower(split_part(it->>'color', ' · ', 1)) )
          order by (lower(v.color) = lower(it->>'color')) desc
          limit 1;
        else
          select v.qty into v_avail from variants v
          where v.product_id = r.product_id
          order by (v.qty > 0) desc, (v.id = (select default_variant_id from products where id = r.product_id)) desc nulls last, v.qty desc, v.id
          limit 1;
        end if;
        v_avail := coalesce(v_avail, 0);
      else
        v_avail := coalesce(r.avail, 0);
      end if;
    end if;
    idx := i; sku := it->>'sku'; color := it->>'color'; available := coalesce(v_avail, 0);
    return next;
    i := i + 1;
  end loop;
end; $function$;
