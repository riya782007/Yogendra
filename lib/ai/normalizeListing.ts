/**
 * normalizeListing — tidy a model's product-page JSON before it is checked against the schema.
 *
 * Models answer with the right content but not always the exact shape: "SEO" instead of "seo",
 * keywords as one comma string, a spec value as a list, the whole page wrapped in { product: … },
 * seo left out. Each of those used to fail "schema validation" and the page was not written
 * (Oct 2026: "groq: schema validation failed"). This only reshapes what the model sent — it never
 * invents copy except the meta title/description, which are taken from the title and description.
 */

type Obj = Record<string, any>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);

function pick(o: Obj, ...names: string[]): any {
  const keys = Object.keys(o);
  for (const n of names) {
    const want = n.toLowerCase().replace(/[^a-z]/g, "");
    const k = keys.find((x) => x.toLowerCase().replace(/[^a-z]/g, "") === want);
    if (k !== undefined && o[k] != null) return o[k];
  }
  return undefined;
}

function str(x: unknown): string {
  if (x == null) return "";
  if (typeof x === "string") return x.trim();
  if (Array.isArray(x)) return x.map(str).filter(Boolean).join(", ");
  if (isObj(x)) return Object.entries(x).map(([k, v]) => `${k}: ${str(v)}`).join(", ");
  return String(x).trim();
}

function list(x: unknown): string[] {
  const raw = Array.isArray(x) ? x.map(str) : typeof x === "string" ? x.split(/[,;|\n]/) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const t = r.replace(/^#/, "").trim();
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
  }
  return out;
}

function specsOf(x: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isObj(x)) {
    for (const [k, v] of Object.entries(x)) { const s = str(v); if (s) out[k] = s; }
  } else if (Array.isArray(x)) {
    for (const it of x) {
      if (isObj(it)) {
        const k = str(pick(it, "key", "name", "label", "spec", "title"));
        const v = str(pick(it, "value", "detail", "val", "description"));
        if (k && v) out[k] = v;
        else if (Object.keys(it).length === 1) { const [kk, vv] = Object.entries(it)[0]; if (str(vv)) out[kk] = str(vv); }
      } else if (typeof it === "string" && it.includes(":")) {
        const i = it.indexOf(":"); const k = it.slice(0, i).trim(); const v = it.slice(i + 1).trim();
        if (k && v) out[k] = v;
      }
    }
  }
  return out;
}

export function normalizeListing(raw: unknown): unknown {
  let o: any = raw;
  if (typeof o === "string") { try { o = JSON.parse(o); } catch { return raw; } }
  if (Array.isArray(o) && o.length === 1) o = o[0];
  if (!isObj(o)) return raw;
  // unwrap { product: {...} } / { page: {...} } / { data: {...} }
  if (pick(o, "title") === undefined) {
    const inner = Object.values(o).find((v) => isObj(v) && pick(v, "title") !== undefined);
    if (inner) o = inner;
  }

  const title = str(pick(o, "title", "productTitle", "name"));
  const description = str(pick(o, "description", "productDescription", "desc", "body"));
  const specs = specsOf(pick(o, "specs", "specifications", "spec", "attributes", "details"));
  let tags = list(pick(o, "tags", "searchTags", "keywords"));

  const seoRaw = pick(o, "seo", "meta");
  const seo: Obj = isObj(seoRaw) ? seoRaw : {};
  const metaTitle = str(pick(seo, "metaTitle", "title") ?? pick(o, "metaTitle")) || title;
  const metaDescription = str(pick(seo, "metaDescription", "description") ?? pick(o, "metaDescription"))
    || description.replace(/\s+/g, " ").slice(0, 155);
  let keywords = list(pick(seo, "keywords", "metaKeywords") ?? pick(o, "seoKeywords", "metaKeywords"));

  // Keywords and tags describe the same thing — top each up from the other when a model is short.
  if (keywords.length < 5) keywords = list([...keywords, ...tags]);
  if (tags.length < 4) tags = list([...tags, ...keywords]);

  return { ...o, title, description, specs, tags, seo: { ...seo, metaTitle, metaDescription, keywords } };
}

/** JSON.parse that also accepts a reply wrapped in ```json fences or with a sentence around it. */
export function parseModelJson(text: string): unknown {
  try { return JSON.parse(text); } catch { /* try harder */ }
  const t = String(text ?? "").replace(/```(?:json)?/gi, "").trim();
  try { return JSON.parse(t); } catch { /* try harder */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  return JSON.parse(t); // throws the real parse error
}
