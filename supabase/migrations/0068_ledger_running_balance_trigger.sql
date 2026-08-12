-- FINANCIAL LEDGER RUNNING BALANCE — one source of truth. Every function used to compute the next
-- balance as max(balance)+credit-debit, but max() ignores debits (purchases, payments out, cancellations,
-- returns) so the running balance only ever climbed and drifted above the true net. It isn't shown to the
-- owner anywhere (the cashbook and supplier ledger recompute independently), but it should still be
-- internally correct. A single BEFORE-INSERT trigger now sets every row's balance to the true cumulative
-- (sum of credits − sum of debits), so it can never drift again regardless of which function writes it.

create or replace function public.bd_ledger_running_balance()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  new.balance := coalesce((select sum(coalesce(credit,0) - coalesce(debit,0)) from ledger), 0)
                 + coalesce(new.credit,0) - coalesce(new.debit,0);
  return new;
end; $function$;

drop trigger if exists trg_ledger_running_balance on public.ledger;
create trigger trg_ledger_running_balance
  before insert on public.ledger
  for each row execute function public.bd_ledger_running_balance();

-- One-time rebuild of existing rows into a correct cumulative running balance.
with c as (
  select id, sum(coalesce(credit,0) - coalesce(debit,0))
             over (order by created_at, id rows between unbounded preceding and current row) as run
  from ledger
)
update ledger l set balance = c.run from c where c.id = l.id;
