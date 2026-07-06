-- Blythe Diva — 0039: WhatsApp conversation log for the AI customer-care agent.
--
-- Records inbound customer messages, the agent's replies, and owner-escalation notices — used both
-- as an audit/CRM trail and to give the agent a few turns of short-term context. The unique index
-- on wa_message_id makes webhook retries idempotent (Meta re-delivers until it gets a 200).
create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  phone text not null,                 -- the customer's number (E.164 digits)
  direction text not null,             -- 'in' (from customer) | 'out' (agent→customer) | 'owner' (agent→owner)
  body text,
  escalated boolean not null default false,
  wa_message_id text,                  -- Meta's message id, for idempotent retries
  created_at timestamptz not null default now()
);
create index if not exists idx_wa_msg_phone on public.whatsapp_messages(phone, created_at desc);
create unique index if not exists idx_wa_msg_waid on public.whatsapp_messages(wa_message_id) where wa_message_id is not null;
alter table public.whatsapp_messages enable row level security;
