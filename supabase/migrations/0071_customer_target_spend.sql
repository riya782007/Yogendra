-- Point every unlinked (or same-name duplicate) bill at the directory customer promotional
-- targeting uses, so a ₹46,000 "Pooja Fashion" invoice counts in this month's spend.

-- 1) Phone last-10
update public.orders o
set customer_id = c.id
from public.customers c
where o.customer_id is null
  and length(regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g')) >= 10
  and length(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')) >= 10
  and right(regexp_replace(o.customer_phone, '\D', '', 'g'), 10)
      = right(regexp_replace(c.phone, '\D', '', 'g'), 10);

-- 2) Unique firm name (whitespace-insensitive) when still unlinked
update public.orders o
set customer_id = c.id
from public.customers c
where o.customer_id is null
  and o.customer_name is not null
  and btrim(o.customer_name) <> ''
  and lower(regexp_replace(btrim(o.customer_name), '\s+', ' ', 'g'))
      = lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g'))
  and (
    select count(*) from public.customers c2
    where lower(regexp_replace(btrim(c2.name), '\s+', ' ', 'g'))
        = lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g'))
  ) = 1;
