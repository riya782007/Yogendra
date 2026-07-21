-- Blythe Diva / Yogendra Industries — initial schema (Part E.3)
-- Postgres + RLS. Money columns are integer paise.

create extension if not exists "uuid-ossp";
-- pgvector optional; embeddings nullable so demo runs without it.
-- create extension if not exists vector;

-- ---------- enums ----------
do $$ begin
  create type product_type as enum ('simple','configurable');
exception when duplicate_object then null; end $$;
do $$ begin
  create type product_status as enum ('draft','published','flagged');
exception when duplicate_object then null; end $$;
do $$ begin
  create type order_channel as enum ('retail','wholesale','pos');
exception when duplicate_object then null; end $$;
do $$ begin
  create type estimate_status as enum ('open','converted','expired');
exception when duplicate_object then null; end $$;
do $$ begin
  create type return_kind as enum ('sales','purchase');
exception when duplicate_object then null; end $$;
do $$ begin
  create type ledger_kind as enum ('sales','purchase','cash','bank');
exception when duplicate_object then null; end $$;
do $$ begin
  create type approval_status as enum ('pending','approved','rejected');
exception when duplicate_object then null; end $$;
do $$ begin
  create type notify_channel as enum ('whatsapp','sms','email','in_app');
exception when duplicate_object then null; end $$;
do $$ begin
  create type notify_status as enum ('sent','acked','escalated');
exception when duplicate_object then null; end $$;

-- ---------- catalogue ----------
create table if not exists categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists suppliers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  city text,
  created_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default uuid_generate_v4(),
  category_id uuid not null references categories(id),
  sku text not null unique,
  name text not null,
  type product_type not null default 'simple',
  base_wholesale integer not null,            -- paise
  qty integer not null default 0,
  status product_status not null default 'draft',
  generated_content jsonb,                    -- {title,description,specs,tags,seo}
  embedding jsonb,                            -- vector placeholder (jsonb until pgvector enabled)
  last_movement_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_products_category on products(category_id);
create index if not exists idx_products_status on products(status);

create table if not exists variants (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id) on delete cascade,
  color text,
  sku text not null unique,
  qty integer not null default 0,
  image_paths text[] default '{}'
);
create index if not exists idx_variants_product on variants(product_id);

create table if not exists product_images (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id) on delete cascade,
  path text not null,
  kind text,                                  -- model|flatlay|closeup|angle
  sort int not null default 0
);
create index if not exists idx_images_product on product_images(product_id);

create table if not exists pricing_settings (
  id uuid primary key default uuid_generate_v4(),
  wholesale_markup_pct numeric not null default 10,
  retail_multiplier numeric not null default 2.2,
  mrp_multiplier numeric not null default 2.75,
  round_to integer not null default 100,      -- paise
  updated_at timestamptz not null default now()
);

-- ---------- commerce ----------
create table if not exists retailers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  city text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default uuid_generate_v4(),
  channel order_channel not null,
  retailer_id uuid references retailers(id),
  status text not null default 'completed',
  total integer not null default 0,           -- paise
  payment_mode text,                          -- cod|online|cash|upi
  created_at timestamptz not null default now()
);
create index if not exists idx_orders_created on orders(created_at);
create index if not exists idx_orders_channel on orders(channel);

create table if not exists order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id),
  variant_id uuid references variants(id),
  qty integer not null,
  unit_price integer not null,                -- paise
  line_total integer not null                 -- paise
);

