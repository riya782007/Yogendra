#!/usr/bin/env node
/**
 * Move Blythe Diva's public Supabase Storage files to Cloudflare R2, so the Supabase project fits
 * the Free plan (1 GB storage, 5 GB cached egress). Staged, resumable, reversible.
 *
 * THE WHOLE SWITCH IS A HOST SWAP. Every image URL in the database is absolute:
 *     https://qfybzwiyhnnpqumtzkpf.supabase.co/storage/v1/object/public/<bucket>/<path>
 * The R2 Worker serves the SAME path:
 *     https://<MEDIA_HOST>/storage/v1/object/public/<bucket>/<path>
 * so only the host changes. Code that parses "/object/public/<bucket>/" (images.ts, studio.ts)
 * keeps working untouched, no React file changes, no Netlify build. Rollback is the reverse swap.
 *
 * WHERE URLS LIVE: not hard-coded. The PostgREST schema is read at run time and every text,
 * varchar, text[] and json/jsonb column of every table is scanned, so a column added next month
 * is covered too.
 *
 * SAFETY RULES
 *   - copy   never changes the database. R2 object keys are "<bucket>/<path>"; a copy is skipped
 *            when R2 already holds the same bytes (ETag/size match), so re-runs resume.
 *   - switch first proves the Worker serves a real image; then rewrites ONLY urls whose file is
 *            already in R2 with matching size. Anything else stays on Supabase.
 *   - purge  is the only stage that deletes, and only from Supabase, and only a file that
 *            (a) is in R2 with the same size, (b) is no longer referenced by ANY row of ANY table
 *            via the Supabase host, and (c) was last modified more than 48 h ago (so an upload whose
 *            row is still being written is never touched). It needs CONFIRM=delete-originals and
 *            writes the list of deleted files to R2 (_migration/) before deleting.
 *   - restore copies R2 back to Supabase (undo a purge); rollback swaps the host back.
 *   - The Worker falls back to Supabase for a file not in R2 yet, so a switched URL never 404s
 *     while the original exists.
 *
 * Stages: plan | copy | switch | sync (copy+switch) | verify | purge | restore | rollback
 * Env: SUPABASE_SERVICE_ROLE_KEY R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY MEDIA_HOST
 *      [SUPABASE_URL] [R2_ACCOUNT_ID] [R2_BUCKET] [LIMIT] [CONCURRENCY] [CONFIRM] [S3_SDK_DIR]
 */
import { createRequire } from "node:module";

const stage = (process.argv[2] || "plan").toLowerCase();
const LIMIT = Number(process.env.LIMIT || 0);
const CONC = Math.max(1, Math.min(16, Number(process.env.CONCURRENCY || 6)));
const SB = (process.env.SUPABASE_URL || "https://qfybzwiyhnnpqumtzkpf.supabase.co").replace(/\/$/, "");
const ACCOUNT = process.env.R2_ACCOUNT_ID || "c13f482ff9256e520d3d4e0c85f24a4a";
const R2_BUCKET = process.env.R2_BUCKET || "blythediva-media";
const MEDIA = (process.env.MEDIA_HOST || "").replace(/\/$/, "");
const PUB = "/storage/v1/object/public/";
const PURGE_MIN_AGE_MS = 48 * 3600 * 1000;

const need = (k) => { const v = process.env[k]; if (!v) { console.error(`::error::missing ${k}`); process.exit(1); } return v; };

// ---------------------------------------------------------------- URL rewriting (pure, unit-tested)
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Matches one public-storage URL on `host`; group 1 is "<bucket>/<path>" exactly as written. */
export const urlRe = (host) => new RegExp(esc(host) + esc(PUB) + "([^\\s\"'<>\\\\)\\]?#]+)", "g");
export const keyOf = (raw) => { try { return decodeURIComponent(raw); } catch { return raw; } };

