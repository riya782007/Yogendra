"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { computePrices, isValidPriceSet } from "@/lib/pricing";
import { getPricingFormula, getColorCodeMap } from "@/lib/supabase/queries";
import { requirePerm } from "@/lib/auth";
import { generateContentAction } from "@/app/actions/aiContent";
import { barcodeCodeForColor } from "@/lib/colors";
import { logActivity } from "@/lib/audit";

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function createCategoryAction(formData: FormData) {
  if (!(await requirePerm("catalog.edit"))) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const sb = supabaseServer();
  await sb.from("categories").insert({ name, slug: slugify(name) });
  await logActivity({ action: "category_created", ref: name, detail: `Added category “${name}”.` });
  revalidatePath("/admin/categories");
  revalidatePath("/shop");
}

/** Delete a category — only when it has no products (to avoid orphaning the catalogue). */
export async function deleteCategoryAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const sb = supabaseServer();
  const { count } = await sb.from("products").select("id", { count: "exact", head: true }).eq("category_id", id);
  if ((count ?? 0) > 0) return; // refuse to delete a non-empty category
  const { data: cat } = await sb.from("categories").select("name").eq("id", id).maybeSingle();
  await sb.from("categories").delete().eq("id", id);
  await logActivity({ action: "category_deleted", ref: id, detail: `Deleted category${(cat as any)?.name ? ` “${(cat as any).name}”` : ""}.` });
  revalidatePath("/admin/categories"); revalidatePath("/shop");
}

async function nextSku(sb: ReturnType<typeof supabaseServer>): Promise<number> {
  const { data } = await sb.from("products").select("sku");
  const max = Math.max(999, ...((data ?? []).map((r: any) => parseInt(String(r.sku).replace(/\D/g, ""), 10) || 0)));
  return max + 1;
}

/** A single owner-defined variant row from the Upload form.
 *  Any of colour / size / polish is enough — at least one must be present for the row to count.
 *  Price fields are in rupees (UI-friendly) and are converted to paise before insert.
 *  null/undefined/<=0 = "inherit the formula / product price". */
export type VariantInput = {
  color?: string;
  size?: string;
  polish?: string;
  sku?: string;                // manual SKU; blank = auto from parent SKU + attributes
  qty: number;
  retailRupees?: number | null;
  wholesaleRupees?: number | null;
  mrpRupees?: number | null;
};
export type NewProduct = {
  categoryId: string;
  name: string;
  basePriceRupees: number;
  qty: number;
  type: "simple" | "configurable";
  colors: string[];
  manualSku?: string;
  /** Optional richer variant definitions. If provided (and type === 'configurable'),
   *  these take precedence over the legacy `colors` comma-list shortcut. */
  variants?: VariantInput[];
};
export type RowResult = { row: number; ok: boolean; sku?: string; error?: string };

