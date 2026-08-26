/** Typed Supabase server client (service-role for admin writes). Server-only. */
import { createClient } from "@supabase/supabase-js";

export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env not set (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  return createClient(url, key, {
    auth: { persistSession: false },
    global: {
      // Admin/service reads must ALWAYS be live â€” never served from Next.js's fetch Data Cache.
      // Without this, a freshly created SKU showed up in Billing only 2â€“3 hours later: the product
      // list read here was cached by Next, and Billing wasn't in any action's revalidate list, so the
      // stale cache lingered until Vercel evicted it. `no-store` guarantees every admin read is fresh.
      // Public shop pages stay fast because they wrap their reads in unstable_cache (result-cached).
      fetch: (input: RequestInfo | URL, init: RequestInit = {}) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}

export { createClient };

