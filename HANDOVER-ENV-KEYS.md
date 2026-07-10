# BlytheDIVA — Vercel Environment Keys (Handover Checklist)

Add these in **Vercel → Project (yogendra) → Settings → Environment Variables** (Production + Preview).
Legend: **[set]** already configured · **[need]** you must collect · **[owner]** owner supplies · **[you decide]** pick a value.

---

## 1. Core platform (already working — just confirm)
| Key | What / where to get |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **[set]** Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **[set]** Supabase → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | **[set]** Supabase → API → service_role (secret) |
| `NEXT_PUBLIC_SITE_URL` | **[need]** Final domain, e.g. `https://blythediva.com` (until then `https://yogendra-ten.vercel.app`). Drives SEO, sitemap, WhatsApp links, Meta callback. |
| `NEXT_PUBLIC_STORE_NAME` | `Blythe Diva` |

## 2. Owner / auth
| Key | What / where |
|---|---|
| `OWNER_PASSCODE` | **[you decide]** the private admin login passcode (replace the demo `blythe2026`). |
| `OWNER_OTP` | **[you decide]** fallback OTP for owner login. |
| `OWNER_WHATSAPP_NUMBER` | **[owner]** owner's WhatsApp number (E.164, e.g. `9195820XXXXX`) — gets order/escalation alerts. |
| `ADMIN_SESSION_TOKEN` | **[you decide]** random 32+ char secret (session signing). |
| `CUSTOMER_SESSION_SECRET` | **[you decide]** random 32+ char secret (storefront customer sessions). |

## 3. AI (product pages, images, WhatsApp agent)
| Key | What / where |
|---|---|
| `GEMINI_API_KEY` | **[need]** Google AI Studio → API keys (text + agent intelligence). |
| `GEMINI_TEXT_MODEL` | `gemini-2.5-flash` (default is fine). |
| `GEMINI_IMAGE_MODEL` | `gemini-2.5-flash-image` (only if using API image-gen; the free copy-paste studio needs no key). |
| `OPENAI_API_KEY` | **[need, optional]** OpenAI → API keys — fallback for AI copy/embeddings/search. |
| `AI_BUDGET_PAISE` | **[you decide]** monthly AI spend cap in paise (e.g. `500000` = ₹5,000) — safety limiter. |

## 4. Payments (Razorpay — retail online orders)
| Key | What / where |
|---|---|
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | **[owner]** Razorpay Dashboard → Settings → API Keys → Key Id |
| `RAZORPAY_KEY_ID` | **[owner]** same Key Id |
| `RAZORPAY_KEY_SECRET` | **[owner]** Razorpay → API Keys → Key Secret |
| `RAZORPAY_WEBHOOK_SECRET` | **[owner]** Razorpay → Settings → Webhooks → add `https://<site>/api/razorpay/webhook` → secret |
| **Bank (shown for UPI/bank transfer):** `BLYTHE_BANK_NAME`, `BLYTHE_BANK_ACCOUNT`, `BLYTHE_BANK_IFSC`, `BLYTHE_BANK_BRANCH` | **[owner]** business bank details |

> Wholesale "pay + upload screenshot" flow (owner's new ask) reuses these + a storage bucket — see the plan; no new payment gateway key needed.

## 5. WhatsApp + Meta (CRM, order alerts, AI agent)
Using **Meta WhatsApp Cloud API** (recommended — the code + webhook are built for it).
| Key | What / where |
|---|---|
| `WHATSAPP_PROVIDER` | `meta` |
| `WHATSAPP_ACCESS_TOKEN` | **[need]** Meta → developers.facebook.com → your App → WhatsApp → API Setup → **permanent** access token (via a System User). |
| `WHATSAPP_PHONE_NUMBER_ID` | **[need]** Meta → WhatsApp → API Setup → Phone number ID. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | **[need]** Meta → WhatsApp → your WABA ID (for templates). |
| `WHATSAPP_APP_SECRET` | **[need]** Meta → App → Settings → Basic → App Secret (verifies incoming webhooks). |
| `WHATSAPP_VERIFY_TOKEN` | **[you decide]** any random string — you type the SAME value into Meta's webhook "Verify token". |
| `WHATSAPP_ORDER_TEMPLATE` | **[need]** the **template name** you create in Meta → WhatsApp Manager → Message Templates and get **approved** (e.g. `order_update`). This is the "template id". |
| `WHATSAPP_TEMPLATE_LANG` | `en` (or `en_US` — must match the template's language). |

**Meta callback (webhook) URL to paste into Meta → WhatsApp → Configuration → Webhook:**
```
Callback URL:  https://<your-site>/api/whatsapp/webhook
Verify token:  (the WHATSAPP_VERIFY_TOKEN value you chose above)
```
Subscribe the webhook to the **messages** field. Once verified, the AI agent receives and replies to customer WhatsApp messages.

*(Alternative provider — Twilio — if you prefer: `WHATSAPP_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`. Pick ONE provider, not both.)*

## 6. Delivery — Delhivery (to integrate)
| Key | What / where |
|---|---|
| `DELHIVERY_API_TOKEN` | **[owner]** Delhivery One (One.delhivery.com) → Settings → API → generate token. Needs an active Delhivery business account. |
| `DELHIVERY_CLIENT_NAME` | **[owner]** the registered client/company name in Delhivery. |
| `DELHIVERY_PICKUP_NAME` | **[owner]** the warehouse/pickup location name registered in Delhivery (Sadar Bazar). |
| `DELHIVERY_BASE_URL` | `https://track.delhivery.com` (production) or the staging URL while testing. |

## 7. Analytics (optional but recommended)
| Key | What / where |
|---|---|
| `NEXT_PUBLIC_GA4_ID` | **[owner]** GA4 → Admin → Data Streams → Measurement ID (`G-XXXX`). |
| `NEXT_PUBLIC_GA4_PROPERTY_ID` | **[owner]** GA4 property ID (numeric). |
| `GA4_API_SECRET` | **[owner]** GA4 → Data Streams → Measurement Protocol API secret. |

---

### Quick "who gives what" summary
- **You (developer) decide/generate:** `OWNER_PASSCODE`, `OWNER_OTP`, `ADMIN_SESSION_TOKEN`, `CUSTOMER_SESSION_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `AI_BUDGET_PAISE`, `NEXT_PUBLIC_SITE_URL`.
- **Owner supplies (accounts):** Razorpay keys + bank details, GA4, Delhivery token/details, owner WhatsApp number.
- **You collect from Meta:** WhatsApp access token, phone number ID, WABA ID, app secret, approved **template name** (= template id), and you paste our **callback URL** into Meta.
- **You collect from Google:** Gemini API key (and optionally OpenAI).
