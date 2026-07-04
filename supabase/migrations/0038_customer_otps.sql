-- Blythe Diva — 0038: customer (retail) account login via one-time WhatsApp code.
--
-- One active code per phone (upsert on resend). Codes are stored HASHED with a 5-minute expiry and
-- an attempt counter for basic brute-force protection. On successful verify the code row is deleted
-- and an HMAC-signed httpOnly session cookie is set (see lib/customerAuth.ts).
create table if not exists public.customer_otps (
  phone text primary key,               -- normalised 10-digit mobile
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  last_sent_at timestamptz not null default now()
);
alter table public.customer_otps enable row level security;
