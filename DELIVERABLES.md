# Blythe Diva — Operating-System Upgrade: Phased Deliverables

_Prepared in response to Yogendra's new requirements (subcategories, unified product module, pricing, catalog, inventory, barcode, **DIVA intelligence**, invoice conversion, dashboard fix)._

## How to read this document

Each phase below has the 10 sections you asked for: **Problem · Root Cause · Architecture Changes · Database Changes · APIs · UI Changes · Files Modified · Migration Plan · Test Cases · Edge Cases**.

A note on honesty about status, because it matters for a system you rely on:

- **✅ Shipped in this change-set** — code is written, reviewed, and included in this PR.
- **🟡 Foundation shipped** — the data model / server actions / engine are in place; one more UI pass wires it fully.
- **⬜ Designed** — specified here in enough detail to implement next, not yet coded.

> ⚠️ **Verification note.** This work was authored in an isolated environment with **no npm registry access and no connection to your Supabase/AI backend**, so I could not run `next build`, `tsc`, or the test suite here, nor exercise the live database. Everything is written to match your existing conventions and was hand-reviewed and hand-traced against the test cases. **Before deploy, run `npm install && npm test && npm run build`, and apply `supabase/migrations/0002_subcategories.sql`.** I flag anything backend-dependent explicitly.

---

## Phase 1 — Critical bugs

**Problem.** (a) Dashboard date picker didn't reflect the selected range. (b) SKU was not editable. (c) A cash memo couldn't become a GST invoice.

**Root cause.**
- (a) The custom range was parsed as `new Date("YYYY-MM-DD" + "T00:00:00")` — i.e. in the **server's** timezone. On a UTC host the Indian business day is shifted by 5h30m, so a selected day could include the wrong orders or appear empty.
- (b) `updateProductAction` deliberately never wrote `sku`; the editor field was `disabled` and labelled "(fixed)".
- (c) No path existed to upgrade `orders.bill_type` from a cash memo to `gst`.

**Architecture changes.** Treat all dashboard day-boundaries as **IST (+05:30)**. Make SKU a first-class editable field with a uniqueness guard. Add a DIVA-driven invoice-conversion path with GSTIN validation.

**Database changes.** None required (uses existing `products.sku`, `orders.bill_type`).

**APIs.**
- `updateProductAction` now reads `new_sku`, validates uniqueness, and renames safely (FKs reference `product_id`, not the SKU string).
- DIVA tool `convert_invoice(invoice, to)` sets `orders.bill_type='gst'`, warning if the customer has no GSTIN.

**UI changes.** Dashboard custom range pinned to IST. `ProductEditor` SKU input is now editable (`name="new_sku"`, pattern-validated, uppercased).

**Files modified.** `app/(admin)/admin/dashboard/page.tsx`, `app/actions/updateProduct.ts`, `components/admin/ProductEditor.tsx`, `app/actions/diva.ts`, `lib/diva/tools.ts`.

**Migration plan.** None; deploy with the rest.

**Test cases.** Pick a custom range that includes "today" → revenue matches the channel cards. Rename a SKU to an existing one → rejected; to a free one → succeeds and storefront URL updates. "Convert cash memo INV123 to GST" via DIVA → `bill_type` flips, GSTIN warning when missing.

**Edge cases.** Duplicate SKU; renaming a SKU with past orders (safe — FKs by id); converting an already-GST invoice (no-op message); range where `from > to`.

**Status.** ✅ Dashboard IST fix · ✅ Editable SKU · ✅ Cash-memo→GST via DIVA. ⬜ A dedicated "Convert to GST" button on the invoice page (server action exists via DIVA; add a one-click button next).

---

## Phase 2 — Product module refactor (one place to work)

**Problem.** Inventory, photos and catalog live on separate pages; the team navigates too much.

**Root cause.** Product concerns were split across `/admin/catalogue`, `/admin/media`, `/admin/inventory`, and the Product 360 view, each its own round-trip.

