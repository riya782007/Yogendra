-- Pillar 2 — defence-in-depth for "no negative inventory".
--
-- The app already clamps qty at 0 (lib `Math.max(0, …)` in `app/actions/stock.ts` and
-- `app/actions/diva.ts`), and the sales path funnels through `place_order` /
-- `place_wholesale_order` / `convert_estimate_v2` RPCs which honour `p_allow_oversell`.
-- But a direct UPDATE (e.g. a manual hot-fix in the Supabase SQL editor, a future code
-- path that forgets the clamp, or a third-party tool) could still push qty below zero.
--
-- These CHECK constraints make the database itself refuse to store a negative count.
-- IF EXISTS / DROP-then-ADD pattern keeps the migration idempotent.

-- Floor product stock at zero.
alter table public.products drop constraint if exists products_qty_non_negative;
alter table public.products add  constraint products_qty_non_negative check (qty >= 0);

-- Floor variant stock at zero.
alter table public.variants drop constraint if exists variants_qty_non_negative;
alter table public.variants add  constraint variants_qty_non_negative check (qty >= 0);

-- Belt-and-braces: also guarantee the stock_adjustments ledger never gets a "phantom" zero
-- row. The app already short-circuits on zero deltas, but a hand-crafted UPDATE could
-- leave a row that contributes nothing to inventory and just clutters the History tab.
alter table public.stock_adjustments drop constraint if exists stock_adjustments_delta_nonzero;
alter table public.stock_adjustments add  constraint stock_adjustments_delta_nonzero check (delta <> 0);
