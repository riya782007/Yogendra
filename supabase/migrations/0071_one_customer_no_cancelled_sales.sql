-- One customer row per person. POS used to INSERT a new retail row on every no-phone bill
-- (The Opal Factory × 3). Merge existing copies, then lock the table so a second row cannot
-- be inserted. Cancelled bills are excluded from sales in application queries.

create or replace function public.merge_duplicate_customers(p_name text default null)
returns jsonb language plpgsql security definer set search_path to 'public','extensions','pg_temp'
as $function$
declare g record; keeper uuid; groups int := 0; removed int := 0;
begin
  -- Same name (whitespace-insensitive), e.g. The Opal Factory × 3 with no phone.
  for g in
    select lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) as lname, count(*) as n
    from customers
    where name is not null and btrim(name) <> ''
      and (p_name is null or lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
           = lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g')))
    group by 1
    having count(*) > 1
  loop
    select c.id into keeper
    from customers c
    where lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) = g.lname
    order by (c.type = 'wholesale') desc,
             (select count(*) from orders o where o.customer_id = c.id) desc,
             c.created_at asc
    limit 1;
    if keeper is null then continue; end if;

    update orders set customer_id = keeper
      where customer_id in (select id from customers where lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = g.lname and id <> keeper);
    update wholesale_quote_requests set customer_id = keeper
      where customer_id in (select id from customers where lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = g.lname and id <> keeper);
    delete from customers where lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = g.lname and id <> keeper;

    groups := groups + 1;
    removed := removed + (g.n - 1);
  end loop;

  -- Same last-10 phone digits (9876543210 vs +91 98765 43210).
  for g in
    select right(regexp_replace(phone, '\D', '', 'g'), 10) as p10, count(*) as n
    from customers
    where length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 10
      and p_name is null
    group by 1
    having count(*) > 1
  loop
    select c.id into keeper
    from customers c
    where right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = g.p10
    order by (c.type = 'wholesale') desc,
             (select count(*) from orders o where o.customer_id = c.id) desc,
             c.created_at asc
    limit 1;
    if keeper is null then continue; end if;

    update orders set customer_id = keeper
      where customer_id in (
        select id from customers
        where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = g.p10 and id <> keeper);
    update wholesale_quote_requests set customer_id = keeper
      where customer_id in (
        select id from customers
        where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = g.p10 and id <> keeper);
    delete from customers
      where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = g.p10 and id <> keeper;

    groups := groups + 1;
    removed := removed + (g.n - 1);
  end loop;

  return jsonb_build_object('groups', groups, 'removed', removed);
end $function$;

select public.merge_duplicate_customers(null);

drop index if exists public.customers_one_nameless_phone;
create unique index if not exists customers_one_nameless_phone
  on public.customers (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')))
  where phone is null or btrim(phone) = '';

drop index if exists public.customers_one_phone_last10;
create unique index if not exists customers_one_phone_last10
  on public.customers (right(regexp_replace(phone, '\D', '', 'g'), 10))
  where length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 10;
