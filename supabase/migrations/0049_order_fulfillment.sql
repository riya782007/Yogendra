-- 0049 — storefront order handling: owner ACCEPTS or REJECTS website orders in /admin/orders.
alter table public.orders add column if not exists fulfillment text; -- null=new, 'accepted', 'rejected'
