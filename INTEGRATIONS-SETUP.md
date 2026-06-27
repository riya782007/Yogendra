# Integrations setup — Payments & WhatsApp

Both integrations are **optional and safe**: until you add the keys, the site keeps working
(Cash-on-Delivery for orders, `wa.me` click-to-chat for WhatsApp). The moment you add the keys
in Vercel, online payment and automated WhatsApp turn on — no code change needed.

Add every key in **Vercel → your project → Settings → Environment Variables** (Production),
then redeploy. The names below match exactly what the code reads.

---

## 1. Razorpay — online payments (UPI / cards / netbanking / wallets)

**Get the keys:**
1. Create a free account at https://razorpay.com and complete KYC (business details + bank account). Until KYC is approved you can use **Test Mode** keys to try the full flow.
2. Razorpay Dashboard → **Settings → API Keys → Generate Key**.
3. You'll get a **Key Id** (starts `rzp_test_…` or `rzp_live_…`) and a **Key Secret** (shown once — copy it).

**Add these env vars:**

| Variable | Value |
|---|---|
| `RAZORPAY_KEY_ID` | your Key Id |
| `RAZORPAY_KEY_SECRET` | your Key Secret (keep private) |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | the **same** Key Id again (this one is sent to the browser) |

That's it. The checkout's **Pay Online** button starts working immediately. Payments are
verified server-side (signature check) before an order is created, so a paid order can't be faked.
Money for online orders settles to your Razorpay-linked bank account on Razorpay's normal cycle.

> Start with **Test Mode** keys, place a ₹1 test order with Razorpay's test card, confirm it lands
> in your Sales records, then swap in the **Live** keys.

---

## 2. WhatsApp — automatic order confirmations + owner alerts

Two ways to run this. **Meta Cloud API** is recommended (official, lowest cost, no vendor lock-in).
**Twilio** is fastest to try today.

### Option A — Meta WhatsApp Cloud API (recommended)

**Get the keys:**
1. Create a Meta Business account at https://business.facebook.com.
2. Go to https://developers.facebook.com → create an app → add the **WhatsApp** product.
3. In **WhatsApp → API Setup** you'll see a **Phone number ID** and a temporary access token. For production, create a **System User** with a **permanent** token (Business Settings → Users → System Users → generate token with `whatsapp_business_messaging`).
4. For messages sent **outside** a 24-hour window (i.e. order confirmations), WhatsApp requires a pre-approved **template**. Create one under **WhatsApp → Message Templates** (category: Utility), e.g. a body like:
   `Hi {{1}}, your order #{{2}} for {{3}} is confirmed ({{4}}). We'll WhatsApp your tracking soon.`
   The code fills `{{1}}=name, {{2}}=order id, {{3}}=amount, {{4}}=payment`.

**Add these env vars:**

| Variable | Value |
|---|---|
| `WHATSAPP_PROVIDER` | `meta` |
| `WHATSAPP_PHONE_NUMBER_ID` | the Phone number ID |
| `WHATSAPP_ACCESS_TOKEN` | your permanent token |
| `WHATSAPP_ORDER_TEMPLATE` | the approved template name (leave blank to send plain text inside the 24h window) |
| `WHATSAPP_TEMPLATE_LANG` | template language, e.g. `en` |
| `OWNER_WHATSAPP_NUMBER` | your number for new-order alerts, e.g. `919873151767` |

### Option B — Twilio WhatsApp (quickest to start)

1. Sign up at https://twilio.com → **Messaging → Try WhatsApp** to enable the sandbox (works in minutes), or onboard your own number for production.
2. Get **Account SID** and **Auth Token** from the Twilio Console.

| Variable | Value |
|---|---|
| `WHATSAPP_PROVIDER` | `twilio` |
| `TWILIO_ACCOUNT_SID` | your Account SID |
| `TWILIO_AUTH_TOKEN` | your Auth Token |
| `TWILIO_WHATSAPP_FROM` | e.g. `whatsapp:+14155238886` (sandbox) or your approved number |
| `OWNER_WHATSAPP_NUMBER` | your number for new-order alerts, e.g. `919873151767` |

---

## What fires automatically once configured

- **Order placed (COD or online):** the customer gets a WhatsApp confirmation, and you (owner) get a "new order" alert with the customer's name, phone, item count, and amount.
- If WhatsApp keys are missing or a send fails, the order still completes normally — notifications are best-effort and never block a sale.

## Optional extras already supported by the code

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_STORE_NAME` | store name shown in WhatsApp messages (default "Blythe Diva") |
| `GA4_MEASUREMENT_ID`, `GA4_API_SECRET` | server-side purchase tracking to Google Analytics |