create table if not exists purchases (
  id uuid primary key default uuid_generate_v4(),
  supplier_id uuid references suppliers(id),
  bill_no text,
  total integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists purchase_items (
  id uuid primary key default uuid_generate_v4(),
  purchase_id uuid not null references purchases(id) on delete cascade,
  supplier_sku text,
  mapped_product_id uuid references products(id),
  qty integer not null,
  unit_cost integer not null
);

create table if not exists estimates (
  id uuid primary key default uuid_generate_v4(),
  customer_name text,
  total integer not null default 0,
  status estimate_status not null default 'open',
  created_at timestamptz not null default now()
);
create table if not exists estimate_items (
  id uuid primary key default uuid_generate_v4(),
  estimate_id uuid not null references estimates(id) on delete cascade,
  product_id uuid references products(id),
  qty integer not null,
  unit_price integer not null,
  line_total integer not null
);

create table if not exists returns (
  id uuid primary key default uuid_generate_v4(),
  kind return_kind not null,
  ref_order_id uuid references orders(id),
  ref_purchase_id uuid references purchases(id),
  reason text,
  qty integer not null,
  created_at timestamptz not null default now()
);

create table if not exists ledger (
  id uuid primary key default uuid_generate_v4(),
  kind ledger_kind not null,
  ref_id uuid,
  debit integer not null default 0,
  credit integer not null default 0,
  balance integer not null default 0,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ledger_created on ledger(created_at);

-- ---------- RBAC + approvals ----------
create table if not exists roles (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  permissions text[] not null default '{}'
);
create table if not exists user_roles (
  user_id uuid not null,
  role_id uuid not null references roles(id) on delete cascade,
  primary key (user_id, role_id)
);
create table if not exists approvals (
  id uuid primary key default uuid_generate_v4(),
  action text not null,
  payload jsonb,
  status approval_status not null default 'pending',
  otp_hash text,
  requested_by uuid,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- ---------- human-in-the-loop + agents ----------
create table if not exists contacts (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  whatsapp text,
  phone text,
  email text,
  in_app_user_id uuid
);
create table if not exists assignments (
  id uuid primary key default uuid_generate_v4(),
  responsibility text not null,
  assigned_contact_id uuid references contacts(id),
  backup_contact_id uuid references contacts(id),
  channel notify_channel not null default 'in_app',
  sla_minutes integer not null default 30
);
create table if not exists notifications (
  id uuid primary key default uuid_generate_v4(),
  assignment_id uuid references assignments(id),
  contact_id uuid references contacts(id),
  channel notify_channel,
  subject text,
  deep_link text,
  status notify_status not null default 'sent',
  sent_at timestamptz not null default now(),
  acked_at timestamptz,
  escalated_at timestamptz
);
create table if not exists audit_log (
  id uuid primary key default uuid_generate_v4(),
  at timestamptz not null default now(),
  actor text,
  action text,
  ref text,
  detail text
);
create table if not exists agent_runs (
  id uuid primary key default uuid_generate_v4(),
  agent text not null,
  trigger text,
  input jsonb,
  output jsonb,
  confidence numeric,
  needs_human boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists ai_calls (
  id uuid primary key default uuid_generate_v4(),
  feature text,
  provider text,
  latency_ms integer,
  tokens integer,
  cache_hit boolean default false,
  fallback_used boolean default false,
  created_at timestamptz not null default now()
);

-- ---------- marketing / analytics ----------
create table if not exists reels (
  id uuid primary key default uuid_generate_v4(),
  ig_id text,
  caption text,
  video_url text,
  posted_at timestamptz
);
create table if not exists reel_products (
  reel_id uuid references reels(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  primary key (reel_id, product_id)
);
create table if not exists ga_events (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  params jsonb,
  sent_server_side boolean default false,
  created_at timestamptz not null default now()
);
create table if not exists gbp_state (
  id uuid primary key default uuid_generate_v4(),
  primary_category text,
  hours jsonb,
  last_synced_at timestamptz
);

-- ---------- RLS ----------
alter table products enable row level security;
alter table categories enable row level security;
alter table variants enable row level security;
alter table product_images enable row level security;

-- storefronts can read PUBLISHED products + their categories/variants/images.
do $$ begin
  create policy "public reads published products" on products
    for select using (status = 'published');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "public reads categories" on categories for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "public reads variants of published" on variants
    for select using (exists (select 1 from products p where p.id = variants.product_id and p.status = 'published'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "public reads images of published" on product_images
    for select using (exists (select 1 from products p where p.id = product_images.product_id and p.status = 'published'));
exception when duplicate_object then null; end $$;
-- NOTE: all writes + admin reads go through the service role / authed staff checks
-- enforced in server actions (see lib/notify + RBAC). Tighten per-role in Phase 2.3.
