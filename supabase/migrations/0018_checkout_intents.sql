-- Pillar 9/online payments — make UPI/Razorpay payments un-loseable.
--
-- Problem: with UPI the customer is bounced to their UPI app (GPay/PhonePe) to approve,
-- then bounced back to the site. If they approve but close the tab / lose network before
-- returning, Razorpay has CAPTURED the money (payment_capture: 1) but our browser-side
-- handler never runs, so the order is never recorded. "Paid but no order."
--
-- Fix: when checkout starts we persist the cart + customer + amount against the Razorpay
-- order id as a "checkout intent". The Razorpay WEBHOOK (server-to-server, fires even if
-- the customer's tab is gone) can then look it up and place the order. Both the browser
-- handler and the webhook funnel through one finaliser that claims the intent first, so an
-- order is placed exactly once.

create table if not exists public.checkout_intents (
  id uuid primary key default uuid_generate_v4(),
  razorpay_order_id text not null unique,
  items jsonb not null,                 -- [{sku, qty, color?}]
  customer jsonb not null,              -- {name, phone, address, pincode?, city?}
  amount integer not null,              -- paise, server-authoritative (items + shipping)
  status text not null default 'pending',  -- pending | placing | placed
  order_id uuid references public.orders(id),
  payment_ref text,                     -- razorpay payment id once captured
  created_at timestamptz not null default now(),
  placed_at timestamptz
);

create index if not exists idx_checkout_intents_status on public.checkout_intents(status);

do $$ begin
  alter table public.checkout_intents add constraint checkout_intents_status_chk
    check (status in ('pending','placing','placed'));
exception when duplicate_object then null; end $$;

-- All access is via the service-role client (server actions + the webhook route), which
-- bypasses RLS. Enable RLS with NO public policies so the anon/browser key can never read
-- customer details or carts.
alter table public.checkout_intents enable row level security;
