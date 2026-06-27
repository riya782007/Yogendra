# Build Context — Artificial-Jewellery Commerce + ERP (Client 2)

**Paste this whole file into a fresh chat to start the new client's software.** It captures the
proven architecture, full feature set, data model, integrations, hard-won lessons, and the one
deliberate difference for this client (**QR codes instead of barcodes**). Client 2 is a higher-value
account — the bar is *delight*, not just parity.

---

## 0. What we're building (one line)

A complete e-commerce storefront + wholesale (B2B) portal + owner/admin ERP console for an
**artificial-jewellery manufacturer & supplier in Sadar Bazar, Delhi** — a near-clone of an existing
successful build ("Blythe Diva", for the client *Yogendra*), with **QR-code labels/scanning instead
of barcodes** and a fresh brand identity.

The reference build is live and proven. Re-use its architecture wholesale; don't reinvent.

---

## 1. Proven stack & hosting (keep identical)

- **Framework:** Next.js **14.2.5**, App Router, TypeScript, React Server Components + server actions.
- **Styling:** Tailwind CSS (custom theme tokens: `ink`, `cream`, `sand`, `emerald`, `gold`, `wine`, `rose`). Keep a tasteful, premium, mobile-first aesthetic.
- **DB/Backend:** **Supabase** (Postgres + Storage + RLS). Server access via a service-role server client (`lib/supabase/server.ts`). Business logic lives in **plpgsql RPCs** (see §5).
- **Storage:** one public bucket `product-media` for all images.
- **Hosting:** **Vercel** (GitHub auto-deploy on push to `main`). Verify every deploy goes green.
- **Deps are intentionally minimal:** `@supabase/ssr`, `@supabase/supabase-js`, `next`, `react`, `react-dom`, `server-only`, `zod`. Dev: `tailwindcss`, `typescript`, `vitest`, `tsx`. **Avoid adding heavy libraries** — the build favours small, dependency-free utilities (e.g. the barcode generator is hand-written SVG). Match that ethos.
- **Money:** stored everywhere as **integer paise** (₹1 = 100). Never floats.

---

## 2. Workflow conventions & HARD-WON LESSONS (read this — it saves days)

1. **One pushable module per turn, deploy each, verify Vercel is green** before moving on. Don't batch many features into one giant commit.
2. **Next.js page-export rule:** a `page.tsx` may only export `default`, `metadata`, `dynamic`, etc. **Any other `export const X` breaks the build** (e.g. `export const LABEL_CHIP`). Use a plain `const` instead. This silently broke ~9 deploys once.
3. **Commit from the user's real terminal, NOT a sandbox.** The repo lives in a OneDrive-synced folder. A sandboxed/Linux view of those files can be **truncated mid-file**, and committing from there pushes broken (truncated) blobs that fail the build with `Unexpected eof`. **Always hand the user the exact `git add/commit/push` commands to run in their own PowerShell** — their terminal sees the complete files. (If a `.git/*.lock` lingers, delete `.git/index.lock` / `.git/HEAD.lock` and retry.)
4. **Verify file state with the Read tool, not bash `cat`/`grep`** when editing — the OneDrive mount lags, so bash may show stale/old content while the real file (and the Read tool) is correct.
5. **Prices in paise, one formula prices the whole catalogue.** See §4.
6. **AI image generation is never on a render path** — only behind explicit "Generate" buttons.
7. **Ask before big ambiguous work** (payment gateway, WhatsApp provider, pricing model) — these decide which keys/SDKs are needed.
8. Use the Vercel MCP to read deploy status + build logs; use the Supabase MCP for migrations/SQL.

---

## 3. Feature inventory (what the reference build already does)

