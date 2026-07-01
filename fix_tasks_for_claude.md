# Fix tasks for Blythe Diva admin console

Context: found during a manual QA pass of the live site (yogendra-ten.vercel.app/admin). Specific numbers/customer names mentioned below are just illustrations from demo data and will have changed — focus on the underlying behavior, not the exact figures.

Work through these in order. For each, confirm the bug still reproduces before fixing (data has likely moved on since testing), then fix, then verify.

## Step 1 — Diagnose the intermittent 503s (do this first, everything else is easier to verify once this is stable)
- Reproduce: rapidly navigate between several `/admin/*` routes (or hard-refresh a few times) and watch the Network tab / server logs for `503`.
- Check: serverless function cold starts, DB/connection-pool exhaustion (e.g. Supabase pool limits under concurrent requests), and whether any rate limiting is misconfigured.
- Fix: resolve the root cause. If some 503s are unavoidable (e.g. cold starts), add client-side retry-with-backoff for GETs and navigation, and surface a visible "couldn't load, retry" state instead of a silent failed navigation or blank error page.
- Specifically re-test after fixing: the Add Inventory "Save & continue"/"Save draft" submit, and the Catalogue product Delete action — both hit 503 during testing.

## Step 2 — Security: mask passcodes on Roles & Permissions
- File/page: `/admin/roles`.
- Change: don't render role passcodes (including Owner's) in plain text by default. Mask with dots and add a "reveal" click, or require a re-auth step to view. Only show a passcode in full at the moment it's created/regenerated.

## Step 3 — Replace native `confirm()` on destructive actions
- Find every use of `window.confirm(...)` (delete product, delete category, delete supplier, etc. — catalogue delete is the confirmed one, audit the others).
- Replace with an in-app confirmation modal consistent with the rest of the UI.
- While in there, add a regression test / manual check: deleting or confirming one row must never mutate a different row's publish state or stock. (This is what happened during testing — likely a stale-index or shared-state bug in the row-expand/action-handler code, worth a closer look at how the delete/publish handlers get the target product id.)

## Step 4 — Customer de-duplication
- File/page: `/admin/customers` and wherever customers get created/matched (POS checkout, estimates, etc.).
- Change: normalize name (and phone, if used for matching) with trim + case-insensitive comparison before creating a new customer record or before treating two entries as "the same customer" in reporting (e.g. "Top customers by spend").
- Optional but recommended: write a one-off migration/script to merge existing duplicate customer records (same phone number, or same name case-insensitive) and re-point their historical orders to a single record.

## Step 5 — Format the Approvals queue payload
- File/page: `/admin/approvals`.
- Change: the pending action currently renders the raw JSON object. Replace with a template per action type, e.g. for `edit price`: "{by} wants to change {sku}'s {field} price from ₹{from} to ₹{to}." Add templates for whatever other action types can appear here.

## Step 6 — Fix SEO domain mismatch
- Check whatever env var / config drives sitemap.xml, robots.txt, and the Trust-pages links on `/admin/analytics` (likely something derived from `VERCEL_URL` instead of a hardcoded production domain / `NEXT_PUBLIC_SITE_URL`).
- Change: point these at the actual production domain the store is meant to be indexed under, not the auto-generated Vercel deployment URL.

## Step 7 — Dashboard chart + stat animation
- File/page: `/admin/dashboard`.
- Revenue trend chart: renders no bars even when a week has nonzero revenue — debug the chart component's data binding (likely a scale/domain issue if all-but-one week is 0, or a height/width calc issue).
- Stat card count-up animation: currently can flash a negative number before landing on the real value (seen on the Revenue card). Fix the animation's start value / easing so it never overshoots below 0 or above the target.

## Step 8 — Inventory status labeling
- File/page: `/admin/inventory`, `/admin/reorder`, `/admin/dashboard`.
- The "Inactive" status (products that have never sold) isn't documented anywhere the rule text appears. Add it to the explanatory copy on Inventory ("Dead = no movement in N days, Low = ≤N pcs, Inactive = never sold").
- On the Dashboard, the "LOW STOCK" card currently shows two unrelated numbers (low-stock count and inactive count) with no distinguishing labels — split into two cards or clearly label each number.

## Step 9 — Pricing formula live preview
- File/page: `/admin/pricing`.
- Recheck the math behind the "+ MRP markup (X%) → ₹Y" delta shown in the live preview — the delta shown didn't match the jump between the retail and MRP figures directly above it in testing. Verify the formula and the display are reading from the same computed values.

## Step 10 — Small polish pass (batch these together)
- Reviews (`/admin/reviews`) and Reels (`/admin/reels`): add an empty state ("No reviews yet", "No reels yet") when the list is empty, matching the pattern already used on Submissions/Creditors.
- Categories (`/admin/categories`): fix "N designs" to singularize correctly ("1 design" vs "2 designs").
- Abandoned Carts (`/admin/abandoned`): the "N item(s)" header count should sum item quantities, not just count distinct product lines.
- Purchases (`/admin/purchases`): consider enforcing (or at least warning on) duplicate supplier bill numbers per supplier.
- Add Inventory (`/admin/upload`): on submit with required fields empty, show inline field errors instead of doing nothing.
- Catalogue (`/admin/catalogue`): after a successful "Publish" action (toast confirms success), update that row's badge/state immediately instead of requiring a page reload.

## Cleanup
- Delete the leftover "QA Test Bangle" test product (hidden draft, SKU will vary — search "QA Test" in Catalogue) once these fixes are verified.
