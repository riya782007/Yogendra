-- 0019 — "Sell with us" intake: products submitted BY customers (storefront) and
-- approved wholesalers (trade panel). Submissions land here as 'pending' and are reviewed
-- in the admin console; on approval they become a DRAFT product in the catalogue.
--
-- Money columns are integer paise (store convention). Reuses the approval_status enum
-- (pending|approved|rejected) created in 0001_init.sql.

create table if not exists public.product_submissions (
  id uuid primary key default uuid_generate_v4(),
  channel text not null default 'retail',          -- 'retail' (storefront) | 'wholesale' (trade panel)
  -- Submitter identity. submitter_customer_id is set (no FK, to stay decoupled from the CRM
  -- customers table) when an approved wholesaler submits while logged in.
  submitter_customer_id uuid,
  submitter_name text,
  submitter_phone text,
  submitter_email text,
  -- The proposed product.
  product_name text not null,
  category_id uuid references categories(id),
  category_other text,                             -- free-text category hint when not in the list
  description text,
  color text,
  asking_price integer,                            -- paise — the price the seller is asking
  qty integer not null default 0,
  image_path text,                                 -- public URL in the product-media bucket
  -- Review workflow.
  status approval_status not null default 'pending',
  review_note text,
  created_product_sku text,                        -- SKU of the catalogue product created on approval
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists idx_product_submissions_status on public.product_submissions(status);
create index if not exists idx_product_submissions_created on public.product_submissions(created_at desc);

alter table public.product_submissions enable row level security;
-- Anyone (anon storefront visitor or logged-in wholesaler) may SUBMIT a product.
-- All reads and review decisions go through the service-role client in server actions.
drop policy if exists product_submissions_insert on public.product_submissions;
create policy product_submissions_insert on public.product_submissions for insert with check (true);
