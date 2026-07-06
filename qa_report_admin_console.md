# Blythe Diva Owner Console — QA Report
Site tested: https://yogendra-ten.vercel.app/admin (full admin console + a spot-check of the public storefront)
Date: 1 Jul 2026

## Top priority — fix first

**1. Intermittent 503 errors across almost every admin route (biggest issue found).**
Watching the network log while clicking around, roughly a third of page loads and background prefetches returned `503 Service Unavailable` — including on `/admin/media`, `/admin/cashbook`, `/admin/pricing`, `/admin/billing`, `/admin/sales`, `/admin/reorder`, and others. Several times a sidebar click or direct URL load silently did nothing (page just stayed on the old screen) or showed the browser's own error page, and a retry a few seconds later worked fine. This is inconsistent and doesn't show the user any "something went wrong, retry?" message — it just looks broken or unresponsive. Two real mutations were also hit: my first "Save & continue" submit on Add Inventory 503'd, and both of my attempts to delete a product returned 503 on the POST.
*Recommendation: check the hosting/runtime (looks like Vercel serverless functions, possibly a database connection pool or cold-start issue), and add retry logic + a visible error toast so failed requests aren't silent.*

**2. Staff/owner passcodes shown in plain text on the Roles & Permissions page.**
Every role — including "Owner" (`17A94A`, which "always unlocks everything") — has its passcode printed directly on the page next to a "copy" button. Anyone who sees this screen (screen-share, shoulder-surf, screenshot) gets full access. Recommend masking passcodes by default with a "reveal" toggle, and only showing the Owner passcode once at creation.

**3. Delete has no safe confirmation flow, and briefly corrupted an unrelated product.**
Deleting a catalogue item uses the browser's native `confirm()` popup. During testing, after triggering that dialog once, a keyboard action ended up un-publishing and zeroing the stock of a *different* product ("Kundan necklace," completely unrelated to the one I was deleting) — it briefly went live as Draft with 0 stock across all variants before I caught it and republished it. I've restored it, but this points to fragile state handling around the delete confirmation. Recommend replacing the native `confirm()` with an in-app modal (also fixes the automation-hostile blocking-dialog behavior, and is more consistent with the rest of the UI).

**4. Test product left behind.**
I created "QA Test Bangle" (SKU BD5812) while testing Add Inventory, then tried to delete it. The system correctly refused to hard-delete it (it has a stock ledger entry) and instead auto-hid it from the store — that's actually good design — but it's still sitting in your catalogue as a hidden draft. You'll want to remove it manually from Catalogue → BD5812 → Delete.

## Confirmed bugs (medium priority)

- **Dashboard revenue chart is empty.** The "Revenue trend" 8-week bar chart on the Dashboard renders no bars at all, even though the underlying numbers (₹0 × 7 weeks, ₹959.81 in the current week) are correct in the page text. The chart itself just doesn't draw.
- **Dashboard stat cards flash wrong values on load.** Revenue, Orders, and Approved Retailers all count up from odd starting numbers (I saw Revenue flash "₹-33" before settling on the correct ₹960). Not wrong once settled, but a jarring first impression, especially the transient negative number.
- **Duplicate customer records from case-sensitive matching.** "Harshit" and "HARSHIT" exist as two separate customer records (different phone/GSTIN on file for each), and "Cash (W)" exists twice with identical blank details. This splits one real customer's order history and lifetime spend across records under Customers → Top customers by spend. Recommend normalizing name matching (case-insensitive, trimmed) when creating/searching customers.
- **Approvals queue shows raw JSON to the owner.** The pending "edit price" approval displays literally as `{"by":"Aman (Store Manager)","to":19900,"sku":"BD1000","from":18700,"field":"retail"}` instead of a plain-English line like "Aman wants to change BD1000's retail price from ₹18,700 to ₹19,900." Worth formatting before this goes live.
- **SEO links point to a different domain than the live site.** On Analytics & SEO, the Sitemap, Robots, and Trust-pages links (and the sitemap's own internal `<loc>` URLs) all point to `yogendra-ry342315-6737s-projects.vercel.app`, not the production domain `yogendra-ten.vercel.app`. If that's not the domain you want indexed, this needs fixing before search engines crawl it.

## Minor / polish

- **"Inactive" stock status is never explained.** Inventory and AI Reorder both bucket 35 of 58 products as "Inactive" (meaning: never sold), but the rule text at the top of Inventory only documents "Dead" (no movement in 30 days) and "Low" (≤2 pcs) — "Inactive" isn't mentioned anywhere. The Dashboard compounds this by cramming "4 low stock" and "35 inactive" onto one card labeled just "LOW STOCK," which reads like they're the same metric.
- **Pricing formula's live preview math looks off.** With wholesale ₹200, customer step 5% → retail is shown correctly as ₹209. But the next line "+ MRP markup (25%) → ₹5" jumps straight to ₹265, an increase of ₹56 — not ₹5. Worth double-checking the formula/display are actually in sync.
- **Reviews and Reels pages show no empty state.** With zero reviews/reels, the pages just show the header and nothing else — no "no reviews yet" message like other empty lists (Submissions, Creditors) have. Could look broken to a first-time user.
- **Grammar: "1 designs"** on the Categories page (Maang Tikka) should read "1 design."
- **Abandoned Carts miscounts items.** Ritu S.'s cart is labeled "1 item" but contains "Pearl Layered Necklace ×2" — that's 2 units, so the header undercounts.
- **Duplicate supplier bill numbers allowed.** Two separate purchase bills from "Delhi Meena Works" are both numbered "011" (₹60 and ₹1,150). No uniqueness check on supplier bill number could make reconciliation confusing later.
- **Add Inventory: empty-form submit fails silently.** Clicking "Save & continue" on a completely blank form does nothing visible — no red field outlines, no error message. (This turned out to be the 503 from issue #1, but even on a healthy day, blank submits should show which fields are required rather than doing nothing.)
- **Publish button doesn't refresh its own row.** After clicking "Publish" on a product, a success toast appears correctly, but the "DRAFT" badge on that row doesn't clear until you reload the page.

## What worked well
Catalogue search/filter/pagination, category tree editing, barcode SKU lookup, POS cart math (MRP → discount → GST → payable all checked out correctly), stock ledger/audit trail (every change I made was logged with a timestamp and reason on the Notifications page — nice touch), and the estimates/backorders/returns/purchases flows all behaved as expected with no errors.