async function insertOne(sb: ReturnType<typeof supabaseServer>, formula: any, n: NewProduct, skuNum: number, publish = false): Promise<RowResult> {
  if (!n.name) return { row: skuNum, ok: false, error: "Missing name" };
  if (!(n.basePriceRupees > 0)) return { row: skuNum, ok: false, error: "Base price must be > 0" };
  if (!n.categoryId) return { row: skuNum, ok: false, error: "Missing category" };
  const prices = computePrices(n.basePriceRupees * 100, formula);
  if (!isValidPriceSet(prices)) return { row: skuNum, ok: false, error: "Computed price invalid — flagged" };
  // Use a manually-entered SKU if provided, else auto-generate BD####.
  const manual = n.manualSku?.trim().toUpperCase().replace(/\s+/g, "-");
  const sku = manual || `BD${skuNum}`;
  if (manual) {
    const { data: dup } = await sb.from("products").select("id").eq("sku", manual).maybeSingle();
    if (dup) return { row: skuNum, ok: false, error: `SKU ${manual} already exists` };
  }

  // ----- Decide variant strategy -----
  // 1) Explicit variants[] from the Upload form (preferred — has colour+size+polish+prices).
  // 2) Legacy `colors` comma-list shortcut (kept for back-compat with AI/CSV import).
  const explicitVariants = n.type === "configurable"
    ? (n.variants ?? []).filter((v) => ((v.color ?? "").trim() || (v.size ?? "").trim() || (v.polish ?? "").trim()))
    : [];
  const useExplicit = explicitVariants.length > 0;

  if (useExplicit) {
    // Catch duplicate manual SKUs early so we don't half-insert.
    const manuals = explicitVariants.map((v) => (v.sku ?? "").trim().toUpperCase().replace(/\s+/g, "-")).filter(Boolean);
    const seen = new Set<string>();
    for (const s of manuals) {
      if (seen.has(s)) return { row: skuNum, ok: false, error: `Duplicate variant SKU ${s} in the form` };
      seen.add(s);
    }
    if (seen.size) {
      const { data: dup } = await sb.from("variants").select("sku").in("sku", [...seen]).limit(1);
      const taken = (dup as any[] | null)?.[0]?.sku as string | undefined;
      if (taken) return { row: skuNum, ok: false, error: `Variant SKU ${taken} already exists` };
    }
  }

  // When the owner spelled out explicit variant rows, the product's total qty is the sum of
  // those rows — this matches the legacy split-evenly behaviour but is exact (no rounding
  // loss) and it keeps the product header in sync with the Variants tab.
  const productQty = useExplicit
    ? explicitVariants.reduce((s, v) => s + Math.max(0, Math.floor(Number(v.qty) || 0)), 0)
    : Math.max(0, n.qty);

  // Incomplete products (no photo yet) stay DRAFT so they never appear on the storefront
  // looking unfinished. They publish automatically once a photo is added, or via Show.
  const { data: prod, error } = await sb.from("products").insert({
    category_id: n.categoryId, sku, name: n.name, type: n.type,
    base_wholesale: n.basePriceRupees * 100, qty: productQty, status: publish ? "published" : "draft", last_movement_at: new Date().toISOString(),
  }).select("id").single();
  if (error) return { row: skuNum, ok: false, error: error.message };

  // Log the opening inventory as a stock movement so it shows in the product's history
  // (the "Opening stock" line), just like purchases/sales/returns do.
  const opening: any[] = [];
  const toPaise = (rs?: number | null) => (rs != null && Number.isFinite(rs) && rs > 0 ? Math.round(rs * 100) : null);

  // Pillar 11 — when auto-generating variant SKUs, prefer the canonical colour code from
  // the colours master (variant_options.barcode_code) so the printed barcode reads
  // "{productSku}-RED" / "{productSku}-MULTI1" / etc., not a 5-char truncation.
  // Static fallback in lib/colors comes into play if the colour isn't in the master yet.
  const colorCodes = useExplicit && explicitVariants.some((v) => (v.color ?? "").trim())
    ? await getColorCodeMap()
    : ({} as Record<string, string>);
  const autoVariantSku = (parent: string, parts: { color?: string | null; size?: string | null; polish?: string | null }) => {
    const code = parts.color ? (colorCodes[parts.color.toLowerCase()] ?? barcodeCodeForColor(parts.color)) : null;
    const sizeCode = parts.size ? parts.size.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) : null;
    const polishCode = parts.polish ? parts.polish.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) : null;
    const suffix = [code, sizeCode, polishCode].filter(Boolean).join("-") || "VAR";
    return `${parent}-${suffix}`;
  };

  if (useExplicit) {
    const variantRows = explicitVariants.map((v) => {
      const color = (v.color ?? "").trim();
      const size = (v.size ?? "").trim();
      const polish = (v.polish ?? "").trim();
      const manualV = (v.sku ?? "").trim().toUpperCase().replace(/\s+/g, "-");
      return {
        product_id: prod!.id,
        color: color || null,
        size: size || null,
        polish: polish || null,
        sku: manualV || autoVariantSku(sku, { color, size, polish }),
        qty: Math.max(0, Math.floor(Number(v.qty) || 0)),
        retail_override: toPaise(v.retailRupees ?? null),
        wholesale_override: toPaise(v.wholesaleRupees ?? null),
        mrp_override: toPaise(v.mrpRupees ?? null),
      };
    });
    const { data: vs, error: vErr } = await sb.from("variants").insert(variantRows).select("id, qty");
    if (vErr) {
      // Best-effort rollback so we don't leave an orphaned product when only the variants failed.
      await sb.from("products").delete().eq("id", prod!.id);
      return { row: skuNum, ok: false, error: vErr.message };
    }
    for (const v of (vs as any[]) ?? []) {
      if (v.qty > 0) opening.push({ product_id: prod!.id, variant_id: v.id, delta: v.qty, kind: "opening", source: "create", reason: "Opening stock" });
    }
    // Grow the autocomplete master list so newly-typed colours/sizes/polishes show as
    // suggestions next time (same behaviour as addVariantAction's rememberOptions).
    const optRows: { kind: string; value: string }[] = [];
    for (const v of explicitVariants) {
      const c = (v.color ?? "").trim(), z = (v.size ?? "").trim(), p = (v.polish ?? "").trim();
      if (c) optRows.push({ kind: "color", value: c });
      if (z) optRows.push({ kind: "size", value: z });
      if (p) optRows.push({ kind: "polish", value: p });
    }
    if (optRows.length) await sb.from("variant_options").upsert(optRows, { onConflict: "kind,value", ignoreDuplicates: true });
  } else if (n.type === "configurable" && n.colors.length) {
    const per = Math.floor(n.qty / Math.max(1, n.colors.length));
    // Bulk colours-comma shortcut: also honour the canonical colour code so old import
    // paths print proper barcodes (BD2024-RED instead of BD2024-RED5).
    const legacyCodes = await getColorCodeMap();
    const { data: vs } = await sb.from("variants").insert(n.colors.map((c) => {
      const code = legacyCodes[c.toLowerCase()] ?? barcodeCodeForColor(c) ?? c.slice(0, 3).toUpperCase();
      return { product_id: prod!.id, color: c, sku: `${sku}-${code}`, qty: per };
    })).select("id, qty");
    for (const v of (vs as any[]) ?? []) if (v.qty > 0) opening.push({ product_id: prod!.id, variant_id: v.id, delta: v.qty, kind: "opening", source: "create", reason: "Opening stock" });
    // Also remember the colours so they appear as suggestions on the Variants tab later.
    const optRows = n.colors.map((c) => ({ kind: "color", value: c.trim() })).filter((r) => r.value);
    if (optRows.length) await sb.from("variant_options").upsert(optRows, { onConflict: "kind,value", ignoreDuplicates: true });
  } else if (n.qty > 0) {
    opening.push({ product_id: prod!.id, delta: n.qty, kind: "opening", source: "create", reason: "Opening stock" });
  }
  if (opening.length) await sb.from("stock_adjustments").insert(opening);
  return { row: skuNum, ok: true, sku };
}