**Architecture changes.** A single **tabbed Product workspace** at `/admin/catalogue/[sku]` with tabs: **Basic · Inventory · Photos · Catalog · Variants · Pricing · History**, each a client tab over server-loaded data and the existing server actions (`updateProductAction`, media actions, `variants` actions, `stock_adjustments`).

**Database changes.** None new for the shell (reuses `products`, `product_images`, `variants`, `stock_adjustments`). History tab reads `audit_log` + `stock_adjustments`.

**APIs.** Reuse existing actions; add `getProductWorkspace(sku)` aggregator in `queries.ts` (designed).

**UI changes.** New `ProductWorkspace` component with a tab bar; `ProductEditor` becomes the "Basic" tab.

**Files (planned).** `app/(admin)/admin/catalogue/[sku]/page.tsx`, `components/admin/ProductWorkspace.tsx`, `lib/supabase/queries.ts`.

**Migration plan.** None.

**Test cases.** Edit price on Pricing tab → reflected on Basic; add stock on Inventory tab → History shows the adjustment.

**Edge cases.** Unsaved-changes guard when switching tabs; configurable vs simple products hide/show the Variants tab.

**Status.** ⬜ Designed. (SKU editing, the most-requested part of "Basic", is already ✅.)

---

## Phase 3 — Category & subcategory system

**Problem.** Flat categories only. The business needs Necklaces → {Oxidised, Kundan, Temple, American Diamond, Long, Choker, …}, products in one or more subcategories, nested filters, and catalog sharing by subcategory.

**Root cause.** Schema had a single `categories` table; products linked by one `category_id`. No subcategory entity, no many-to-many.

**Architecture changes.** Self-referential `categories.parent_id` (future nesting) + a dedicated `subcategories` table + a `product_subcategory_map` many-to-many so a product can sit in several subcategories. A DB trigger keeps a product's **primary** subcategory in the map automatically.

**Database changes (migration `0002_subcategories.sql`, additive + idempotent).**
- `categories.parent_id`, `categories.sort`
- `subcategories(id, category_id, name, slug, sort)` with `unique(category_id, slug)`
- `products.subcategory_id`
- `product_subcategory_map(product_id, subcategory_id)`
- RLS read policies for storefront; trigger `sync_primary_subcategory()`.

**APIs.** `getCategoryTree()`, `getSubcategories({categoryId|categorySlug})`, `getCatalogProducts({category, subcategory})`. Server actions: `createSubcategoryAction`, `renameSubcategoryAction`, `deleteSubcategoryAction`, `reorderSubcategoriesAction`, `moveProductToSubcategoryAction`. DIVA tool `create_subcategory`.

**UI changes.** `/admin/categories` rewritten to manage parents + subcategories (create/delete inline, counts, slugs).

**Files modified.** `supabase/migrations/0002_subcategories.sql` (new), `lib/supabase/queries.ts`, `app/actions/catalog.ts`, `app/(admin)/admin/categories/page.tsx`, `lib/diva/tools.ts`, `app/actions/diva.ts`.

**Migration plan.** Apply `0002` to Supabase (idempotent — safe if partially applied). Existing products keep working (subcategory is nullable). Optionally backfill subcategories from product tags later.

**Test cases.** Create "Oxidised" under "Necklaces"; assign a product; share catalog filtered to "Oxidised" returns only those products; delete a subcategory → products fall back to parent.

**Edge cases.** Two parents each with a "Long" subcategory (slug unique per parent, so allowed); deleting a parent with subcategories; a product in multiple subcategories.

**Status.** 🟡 DB + data layer + server actions + parent/subcategory management UI ✅. ⬜ Storefront nested filter UI and the product-level multi-subcategory picker (actions ready; UI pass remaining).

---

## Phase 4 — Pricing system (MRP / Retail / Wholesale, per variant)

**Problem.** Need explicit MRP, Retail and Wholesale per product **and per variant**, with the rule: variant price → product price → default; wholesale customers see wholesale, retail see retail, public sees MRP.

