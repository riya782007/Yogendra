/** Typed Supabase server client (service-role for admin writes). Server-only. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const noStoreFetch = (input: RequestInfo | URL, init: RequestInit = {}) =>
  fetch(input, { ...init, cache: "no-store" });

function client(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: noStoreFetch },
  });
}

/** Admin writes + RLS-bypass reads. */
export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env not set (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  return client(url, key);
}

/**
 * Clients to try for public catalogue reads.
 * Anon + RLS (published products, all categories) is tried FIRST. A bad/expired
 * service_role JWT otherwise blanks shop, trade, search and the owner dashboard.
 */
export function supabaseReadClients(): SupabaseClient[] {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("Supabase env not set (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  const out: SupabaseClient[] = [];
  if (anon) out.push(client(url, anon));
  if (svc && svc !== anon) out.push(client(url, svc));
  if (!out.length) throw new Error("Supabase env not set (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  return out;
}

export { createClient };