export async function createProductAction(p: NewProduct): Promise<RowResult> {
  if (!(await requirePerm("catalog.create"))) return { row: 0, ok: false, error: "Your role can't add products." };
  const sb = supabaseServer();
  const [formula, sku] = await Promise.all([getPricingFormula(), nextSku(sb)]);
  const res = await insertOne(sb, formula, p, sku);
  // #6: every newly created product gets AI-written SEO (title/description/keywords).
  // Best-effort — falls back to a strong heuristic when no AI key is set, and never blocks creation.
  if (res.ok && res.sku) { try { await generateContentAction(res.sku); } catch { /* SEO is non-blocking */ } }
  revalidatePath("/admin/catalogue"); revalidatePath("/shop");
  return res;
}

export async function bulkUploadAction(categoryId: string, rows: Omit<NewProduct, "categoryId">[]): Promise<{ created: number; results: RowResult[] }> {
  if (!(await requirePerm("catalog.create"))) return { created: 0, results: [{ row: 0, ok: false, error: "Your role can't add products." }] };
  const sb = supabaseServer();
  const formula = await getPricingFormula();
  let skuNum = await nextSku(sb);
  const results: RowResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const res = await insertOne(sb, formula, { ...r, categoryId }, skuNum);
    results.push({ ...res, row: i + 1 });
    if (res.ok) skuNum++;
  }
  revalidatePath("/admin/catalogue"); revalidatePath("/shop");
  return { created: results.filter((r) => r.ok).length, results };
}

const BUCKET = "product-media";
async function ensureMediaBucket(sb: ReturnType<typeof supabaseServer>) {
  await sb.storage.createBucket(BUCKET, { public: true }).catch(() => {});
}

