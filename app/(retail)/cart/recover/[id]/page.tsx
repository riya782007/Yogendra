export const dynamic = "force-dynamic";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { CartRestore } from "@/components/site/CartRestore";

export const metadata = { title: "Confirm your order · Blythe Diva" };

/**
 * Public recovery link for an abandoned cart. The owner shares this from the admin Abandoned Carts page
 * over WhatsApp; the customer opens it, their exact cart is restored, and they're taken to checkout to
 * pay. Only the items are used here — no customer contact details are exposed on the page.
 */
export default async function RecoverCartPage({ params }: { params: { id: string } }) {
  const { data } = await supabaseServer()
    .from("abandoned_carts")
    .select("items")
    .eq("id", params.id)
    .maybeSingle();

  const raw = ((data as any)?.items ?? []) as any[];
  if (!raw.length) notFound();

  const items = raw.map((i) => ({
    sku: String(i?.sku ?? ""),
    name: String(i?.name ?? ""),
    price: Math.max(0, Math.round(Number(i?.price) || 0)),
    qty: Math.max(1, Math.round(Number(i?.qty) || 1)),
    category: "",
  })).filter((i) => i.sku);

  if (!items.length) notFound();

  return <CartRestore items={items} />;
}
