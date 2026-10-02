/**
 * bd-media - serves Blythe Diva's images and videos from R2 (bucket blythediva-media, binding MEDIA).
 *
 * The URL path is the SAME as Supabase's, only the host differs:
 *   https://<this worker>/storage/v1/object/public/<bucket>/<path>  ->  R2 key "<bucket>/<path>"
 * so moving the shop's images is a host swap in the database (scripts/media-to-r2.mjs).
 *
 * A file R2 does not have yet is fetched from the same path on Supabase, so a switched URL never
 * breaks while the original still exists. Only that one Supabase host is ever fetched - this is
 * not an open proxy. Range requests (video seeking on iPhone) are answered from R2 with 206.
 *
 * Deployed by hand in the Cloudflare dashboard (Workers & Pages -> bd-media). Keep this file in sync.
 */
const ORIGIN = "https://qfybzwiyhnnpqumtzkpf.supabase.co";
const PREFIX = "/storage/v1/object/public/";
const TTL = 86400; // a file overwritten at the same path shows its new version within a day

const plain = (status, text, extra = {}) =>
  new Response(text, { status, headers: { "content-type": "text/plain", "cache-control": "public, max-age=60", ...extra } });

function headersFor(obj) {
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("etag", obj.httpEtag);
  h.set("cache-control", `public, max-age=${TTL}`);
  h.set("access-control-allow-origin", "*");
  h.set("accept-ranges", "bytes");
  h.set("x-bd-source", "r2");
  return h;
}

export default {
  async fetch(req, env, ctx) {
    if (req.method !== "GET" && req.method !== "HEAD") return plain(405, "method not allowed", { allow: "GET, HEAD" });
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/health") return plain(200, "ok");
    if (!url.pathname.startsWith(PREFIX)) return plain(404, "not found");
    let key;
    try { key = decodeURIComponent(url.pathname.slice(PREFIX.length)); } catch { return plain(400, "bad path"); }
    if (!key || key.startsWith("_migration/") || key.includes("..")) return plain(404, "not found");

    const head = req.method === "HEAD";
    const range = req.headers.get("range");

    // Partial content: straight from R2, not cached at the edge.
    if (range) {
      const obj = await env.MEDIA.get(key, { range: req.headers });
      if (obj) {
        const h = headersFor(obj);
        const r = obj.range || {};
        const offset = "suffix" in r ? obj.size - r.suffix : (r.offset ?? 0);
        const length = "suffix" in r ? r.suffix : (r.length ?? obj.size - offset);
        h.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
        h.set("content-length", String(length));
        return new Response(head ? null : obj.body, { status: 206, headers: h });
      }
      const up = await fetch(ORIGIN + url.pathname, { headers: { range } });
      const h = new Headers(up.headers); h.set("x-bd-source", "origin"); h.set("access-control-allow-origin", "*");
      return new Response(head ? null : up.body, { status: up.status, headers: h });
    }

    const cache = caches.default;
    const cacheKey = new Request(url.origin + url.pathname, { method: "GET" });
    let res = await cache.match(cacheKey);
    if (!res) {
      const obj = await env.MEDIA.get(key);
      if (obj) {
        res = new Response(obj.body, { headers: headersFor(obj) });
      } else {
        const up = await fetch(ORIGIN + url.pathname, { cf: { cacheTtl: 3600 } });
        if (!up.ok) return plain(404, "not found");
        const h = new Headers(up.headers);
        h.set("cache-control", "public, max-age=3600");
        h.set("access-control-allow-origin", "*");
        h.set("x-bd-source", "origin");
        res = new Response(up.body, { status: 200, headers: h });
      }
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
    return head ? new Response(null, { status: res.status, headers: res.headers }) : res;
  },
};
