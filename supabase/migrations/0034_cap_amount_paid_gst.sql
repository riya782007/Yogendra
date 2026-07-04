-- Blythe Diva — 0034: fix the amount_paid cap for GST bills (root cause of the phantom GST balance).
--
-- The trg_cap_amount_paid trigger clamped amount_paid to the PRE-TAX `total`. On a GST tax invoice
-- the customer pays total + GST, so a fully-paid bill was silently reduced to the pre-tax figure,
-- leaving the GST amount showing as a fake "balance due" — even when the whole amount was paid in
-- cash. Cap at the correct ceiling instead:
--   • GST bill  -> rounded-to-₹1 GST-inclusive grand total (matches the printed invoice Grand Total
--                  and lib grandTotalPaise in app/actions/orders.ts)
--   • Cash memo -> the plain total (no tax)
create or replace function public.cap_amount_paid()
returns trigger
language plpgsql
as $function$
declare cap_paise int;
begin
  if new.total is not null then
    if coalesce(new.bill_type, 'gst') = 'gst' then
      cap_paise := (round((new.total + round(new.total * 0.03)) / 100.0) * 100)::int; -- grand total, nearest ₹1
    else
      cap_paise := new.total;
    end if;
    if coalesce(new.amount_paid, 0) > cap_paise then
      new.amount_paid := cap_paise;
    end if;
  end if;
  return new;
end; $function$;

-- Correct historical GST bills that were clamped to the pre-tax total but were actually paid in full
-- (the recorded tender already covers the grand total).
update orders
set amount_paid = (round((total + round(total*0.03))/100.0)*100)::int
where bill_type = 'gst'
  and amount_paid < (round((total + round(total*0.03))/100.0)*100)::int
  and (coalesce(pay_cash,0) + coalesce(pay_bank,0)) >= (round((total + round(total*0.03))/100.0)*100)::int;