### Owner / Admin console (`/admin/*`, auth-gated, granular roles)
- **Dashboard** — sales/cash KPIs, custom date ranges, expandable detail, a **privacy toggle** that blurs all money figures for in-store safety.
- **Add Inventory / Upload** — fast product creation, **AI-assisted bulk import** (messy CSV/paste → structured rows), CSV template.
- **Catalogue** — per-SKU editor: details, **pricing overrides**, inventory, **photos**, **variants**, category/labels, history. Hide/unhide, delete.
- **Categories & subcategories** — hierarchy, owner-defined **labels** (colour chips).
- **Pricing formula** (`/admin/pricing`) — the configurable **% cost build-up** (see §4).
- **Inventory** — per-product analytics, stock adjust, low/out-of-stock views, hide/delete.
- **Barcodes** *(→ becomes QR for Client 2, see §7)* — printable label sheets per SKU; **scan at POS**.
- **Billing (POS)** — ring up sales, editable qty, **GST tax-invoice or cash-memo (one-tap convertible)**, split cash/UPI tender, partial payments, oversell/backorder guard, retail vs wholesale tier.
- **Sales records** — all channels with source tags.
- **Estimates** — create, 4-state workflow, edit open estimates, convert to sale, print.
- **Returns** — sales returns with stock + ledger reversal.
- **Purchases & Suppliers** — purchase entry per variant, **last-purchase-price memory**, supplier ledger, edit-with-approval/2FA.
- **Customers/CRM** — retail & wholesale customers, GST, per-customer ledger, abandoned carts.
- **Invoices** — professional B2B GST jewellery invoice (proforma ↔ tax invoice, cash ↔ GST).
- **Reviews, Feedback (WhatsApp form), Reels, Approvals, Notifications (inbox), Roles (Discord-style granular permissions).**
- **DIVA** — the in-console AI operator agent (see §6).

### Retail storefront (D2C) (`/shop`, `/`, etc.)
- Home, category & subcategory pages, **product page** (image **zoom/lightbox gallery incl. per-colour variant photos**, **never leaks the wholesale price**), search, wishlist, cart, **checkout (COD + Razorpay online)**, order confirmation, order tracking, and trust pages (about, contact, FAQ, returns, shipping, size-guide).

### Wholesale portal (B2B) (`/wholesale`)
- Approved-buyer login, role-based **wholesale pricing**, category filter, qty capped to stock, tap-to-enlarge images, mobile card layout, **₹3000 minimum order**, order history + one-click reorder, quick-order by SKU.

---

## 4. Pricing model — the configurable % cost build-up (important)

One global formula (`pricing_settings` row) prices the entire catalogue; per-product/per-variant
**overrides** can pin exact tier prices. Two modes, toggled by `use_buildup`:

