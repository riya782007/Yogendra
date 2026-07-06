-- Blythe Diva — 0037: Employees (salespeople) + sales attribution.
--
-- The owner wants to (a) keep a roster of employees, and (b) at billing, record WHICH employee
-- dealt with the customer, so sales accumulate per employee for performance-based rewards.
-- Idempotent.

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  title text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Every order can be attributed to the salesperson who rang it up (nullable — legacy orders + online).
alter table public.orders add column if not exists sales_employee_id uuid references public.employees(id) on delete set null;

create index if not exists idx_orders_sales_employee on public.orders(sales_employee_id);
-- Speeds up per-customer spend-in-period rollups used for promotional targeting on the Customers page.
create index if not exists idx_orders_customer_created on public.orders(customer_id, created_at);
