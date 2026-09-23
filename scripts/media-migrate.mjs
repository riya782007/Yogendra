#!/usr/bin/env node
/**
 * Move Blythe Diva's Supabase-hosted images to Cloudinary. Staged, resumable, reversible.
 *
 * WHY IT IS ONLY A STRING SWAP: every image URL in this database is ABSOLUTE - the app writes
 * getPublicUrl(...) straight into product_images.path, products.thumbnail_path,
 * variants.image_paths[] and promotions.image_path, and the 54 <img> tags render whatever string is
 * there. There is no next/image and no URL builder. So nothing in the app has to change; four
 * columns do. Yogendra's screens are untouched.
 *
 * VERIFIED BEFORE THIS WAS WRITTEN (23 Sep 2026):
 *   - Cloudinary pulls straight from a public Supabase URL: a real 1200x1600 / 354 KB variant photo
 *     uploaded by remote fetch, so no image is ever downloaded and re-uploaded.
 *   - Pre-flight on the bucket: 4,385 objects, all image/jpeg or image/png, largest 3.3 MB.
 *     Nothing hits Cloudinary's 10 MB image limit and nothing is a file type it would refuse.
 *   - Account: Free plan, 25 credits, 0.68% used.
 *
 * SAFETY:
 *   - public_id is derived deterministically from the old storage path, and overwrite=false, so
 *     re-running never duplicates an asset and an interrupted run simply resumes.
 *   - Every old -> new pair lands in media_url_migrations BEFORE any column is touched.
 *     `rollback` restores from it.
 *   - A new URL must actually serve an image (HTTP 200, image/* , >1 KB) before it is allowed to
 *     replace an old one. A failure leaves that row on Supabase and records why.
 *   - NOTHING is deleted from Supabase Storage here, ever. That is a separate later step, once the
 *     new URLs have served live for a while and the nightly backup has covered them.
 *
 * Stages: plan | upload | switch | verify | rollback
 * Env: SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY CLOUDINARY_CLOUD_NAME CLOUDINARY_API_KEY
 *      CLOUDINARY_API_SECRET  [LIMIT=n] [CONCURRENCY=4]
 */
import crypto from "node:crypto";

const stage = (process.argv[2] || "plan").toLowerCase();
const LIMIT = Number(process.env.LIMIT || 0);
const CONC = Math.max(1, Math.min(8, Number(process.env.CONCURRENCY || 4)));

const need = (k) => { const v = process.env[k]; if (!v) { console.error(`missing env ${k}`); process.exit(1); } return v; };
const SB = need("SUPABASE_URL").replace(/\/$/, "");
const KEY = need("SUPABASE_SERVICE_ROLE_KEY");
const CLOUD = need("CLOUDINARY_CLOUD_NAME");

const rest = async (path, init = {}) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json",
               prefer: init.prefer || "return=representation", ...(init.headers || {}) },
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status} ${path}: ${txt.slice(0, 300)}`);
  return txt ? JSON.parse(txt) : null;
};

const MARK = "/storage/v1/object/public/";
export const isSupabaseMedia = (u) => typeof u === "string" && u.includes(MARK) && u.includes(".supabase.co");

/** Deterministic public_id from the old storage path - the key to idempotent re-runs. */
export function publicIdFor(url) {
  const after = String(url).split(MARK)[1] || String(url);
  const clean = decodeURIComponent(after).replace(/\?.*$/, "").replace(/\.[a-z0-9]+$/i, "");
  return "blythediva/" + clean.replace(/[^a-zA-Z0-9/_-]/g, "_").replace(/\/+/g, "/");
}
/** f_auto,q_auto is where the bandwidth saving lives: WebP/AVIF at an automatic quality. */
export const deliveryUrl = (publicId) => `https://res.cloudinary.com/${CLOUD}/image/upload/f_auto,q_auto/${publicId}`;

