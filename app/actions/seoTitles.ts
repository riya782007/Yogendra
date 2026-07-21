"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { seoTitleFromName } from "@/lib/seoTitle";

/**
 * One-click, no-cost SEO title pass over the WHOLE catalogue. Deterministically rewrites descriptive
 * product names into ChatGPT-style titles ("{Name} {Materials} {Design} {Type} for Women") and saves
 * them as the storefront title. It only touches names with real jewellery vocabulary — SKU-only names
 * and placeholder junk are left untouched (for the AI/vision flow). dryRun returns a preview without
 * writing. Reversible: it only sets generated_content.title; every other field still falls back to the
 * live template.
 */
export async function seoTitlePassAction(opts?: { dryRun?: boolean }): Promise<{
  ok: boolean; scanned?: number; rewritten?: number; skipped?: number;
  sample?: { before: string; after: string }[]; error?: string;
}> {
  if (!(await requirePerm("catalog.edit"))) return { ok: false, error: "Your role can't edit the catalogue." };
  const sb = supabaseServer();

  const cat = new Map<string, string>();
  { const { data } = await sb.from("categories").select("id,name"); for (const c of ((data as any[]) ?? [])) cat.set(c.id, c.name ?? ""); }

  const updates: { id: string; gc: any; before: string; after: string }[] = [];
  let scanned = 0, skipped = 0;
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("products").select("id,name,category_id,generated_content").order("id").range(from, from + 999);
    const arr = (data as any[]) ?? [];
    for (const p of arr) {
      scanned++;
      const next = seoTitleFromName(p.name ?? "", cat.get(p.category_id));
      const current = (p.generated_content?.title ?? p.name ?? "").trim();
      if (!next || next === current) { skipped++; continue; }
      updates.push({ id: p.id, gc: { ...(p.generated_content ?? {}), title: next }, before: current || "(no title)", after: next });
    }
    if (arr.length < 1000) break;
  }

  const sample = updates.slice(0, 20).map((u) => ({ before: u.before, after: u.after }));
  if (opts?.dryRun) return { ok: true, scanned, rewritten: updates.length, skipped, sample };

  const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
  for (const grp of chunk(updates, 60)) await Promise.all(grp.map((u) => sb.from("products").update({ generated_content: u.gc }).eq("id", u.id)));

  revalidatePath("/admin/catalogue"); revalidatePath("/shop");
  return { ok: true, scanned, rewritten: updates.length, skipped, sample };
}
