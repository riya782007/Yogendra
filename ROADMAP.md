# Blythe Diva — Product Audit & Roadmap
_Gap analysis against the master spec, yogendra.pdf, and best-in-class commerce sites (GIVA, Kalyan, Vyapar, Shopping Tree, Discord). Living document._

## Verdict
The platform already **meets or exceeds** the Phase-1 demo spec: premium storefront, AI-drafted product pages, dual storefronts, cart→checkout, POS + GST invoices, estimates, returns, purchases with SKU mapping, inventory intelligence, animated dashboard, RBAC, approvals/OTP, CRM, abandoned carts, search, reviews, SEO, GA4 — all live and verified.
To become a **premium system a business truly relies on**, the gaps below matter. Prioritised P0 (must) → P2 (delight).

---

## P0 — Critical (trust, security, money)
1. **Owner-console authentication** — `/admin/*` is currently open. Add a login gate (passcode now, full Supabase Auth + per-user roles next), middleware protection, logout. _[in progress]_
2. **Real payment gateway (Razorpay)** — checkout is COD + "online" placeholder. Add Razorpay order + verify + webhook so online payments actually work.
3. **Stock reservation at checkout** — prevent overselling when two buyers race; reserve on begin-checkout, release on timeout.
4. **Real OTP for approvals** — currently a fixed demo OTP. Generate per-request OTP and deliver to owner (WhatsApp/SMS via Twilio) instead of a constant.
5. **Per-role RLS + enforced permissions in UI** — roles exist; enforce them on every admin action and tighten RLS.

## P1 — Premium UX on every page
6. **Global toast/notification system** — replace inline "✓ saved" text with elegant toasts across all admin + storefront actions.
7. **Storefront listing filters + sort** — price range, colour, category, in-stock, rating; sticky filter bar.
8. **Quick-view modal** + image lightbox/zoom on product cards.
9. **Wishlist (persisted) + wishlist page** — heart currently cosmetic; make it real with a page.
10. **Customer accounts** — login, order history, saved addresses, track order. (`/account` is a dead link today.)
11. **Skeleton loaders + page transitions** — premium perceived performance.
12. **Content & trust pages** — About, Contact, Shipping, Returns, Privacy, FAQ, size/length guide (jewellery). Incumbent has these; great sites always do.
13. **Empty states + styled 404/error pages** everywhere.
14. **Mobile polish pass** — sticky add-to-cart bar, mobile filters, nav.
15. **Recently viewed + "complete the look"** recommendations.

## P1 — AI intelligence everywhere
16. **AI store assistant (chat)** — Groq-powered concierge on the storefront: answers product/stock/care questions, recommends, shares catalogue. (Req 12 in-app form.)
17. **Semantic search + recommendations** — embed each product once; power "you may also love", search-by-meaning, dedup. (Spec B.1.6.)
18. **AI inventory agent** — turn the dead/low classifier into **reorder & clearance proposals** with confidence, notifying the assigned person (Req 11 + Part F).
19. **AI review responder + reputation** — draft replies to reviews for one-tap approval; feed Google Business Profile signals (Req 15.3/16.3).
20. **AI marketing agent** — caption drafts + IG/FB scheduling (human-approved); shoppable reels mapped to SKUs on-site (Req 15, Shopping Tree reference).
21. **Persist AI/agent telemetry** — write to `ai_calls` and `agent_runs` for the gateway + every agent (Req 10.4).

## P1 — Spec modules still open
22. **WhatsApp Assistant agent (Req 12)** — Twilio: answer, share catalogue, onboard retailer, post-order feedback; hand off to human.
23. **Shipping / Delhivery (Req 14)** — pincode serviceability, label, pickup, tracking, reverse logistics; notify on failure.
24. **Voice command operations (Req 13)** — "add 50 units to Kundan", "send catalogue to retailers" → parse intent → act with confirmation.
25. **Wholesale retailer signup → owner approval** — real flow (not the demo toggle); approved buyers unlock trade pricing.
26. **Real product images** — run the Gemini image agent (or owner upload) to replace placeholders; multi-image upload + gallery.
27. **Bulk CSV via file upload + image upload** — currently paste-only.

## P2 — Commerce best-practices great sites have (not in the docs)
28. **Coupons / discount codes** (incumbent has Deals/Coupons) — code engine, usage limits, expiry.
29. **Order fulfilment workflow** — placed → packed → shipped → delivered, with timeline + customer notifications.
30. **Order & shipping notifications** — WhatsApp/email confirmations and status updates.
31. **Loyalty / referral program** — points, refer-a-friend.
32. **Gift options** — gift wrap, gift message, gift cards.
33. **Blog / SEO content engine** — AI-assisted posts (incumbent + GIVA have blogs) for organic traffic.
34. **Vyapar-grade reports** — GST report, day-book, P&L, party ledger, stock summary, downloadable.
35. **Barcode / QR labels** — generate + print product barcodes (Vyapar reference); scan at POS.
36. **Variants beyond colour** — length/size for chains, anklets, bangles.
37. **Festival/seasonal campaign scheduler** — themed banners + offers on a calendar.
38. **Data export / backup** — owner can export catalogue, orders, ledger.

## P2 — Reliability & ops
39. **Integration tests** for server actions (orders/purchases/returns move stock+ledger correctly) + Playwright happy-path.
40. **Error monitoring + rate limiting + image CDN/optimisation.**
41. **Audit log surfaced** in the console (who did what, when) — table exists, add a viewer.

---

## Execution order (recommended)
**Now:** 1 (auth) → 6 (toasts) → 16 (AI assistant) → 17 (semantic search/recs) → 18 (AI reorder) → 7–9 (filters/quick-view/wishlist).
**Then:** 12/13 (content + empty states) → 10 (customer accounts) → 2 (Razorpay) → 28 (coupons) → 29/30 (fulfilment + notifications).
**Then:** 22 (WhatsApp) → 23 (Delhivery) → 19/20 (reputation + marketing) → 34/35 (reports + barcode) → remaining P2.

Each item ships behind a full `next build` and is deployed before the next begins.
