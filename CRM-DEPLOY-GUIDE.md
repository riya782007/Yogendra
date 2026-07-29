# BlytheDiva WhatsApp CRM — Final Steps (on YOUR account)

## ✅ Already done (by me, on your accounts)
- Supabase `blythediva22` — **database built & verified (36 tables)**
- wacrm **forked** → GitHub **`riya782007/blythediva-crm`**
- **Imported to your Vercel** → team **ry342315-6737's projects**, project **blythediva-crm**
- Added 3 non-secret env vars: `NEXT_PUBLIC_SUPABASE_URL`, `META_APP_ID`, `NEXT_PUBLIC_APP_LOCALE`

**Your live URL (goes live after Step 1–2):** https://blythediva-crm-delta.vercel.app

> The earlier `chalance` / `anshika-2807` project was a mistake — you can delete that Vercel project and GitHub repo whenever; it's not connected to anything.

---

## ⬜ STEP 1 — Add the 5 secret env vars (only you can — I can't type secret keys)

Vercel → **ry342315-6737's projects** → project **blythediva-crm** → **Settings → Environment Variables → Add**:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *(Supabase → `blythediva22` → Settings → API → **anon public**)* |
| `SUPABASE_SERVICE_ROLE_KEY` | *(Supabase → `blythediva22` → Settings → API → **service_role**)* |
| `ENCRYPTION_KEY` | `26f6030ced377de48699e04a82fad198ca2fc3fad2c8241639279e8f68e3c442` |
| `META_APP_SECRET` | `ed17c441fc99a27c61156ad68a03dc60` |
| `AUTOMATION_CRON_SECRET` | `13acb3e9957d847277e3958db60533490e8c54fb67e77d93b4573f88bd29cdc2` |
| `NEXT_PUBLIC_SITE_URL` | `https://blythediva-crm-delta.vercel.app` |

## ⬜ STEP 2 — Redeploy
Vercel → project → **Deployments** → top deployment → **⋯ → Redeploy**. Wait for the green ✓.
App is then live at **https://blythediva-crm-delta.vercel.app**.

## ⬜ STEP 3 — Connect WhatsApp + AI (inside the CRM)
1. Open the live URL → **sign up** (first account = admin).
2. **Settings → WhatsApp / Channels:** Phone Number ID (Meta → WhatsApp → API Setup), Permanent
   Access Token (`EAAOxGVPXjT4BR…`), register number **9873151767**.
3. **Settings → AI:** paste your AI key, enable auto-reply, add product/price knowledge base.

## ⬜ STEP 4 — Point the Meta webhook
Meta → App → **WhatsApp → Configuration → Webhooks**:
- Callback URL: `https://blythediva-crm-delta.vercel.app/api/whatsapp/webhook`
- Verify Token: your existing `WHATSAPP_VERIFY_TOKEN`
- Subscribe to **messages** → **Verify and Save**.

---

## Done ✅
Anyone messaging **9873151767** lands in the CRM inbox with an AI auto-reply. Customer-initiated
WhatsApp conversations are free — no card needed.

*Repo: github.com/riya782007/blythediva-crm · Vercel: ry342315-6737's projects / blythediva-crm*
