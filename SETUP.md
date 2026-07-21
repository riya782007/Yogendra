# Setup & Demo Notes

## Live infrastructure (already provisioned)
- **Supabase project:** `blythe-diva` (ref `qfybzwiyhnnpqumtzkpf`), region ap-south-1 (Mumbai).
- **API URL:** https://qfybzwiyhnnpqumtzkpf.supabase.co
- **Schema:** applied (28 tables, enums, indexes, RLS). See `supabase/migrations/`.
- **Seed:** loaded into the live DB — 24 SKUs, 19 variants, 5 retailers, 40 orders over ~8 weeks
  (₹99,616 revenue; 13 POS, 7 COD), dead/low/inactive stock, 1 pending OTP approval.

## The ONE secret you must attach
The public URL + anon key are already in `.env.local`. The admin dashboard reads RLS-protected
operational tables from the server, which needs the **service_role** key:

1. Open Supabase dashboard -> project **blythe-diva** -> Settings -> API.
2. Copy the **service_role** secret.
3. Paste it into `.env.local` as `SUPABASE_SERVICE_ROLE_KEY=...`

Nothing else is needed for the demo. No AI/Twilio/Delhivery/GA4 keys — the demo path is
seeded and deterministic by design.

## Demo OTP
The pending price-change approval is unlocked with OTP **482913** (seed value).

## Run
```bash
npm install
npm test          # 38 unit tests, no services needed
npm run dev       # needs .env.local with the service_role key
```