/** Swap `from` host to `to` host for every storage URL in a string whose key passes `allow`. */
export function swapString(s, from, to, allow, found) {
  if (typeof s !== "string" || !s.includes(PUB)) return s;
  return s.replace(urlRe(from), (whole, raw) => {
    const key = keyOf(raw);
    found?.add(key);
    return allow(key) ? to + PUB + raw : whole;
  });
}
/** Same, through any JSON value (text[], jsonb). */
export function swapDeep(v, from, to, allow, found) {
  if (typeof v === "string") return swapString(v, from, to, allow, found);
  if (Array.isArray(v)) return v.map((x) => swapDeep(x, from, to, allow, found));
  if (v && typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = swapDeep(x, from, to, allow, found); return o; }
  return v;
}

// ---------------------------------------------------------------- Supabase
// A legacy service_role key is a JWT and goes in both headers; a new sb_secret_ key must ONLY go in
// apikey (the gateway mints the JWT itself and rejects a non-JWT bearer).
const sbHeaders = () => { const k = need("SUPABASE_SERVICE_ROLE_KEY").replace(/\s+/g, ""); return k.startsWith("eyJ") ? { apikey: k, authorization: `Bearer ${k}` } : { apikey: k }; };
// Supabase's gateway returns the odd 502/503/504/429 under load. A READ is retried with backoff;
// a write (PATCH/DELETE/POST) is never blindly repeated, except a 429/503 that was refused outright.
async function sbJson(path, init = {}) {
  const method = (init.method || "GET").toUpperCase();
  const listing = method === "GET" || path.startsWith("/storage/v1/object/list/");
  for (let attempt = 1; ; attempt++) {
    let r, t;
    try {
      r = await fetch(`${SB}${path}`, { ...init, headers: { ...sbHeaders(), "content-type": "application/json", ...(init.headers || {}) } });
      t = await r.text();
    } catch (e) {
      if (listing && attempt < 6) { await new Promise((ok) => setTimeout(ok, 1000 * 2 ** attempt)); continue; }
      throw e;
    }
    const retryable = r.status === 429 || r.status === 503 || (listing && (r.status === 502 || r.status === 504));
    if (!r.ok && retryable && attempt < 6) { await new Promise((ok) => setTimeout(ok, 1000 * 2 ** attempt)); continue; }
    if (!r.ok) throw new Error(`supabase ${r.status} ${path.slice(0, 120)}: ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : null;
  }
}

/** Every object in every PUBLIC bucket: key "<bucket>/<path>" -> {size, etag, updated, mime}. */
async function listSupabase() {
  const buckets = (await sbJson("/storage/v1/bucket")).filter((b) => b.public);
  const out = new Map(); const skipped = [];
  // Folders are listed 6 at a time: one request per folder, and a shop has thousands of them
  // (walking them one by one took ~18 minutes).
  const queue = buckets.map((b) => ({ b: b.id, prefix: "" }));
  const listFolder = async ({ b, prefix }) => {
    for (let offset = 0; ; offset += 1000) {
      const page = await sbJson(`/storage/v1/object/list/${encodeURIComponent(b)}`, { method: "POST",
        body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }) });
      for (const e of page) {
        const p = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.id === null || !e.metadata) queue.push({ b, prefix: p });       // a folder
        else out.set(`${b}/${p}`, { size: Number(e.metadata.size ?? e.metadata.contentLength ?? 0),
          etag: String(e.metadata.eTag || "").replace(/"/g, ""), mime: e.metadata.mimetype || "application/octet-stream",
          updated: Date.parse(e.updated_at || e.created_at || 0) || 0 });
      }
      if (page.length < 1000) break;
    }
  };
  let active = 0;
  await new Promise((resolve, reject) => {
    const pump = () => {
      if (!queue.length && !active) return resolve();
      while (queue.length && active < 6) {
        active++;
        listFolder(queue.shift()).then(() => { active--; pump(); }, reject);
      }
    };
    pump();
  });
  return { objects: out, buckets: buckets.map((b) => b.id), skipped };
}

// ---------------------------------------------------------------- R2 (S3 API)
let _s3;
function s3() {
  if (_s3) return _s3;
  const req = createRequire((process.env.S3_SDK_DIR || process.cwd()).replace(/\/?$/, "/"));
  const sdk = req("@aws-sdk/client-s3");
  // R2 keys are plain hex (32 and 64 chars). Say WHICH secret is wrong instead of a cryptic
  // "invalid character in header" from the signer. Never prints the value.
  for (const [name, len] of [["R2_ACCESS_KEY_ID", 32], ["R2_SECRET_ACCESS_KEY", 64]]) {
    const v = need(name).replace(/\s+/g, "");
    if (!/^[0-9a-f]+$/i.test(v) || v.length !== len)
      { console.error(`::error::${name} looks wrong: expected ${len} hex characters, got ${v.length} characters${/^[0-9a-f]*$/i.test(v) ? "" : " including non-hex ones"}. Re-paste it in Settings > Secrets.`); process.exit(1); }
  }
  const client = new sdk.S3Client({ region: "auto", endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
    // A pasted secret often carries a trailing newline or space; S3 signing rejects it in the header.
    credentials: { accessKeyId: need("R2_ACCESS_KEY_ID").replace(/\s+/g, ""), secretAccessKey: need("R2_SECRET_ACCESS_KEY").replace(/\s+/g, "") } });
  return (_s3 = { sdk, client, send: (c) => client.send(c) });
}
async function listR2() {
  const { sdk, send } = s3(); const out = new Map(); let token;
  do {
    const r = await send(new sdk.ListObjectsV2Command({ Bucket: R2_BUCKET, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of r.Contents || []) out.set(o.Key, { size: Number(o.Size), etag: String(o.ETag || "").replace(/"/g, "") });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}
const encPath = (key) => key.split("/").map(encodeURIComponent).join("/");
/** R2 holds the same bytes: same size, and same MD5 ETag whenever both sides have a simple one. */
export function sameFile(sb, r2) {
  if (!sb || !r2 || sb.size !== r2.size) return false;
  const simple = (e) => /^[0-9a-f]{32}$/i.test(e || "");
  return simple(sb.etag) && simple(r2.etag) ? sb.etag.toLowerCase() === r2.etag.toLowerCase() : true;
}
async function copyOne(key, meta) {
  const r = await fetch(`${SB}/storage/v1/object/authenticated/${encPath(key)}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`download HTTP ${r.status}`);
  const body = Buffer.from(await r.arrayBuffer());
  if (meta.size && body.length !== meta.size) throw new Error(`size ${body.length} != ${meta.size}`);
  const { sdk, send } = s3();
  await send(new sdk.PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body,
    ContentType: r.headers.get("content-type") || meta.mime, CacheControl: "public, max-age=86400" }));
  return body.length;
}

