// BlytheDIVA deep-merge (resumable, rate-limit friendly).
// Turns the deep-scrape into real variants, inventory, prices, descriptions and original photos.
// Reads:  ../.env.local · ./blythediva_products.json (ext_id→sku) · ./blythediva_deep.json
// Run:  node product-import/merge-deep.mjs
// Safe to run repeatedly — it SKIPS products already merged and only finishes what's left.
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const env = {};
for (const line of readFileSync(new URL(".env.local", root), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const URL_ = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error("Missing Supabase env in .env.local"); process.exit(1); }
const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// REST with retry on network errors / 429 / 5xx
async function rest(method, path, body, prefer) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const r = await fetch(URL_ + "/rest/v1/" + path, { method, headers: prefer ? { ...H, Prefer: prefer } : H, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 429 || r.status >= 500) { await sleep(1000 * (attempt + 1) + Math.random() * 500); lastErr = new Error("HTTP " + r.status); continue; }
      const t = await r.text();
      if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 160)}`);
      return t ? JSON.parse(t) : null;
    } catch (e) {
      lastErr = e;
      if (/fetch failed|ECONNRESET|ETIMEDOUT|socket|network|terminated/i.test(String(e.message))) { await sleep(1500 * (attempt + 1) + Math.random() * 800); continue; }
      throw e;
    }
  }
  throw lastErr;
}
const paise = (x) => (x === null || x === undefined || x === "" || isNaN(Number(x))) ? null : Math.round(Number(x) * 100);
const money = (x) => { const p = paise(x); return (p == null || p < 0 || p > 50000000) ? null : p; };
const nonNeg = (x) => Math.max(0, Number(x) || 0);
const strip = (h) => !h ? null : String(h).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim() || null;
const imgUrls = (v) => { const out = []; if (Array.isArray(v.img)) for (const im of v.img) { const p = im && (im.path || im.url || im); if (p) out.push(p); } if (v.thumb && !out.includes(v.thumb)) out.unshift(v.thumb); return out; };

// paginated GET-all helper
async function getAll(table, select) {
  const out = []; const step = 1000;
  for (let from = 0; ; from += step) {
    const r = await fetch(URL_ + "/rest/v1/" + `${table}?select=${select}`, { headers: { ...H, Range: `${from}-${from + step - 1}` } });
    const chunk = JSON.parse(await r.text());
    out.push(...chunk);
    if (chunk.length < step) break;
  }
  return out;
}

// ---- load source ----
const extToSku = new Map();
for (const p of JSON.parse(readFileSync(new URL("blythediva_products.json", import.meta.url), "utf8"))) extToSku.set(p.ext_id, p.sku);
const deep = JSON.parse(readFileSync(new URL("blythediva_deep.json", import.meta.url), "utf8"));

// ---- preload DB state (few calls) ----
console.log("loading current catalogue…");
const prods = await getAll("products", "id,sku");
const idBySku = new Map(prods.map((p) => [p.sku, p.id]));
const vrows = await getAll("variants", "product_id,color");
const mergedSet = new Set(); // products that already have at least one colour variant
for (const v of vrows) if (v.color) mergedSet.add(v.product_id);
console.log(`products:${prods.length}  already-merged:${mergedSet.size}  deep records:${deep.length}`);

// ---- process only what's left ----
let done = 0, made = 0, imgs = 0, skipped = 0, failed = 0, i = 0;
for (const d of deep) {
  i++;
  if (d.error) continue;
  const vs = d.variants || [];
  if (!vs.length) { skipped++; continue; }                 // no variants to add
  const sku = extToSku.get(d.ext_id); if (!sku) { skipped++; continue; }
  const pid = idBySku.get(sku); if (!pid) { skipped++; continue; }
  if (mergedSet.has(pid)) { skipped++; continue; }           // already done in a prior run
  try {
    await rest("DELETE", `product_images?product_id=eq.${pid}`, null, "return=minimal");
    await rest("DELETE", `variants?product_id=eq.${pid}`, null, "return=minimal");
    const rows = vs.map((v, idx) => ({ product_id: pid, color: v.color || null, sku: (v.sku && String(v.sku).trim()) || `${sku}-${idx + 1}`,
      qty: nonNeg(v.qty), retail_override: money(v.price), wholesale_override: money(v.wholesale), mrp_override: money(v.mrp), image_paths: imgUrls(v) }));
    const seen = new Set(); for (const r of rows) { while (seen.has(r.sku)) r.sku += "-" + Math.random().toString(36).slice(2, 4); seen.add(r.sku); }
    let ins;
    try { ins = await rest("POST", "variants", rows, "return=representation"); }
    catch (e) { for (const r of rows) r.sku += "-" + pid.slice(0, 4); ins = await rest("POST", "variants", rows, "return=representation"); }
    const bySku = new Map(ins.map((r) => [r.sku, r.id]));
    made += ins.length;
    const imageRows = [];
    rows.forEach((r) => { const vid = bySku.get(r.sku); (r.image_paths || []).forEach((p, k) => imageRows.push({ product_id: pid, variant_id: vid, path: p, kind: k === 0 ? "model" : "gallery", sort: k === 0 ? -10 : k })); });
    if (imageRows.length) { await rest("POST", "product_images", imageRows, "return=minimal"); imgs += imageRows.length; }
    const firstImg = imageRows[0]?.path || null;
    const w = rows.map((r) => r.wholesale_override).filter((x) => x != null);
    const patch = { default_variant_id: ins[0]?.id || null };
    if (firstImg) patch.thumbnail_path = firstImg;
    if (w.length) patch.base_wholesale = Math.min(...w);
    await rest("PATCH", `products?id=eq.${pid}`, patch, "return=minimal");
    const desc = strip(d.desc) || strip(d.short);
    if (desc) {
      await rest("PATCH", `product_details?product_id=eq.${pid}`, { short_description: desc.slice(0, 500) }, "return=minimal").catch(() => {});
      await rest("PATCH", `product_channel_settings?product_id=eq.${pid}&channel=eq.retail`, { description: desc.slice(0, 4000) }, "return=minimal").catch(() => {});
    }
    mergedSet.add(pid); done++;
  } catch (e) { failed++; if (failed <= 25) console.log("FAIL", sku, e.message); }
  if (i % 100 === 0) console.log(`… ${i}/${deep.length}  newly-merged:${done} variants:${made} images:${imgs} skipped:${skipped} failed:${failed}`);
  await sleep(35); // gentle pacing to stay under the API rate limit
}
console.log(`\n✅ DONE. newly-merged:${done} variants:${made} images:${imgs} skipped(already/none):${skipped} failed:${failed}`);