**Build-up chain (the client's costing sheet), all percentages configurable:**
```
cost (base_wholesale, paise)
  → +shipping%  → +packing%  → +promotion%      = landed cost
  → +reseller%                                    = WHOLESALE price
  → +customer_discount%                           = RETAIL price
  → +mrp%                                         = printed MRP
```
Reproduces e.g. ₹200 cost → ₹310 wholesale → ₹326 retail → ₹408 MRP. Implemented **once** in the DB
function `bd_price(base, tier)` and mirrored in TS `lib/pricing.ts` (`computePrices`/`buildupBreakdown`)
so **storefront display always equals what's billed**. All three billing RPCs route through `bd_price`.
Admin UI at `/admin/pricing` with a live preview. Defaults preserve old multiplier mode until enabled.

---

## 5. Data model (Supabase Postgres)

**Tables:** `products`, `variants`, `variant_options`, `product_images`, `categories`, `subcategories`,
`product_subcategory_map`, `labels`, `product_labels`, `pricing_settings`, `orders`, `order_items`,
`estimates`, `estimate_items`, `purchases`, `purchase_items`, `suppliers`, `customers`, `retailers`,
`returns`, `ledger`, `stock_adjustments`, `reviews`, `feedback`, `reels`, `reel_products`, `roles`,
`user_roles`, `approvals`, `notifications`, `audit_log`, `abandoned_carts`, `assignments`, `contacts`,
`doc_settings`, `ai_calls`, `agent_runs`, `ga_events`, `gbp_state`.

**Key RPCs (plpgsql, SECURITY DEFINER):** `bd_price`, `place_order`, `place_wholesale_order`,
`create_estimate`, `convert_estimate_v2`, `record_purchase`, `record_payment`, `record_sales_return`,
`assign_invoice_no`, `delete_purchase`, `sync_primary_subcategory`.

- Money columns in **paise**. Variant images live in `variants.image_paths` (text[] of public URLs).
- Overselling guard built into the order RPCs (opt-in backorder). RLS is locked down; the app reads/writes via the service-role server client.
- **Migrations 0001–0014 are files in `supabase/migrations/`; 0015 (pricing build-up) & 0016 (`orders.payment_ref`) were applied via the Supabase MCP** — recreate them as part of the new project's schema.

---

## 6. DIVA — the in-console AI operator agent

A bottom-right assistant in the Owner Console that understands the **whole admin surface** (inventory,
catalogue, categories, products, images, variants, bills, invoices, purchases, customers, analytics)
and **actually performs commands** in English/Hindi/Hinglish.

- `lib/diva/nlu.ts` (deterministic multilingual NLU) + `lib/diva/tools.ts` (tool catalog) +
  `app/actions/diva.ts` (`divaPlan` planner + `divaRun` executor) + `components/admin/Diva.tsx` (widget).
- **LLM brain:** Gemini text (`gemini-2.5-flash`) → Groq → OpenAI fallback (`lib/ai/providers.ts`).
  Mutations escalate to the LLM when NLU confidence < 0.72.
- **Honesty is a hard requirement:** show a "thinking" state; never claim "Done" unless the work
  actually ran; report real per-step results (✓/✕) and ask ONE clarifying question when unsure.
- Matches products by **SKU or any detail hint** (fuzzy token-overlap resolver, not literal substring).
- There is a short end-user guide (`DIVA-Guide-for-Yogendra.md`) — produce the equivalent for Client 2.

---

## 7. ⭐ THE KEY DIFFERENCE FOR CLIENT 2 — QR CODES INSTEAD OF BARCODES

The reference build prints **Code128 barcodes** via a hand-written, dependency-free SVG generator
(`lib/barcode.ts` → `components/admin/Barcode.tsx` → `components/admin/BarcodeSheet.tsx`), and the POS
reads a scanned **SKU** from a keyboard-wedge scanner (`components/admin/POSClient.tsx`).

**For Client 2, swap barcode → QR while keeping the rest of the flow identical:**

1. **Generation (keep zero-dep ethos):** add `lib/qr.ts` — a small pure-TS QR encoder that returns an
   **inline SVG** (mirror how `lib/barcode.ts` works). If a dependency is acceptable, `qrcode` (npm)
   is fine, but a self-contained generator matches the codebase style and prints crisply.
2. **What the QR encodes:** the **product SKU** (simplest — keyboard-wedge 2D scanners "type" the
   decoded SKU, so the existing POS scan-by-SKU input works **unchanged**). Optionally encode a deep
   link (`https://<store>/shop/<category>/<sku>`) so a phone camera opens the product page — nice for
   shop-floor staff and customers. Decide with the client; SKU-only is the safe default.
3. **Label sheet:** replace `<Barcode>` with `<QRCode>` in `BarcodeSheet.tsx` (rename to
   `LabelSheet`/`QrSheet`). Each label = **QR + the SKU text + (optional) name/price**, sized to the
   small sticker the client uses (see §8). Keep the print grid + `break-inside-avoid`.
4. **Scanning at POS:** hardware 2D/QR scanners need **no code change** (they wedge the decoded text).
   For *delight*, add an optional **in-browser camera scanner** using the native
   `BarcodeDetector` API (supports `qr_code`) with a graceful fallback message where unsupported.
5. Update nav label/icon and any "barcode" copy to "QR".

This is a contained change — the data model (SKU), POS, and printing pipeline all stay the same.

---

## 8. The client's current label (from the provided photo)

Products are bagged in clear zip pouches with a **small printed sticker** carrying an **alphanumeric
code** (e.g. `BR…8696`). So the new QR label should: show the **QR**, the **human-readable SKU/code**
beneath it, fit the small sticker footprint, and (optionally) the product name/price. Confirm exact
sticker dimensions and whether they want price on the label.

---

## 9. Integrations (re-use; keys are env-var driven, code no-ops without them)

- **Payments — Razorpay** (`lib/payments/razorpay.ts`, `app/actions/checkoutOnline.ts`): server quotes
  the cart authoritatively, creates a Razorpay order, **verifies the signature server-side before
  creating the order**, stores `orders.payment_ref`. Falls back to COD if keys absent.
- **WhatsApp — Meta Cloud API (default) or Twilio** (`lib/whatsapp.ts`): order-confirmation to customer
  + new-order alert to owner, best-effort/non-blocking. Hooked into `placeOrderAction` + the online
  confirm action.
- **AI images — Gemini (Nano Banana) → OpenAI fallback** (`lib/ai/gemini.ts`, `lib/ai/imagePrompt.ts`):
  editorial model shots + **per-colour variant recolour** images. **Prompt lesson:** specify a clearly
  **Indian/South-Asian model with bright, luminous (not dark) skin**, and a hard "**jewellery is the
  hero**" block (brightly lit, tack-sharp, pops against skin) — the first prompt produced dark, jewellery-
  not-highlighted results.
- **Analytics — GA4** server-side purchase events (`lib/ga4.ts`).
- **Env keys:** see the reference repo's `.env.example` + `INTEGRATIONS-SETUP.md` (Supabase, Razorpay
  `RAZORPAY_KEY_ID/SECRET` + `NEXT_PUBLIC_RAZORPAY_KEY_ID`, WhatsApp Meta/Twilio block,
  `OWNER_WHATSAPP_NUMBER`, `NEXT_PUBLIC_STORE_NAME`, Gemini/OpenAI, GA4). Leave a clearly-labelled keys
  section for the client to fill.

