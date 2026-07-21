# Blythe Diva / Yogendra Industries — AI Commerce & Operations Platform

Next.js (App Router, TS) + Tailwind + Supabase. Built phase-by-phase per `MASTER-BUILD-SPEC.md`.

## Status
- **Phase 0 — Foundations (in progress):**
  - ✅ Pure pricing engine `lib/pricing.ts` (integer paise, one-formula re-pricing) + tests
  - ✅ Pure inventory classifier `lib/inventory.ts` (dead/low/inactive/healthy) + tests
  - ✅ AI gateway `lib/ai/gateway.ts` (cache→primary→secondary→deterministic, retry, breaker, zod, budget, logging) + tests
  - ✅ Human-in-the-loop core `lib/notify/*` (assignments, SLA escalation, OTP approvals, audit) + tests
  - ✅ Content resolver `lib/content.ts` (cached → deterministic template; no model on request path) + tests
  - ✅ DB schema `supabase/migrations/0001_init.sql` (full Part E.3 model, RLS, enums, indexes)
  - ⏳ Seed dataset + `/api/seed` (next)
- **Phase 1 — Demo (next):** categorized upload, product pages, dual storefronts, billing/POS, dashboard, OTP demo moment.

## Run unit tests (no external services needed)
```bash
npm install
npm test          # 38 tests across pricing/inventory/gateway/notify/content
```

## Run the app (needs Supabase)
```bash
cp .env.example .env.local   # fill Supabase URL + keys
# apply supabase/migrations/0001_init.sql to your Supabase project
npm run dev
```

## Demo-safety guarantees (built in)
- No live AI / 3rd-party call on any request path — content is cached or deterministic.
- Money in integer paise; invalid prices are flagged and excluded from publish.
- Every human-required step creates a task AND notifies the assigned contact (cannot pass silently).
