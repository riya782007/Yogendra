-- The PARTIAL unique index can't be used as an ON CONFLICT target by PostgREST's upsert, so cart
-- tracking silently failed. Replace it with a FULL unique index (Postgres treats NULLs as distinct,
-- so legacy null-session rows are still allowed). Now upsert(onConflict: session_id) works.
drop index if exists public.uq_abandoned_carts_session;
create unique index if not exists uq_abandoned_carts_session on public.abandoned_carts (session_id);

-- Clear the seeded demo carts (Neha Gupta, etc.) so the page shows only REAL tracked carts.
delete from public.abandoned_carts where session_id is null;
