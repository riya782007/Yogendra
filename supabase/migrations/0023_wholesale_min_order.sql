-- Meeting 2 §7 — configurable minimum wholesale order value (was hardcoded ₹3,000).
-- Stored in paise on the single pricing_settings row; editable from /admin/pricing.
-- Idempotent — safe to re-run.

alter table public.pricing_settings add column if not exists wholesale_min_order bigint not null default 300000;
