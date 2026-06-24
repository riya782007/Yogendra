# Testing — Blythe Diva

Three layers: **unit** (pure logic, runs anywhere), **integration** (server actions against a Supabase test project), **E2E** (Playwright against a running app). Unit tests are wired up and run today; integration/E2E are documented here for your environment.

## 1. Unit tests (Vitest) — wired up ✅

```bash
npm install
npm test            # vitest, runs tests/**/*.test.ts
```

Pure, dependency-free logic is unit-tested with no backend:

| Suite | Covers |
|---|---|
| `tests/pricing.test.ts` | formula price computation + validation |
| `tests/pricing-overrides.test.ts` | `resolvePrices` hierarchy (variant → product → formula), tier helpers, `overridesOf` |
| `tests/offers.test.ts` | offer/MRP/discount derivation |
| `tests/stock-kind.test.ts` | `inferStockKind` (source label → typed movement) |
| `tests/diva-nlu.test.ts` | DIVA language detection, entity extraction, intent→tool mapping (incl. all client example commands), multi-turn slot-filling, set-price, damage, edge cases |
| `tests/inventory.test.ts` | dead/low/healthy classification |
| `tests/content.test.ts`, `imagePrompt`, `gateway`, `notify`, `smoke` | content, AI gateway fallback, notifications, smoke |

**Design rule that makes this possible:** business logic lives in pure modules (`lib/pricing.ts`, `lib/offers.ts`, `lib/diva/nlu.ts`, `lib/stockKind.ts`, `lib/inventory.ts`) with no React/Next/Supabase imports, so it's testable in isolation. Keep new logic there.

### Known limitation (honest)
DIVA's NLU is keyword-based on English/romanised-Hindi (Hinglish) tokens. It **detects** Devanagari script (`detectLanguage`) but does not yet extract intent from *pure* Devanagari commands — those need a transliteration step (future work). Romanised Hindi/Hinglish (the way the team actually types) is fully handled.

## 2. Integration tests (server actions) — to run in your environment

The server actions (`app/actions/*`) need a live Supabase. Recommended setup:

1. Create a **separate Supabase project** for testing (never the production one). Apply migrations `0001`–`0005`.
2. Add `.env.test` with that project's `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
3. Seed a few products/categories/customers (a `supabase/seed.sql` can be added).
4. Write tests that call the action and assert DB state, e.g.:

```ts
// example shape (needs the test Supabase env)
import { adjustStockAction } from "@/app/actions/stock";
// build FormData { sku, delta, source }, call the action, then read back
// products.qty and the latest stock_adjustments row (delta + kind).
```

Priority flows to cover: `createProductAction`, `updateProductAction` (incl. SKU rename uniqueness), `adjustStockAction` (product + variant rollup + kind), `savePricingAction` (overrides), `billEstimateAction` (cash↔GST), `recordReturnAction`, and `divaRun` for each tool.

**RBAC tests:** invoke an action with a non-owner role context and assert it is refused (e.g. staff without `inventory.remove` cannot reduce stock; `decideApprovalAction` requires `approvals.approve`).

## 3. E2E (Playwright) — to add in your environment

```bash
npm i -D @playwright/test && npx playwright install
```

Add `playwright.config.ts` and `e2e/*.spec.ts` (keep `e2e/` out of `tsconfig` `include`, or add it to `exclude`, so `next build` doesn't type-check specs). Happy-paths worth scripting:

- Owner logs in → creates a product (Basic tab) → adds a photo → publishes → it appears on `/shop`.
- Inventory tab: add/remove stock → History shows the movement with the right kind.
- Pricing tab: set a retail override → `/shop` reflects it; wholesale view shows wholesale.
- Catalogue `/catalog`: filter by subcategory, "select pieces to share" → link carries `?skus=`.
- DIVA: type "BD#### me 20 add kar do" → confirm → stock increases; a suggestion chip runs.

## CI

Run unit tests on every PR:

```yaml
# .github/workflows/test.yml (suggested)
- run: npm ci
- run: npm test
- run: npm run build
```