**Root cause.** Today a single `products.base_wholesale` drives a formula (`computePrices`) for retail/MRP. There are no explicit per-tier or per-variant overrides.

**Architecture changes.** Keep the formula as the **default tier** (so nothing breaks), and add optional **explicit overrides** at product and variant level. Resolution order: variant override → product override → formula default. A `priceFor(customerType)` selector returns the right tier.

**Database changes (designed, migration `0003`).** `products: mrp_override, retail_override, wholesale_override (nullable paise)`; same three nullable columns on `variants`. Null = inherit.

**APIs.** Extend `lib/pricing.ts` with `resolvePrice({product, variant, tier})`; `getStorefront`/catalog read the resolved tier by `customers.type`. DIVA `set_price` already sets the base/wholesale; extend to set explicit tiers.

**UI changes.** Pricing tab (Phase 2) with three editable tiers + per-variant grid; live preview already exists in `ProductEditor`.

**Files (planned).** `supabase/migrations/0003_pricing_overrides.sql`, `lib/pricing.ts`, `lib/supabase/queries.ts`, `components/admin/ProductWorkspace.tsx`.

**Migration plan.** Additive nullable columns; zero downtime; formula remains the fallback.

**Test cases.** Variant override beats product override beats formula; wholesale customer sees wholesale; public sees MRP.

**Edge cases.** Override below cost (warn); partial overrides (only MRP set); rounding to `pricing_settings.round_to`.

**Status.** ⬜ Designed. ✅ DIVA `set_price` (base/wholesale) shipped now.

---

## Phase 5 — Catalog system & sharing

**Problem.** Weak catalog cards; need share by product / category / **subcategory**; generate share links, PDFs, WhatsApp catalogs.

**Root cause.** Sharing was limited to category; no subcategory or selected-product scope; no WhatsApp-ready link.

**Architecture changes.** Catalog queries accept a **facet** (category OR subcategory OR explicit SKU list). A share builder produces a deep link and a `wa.me` message; PDF is a print-styled route.

**Database changes.** None (uses Phase-3 tables).

**APIs.** `getCatalogProducts({category, subcategory})` ✅; DIVA `share_catalog(facet, whatsapp)` builds `/shop/c/{slug}` (or search) + `https://wa.me/?text=…` ✅. PDF route + selected-SKU sharing (designed).

**UI changes.** Richer catalog card (image, SKU, category, subcategory, prices, stock, keywords) — designed; share button surfaced in DIVA today.

**Files modified.** `lib/supabase/queries.ts`, `app/actions/diva.ts`, `lib/diva/tools.ts`. (Planned: `app/(retail)/catalog/pdf/route.tsx`.)

**Migration plan.** None.

**Test cases.** "Oxidised necklace ka catalog whatsapp pe bhejo" → DIVA returns a subcategory link + WhatsApp text.

**Edge cases.** Empty facet → full catalogue; facet with no matches → graceful message; out-of-stock items flagged on cards.

**Status.** 🟡 Subcategory-scoped sharing + WhatsApp link ✅ via DIVA. ⬜ PDF export + redesigned cards + selected-product sharing.

---

## Phase 6 — Inventory system

**Problem.** Need variant inventory, stock adjustments, purchase entries, damaged stock, barcode scan, low-stock alerts, live updates, stock shown during scanning.

**Root cause.** Stock lived only on `products.qty`; adjustments existed (`stock_adjustments`) but not per-variant or typed (damaged/purchase/manual).

**Architecture changes.** Promote `stock_adjustments` to a typed ledger (`reason: purchase|sale|damage|manual|return`) keyed by product **and** variant; classifier (`lib/inventory.ts`) already powers dead/low alerts and the reorder agent.

**Database changes (designed, `0004`).** `stock_adjustments.variant_id`, `stock_adjustments.reason` enum; index on `(product_id, created_at)`.