const sign = (params, secret) =>
  crypto.createHash("sha1")
    .update(Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&") + secret)
    .digest("hex");

async function uploadByFetch(remoteUrl) {
  const public_id = publicIdFor(remoteUrl);
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { overwrite: "false", public_id, timestamp: String(timestamp), unique_filename: "false" };
  const body = new URLSearchParams({
    ...params, file: remoteUrl, api_key: need("CLOUDINARY_API_KEY"),
    signature: sign(params, need("CLOUDINARY_API_SECRET")),
  });
  const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, { method: "POST", body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`cloudinary ${r.status}: ${(j?.error?.message) || JSON.stringify(j).slice(0, 200)}`);
  return { public_id: j.public_id || public_id, bytes: j.bytes ?? null };
}

/** Only a real image of a believable size is allowed to replace a working URL. */
async function checkUrl(u) {
  try {
    const r = await fetch(u, { redirect: "follow" });
    if (!r.ok) return { ok: false, why: `HTTP ${r.status}` };
    const ct = r.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) return { ok: false, why: `content-type ${ct}` };
    const b = await r.arrayBuffer();
    if (b.byteLength < 1024) return { ok: false, why: `${b.byteLength} bytes` };
    return { ok: true, bytes: b.byteLength, type: ct };
  } catch (e) { return { ok: false, why: String(e?.message || e).slice(0, 120) }; }
}

async function pool(items, worker) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (i < items.length) { const n = i++; out[n] = await worker(items[n], n); }
  }));
  return out;
}

/** Every Supabase-hosted image reference, and which column owns it. */
async function collectRefs() {
  const refs = [];
  const push = (table, col, id, url) => { if (isSupabaseMedia(url)) refs.push({ table, col, id: String(id), url }); };
  for (const r of await rest("product_images?select=id,path&path=not.is.null&limit=20000")) push("product_images", "path", r.id, r.path);
  for (const r of await rest("products?select=id,thumbnail_path&thumbnail_path=not.is.null&limit=20000")) push("products", "thumbnail_path", r.id, r.thumbnail_path);
  for (const r of await rest("promotions?select=id,image_path&image_path=not.is.null&limit=20000")) push("promotions", "image_path", r.id, r.image_path);
  for (const r of await rest("variants?select=id,image_paths&image_paths=not.is.null&limit=20000"))
    for (const u of (r.image_paths || [])) push("variants", "image_paths", r.id, u);
  return refs;
}

const banner = (refs) => {
  const by = {};
  for (const r of refs) by[`${r.table}.${r.col}`] = (by[`${r.table}.${r.col}`] || 0) + 1;
  console.log(`Supabase-hosted references: ${refs.length} (${new Set(refs.map((r) => r.url)).size} distinct files)`);
  for (const [k, v] of Object.entries(by)) console.log(`   ${k}: ${v}`);
};