async function pool(items, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONC, items.length || 1) }, async () => {
    while (i < items.length) { const n = i++; await worker(items[n], n); }
  }));
}
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;

// ---------------------------------------------------------------- database scan
const TEXTISH = new Set(["text", "character varying", "character", "text[]", "character varying[]", "json", "jsonb"]);
async function schema() {
  const api = await sbJson("/rest/v1/", { headers: { accept: "application/openapi+json" } });
  const tables = [];
  for (const [name, def] of Object.entries(api.definitions || {})) {
    const cols = Object.entries(def.properties || {});
    const pk = cols.filter(([, p]) => /<pk\/>/.test(p.description || "")).map(([c]) => c);
    const text = cols.filter(([, p]) => TEXTISH.has(p.format)).map(([c]) => c);
    const plain = cols.filter(([, p]) => /^(text|character varying|character)$/.test(p.format)).map(([c]) => c);
    // Views PostgREST cannot write through have no PATCH path - read them, never patch them.
    const writable = !!api.paths?.[`/${name}`]?.patch;
    if (text.length) tables.push({ name, pk, text, writable, plainOnly: plain.length === text.length });
  }
  return tables;
}
/** Read every row of `t` that might hold a storage URL on `host` (server-side filter when possible). */
async function readRows(t, host) {
  const like = `*${host.replace(/^https?:\/\//, "")}${PUB}*`;
  const sel = [...new Set([...t.pk, ...t.text])].join(",");
  const order = t.pk.length ? `&order=${t.pk.join(",")}` : "";
  const filter = t.plainOnly ? `&or=(${t.text.map((c) => `${c}.like.${encodeURIComponent(like)}`).join(",")})` : "";
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await sbJson(`/rest/v1/${encodeURIComponent(t.name)}?select=${sel}${filter}${order}&limit=1000&offset=${offset}`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}
/**
 * Visit every row that might hold a storage URL on `fromHost`. onRow(table,row) returns a patch or
 * null. All rows of a table are read BEFORE any patch, so rewriting never shifts the paging.
 */
async function scan(fromHost, onRow, { write = false } = {}) {
  const tables = await schema();
  const stats = { tables: 0, rows: 0, patched: 0, failed: 0, noPk: [] };
  for (const t of tables) {
    let rows;
    try { rows = await readRows(t, fromHost); }
    catch (e) { console.log(`   (skipped ${t.name}: ${e.message.slice(0, 100)})`); continue; }
    let hit = false;
    for (const row of rows) {
      stats.rows++;
      const patch = onRow(t, row);
      if (!patch) continue;
      hit = true;
      if (!write || !t.writable) continue;
      if (!t.pk.length) { if (!stats.noPk.includes(t.name)) stats.noPk.push(t.name); stats.failed++; continue; }
      const where = t.pk.map((c) => `${c}=eq.${encodeURIComponent(String(row[c]))}`).join("&");
      try {
        await sbJson(`/rest/v1/${encodeURIComponent(t.name)}?${where}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify(patch) });
        stats.patched++;
      } catch (e) { stats.failed++; console.error(`   PATCH ${t.name} failed: ${e.message.slice(0, 160)}`); }
    }
    if (hit) stats.tables++;
  }
  if (stats.noPk.length) console.log(`   tables with URLs but no primary key (not rewritten): ${stats.noPk.join(", ")}`);
  return stats;
}
/** Collect every key referenced through `host`, per table, without changing anything. */
async function references(host) {
  const keys = new Set(); const where = new Map();
  await scan(host, (t, row) => {
    const found = new Set();
    for (const c of t.text) swapDeep(row[c], host, host, () => false, found);
    if (found.size) { for (const k of found) keys.add(k); where.set(t.name, (where.get(t.name) || 0) + 1); }
    return null;
  });
  return { keys, where };
}
/** Rewrite every allowed URL from `from` host to `to` host. */
async function rewrite(from, to, allow) {
  const found = new Set();
  const stats = await scan(from, (t, row) => {
    const patch = {};
    for (const c of t.text) {
      const before = row[c];
      if (before == null) continue;
      const after = swapDeep(before, from, to, allow, found);
      if (JSON.stringify(after) !== JSON.stringify(before)) patch[c] = after;
    }
    return Object.keys(patch).length ? patch : null;
  }, { write: true });
  return { ...stats, found };
}

/** Prove the Worker serves a real image before any URL is pointed at it. */
async function checkUrl(u) {
  try {
    const r = await fetch(u);
    if (!r.ok) return { ok: false, why: `HTTP ${r.status}` };
    const ct = r.headers.get("content-type") || "";
    const b = await r.arrayBuffer();
    if (!/^(image|video)\//.test(ct) && b.byteLength < 1024) return { ok: false, why: `${ct} ${b.byteLength} bytes` };
    return { ok: true, bytes: b.byteLength, source: r.headers.get("x-bd-source") || "?" };
  } catch (e) { return { ok: false, why: String(e?.message || e).slice(0, 120) }; }
}

// ---------------------------------------------------------------- stages
async function doCopy(sbObjs, r2) {
  let todo = [...sbObjs].filter(([k, m]) => !sameFile(m, r2.get(k)));
  if (LIMIT) todo = todo.slice(0, LIMIT);
  console.log(`\ncopying ${todo.length} file(s) (${mb(todo.reduce((a, [, m]) => a + m.size, 0))}) to R2, ${CONC} at a time`);
  let ok = 0, bad = 0, bytes = 0;
  await pool(todo, async ([k, m]) => {
    try { const n = await copyOne(k, m); bytes += n;  // read bytes AFTER the await: `bytes += await` loses updates under concurrency
       r2.set(k, { size: m.size, etag: m.etag }); ok++; }
    catch (e) { bad++; console.error(`   FAILED ${k}: ${e.message}`); }
    if ((ok + bad) % 200 === 0) console.log(`   ${ok + bad}/${todo.length}`);
  });
  console.log(`copied ${ok} (${mb(bytes)}), failed ${bad}. The database was not touched.`);
  return bad;
}
async function doSwitch(sbObjs, r2) {
  if (!MEDIA) { console.error("::error::MEDIA_HOST is not set"); process.exit(1); }
  // 1. The Worker must serve a real file from R2 before anything points at it.
  const sample = [...r2.keys()].filter((k) => !k.startsWith("_migration/")).slice(0, 3);
  if (!sample.length) { console.error("::error::R2 is empty - run copy first"); process.exit(1); }
  for (const k of sample) {
    const c = await checkUrl(`${MEDIA}${PUB}${encPath(k)}`);
    if (!c.ok || c.source !== "r2") { console.error(`::error::Worker is not serving R2 correctly (${k}: ${c.why || "source " + c.source}). Nothing switched.`); process.exit(1); }
  }
  console.log(`Worker check passed (${sample.length} files served from R2).`);
  // 2. Only files R2 really has are allowed to move.
  const allow = (key) => sameFile(sbObjs.get(key), r2.get(key)) || (!sbObjs.has(key) && r2.has(key));
  const s = await rewrite(SB, MEDIA, allow);
  const held = [...s.found].filter((k) => !allow(k));
  console.log(`\nswitched ${s.patched} row(s) in ${s.tables} table(s); ${s.failed} failed.`);
  if (held.length) console.log(`left on Supabase (not in R2 yet, or missing everywhere): ${held.length}\n   ${held.slice(0, 15).join("\n   ")}`);
  return s.failed;
}

async function main() {
  console.log(`stage: ${stage}   supabase: ${SB}   r2: ${R2_BUCKET}   media host: ${MEDIA || "(not set)"}`);
  const { objects: sbObjs, buckets } = await listSupabase();
  const sbBytes = [...sbObjs.values()].reduce((a, m) => a + m.size, 0);
  console.log(`Supabase public buckets: ${buckets.join(", ")} - ${sbObjs.size} files, ${mb(sbBytes)}`);
  const r2 = stage === "rollback" ? new Map() : await listR2();
  if (stage !== "rollback") {
    const inR2 = [...sbObjs].filter(([k, m]) => sameFile(m, r2.get(k))).length;
    console.log(`R2: ${r2.size} files; ${inR2} of ${sbObjs.size} Supabase files already copied`);
  }

  if (stage === "plan") {
    const old = await references(SB);
    const moved = MEDIA ? await references(MEDIA) : { keys: new Set(), where: new Map() };
    const missing = [...old.keys].filter((k) => !sbObjs.has(k));
    console.log(`\nDatabase references via Supabase host: ${old.keys.size} files`);
    for (const [t, n] of old.where) console.log(`   ${t}: ${n} row(s)`);
    console.log(`Database references via media host: ${moved.keys.size} files`);
    if (missing.length) console.log(`Referenced but not in Supabase (already broken, left alone): ${missing.length}`);
    const unreferenced = [...sbObjs.keys()].filter((k) => !old.keys.has(k) && !moved.keys.has(k));
    console.log(`Files no row points at (orphans): ${unreferenced.length}, ${mb(unreferenced.reduce((a, k) => a + sbObjs.get(k).size, 0))}`);
    console.log("\nNothing was changed.");
    return;
  }
  if (stage === "copy") { if (await doCopy(sbObjs, r2)) process.exitCode = 1; return; }
  if (stage === "switch") { if (await doSwitch(sbObjs, r2)) process.exitCode = 1; return; }
  if (stage === "sync") { await doCopy(sbObjs, r2); if (await doSwitch(sbObjs, r2)) process.exitCode = 1; return; }

  if (stage === "verify") {
    if (!MEDIA) { console.error("::error::MEDIA_HOST is not set"); process.exit(1); }
    const old = await references(SB); const moved = await references(MEDIA);
    console.log(`\nstill on Supabase host: ${old.keys.size} file(s)   on media host: ${moved.keys.size} file(s)`);
    let keys = [...moved.keys]; if (LIMIT) keys = keys.slice(0, LIMIT);
    let ok = 0; const bad = []; const src = {};
    await pool(keys, async (k) => { const c = await checkUrl(`${MEDIA}${PUB}${encPath(k)}`); if (c.ok) { ok++; src[c.source] = (src[c.source] || 0) + 1; } else bad.push(`${k} (${c.why})`); });
    console.log(`serving fine: ${ok}/${keys.length}   by source: ${JSON.stringify(src)}`);
    if (bad.length) { console.error(`BROKEN: ${bad.length}`); bad.slice(0, 25).forEach((b) => console.error(`   ${b}`)); process.exitCode = 1; }
    return;
  }

  if (stage === "purge") {
    if (process.env.CONFIRM !== "delete-originals") { console.error("::error::purge needs confirm = delete-originals"); process.exit(1); }
    const old = await references(SB);
    const now = Date.now();
    const doomed = [...sbObjs].filter(([k, m]) => sameFile(m, r2.get(k)) && !old.keys.has(k) && now - m.updated > PURGE_MIN_AGE_MS).map(([k]) => k);
    const kept = sbObjs.size - doomed.length;
    let list = LIMIT ? doomed.slice(0, LIMIT) : doomed;
    const freed = list.reduce((a, k) => a + sbObjs.get(k).size, 0);
    console.log(`\npurging ${list.length} Supabase file(s), ${mb(freed)} - every one is in R2 with the same size and no row points at it on Supabase. Keeping ${kept}.`);
    if (!list.length) return;
    const { sdk, send } = s3();
    await send(new sdk.PutObjectCommand({ Bucket: R2_BUCKET, Key: `_migration/purged-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      Body: JSON.stringify(list), ContentType: "application/json" }));
    const byBucket = new Map();
    for (const k of list) { const i = k.indexOf("/"); const b = k.slice(0, i); (byBucket.get(b) || byBucket.set(b, []).get(b)).push(k.slice(i + 1)); }
    let gone = 0;
    for (const [b, paths] of byBucket) for (let i = 0; i < paths.length; i += 100) {
      const res = await sbJson(`/storage/v1/object/${encodeURIComponent(b)}`, { method: "DELETE", body: JSON.stringify({ prefixes: paths.slice(i, i + 100) }) });
      gone += Array.isArray(res) ? res.length : 0;
    }
    console.log(`deleted ${gone} file(s) from Supabase Storage (${mb(sbBytes - freed)} left). Copies remain in R2; \`restore\` puts them back.`);
    return;
  }

  if (stage === "restore") {
    const { sdk, send } = s3();
    let todo = [...r2.keys()].filter((k) => !k.startsWith("_migration/") && !sbObjs.has(k) && buckets.includes(k.split("/")[0]));
    if (LIMIT) todo = todo.slice(0, LIMIT);
    console.log(`\nrestoring ${todo.length} file(s) from R2 to Supabase`);
    let ok = 0;
    await pool(todo, async (k) => {
      try {
        const o = await send(new sdk.GetObjectCommand({ Bucket: R2_BUCKET, Key: k }));
        const body = Buffer.from(await o.Body.transformToByteArray());
        const i = k.indexOf("/");
        const r = await fetch(`${SB}/storage/v1/object/${encodeURIComponent(k.slice(0, i))}/${encPath(k.slice(i + 1))}`, { method: "POST",
          headers: { ...sbHeaders(), "content-type": o.ContentType || "application/octet-stream", "x-upsert": "true" }, body });
        if (!r.ok) throw new Error(`HTTP ${r.status}`); ok++;
      } catch (e) { console.error(`   FAILED ${k}: ${e.message}`); }
    });
    console.log(`restored ${ok}/${todo.length}.`);
    return;
  }

  if (stage === "rollback") {
    if (!MEDIA) { console.error("::error::MEDIA_HOST is not set"); process.exit(1); }
    const s = await rewrite(MEDIA, SB, (k) => sbObjs.has(k));
    const stuck = [...s.found].filter((k) => !sbObjs.has(k));
    console.log(`\nrolled back ${s.patched} row(s); ${s.failed} failed.`);
    if (stuck.length) console.log(`${stuck.length} file(s) kept on the media host because Supabase no longer has them - run \`restore\` first, then rollback again.`);
    return;
  }

  console.error(`unknown stage "${stage}"`); process.exit(1);
}

if (process.env.UNIT_TEST !== "1") main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
