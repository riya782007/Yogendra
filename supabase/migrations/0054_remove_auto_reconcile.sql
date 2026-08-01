-- REMOVE THE DESTRUCTIVE AUTO-RECONCILE (owner: stock movement report was confusing / "sara stock hil gaya").
--
-- A pg_cron job ran `bd_reconcile_stock_ledger(180)` every 2 minutes. It trusted products.qty (live stock)
-- as truth and REWROTE the movement ledger to match it — appending silent "Auto-balanced ledger to live
-- stock" rows. When a cancellation/return posted a +qty to the ledger but the live qty briefly lagged, the
-- job deleted the difference, silently eating legitimately returned stock and leaving mystery lines the
-- owner could not trace. Stock must only ever change on a REAL, traceable event (sale, purchase, return,
-- adjustment) — never via a background job. This removes the job and its function for good.
--
-- Note: the recurring cron job + function were created directly on the database (not via a prior migration),
-- so this file documents and enforces their removal for any rebuilt environment. Guarded so it is safe to
-- run even where they were never present.
do $$
declare j record;
begin
  for j in select jobid from cron.job where command ilike '%bd_reconcile_stock_ledger%' loop
    perform cron.unschedule(j.jobid);
  end loop;
exception when others then
  -- pg_cron may be absent in some environments; ignore.
  null;
end $$;

drop function if exists public.bd_reconcile_stock_ledger(integer);
