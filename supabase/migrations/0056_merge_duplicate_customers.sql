-- Merge same-name customer duplicates into one (marketplace automations create a fresh "Myntra"/"Meesho"
-- customer per order; this cleans them). Keeps ONE record per name — prefer a wholesale one, else the one
-- with the most orders, else the oldest — re-points every order + quote onto it (no sale lost), deletes
-- the extras. p_name scopes to a single name; NULL merges every duplicate-name group.
create or replace function public.merge_duplicate_customers(p_name text default null)
returns jsonb language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $function$
declare g record; keeper uuid; groups int := 0; removed int := 0;
begin
  for g in
    select lower(btrim(name)) as lname, count(*) as n
    from customers
    where name is not null and btrim(name) <> ''
      and (p_name is null or lower(btrim(name)) = lower(btrim(p_name)))
    group by lower(btrim(name))
    having count(*) > 1
  loop
    select c.id into keeper
    from customers c
    where lower(btrim(c.name)) = g.lname
    order by (c.type = 'wholesale') desc,
             (select count(*) from orders o where o.customer_id = c.id) desc,
             c.created_at asc
    limit 1;
    if keeper is null then continue; end if;

    update orders set customer_id = keeper
      where customer_id in (select id from customers where lower(btrim(name)) = g.lname and id <> keeper);
    update wholesale_quote_requests set customer_id = keeper
      where customer_id in (select id from customers where lower(btrim(name)) = g.lname and id <> keeper);
    delete from customers where lower(btrim(name)) = g.lname and id <> keeper;

    groups := groups + 1;
    removed := removed + (g.n - 1);
  end loop;
  return jsonb_build_object('groups', groups, 'removed', removed);
end $function$;