---

## 10. Catalogue migration from an existing site (re-usable playbook)

Yogendra's old catalogue lived in a **Laravel** admin (`app.brainybuzz.digital`). Approach (works for any
similar site): **owner logs in themselves** (never type their password — hard rule); then either drive
the authenticated pages via the Claude-in-Chrome extension, or have them paste a **recon console
script** (read-only, uses their session) that reports the catalogue's structure, then a tailored
**extractor** downloads `products.json`, then an **importer** recreates categories/products, runs prices
through the build-up, and **re-hosts every image into Supabase storage**. Always do a **50-product pilot
first**. (Reference: `migration/brainybuzz-recon.js`.) Client 2 will likely need the same migration —
ask what platform their current catalogue is on.

---

## 11. Kickoff checklist for the new chat

1. **Brand & identity:** new store/brand name, logo, colour theme, domain, store address, GSTIN, WhatsApp/contact number.
2. **Repo + infra:** new GitHub repo, new Supabase project, new Vercel project (don't reuse Yogendra's).
3. **Schema:** recreate migrations 0001–0016 equivalent (tables + RPCs + pricing build-up + `payment_ref`).
4. **Pricing:** capture the client's exact costing %s (shipping/packing/promotion/reseller/customer/MRP).
5. **QR module:** build `lib/qr.ts` + QR label sheet + optional camera scanner (§7).
6. **Integrations:** wire Razorpay + WhatsApp + AI images; leave the env keys section for the client.
7. **Migration:** identify their current catalogue platform; run the recon→extract→import→pilot flow (§10).
8. **DIVA:** stand up the agent + write the client's short usage guide.
9. Ship **one module per turn**, deploy, verify green, repeat.

## 12. Questions to ask the new client up front
- Brand name, logo, colours, domain?
- GSTIN + invoice header details (address, terms)?
- Their exact pricing percentages (the costing sheet)?
- QR should encode just the **SKU**, or a **deep link** to the product page?
- Exact sticker/label size; do they want price printed on the label?
- Where is their current catalogue today (platform), and roughly how many SKUs + images?
- Razorpay account ready? WhatsApp via Meta or Twilio? Who's the owner number for alerts?
- Do they need the wholesale/B2B portal from day one, or retail first?

---

*Reference build: "Blythe Diva" for client Yogendra (Sadar Bazar, Delhi). This document is a faithful
summary of that production system as of the latest deploy. Re-use aggressively; the architecture is proven.*