export async function createProductWithImageAction(formData: FormData): Promise<RowResult> {
  if (!(await requirePerm("catalog.create"))) return { row: 0, ok: false, error: "Your role can't add products." };
  const sb = supabaseServer();

  // Optional structured variants payload from the Upload form — JSON-encoded array of
  // VariantInput. Silently ignored if malformed; falls back to the colours-comma shortcut.
  let variants: VariantInput[] | undefined;
  const variantsRaw = String(formData.get("variants") ?? "").trim();
  if (variantsRaw) {
    try {
      const parsed = JSON.parse(variantsRaw);
      if (Array.isArray(parsed)) {
        variants = parsed
          .map((v: any) => ({
            color: v?.color ? String(v.color).trim() : undefined,
            size: v?.size ? String(v.size).trim() : undefined,
            polish: v?.polish ? String(v.polish).trim() : undefined,
            sku: v?.sku ? String(v.sku).trim() : undefined,
            qty: Math.max(0, Math.floor(Number(v?.qty) || 0)),
            retailRupees: v?.retailRupees != null && Number(v.retailRupees) > 0 ? Number(v.retailRupees) : null,
            wholesaleRupees: v?.wholesaleRupees != null && Number(v.wholesaleRupees) > 0 ? Number(v.wholesaleRupees) : null,
            mrpRupees: v?.mrpRupees != null && Number(v.mrpRupees) > 0 ? Number(v.mrpRupees) : null,
          }))
          // Drop rows that don't define ANY attribute (Colour / Size / Polish).
          .filter((v) => Boolean(v.color || v.size || v.polish));
      }
    } catch { /* ignore — legacy colours-comma path still works */ }
  }

  const n: NewProduct = {
    categoryId: String(formData.get("categoryId") ?? ""),
    name: String(formData.get("name") ?? "").trim(),
    basePriceRupees: Number(formData.get("price")) || 0,
    qty: Number(formData.get("qty")) || 0,
    type: String(formData.get("type")) === "configurable" ? "configurable" : "simple",
    colors: String(formData.get("colors") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    manualSku: String(formData.get("sku") ?? "").trim() || undefined,
    variants,
  };
  const [formula, skuNum] = await Promise.all([getPricingFormula(), nextSku(sb)]);
  const file = formData.get("image") as File | null;
  const hasPhoto = !!(file && typeof file === "object" && file.size > 0);
  // Publish immediately only when a photo is attached (complete listing); otherwise draft.
  const res = await insertOne(sb, formula, n, skuNum, hasPhoto);
  if (res.ok && res.sku && hasPhoto && file) {
    await ensureMediaBucket(sb);
    const ext = ((file.type.split("/")[1]) || "jpg").replace("jpeg", "jpg");
    const path = `${res.sku}/source.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: file.type || "image/jpeg", upsert: true });
    if (!up.error) {
      const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
      const { data: prod } = await sb.from("products").select("id").eq("sku", res.sku).single();
      if (prod) await sb.from("product_images").insert({ product_id: prod.id, path: pub.publicUrl, kind: "flatlay", sort: 0 });
    }
  }
  revalidatePath("/admin/catalogue"); revalidatePath("/shop");
  if (res.ok && res.sku) await logActivity({ action: "product_created", ref: res.sku, detail: `Added ${n.name} (${res.sku})${hasPhoto ? " · published" : " · draft"}.` });
  return res;
}

// ---- Live-progress inventory build: parse first, then insert one row at a time ----
export type ParsedRow = Omit<NewProduct, "categoryId">;

/** AI/naive parse a messy list into clean rows WITHOUT inserting (so the client can show progress). */
export async function aiParseRowsAction(rawText: string): Promise<{ rows: ParsedRow[]; usedAi: boolean }> {
  if (!(await requirePerm("catalog.create"))) return { rows: [], usedAi: false };
  const text = (rawText ?? "").trim().slice(0, 8000);
  let rows: ParsedRow[] = [];
  let usedAi = false;
  if (text && (groqConfigured() || openaiConfigured())) {
    const system = `You convert a messy product list into clean JSON for a jewellery store. Output STRICT JSON:
{"rows":[{
  "name":string,
  "base_price":number,                        // wholesale cost in rupees, no currency symbols
  "qty":number,                                // total stock, integer
  "type":"simple"|"configurable",
  "colors":string[],                           // ["Red","Green"] — empty = simple
  "sku":string,                                // optional existing product code — copy verbatim, else ""
  "variants":[{                                // optional — only when sizes / polishes / per-variant prices appear
    "color":string,                            // any of color / size / polish must be present per row
    "size":string,
    "polish":string,
    "sku":string,
    "qty":number,
    "retail":number,                           // optional rupees override
    "wholesale":number,
    "mrp":number
  }]
}]}.
The input may be CSV, tab-separated, or freeform, with columns in any order or different header names: price/cost/wholesale -> base_price (rupees, number); quantity/stock/pcs -> qty (int); colours/variants -> colors[]; sku/code/item code -> sku (verbatim if given else ""). When the row mentions sizes (S/M/L, 2.4, 2.6 etc.) or polishes (Antique, Oxidised, Matte etc.) or per-variant prices, populate "variants" instead of plain "colors" and set type="configurable". A row with >1 colour OR any variants[] entry must be "configurable". Ignore header rows, currency symbols, and totals. Return ONLY JSON.`;
    try {
      const out = groqConfigured() ? await groqChat({ system, user: text, json: true }) : await openaiChat({ system, user: text, json: true });
      const parsed = JSON.parse(out);
      rows = (parsed.rows ?? []).map((r: any) => {
        // Pillar 10 — capture full variants when the AI emits them. Each entry can carry
        // colour/size/polish + qty + per-variant retail/wholesale/MRP. Rows with at least
        // one structured variant flip to "configurable" regardless of the colors[] hint.
        const variantsRaw: any[] = Array.isArray(r.variants) ? r.variants : [];
        const variants = variantsRaw
          .map((v: any) => ({
            color: v?.color ? String(v.color).trim() : undefined,
            size: v?.size ? String(v.size).trim() : undefined,
            polish: v?.polish ? String(v.polish).trim() : undefined,
            sku: v?.sku ? String(v.sku).trim() : undefined,
            qty: Math.max(0, Math.floor(Number(v?.qty) || 0)),
            retailRupees: v?.retail != null && Number(v.retail) > 0 ? Number(v.retail) : null,
            wholesaleRupees: v?.wholesale != null && Number(v.wholesale) > 0 ? Number(v.wholesale) : null,
            mrpRupees: v?.mrp != null && Number(v.mrp) > 0 ? Number(v.mrp) : null,
          }))
          .filter((v: any) => v.color || v.size || v.polish);
        const isConfigurable = r.type === "configurable" || variants.length > 0 || (Array.isArray(r.colors) && r.colors.length > 1);
        return {
          name: String(r.name ?? "").trim(),
          basePriceRupees: Number(r.base_price) || 0,
          qty: parseInt(r.qty, 10) || 0,
          type: (isConfigurable ? "configurable" : "simple") as "simple" | "configurable",
          colors: Array.isArray(r.colors) ? r.colors.map((c: any) => String(c).trim()).filter(Boolean) : [],
          manualSku: r.sku ? String(r.sku).trim() : undefined,
          variants: variants.length ? variants : undefined,
        };
      }).filter((r: any) => r.name);
      usedAi = rows.length > 0;
    } catch { /* fall through */ }
  }
  if (!usedAi) {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const header = lines[0]?.toLowerCase().split(",").map((s) => s.trim()) ?? [];
    const hasHeader = header.includes("name");
    if (hasHeader) {
      // Header-aware: columns can be in any order; sku & colours optional.
      const idx = (...names: string[]) => header.findIndex((h) => names.includes(h));
      const iName = idx("name", "product", "design"), iPrice = idx("base_price", "price", "cost", "wholesale");
      const iQty = idx("qty", "quantity", "stock", "pcs"), iType = idx("type");
      const iColors = idx("colours", "colors", "variants"), iSku = idx("sku", "code", "item code");
      rows = lines.slice(1).map((l) => {
        const c = l.split(",").map((s) => s?.trim() ?? "");
        const colors = iColors >= 0 ? (c[iColors] ?? "").split("|").map((s) => s.trim()).filter(Boolean) : [];
        const type = ((iType >= 0 && c[iType] === "configurable") || colors.length > 1 ? "configurable" : "simple") as "simple" | "configurable";
        return { name: iName >= 0 ? c[iName] : "", basePriceRupees: iPrice >= 0 ? Number(c[iPrice]) || 0 : 0, qty: iQty >= 0 ? Number(c[iQty]) || 0 : 0, type, colors, manualSku: iSku >= 0 ? (c[iSku] || undefined) : undefined };
      }).filter((r) => r.name);
    } else {
      // Positional fallback: name, base_price, qty, type, colours|pipe, sku
      rows = lines.map((l) => {
        const [name, price, qty, type, colors, sku] = l.split(",").map((s) => s?.trim() ?? "");
        return { name, basePriceRupees: Number(price) || 0, qty: Number(qty) || 0, type: (type === "configurable" ? "configurable" : "simple") as "simple" | "configurable", colors: (colors ?? "").split("|").map((s) => s.trim()).filter(Boolean), manualSku: sku || undefined };
      }).filter((r) => r.name);
    }
  }
  return { rows, usedAi };
}

/** Insert ONE product row. The client calls this per row so it can render live progress. */
export async function createOneRowAction(categoryId: string, row: ParsedRow): Promise<RowResult & { name?: string }> {
  if (!(await requirePerm("catalog.create"))) return { row: 0, ok: false, error: "Your role can't add products." };
  const sb = supabaseServer();
  const formula = await getPricingFormula();
  const skuNum = await nextSku(sb);
  const res = await insertOne(sb, formula, { ...row, categoryId }, skuNum);
  revalidatePath("/admin/catalogue"); revalidatePath("/shop");
  return { ...res, name: row.name };
}

/** Hide (draft) or show (publish) a product on the storefront. */
export async function setProductVisibilityAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.publish"))) return;
  const sku = String(formData.get("sku") ?? "").trim();
  const status = String(formData.get("status") ?? "") === "published" ? "published" : "draft";
  if (!sku) return;
  await supabaseServer().from("products").update({ status }).eq("sku", sku);
  await logActivity({ action: status === "published" ? "product_shown" : "product_hidden", ref: sku, detail: `${sku} ${status === "published" ? "shown on" : "hidden from"} the store.` });
  revalidatePath("/admin/inventory"); revalidatePath("/admin/catalogue"); revalidatePath("/shop");
}

/** #1: mark a product as wholesale-only (hidden from the D2C storefront, shown to retailers). */
export async function setWholesaleOnlyAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const sku = String(formData.get("sku") ?? "").trim();
  const on = String(formData.get("wholesale_only") ?? "") === "1";
  if (!sku) return;
  await supabaseServer().from("products").update({ wholesale_only: on }).eq("sku", sku);
  await logActivity({ action: "product_wholesale_only", ref: sku, detail: `${sku} set to ${on ? "wholesale-only" : "available to all"}.` });
  revalidatePath(`/admin/catalogue/${sku}`); revalidatePath("/shop"); revalidatePath("/wholesale");
}

const LABEL_COLORS = ["emerald", "gold", "wine", "rose", "blue", "ink"];

/** #9/#31: create an owner-defined label. */
export async function createLabelAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "emerald").trim();
  if (!name) return;
  await supabaseServer().from("labels").upsert({ name, color: LABEL_COLORS.includes(color) ? color : "emerald" }, { onConflict: "name", ignoreDuplicates: true });
  revalidatePath("/admin/categories");
}

export async function deleteLabelAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await supabaseServer().from("labels").delete().eq("id", id);
  revalidatePath("/admin/categories");
}

/** #9/#31: attach/detach a label on a product (from the SKU's Catalog tab). */
export async function toggleProductLabelAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const sku = String(formData.get("sku") ?? "").trim();
  const labelId = String(formData.get("label_id") ?? "");
  const on = String(formData.get("on") ?? "") === "1";
  if (!sku || !labelId) return;
  const sb = supabaseServer();
  const { data: p } = await sb.from("products").select("id").ilike("sku", sku).maybeSingle();
  if (!p) return;
  if (on) await sb.from("product_labels").upsert({ product_id: (p as any).id, label_id: labelId }, { onConflict: "product_id,label_id", ignoreDuplicates: true });
  else await sb.from("product_labels").delete().eq("product_id", (p as any).id).eq("label_id", labelId);
  revalidatePath(`/admin/catalogue/${sku}`); revalidatePath("/admin/catalogue"); revalidatePath("/admin/inventory");
}

/** Delete a product (or hide it if it has past orders, to keep the books intact). */
export async function deleteProductAction(formData: FormData): Promise<{ ok: boolean; message: string }> {
  if (!(await requirePerm("catalog.delete"))) return { ok: false, message: "Your role can't delete products." };
  const sku = String(formData.get("sku") ?? "").trim();
  if (!sku) return { ok: false, message: "Missing SKU" };
  const sb = supabaseServer();
  const { data: p } = await sb.from("products").select("id,name").eq("sku", sku).maybeSingle();
  if (!p) return { ok: false, message: "Product not found" };
  const pid = (p as any).id;
  await sb.from("product_images").delete().eq("product_id", pid);
  await sb.from("variants").delete().eq("product_id", pid);
  const { error } = await sb.from("products").delete().eq("id", pid);
  revalidatePath("/admin/inventory"); revalidatePath("/admin/catalogue"); revalidatePath("/shop");
  if (error) {
    await sb.from("products").update({ status: "draft" }).eq("id", pid);
    await logActivity({ action: "product_hidden", ref: sku, detail: `${(p as any).name} (${sku}) has past orders — hidden from the store instead of deleted.` });
    return { ok: true, message: `${sku} has past orders — hidden from the store instead of deleted.` };
  }
  await logActivity({ action: "product_deleted", ref: sku, detail: `Deleted ${(p as any).name} (${sku}).` });
  return { ok: true, message: `Deleted ${(p as any).name} (${sku}).` };
}

export async function createCategoryJsonAction(name: string): Promise<{ id: string; name: string } | null> {
  const nm = name.trim(); if (!nm) return null;
  const sb = supabaseServer();
  const { data } = await sb.from("categories").insert({ name: nm, slug: slugify(nm) }).select("id,name").single();
  revalidatePath("/admin/categories"); revalidatePath("/shop"); revalidatePath("/admin/upload");
  return data ? { id: (data as any).id, name: (data as any).name } : null;
}

// ---------------------------------------------------------------------------
// Subcategories (category hierarchy) — backs the management UI + DIVA.
// Requires migration 0002 (subcategories, product_subcategory_map).
// ---------------------------------------------------------------------------

/** Create a subcategory under a parent category (by id or name). */
export async function createSubcategoryAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const sb = supabaseServer();
  let categoryId = String(formData.get("category_id") ?? "").trim() || null;
  const parentName = String(formData.get("parent") ?? "").trim();
  if (!categoryId && parentName) {
    const { data: pc } = await sb.from("categories").select("id").ilike("name", parentName).maybeSingle();
    categoryId = (pc as any)?.id ?? null;
  }
  await sb.from("subcategories").insert({ name, slug: slugify(name), category_id: categoryId });
  await logActivity({ action: "subcategory_created", ref: name, detail: `Added subcategory “${name}”.` });
  revalidatePath("/admin/categories"); revalidatePath("/shop");
}

/** Rename a subcategory. */
export async function renameSubcategoryAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;
  await supabaseServer().from("subcategories").update({ name, slug: slugify(name) }).eq("id", id);
  revalidatePath("/admin/categories"); revalidatePath("/shop");
}

/** Delete a subcategory (products fall back to their parent category; map rows cascade). */
export async function deleteSubcategoryAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const sb = supabaseServer();
  const { data: sub } = await sb.from("subcategories").select("name").eq("id", id).maybeSingle();
  await sb.from("subcategories").delete().eq("id", id);
  await logActivity({ action: "subcategory_deleted", ref: id, detail: `Deleted subcategory${(sub as any)?.name ? ` “${(sub as any).name}”` : ""}.` });
  revalidatePath("/admin/categories"); revalidatePath("/shop");
}

/** Pillar 12: set the AI image style for a subcategory — 'auto' | 'indian' | 'western'.
 *  Drives which model the per-product photo generator uses (e.g. western necklace → foreign model). */
export async function setSubcategoryStyleAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "").trim();
  const style = String(formData.get("style") ?? "auto").trim();
  if (!id || !["auto", "indian", "western"].includes(style)) return;
  await supabaseServer().from("subcategories").update({ image_style: style }).eq("id", id);
  revalidatePath("/admin/categories");
}

/** Reorder subcategories: pass an ordered list of ids; sets their `sort` to match. */
export async function reorderSubcategoriesAction(ids: string[]): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const sb = supabaseServer();
  await Promise.all(ids.map((id, i) => sb.from("subcategories").update({ sort: i }).eq("id", id)));
  revalidatePath("/admin/categories"); revalidatePath("/shop");
}

/** Move a product into a subcategory (sets the primary; trigger keeps the M2M map in sync). */
export async function moveProductToSubcategoryAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const sku = String(formData.get("sku") ?? "").trim();
  const subcategoryId = String(formData.get("subcategory_id") ?? "").trim() || null;
  if (!sku) return;
  const sb = supabaseServer();
  await sb.from("products").update({ subcategory_id: subcategoryId }).eq("sku", sku);
  revalidatePath("/admin/categories"); revalidatePath("/admin/catalogue"); revalidatePath("/shop");
}

// ---------------------------------------------------------------------------
// Pricing overrides (Phase 4) — explicit per-product / per-variant tier prices.
// Requires migration 0003. Blank/0 input clears the override (back to formula).
// ---------------------------------------------------------------------------

/** Rupees text → integer paise, or null when blank / non-positive (= inherit formula). */
function rupeesToPaiseOrNull(raw: FormDataEntryValue | null): number | null {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export async function savePricingAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.price_edit"))) return;
  const sku = String(formData.get("sku") ?? "").trim();
  if (!sku) return;
  const sb = supabaseServer();
  const { data: prod } = await sb.from("products").select("id").eq("sku", sku).maybeSingle();
  if (!prod) return;

  // Product-level overrides.
  await sb.from("products").update({
    wholesale_override: rupeesToPaiseOrNull(formData.get("p_wholesale")),
    retail_override: rupeesToPaiseOrNull(formData.get("p_retail")),
    mrp_override: rupeesToPaiseOrNull(formData.get("p_mrp")),
  }).eq("id", (prod as any).id);

  // Variant-level overrides — fields named v_<variantId>_(w|r|m).
  const byVariant = new Map<string, { w: number | null; r: number | null; m: number | null }>();
  for (const [key, val] of formData.entries()) {
    const mm = /^v_(.+)_(w|r|m)$/.exec(key);
    if (!mm) continue;
    const [, id, tier] = mm;
    const cur = byVariant.get(id) ?? { w: null, r: null, m: null };
    (cur as any)[tier] = rupeesToPaiseOrNull(val);
    byVariant.set(id, cur);
  }
  await Promise.all(
    [...byVariant.entries()].map(([id, o]) =>
      sb.from("variants").update({ wholesale_override: o.w, retail_override: o.r, mrp_override: o.m }).eq("id", id),
    ),
  );

  await logActivity({ action: "price_changed", ref: sku, detail: `Prices updated for ${sku}.` });
  revalidatePath(`/admin/catalogue/${sku}`);
  revalidatePath(`/admin/product/${sku}`);
  revalidatePath("/shop");
  revalidatePath("/wholesale");
}

/** Module 4 — save the GLOBAL pricing formula (pricing_settings): the %-build-up
 *  (cost → +shipping% → +packing% → +promotion% → +reseller% (wholesale) →
 *  +customer_discount% (retail) → +mrp% (MRP)) plus the legacy multipliers and rounding.
 *  Re-prices the whole catalogue, so it's permission-gated and revalidates the storefront. */
export async function savePricingFormulaAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.price_edit"))) return;
  const num = (k: string, d: number) => {
    const v = Number(formData.get(k));
    return Number.isFinite(v) ? v : d;
  };
  const patch = {
    use_buildup: String(formData.get("use_buildup") ?? "") === "on",
    shipping_pct: num("shipping_pct", 10),
    packing_pct: num("packing_pct", 11.36),
    promotion_pct: num("promotion_pct", 10.2),
    reseller_pct: num("reseller_pct", 15),
    customer_discount_pct: num("customer_discount_pct", 5),
    mrp_pct: num("mrp_pct", 25),
    wholesale_markup_pct: num("wholesale_markup_pct", 10),
    retail_multiplier: num("retail_multiplier", 2.2),
    mrp_multiplier: num("mrp_multiplier", 2.75),
    round_to: Math.max(1, Math.round(num("round_to", 100))),
  };
  const sb = supabaseServer();
  const { data: row } = await sb.from("pricing_settings").select("id").limit(1).maybeSingle();
  if ((row as any)?.id) await sb.from("pricing_settings").update(patch).eq("id", (row as any).id);
  else await sb.from("pricing_settings").insert(patch);
  revalidatePath("/admin/pricing");
  revalidatePath("/shop");
  revalidatePath("/wholesale");
  revalidatePath("/admin/catalogue");
}

import { groqChat, openaiChat, groqConfigured, openaiConfigured } from "@/lib/ai/providers";

/** AI-processed bulk import: reads a messy CSV/spreadsheet/freeform list, maps columns
 *  intelligently to {name, base_price, qty, type, colors}, then inserts. Falls back to
 *  naive comma parsing if no AI key. */
export async function aiBulkUploadAction(categoryId: string, rawText: string): Promise<{ created: number; results: RowResult[]; usedAi: boolean }> {
  if (!(await requirePerm("catalog.create"))) return { created: 0, results: [{ row: 0, ok: false, error: "Your role can't add products." }], usedAi: false };
  const sb = supabaseServer();
  const formula = await getPricingFormula();
  let rows: Omit<NewProduct, "categoryId">[] = [];
  let usedAi = false;

  const text = (rawText ?? "").trim().slice(0, 8000);
  if (text && (groqConfigured() || openaiConfigured())) {
    const system = `You convert a messy product list into clean JSON for a jewellery store. Output STRICT JSON: {"rows":[{"name":string,"base_price":number,"qty":number,"type":"simple"|"configurable","colors":string[]}]}. The input may be CSV, tab-separated, or freeform, with columns in any order or with different header names (price/cost/wholesale -> base_price in rupees as a number; quantity/stock/pcs -> qty integer; colours/variants -> colors array; if multiple colours are present set type to "configurable" else "simple"). Ignore header rows and currency symbols. Infer sensibly. Return ONLY JSON.`;
    try {
      const out = groqConfigured() ? await groqChat({ system, user: text, json: true }) : await openaiChat({ system, user: text, json: true });
      const parsed = JSON.parse(out);
      rows = (parsed.rows ?? []).map((r: any) => ({
        name: String(r.name ?? "").trim(),
        basePriceRupees: Number(r.base_price) || 0,
        qty: parseInt(r.qty, 10) || 0,
        type: r.type === "configurable" || (Array.isArray(r.colors) && r.colors.length > 1) ? "configurable" : "simple",
        colors: Array.isArray(r.colors) ? r.colors.map((c: any) => String(c).trim()).filter(Boolean) : [],
      })).filter((r: any) => r.name);
      usedAi = rows.length > 0;
    } catch { /* fall through to naive */ }
  }

  if (!usedAi) {
    rows = text.split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => !/^name\s*,/i.test(l)).map((l) => {
      const [name, price, qty, type, colors] = l.split(",").map((s) => s?.trim() ?? "");
      return { name, basePriceRupees: Number(price) || 0, qty: Number(qty) || 0, type: (type === "configurable" ? "configurable" : "simple") as "simple" | "configurable", colors: (colors ?? "").split("|").map((s) => s.trim()).filter(Boolean) };
    });
  }

  let skuNum = await nextSku(sb);
  const results: RowResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const res = await insertOne(sb, formula, { ...rows[i], categoryId }, skuNum);
    results.push({ ...res, row: i + 1 });
    if (res.ok) skuNum++;
  }
  revalidatePath("/admin/catalogue"); revalidatePath("/shop");
  return { created: results.filter((r) => r.ok).length, results, usedAi };
}
