// BlytheDIVA product importer — creates 4346 draft products from the old BuzzCart catalog.
// Runs on YOUR machine (which can reach Supabase). Uses the service-role key from .env.local.
// Usage:  node product-import/import.mjs         (from the project root)
//         FORCE=1 node product-import/import.mjs (skip the "already has products" guard)
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
function loadEnv() {
  const txt = readFileSync(new URL(".env.local", root), "utf8");
  const e = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) e[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return e;
}
const env = loadEnv();
const URL_ = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local"); process.exit(1); }

const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
async function rest(method, path, body, prefer) {
  const r = await fetch(URL_ + "/rest/v1/" + path, {
    method, headers: prefer ? { ...H, Prefer: prefer } : H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

(async () => {
  // guard
  const existing = await rest("GET", "products?select=id&limit=1", null, "count=exact").catch(() => []);
  if (Array.isArray(existing) && existing.length && !process.env.FORCE) {
    console.error("Products already exist. Re-run with  FORCE=1  to add anyway."); process.exit(1);
  }

  // category maps (top categories + subcategories were already created)
  const cats = await rest("GET", "categories?select=id,name&limit=200");
  const subs = await rest("GET", "subcategories?select=id,name,category_id&limit=400");
  const topByName = {}; const subByKey = {};
  for (const c of cats) topByName[c.name] = c.id;
  for (const s of subs) subByKey[s.category_id + "|" + s.name] = s.id;

  const data = JSON.parse(readFileSync(new URL("blythediva_products.json", import.meta.url), "utf8"));
  console.log("loaded", data.length, "products;", Object.keys(topByName).length, "top cats");

  // build product rows
  const rows = data.map((p) => {
    const catId = topByName[p._top] || topByName["Other Accessories"];
    const subId = p._sub ? (subByKey[catId + "|" + p._sub] || null) : null;
    const price = Number(p.price) || 0;
    const base = Math.round(price * 100);
    return {
      category_id: catId,
      subcategory_id: subId,
      sku: p.sku,
      name: p.name || p.sku,
      type: (p.type === "simple" || p.type === "configurable") ? p.type : "simple",
      base_wholesale: base,
      retail_override: price > 0 ? base : null,
      status: "draft",
      admin_tags: Array.isArray(p._tags) ? p._tags : [],
    };
  });

  // insert products, collect sku -> id
  const skuId = {};
  let done = 0;
  for (const b of chunk(rows, 500)) {
    const ret = await rest("POST", "products", b, "return=representation");
    for (const r of ret) skuId[r.sku] = r.id;
    done += b.length; console.log("products", done, "/", rows.length);
  }

  const ids = Object.values(skuId);
  // variants (one default per product)
  const variants = rows.map((r) => ({ product_id: skuId[r.sku], sku: r.sku, qty: 0 }));
  let v = 0; for (const b of chunk(variants, 800)) { await rest("POST", "variants", b, "return=minimal"); v += b.length; console.log("variants", v, "/", variants.length); }

  // product_details
  const details = rows.map((r) => ({ product_id: skuId[r.sku], product_code: r.sku, internal_sku: r.sku, lifecycle: "draft" }));
  let d = 0; for (const b of chunk(details, 800)) { await rest("POST", "product_details", b, "return=minimal"); d += b.length; console.log("details", d, "/", details.length); }

  // channel settings: retail + wholesale
  const chans = [];
  for (const id of ids) { chans.push({ product_id: id, channel: "retail" }, { product_id: id, channel: "wholesale" }); }
  let c = 0; for (const b of chunk(chans, 1000)) { await rest("POST", "product_channel_settings", b, "return=minimal"); c += b.length; console.log("channels", c, "/", chans.length); }

  console.log("\n✅ DONE — imported", ids.length, "products with variants, details and channel settings.");
})().catch((e) => { console.error("\n❌ Import failed:", e.message); process.exit(1); });
