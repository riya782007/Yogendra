"use server";
/**
 * Bulk-fix EXISTING nath / nose-pin listings with wrong Pendant Chain / Other Accessories specs.
 * Broader match: name, sku, category, subcategory, and NP-* skus — not only "nath" in text.
 */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

type ContentResult = { ok: boolean; sku: string; provider?: string; fallbackUsed?: boolean; title?: string; error?: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function nameForAi(name: string | null | undefined, sku: string): string {
  let n = (name ?? "").replace(/\s*\([^)]*\)\s*$/, "");
  if (sku) n = n.replace(new RegExp(`\\b${esc(sku)}\\b`, "ig"), " ");
  n = n.replace(/\s+/g, " ").trim();
  return /^[A-Za-z]{1,4}[-\s]?\d{1,6}[A-Za-z]?$/.test(n) ? "" : n;
}
function stripCode(title: string | undefined, sku: string): string {
  let t = title ?? "";
  if (sku) t = t.replace(new RegExp(`\\b${esc(sku)}\\b`, "ig"), " ");
  t = t.replace(/\b[A-Za-z]{1,4}\d{1,6}[A-Za-z]?\b/g, " ");
  return t.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").replace(/^[\s\-–|]+|[\s\-–|]+$/g, "").trim();
}

export async function fixNathListingsAction(): Promise<{
  total: number; fixed: number; skipped: number; results: ContentResult[];
  error?: string;
}> {
  if (!(await requirePerm("catalog.ai"))) {
    return { total: 0, fixed: 0, skipped: 0, results: [{ ok: false, sku: "", error: "not permitted" }], error: "not permitted" };
  }
  const { templateContent } = await import("@/lib/content");
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("products")
    .select("id,sku,name,status,generated_content, category:categories(name,slug), subcategory:subcategories(name), style_id")
    .limit(5000);
  if (error) {
    return { total: 0, fixed: 0, skipped: 0, results: [{ ok: false, sku: "", error: error.message }], error: error.message };
  }

  const nathRe = /\bnath\b|nathni|nose\s*pin|nosepin|nose\s*ring/i;
  const wrongSpecRe = /pendant\s*chain|other\s*accessor|one\s*necklace|necklace\s*with|pendant/i;
  const rows = ((data as any[]) ?? []).filter((p) => {
    const gc = (p.generated_content as any) ?? {};
    const specs = gc.specs ?? {};
    const catName = String(p.category?.name ?? "");
    const subName = String(p.subcategory?.name ?? "");
    const blob = [
      p.name, p.sku, catName, subName,
      gc.title, gc.description,
      specs.Category, specs["Work/Style"], specs["Box Containing"],
      ...(Array.isArray(gc.tags) ? gc.tags : []),
    ].filter(Boolean).join(" ");
    const looksLikeNath =
      nathRe.test(blob)
      || /nose/i.test(catName)
      || /nose|nath/i.test(subName)
      || /\bnp[-_]?\d/i.test(String(p.sku ?? ""));
    if (!looksLikeNath) return false;
    const cat = String(specs.Category ?? "");
    const work = String(specs["Work/Style"] ?? "");
    const box = String(specs["Box Containing"] ?? "");
    const looksWrong =
      !gc.title
      || wrongSpecRe.test(cat)
      || wrongSpecRe.test(work)
      || wrongSpecRe.test(box)
      || wrongSpecRe.test(String(gc.description ?? ""))
      || wrongSpecRe.test(String(gc.title ?? ""))
      || !/nose\s*pin|nath/i.test(cat || "x")
      || !/nose\s*pin|nath|one nose/i.test(box || "x");
    return looksWrong;
  });

  const results: ContentResult[] = [];
  let fixed = 0;
  for (const p of rows) {
    try {
      let styleName: string | undefined;
      if (p.style_id) {
        const { data: st } = await sb.from("styles").select("name").eq("id", p.style_id).maybeSingle();
        styleName = (st as any)?.name;
      }
      const content = templateContent({
        name: nameForAi(p.name, p.sku) || p.name || "Nath",
        sku: p.sku,
        categoryName: p.category?.name || "Nose Pin",
        subcategoryName: p.subcategory?.name,
        styleName,
        keywords: ["nath", "nose pin", "nathni"],
      });
      content.title = stripCode(content.title, p.sku) || content.title;
      content.specs = {
        ...(content.specs ?? {}),
        Category: "Nose Pin",
        "Work/Style": (content.specs?.["Work/Style"] && /nath|nose/i.test(String(content.specs["Work/Style"])))
          ? content.specs["Work/Style"]
          : "Nose Pin / Nath",
        "Box Containing": "One nose pin.",
      };
      const { error: updErr } = await sb
        .from("products")
        .update({ generated_content: content })
        .eq("id", p.id);
      if (updErr) {
        results.push({ ok: false, sku: p.sku, error: updErr.message });
        continue;
      }
      fixed++;
      results.push({ ok: true, sku: p.sku, title: content.title, provider: "template-nath-fix" });
      if (p.category?.slug) revalidatePath(`/shop/${p.category.slug}/${p.sku}`);
    } catch (e) {
      results.push({
        ok: false,
        sku: p.sku,
        error: e instanceof Error ? e.message : "fix failed",
      });
    }
  }
  revalidatePath("/admin/catalogue");
  revalidatePath("/shop");
  return { total: rows.length, fixed, skipped: rows.length - fixed, results };
}