async function main() {
  const refs = await collectRefs();
  console.log(`stage: ${stage}`);
  banner(refs);
  const distinct = [...new Set(refs.map((r) => r.url))];

  if (stage === "plan") {
    const done = await rest(`media_url_migrations?select=old_url,state&limit=20000`);
    const seen = new Map(done.map((d) => [d.old_url, d.state]));
    const todo = distinct.filter((u) => !seen.has(u));
    console.log(`\nalready recorded: ${done.length}   still to upload: ${todo.length}`);
    for (const u of todo.slice(0, 3)) console.log(`   ${u.slice(-60)}\n     -> ${deliveryUrl(publicIdFor(u))}`);
    console.log("\nNothing was changed.");
    return;
  }

  if (stage === "upload") {
    const done = await rest(`media_url_migrations?select=old_url&limit=20000`);
    const seen = new Set(done.map((d) => d.old_url));
    let todo = distinct.filter((u) => !seen.has(u));
    if (LIMIT) todo = todo.slice(0, LIMIT);
    console.log(`\nuploading ${todo.length} file(s) to Cloudinary by remote fetch, ${CONC} at a time`);
    let ok = 0, bad = 0;
    await pool(todo, async (url) => {
      const owner = refs.find((r) => r.url === url);
      try {
        const up = await uploadByFetch(url);
        await rest("media_url_migrations", { method: "POST", prefer: "return=minimal", body: JSON.stringify({
          table_name: owner.table, col_name: owner.col, row_id: owner.id, old_url: url,
          new_url: deliveryUrl(up.public_id), public_id: up.public_id, bytes_new: up.bytes, state: "uploaded" }) });
        ok++;
      } catch (e) {
        bad++;
        await rest("media_url_migrations", { method: "POST", prefer: "return=minimal", body: JSON.stringify({
          table_name: owner.table, col_name: owner.col, row_id: owner.id, old_url: url,
          state: "error", error: String(e.message).slice(0, 400) }) }).catch(() => {});
        console.error(`   FAILED ${url.slice(-50)}: ${e.message}`);
      }
      if ((ok + bad) % 100 === 0) console.log(`   ${ok + bad}/${todo.length}…`);
    });
    console.log(`\nuploaded ${ok}, failed ${bad}. No app-visible column was changed - run \`switch\` next.`);
    return;
  }

  if (stage === "switch") {
    let rows = await rest(`media_url_migrations?select=*&state=eq.uploaded&limit=20000`);
    if (LIMIT) rows = rows.slice(0, LIMIT);
    console.log(`\nverifying then switching ${rows.length} URL(s)`);
    const good = [];
    await pool(rows, async (row) => {
      const c = await checkUrl(row.new_url);
      if (!c.ok) {
        console.error(`   REFUSED ${row.public_id}: ${c.why} - left on Supabase`);
        await rest(`media_url_migrations?id=eq.${row.id}`, { method: "PATCH", prefer: "return=minimal",
          body: JSON.stringify({ state: "verify_failed", error: c.why }) });
        return;
      }
      good.push({ ...row, bytes_new: c.bytes });
    });
    console.log(`   ${good.length} of ${rows.length} verified as real images`);

    const byUrl = new Map(good.map((g) => [g.old_url, g.new_url]));
    let updated = 0;
    // Scalar columns: one PATCH per owning row.
    for (const g of good.filter((g) => g.col_name !== "image_paths")) {
      await rest(`${g.table_name}?id=eq.${g.row_id}`, { method: "PATCH", prefer: "return=minimal",
        body: JSON.stringify({ [g.col_name]: g.new_url }) });
      updated++;
    }
    // variants.image_paths is an array: read it, swap only the migrated entries, write it back whole.
    const variantIds = [...new Set(good.filter((g) => g.col_name === "image_paths").map((g) => g.row_id))];
    for (const id of variantIds) {
      const [v] = await rest(`variants?select=id,image_paths&id=eq.${id}`);
      if (!v) continue;
      const next = (v.image_paths || []).map((u) => byUrl.get(u) || u);
      await rest(`variants?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal",
        body: JSON.stringify({ image_paths: next }) });
      updated++;
    }
    for (const g of good) {
      await rest(`media_url_migrations?id=eq.${g.id}`, { method: "PATCH", prefer: "return=minimal",
        body: JSON.stringify({ state: "switched", switched_at: new Date().toISOString(), bytes_new: g.bytes_new }) });
    }
    console.log(`\nswitched ${good.length} URL(s) across ${updated} row(s). Supabase Storage untouched - originals still there.`);
    return;
  }

  if (stage === "verify") {
    const all = await rest(`media_url_migrations?select=old_url,new_url,state&state=eq.switched&limit=20000`);
    console.log(`\nre-checking ${all.length} switched URL(s)`);
    let ok = 0; const bad = [];
    await pool(all, async (r) => { const c = await checkUrl(r.new_url); c.ok ? ok++ : bad.push(`${r.new_url} (${c.why})`); });
    console.log(`   serving fine: ${ok}`);
    if (bad.length) { console.error(`   BROKEN: ${bad.length}`); bad.slice(0, 20).forEach((b) => console.error(`     ${b}`)); process.exit(1); }
    console.log("   every switched image is serving.");
    return;
  }

  if (stage === "rollback") {
    const rows = await rest(`media_url_migrations?select=*&state=eq.switched&limit=20000`);
    console.log(`\nrestoring ${rows.length} URL(s) to Supabase`);
    for (const r of rows.filter((r) => r.col_name !== "image_paths")) {
      await rest(`${r.table_name}?id=eq.${r.row_id}`, { method: "PATCH", prefer: "return=minimal",
        body: JSON.stringify({ [r.col_name]: r.old_url }) });
    }
    const back = new Map(rows.map((r) => [r.new_url, r.old_url]));
    for (const id of [...new Set(rows.filter((r) => r.col_name === "image_paths").map((r) => r.row_id))]) {
      const [v] = await rest(`variants?select=id,image_paths&id=eq.${id}`);
      if (!v) continue;
      await rest(`variants?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal",
        body: JSON.stringify({ image_paths: (v.image_paths || []).map((u) => back.get(u) || u) }) });
    }
    for (const r of rows) await rest(`media_url_migrations?id=eq.${r.id}`, { method: "PATCH", prefer: "return=minimal",
      body: JSON.stringify({ state: "uploaded", switched_at: null }) });
    console.log("rolled back. The Cloudinary copies are left in place for a retry.");
    return;
  }

  console.error(`unknown stage "${stage}" - use plan | upload | switch | verify | rollback`);
  process.exit(1);
}

if (process.env.UNIT_TEST !== "1") main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
