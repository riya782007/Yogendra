-- One customer row per person. POS used to INSERT a new retail row on every no-phone bill
-- (The Opal Factory × 3). Merge existing same-name copies, then stop a second no-phone row
-- for the same name. Cancelled bills are excluded from sales in application queries.

-- Re-point orders/quotes onto one keeper per name (wholesale preferred), drop extras.
select public.merge_duplicate_customers(null);

create unique index if not exists customers_one_nameless_phone
  on public.customers (lower(btrim(name)))
  where phone is null or btrim(phone) = '';
