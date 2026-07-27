export const dynamic = "force-dynamic";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { CartRestore } from "@/components/site/CartRestore";

/** Rich link preview so WhatsApp/social show a real product PHOTO (not just the link) when the owner
 *  shares this recovery link — the owner asked for images, and a link preview image is what a text
 *  WhatsApp message can display. Uses the first item's photo. */
export async function generateMetadata({ params }: { params: { id: string } }) {
  const sb = supabaseServer();
  const { data } = await sb.from("abandoned_carts").select("items").eq("id", params.id).maybeSingle();
  const items = (((data as any)?.items ?? []) as any[]).filter((i) => i?.sku);
  const count = items.reduce((n, i) => n + Math.max(1, Math.round(Number(i?.qty) || 1)), 0);
  let img: string | null = null;
  const firstSku = String(items[0]?.sku ?? "").trim();
  if (firstSku) {
    const { data: v } = await sb.from("variants").select("image_paths, product:products(thumbnail_path)").ilike("sku", firstSku).maybeSingle();
    const paths = Array.isArray((v as any)?.image_paths) ? ((v as any).image_paths as string[]) : [];
    img = paths.find((x) => typeof x === "string" && x.startsWith("http"))
      ?? ((v as any)?.product?.thumbnail_path?.startsWith?.("http") ? (v as any).product.thumbnail_path : null);
    if (!img) {
      const { data: p } = await sb.from("products").select("thumbnail_path").ilike("sku", firstSku).maybeSingle();
      if ((p as any)?.thumbnail_path?.startsWith?.("http")) img = (p as any).thumbnail_path;
    }
  }
  const title = "Your Blythe Diva cart — complete your order";
  const description = count ? `${count} piece${count === 1 ? "" : "s"} waiting in your bag. Tap to review & checkout.` : "Complete your order on Blythe Diva.";
  return {
    title,
    description,
    openGraph: { title, description, images: img ? [{ url: img }] : undefined },
    twitter: { card: img ? "summary_large_image" : "summary", title, description, images: img ? [img] : undefined },
  };
}

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
