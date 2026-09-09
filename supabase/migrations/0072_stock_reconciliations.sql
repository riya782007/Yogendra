-- Append-only physical stock counts. This is deliberately additive: sales, purchases and
-- existing stock_adjustments retain their current behavior.
create table if not exists public.stock_reconciliations (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid references public.variants(id) on delete restrict,
  stock_adjustment_id uuid not null unique references public.stock_adjustments(id) on delete restrict,
  sku text not null,
  system_qty integer not null check (system_qty >= 0),
  physical_qty integer not null check (physical_qty >= 0),
  delta integer not null check (delta <> 0),
  reason text not null check (reason in ('damage','loss','supplier_shortage','found_stock','expiry','recount','other')),
  note text,
  unit_cost integer not null check (unit_cost >= 0),
  inventory_value_impact integer not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  reversed_by uuid unique references public.stock_reconciliations(id) on delete restrict,
  check (delta = physical_qty - system_qty),
  check (inventory_value_impact = delta * unit_cost)
);

-- This audit record is admin-only. The server-side Supabase client retains access.
alter table public.stock_reconciliations enable row level security;

create index if not exists idx_stock_reconciliations_created on public.stock_reconciliations(created_at desc);
create index if not exists idx_stock_reconciliations_product on public.stock_reconciliations(product_id, created_at desc);

-- One transaction: lock the counted item, reject a stale count, apply stock, write the existing
-- movement ledger and write the immutable financial reconciliation record together.
create or replace function public.record_stock_reconciliation(
  p_product_id uuid,
  p_variant_id uuid,
  p_expected_qty integer,
  p_physical_qty integer,
  p_reason text,
  p_note text default null,
  p_actor text default 'owner'
) returns public.stock_reconciliations
language plpgsql
set search_path to public
as $function$
declare
  v_product products%rowtype;
  v_variant variants%rowtype;
  v_system_qty integer;
  v_delta integer;
  v_sku text;
  v_cost integer;
  v_adjustment_id uuid;
  v_row stock_reconciliations%rowtype;
begin
  if p_physical_qty is null or p_physical_qty < 0 then raise exception 'Physical quantity must be zero or greater'; end if;
  if p_reason not in ('damage','loss','supplier_shortage','found_stock','expiry','recount','other') then raise exception 'Choose a valid reconciliation reason'; end if;

  select * into v_product from products where id = p_product_id for update;
  if not found then raise exception 'Product no longer exists'; end if;

  if p_variant_id is not null then
    select * into v_variant from variants where id = p_variant_id and product_id = p_product_id for update;
    if not found then raise exception 'Variant does not belong to this product'; end if;
    v_system_qty := coalesce(v_variant.qty, 0);
    v_sku := upper(coalesce(v_variant.sku, v_product.sku));
  elsif exists (select 1 from variants where product_id = p_product_id) then
    raise exception 'Count a specific variant for configurable products';
  else
    v_system_qty := coalesce(v_product.qty, 0);
    v_sku := upper(v_product.sku);
  end if;

  if p_expected_qty is distinct from v_system_qty then
    raise exception 'Stock changed from % to % while counting. Refresh and recount.', p_expected_qty, v_system_qty;
  end if;
  v_delta := p_physical_qty - v_system_qty;
  if v_delta = 0 then raise exception 'Physical count already matches system stock'; end if;

  select coalesce(round(sum(pi.unit_cost * pi.qty)::numeric / nullif(sum(pi.qty), 0)), 0)::integer
    into v_cost
    from purchase_items pi
   where pi.mapped_product_id = p_product_id;

  if p_variant_id is not null then
    update variants set qty = p_physical_qty where id = p_variant_id;
    update products set qty = (select coalesce(sum(qty), 0) from variants where product_id = p_product_id), last_movement_at = now() where id = p_product_id;
  else
    update products set qty = p_physical_qty, last_movement_at = now() where id = p_product_id;
  end if;

  insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, created_by)
  values (p_product_id, p_variant_id, v_sku, v_delta, 'recount', 'Physical stock count',
          concat('Physical ', p_physical_qty, ' vs system ', v_system_qty, ' · ', p_reason,
                 case when nullif(trim(coalesce(p_note, '')), '') is null then '' else ' · ' || trim(p_note) end), p_actor)
  returning id into v_adjustment_id;

  insert into stock_reconciliations(product_id, variant_id, stock_adjustment_id, sku, system_qty, physical_qty, delta, reason, note, unit_cost, inventory_value_impact, created_by)
  values (p_product_id, p_variant_id, v_adjustment_id, v_sku, v_system_qty, p_physical_qty, v_delta, p_reason, nullif(trim(p_note), ''), v_cost, v_delta * v_cost, p_actor)
  returning * into v_row;
  return v_row;
end; $function$;

-- Audit rows cannot be rewritten or erased. A future correction must be a new count, preserving
-- the original evidence and its cost snapshot.
create or replace function public.prevent_stock_reconciliation_mutation()
returns trigger language plpgsql set search_path to public as $function$
begin
  raise exception 'Stock reconciliation records are immutable; record a new physical count instead';
end; $function$;

drop trigger if exists trg_stock_reconciliations_immutable on public.stock_reconciliations;
create trigger trg_stock_reconciliations_immutable
  before update or delete on public.stock_reconciliations
  for each row execute function public.prevent_stock_reconciliation_mutation();