**APIs.** DIVA already does `add_stock` / `remove_stock` (by SKU) and `add_stock_by_name` / `remove_stock_by_name` ✅, each writing a `stock_adjustments` row. Add `record_damage`, per-variant variants (designed).

**UI changes.** Inventory tab in the Product workspace; scan view shows live stock.

**Files modified.** `app/actions/diva.ts`, `lib/diva/tools.ts`. (Planned: `app/actions/stock.ts`, barcode scan view.)

**Test cases.** "20 oxidised necklace ka stock add kar do" → matches a product, adds 20, writes an adjustment, stock reflects live.

**Edge cases.** Removing below zero (clamped to 0); ambiguous name match (returns best match, asks for SKU when unsure); concurrent adjustments.

**Status.** 🟡 Stock add/remove (by SKU and by name) + low/dead classification ✅. ⬜ Per-variant inventory + typed damage entries + scan-time stock overlay.

---

## Phase 7 — DIVA intelligence layer ⭐ (the most important part)

**Problem.** DIVA had to understand English, Hindi, Hinglish and mixed input, extract entities, plan multi-step tasks, remember context across turns, and actually operate the business (create products/customers/invoices, adjust stock, share catalogs, answer questions) — safely, behind permissions.

**Root cause.** The old planner relied on an LLM and, with **no AI key or network**, fell back to a weak English-only keyword matcher (`heuristicPlan`) that could not parse Hindi/Hinglish, extract quantities/SKUs/prices, or hold a conversation.

**Architecture changes (the new pipeline — language → intent → entities → permission → plan → execute → confirm).**
- A new **pure, deterministic, multilingual NLU engine** (`lib/diva/nlu.ts`) that runs **with no network and no model** — the only thing that works in your demo's no-AI-key path, and a reliable fallback in production.
  - **Language detection:** Devanagari → Hindi; Devanagari+Latin → Hinglish; curated romanised-Hindi marker set → Hinglish; else English.
  - **Entity extraction:** SKU (`BD####`), quantity (digits, Devanagari digits, and number-words `ek…hazaar`), price (₹/rs/"… ka"), colour (English + Hindi), product/subject (jewellery taxonomy-aware), customer name.
  - **Intent engine:** maps to tools for stock add/remove, price/inventory queries, catalog share, photos, create product/customer/category/subcategory, hide/publish/delete, SKU rename, invoice create/convert, pending orders, navigation, sales/summary.
  - **Conversational memory:** `DivaContext` carries a pending task + collected slots and the last SKU/customer, enabling the "create a necklace → which category? → price? → qty? → done" flow and "ye product" references.
  - **Task planning:** a request becomes an ordered list of steps; mutating steps are confirmed and permission-gated.
  - **Human responses:** localized acknowledgements ("I've added 20 — stock is now 84"), not "Operation Successful".
