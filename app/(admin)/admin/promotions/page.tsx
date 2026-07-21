export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { getCategories, getPromotionsAdmin } from "@/lib/supabase/queries";
import { requirePerm } from "@/lib/auth";
import { PromoUpload } from "@/components/admin/PromoUpload";
import { PromoCampaigns } from "@/components/admin/PromoCampaigns";

export const metadata = { title: "Owner Console · Promotions" };

export default async function PromotionsPage() {
  if (!(await requirePerm("marketing.manage"))) redirect("/admin/dashboard?denied=promotions");
  const [cats, promos] = await Promise.all([getCategories(), getPromotionsAdmin()]);
  const categories = ((cats as any[]) ?? []).map((c) => ({ name: c.name, slug: c.slug }));
  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Promotions</h1>
      <p className="text-sm text-muted mb-5">Run offers like the big storefronts — hero banners, welcome popups with a countdown &amp; coupon, or a scrolling strip. Create one, schedule it, and manage everything below.</p>

      {/* Create — placement, media, copy, coupon, schedule + live preview */}
      <PromoUpload categories={categories} />

      {/* Manage — Live / Scheduled / Expired / Paused, with pause & delete */}
      <h2 className="font-display text-2xl text-ink mt-8 mb-3">Your campaigns</h2>
      <PromoCampaigns promos={promos as any} />
    </main>
  );
}
