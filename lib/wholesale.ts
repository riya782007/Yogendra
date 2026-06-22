import "server-only";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";

/** Returns the logged-in, APPROVED wholesale customer, or null. */
export async function getWholesaleSession(): Promise<{ id: string; name: string } | null> {
  const id = cookies().get("bd_wholesale")?.value;
  if (!id) return null;
  const { data } = await supabaseServer()
    .from("customers").select("id,name,type,wholesale_approved").eq("id", id).maybeSingle();
  const c = data as any;
  if (!c || c.type !== "wholesale" || !c.wholesale_approved) return null;
  return { id: c.id, name: c.name };
}