- The server planner (`divaPlan`) runs NLU first and uses it when confident / when it needs an answer / when no LLM is available, and only escalates ambiguous input to the LLM (keeping NLU's memory).

**Database changes.** None required. (Telemetry to `agent_runs`/`ai_calls` is designed.)

**APIs / tools (new in `lib/diva/tools.ts`, executors in `app/actions/diva.ts`).** `get_price`, `inventory_of`, `pending_orders`, `find_customer`, `add_stock_by_name`, `remove_stock_by_name`, `create_product`, `set_price`, `rename_sku`, `create_customer`, `set_customer_type`, `create_category`, `create_subcategory`, `share_catalog`, `convert_invoice` — each with a permission key and a confirm flag for mutations. Existing read/navigate/mutate tools retained.

**UI changes.** `Diva.tsx` threads conversational context between turns and advertises Hindi/Hinglish in its greeting.

**Files modified.** `lib/diva/nlu.ts` (new), `lib/diva/tools.ts`, `app/actions/diva.ts`, `components/admin/Diva.tsx`, `tests/diva-nlu.test.ts` (new).

**Migration plan.** None. Fully backward compatible: the widget's old single-arg call still works; with an AI key set, the LLM path still runs for low-confidence input.

**Test cases (`tests/diva-nlu.test.ts`).** All of the client's example commands map to the right tool/args; language detection; entity extraction; full multi-turn create-product; stock slot-filling; cancel; graceful low-confidence fallback.

**Edge cases.** Mixed-script input; number-words; "ye product" with no prior context (asks for a SKU); ambiguous product names (best match, else asks); cancellation mid-flow; permission denial returns a friendly message and does nothing.

**Status.** ✅ Shipped (engine + tools + executors + widget wiring + tests). 🟡 Suggestions engine ("stock low on Kundan — make a purchase order?") and agent telemetry are designed next. ⬜ Full invoice **creation** through DIVA opens billing today rather than building line-items conversationally.

---

## Phase 8 — Permissions & security (RBAC)

**Problem.** DIVA must never perform unauthorized actions; staff/wholesale limits must hold everywhere.

**Root cause.** Granular permissions exist (`lib/permissions.ts`) and middleware guards routes, but RLS is still permissive for admin reads/writes (service role), and per-action checks must be consistent.

**Architecture changes.** Every DIVA mutation already calls `requirePerm(tool.permission)` server-side before executing (owner has all; staff scoped by role). Continue tightening table-level RLS per role (Phase 2.3 in the roadmap).

**Database changes (designed).** Per-role RLS policies on `products`, `orders`, `customers`, `stock_adjustments`.

**APIs.** `sessionCan(perm)` gate in `divaRun`; new tools carry keys: `catalog.create/edit/price_edit/delete`, `inventory.add/remove`, `customers.manage/view`, `sales.view`, `billing.gst`.

**UI changes.** Denied actions surface "Your role doesn't have permission for X".

**Files modified.** `app/actions/diva.ts`, `lib/diva/tools.ts` (permission keys). Existing: `middleware.ts`, `lib/permissions.ts`, `lib/auth.ts`.

**Migration plan.** RLS tightening is additive policy work; test with a non-owner role before enabling.

**Test cases.** A staff role without `inventory.remove` asks DIVA to remove stock → refused; without `catalog.delete` → delete refused.

**Edge cases.** Owner bypass; expired session; conflicting role permissions.

**Status.** ✅ Per-action permission gating for all new DIVA tools. ⬜ Per-role RLS hardening at the database layer.

---

## Phase 9 — Testing

**Problem.** Need confidence the new behavior is correct and stays correct.

**Root cause.** Server actions and the AI path were lightly tested; the NLU engine is brand new.

**Architecture changes.** Keep pure logic in dependency-free modules (NLU, pricing, inventory) so they're unit-testable with no backend — the pattern the repo already uses.

**Database changes.** None.

**APIs.** N/A.

**UI changes.** N/A.

**Files modified.** `tests/diva-nlu.test.ts` (new) joins the existing vitest suites.

**Migration plan.** Run `npm test` in CI on every PR.

**Test cases.** See Phase 7. Plus the existing pricing/inventory/gateway/notify suites.

**Edge cases.** Covered in the NLU test (mixed language, slot-fill, cancel, fallback).

**Status.** ✅ NLU unit tests written. ⬜ Integration tests for the new server-action executors (need a Supabase test project) and Playwright happy-paths.

---

## What to do next (recommended order)

1. `npm install && npm test && npm run build`; apply `supabase/migrations/0002_subcategories.sql`.
2. Phase 2 — build the tabbed Product workspace (biggest day-to-day time saver).
3. Phase 4 — explicit MRP/Retail/Wholesale + per-variant overrides (`0003`).
4. Phase 5 — catalog PDF + redesigned cards + selected-product sharing.
5. Phase 6 — per-variant inventory + typed damage + scan-time stock.
6. Phase 7 follow-ups — DIVA suggestions engine + conversational invoice building + telemetry.
7. Phase 8 — per-role RLS hardening.
