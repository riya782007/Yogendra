# Edit safety (stop feature regressions)

## Why features keep disappearing

Past fixes often **replaced whole files** with incomplete copies (or temporary PLACEHOLDER text), then re-pushed “restores” that only brought back *part* of a module. That is why COD edit lost packing/courier, and why catalogue/nath fixes briefly broke builds.

## Rules for every change

1. **Surgical diffs only** — change the smallest function / block needed. Never overwrite an entire `page.tsx` or `actions/*.ts` unless the task is a full rewrite.
2. **No PLACEHOLDER commits on `main`** — if a restore is needed, restore from a known-good commit SHA, not from hand-typed stubs.
3. **Before push, inventory the module** — for the file(s) you touch, list existing exports / UI sections and confirm they still exist after the edit.
4. **Shared domains** — bill charges live on `orders.extra_packing|extra_courier|extra_adjustment` (same as POS/Estimate). Edit-bill must keep all three, not only line qty.
5. **COD path** — `/admin/cod` links to `/admin/invoice/[id]` which hosts `EditBillPanel`. Do not remove that link or strip charge fields when fixing PDF/labels.

## COD Edit bill (current contract)

- Line qty / remove / add SKU (OTP + `edit_order_line` / `add_order_line`)
- Packing / Courier / Adjustment ₹ (OTP + `editOrderChargesAction`)
- Re-total matches RPC rules (wholesale GST ×1.03 on goods, then + charges)
