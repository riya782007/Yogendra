-- GUARD: a reservation ("reserve" movement) may ONLY hold stock while its estimate is status='held'.
-- If an estimate is denied/converted/cancelled/open but still nets pieces held, its release was missed
-- (this is a semantic leak the stock_integrity view can't see, because a reserve is a valid ledger row).
-- Any row here = an estimate wrongly holding stock; empty = healthy. Query: select * from estimate_hold_integrity;
create or replace view public.estimate_hold_integrity as
  select e.id as estimate_id, e.status::text as status, e.customer_name,
         -sum(sa.delta) as pieces_still_held
  from stock_adjustments sa
  join estimates e on e.id = sa.ref_id
  where sa.kind in ('reserve','release')
  group by e.id, e.status, e.customer_name
  having e.status::text <> 'held' and -sum(sa.delta) > 0;
