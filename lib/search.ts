/**
 * Storefront product search — jewellery-aware matching used by /search.
 *
 * Shoppers type the way they talk ("Watch", "gold jhumka", "necklace for women"), but catalogue
 * names are curated ("Prisha Floral Design Gold Watch", "Ananya AD Jhumkas") and AI titles may
 * carry the true type when the category is vague ("Bracelet Watch" filed under Bracelets).
 *
 * Rules:
 *  - every meaningful word must match, in any order
 *  - stopwords ("for", "women", "with") are ignored
 *  - plurals / tight synonyms (watch↔watches, jhumka↔jhumki, oxidised↔oxidized) expand
 *  - short tokens (ring, ad) match as whole words so "ring" does not hit "earrings"
 */

export type SearchableProduct = {
  sku: string;
  name: string;
  category?: string | null;
  subcategory?: string | null;
  style?: string | null;
  colors?: string[];
  tags?: string[];
  keywords?: string[];
  title?: string | null;
};

const STOPWORDS = new Set([
  "a", "an", "the", "for", "with", "and", "or", "of", "in", "on", "to", "by",
  "from", "into", "set", "sets", "piece", "pieces", "design", "designs",
  "women", "womens", "woman", "ladies", "lady", "girls", "girl", "female",
  "mens", "men", "male", "unisex", "kids", "jewellery", "jewelry", "artificial",
  "imitation", "fashion", "premium", "latest", "new", "style", "wear", "party",
]);

/** Tight alias groups — a query token matches a product if ANY member of its group appears. */
const SYN_GROUPS: string[][] = [
  ["watch", "watches", "wristwatch", "wristwatches", "timepiece", "timepieces"],
  ["jhumka", "jhumkas", "jhumki", "jhumkis", "jhumkies"],
  ["earring", "earrings", "earings"],
  ["necklace", "necklaces", "haar", "mala"],
  ["choker", "chokers"],
  ["bracelet", "bracelets", "kada", "kade", "kangan"],
  ["bangle", "bangles"],
  ["ring", "rings"],
  ["anklet", "anklets", "payal", "payals", "pajeb"],
  ["pendant", "pendants"],
  ["nath", "nose", "nosepin"],
  ["tikka", "maang", "mangtikka", "mangtika"],
  ["oxidised", "oxidized", "oxodised", "oxodized"],
  ["kundan", "kundanwork"],
  ["meenakari", "meena", "meenawork"],
  ["ad", "cz", "zircon"],
];

const SYN_INDEX = new Map<string, string[]>();
for (const g of SYN_GROUPS) {
  for (const w of g) SYN_INDEX.set(w, g);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function stem(t: string): string {
  if (t.length <= 3) return t;
  if (t.endsWith("ies") && t.length > 5) return t.slice(0, -3) + "y";
  if (t.endsWith("sses")) return t.slice(0, -2);
  if (t.endsWith("ches") || t.endsWith("shes")) return t.slice(0, -2);
  if (t.endsWith("ses") && t.length > 4) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss") && t.length > 3) return t.slice(0, -1);
  return t;
}

/** Query tokens after stopword removal, with synonym/plural expansions. */
export function queryTokens(q: string): string[][] {
  const raw = tokenize(q);
  const kept = raw.filter((t) => !STOPWORDS.has(t));
  const source = kept.length ? kept : raw;
  return source.map((t) => {
    const extras = SYN_INDEX.get(t) ?? SYN_INDEX.get(stem(t)) ?? [];
    return [...new Set([t, stem(t), ...extras])];
  });
}

export function haystackOf(p: SearchableProduct): { text: string; words: Set<string> } {
  const parts = [
    p.name,
    p.sku,
    p.category,
    p.subcategory,
    p.style,
    p.title,
    ...(p.colors ?? []),
    ...(p.tags ?? []),
    ...(p.keywords ?? []),
  ];
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  const words = new Set(tokenize(text).flatMap((w) => [w, stem(w)]));
  return { text, words };
}

function tokenHits(tokenGroup: string[], hay: { text: string; words: Set<string> }): boolean {
  return tokenGroup.some((t) => {
    if (!t) return false;
    if (hay.words.has(t) || hay.words.has(stem(t))) return true;
    // Prefix on a catalogue word: "neck" → necklace, but not "ring" → earrings.
    if (t.length >= 4) {
      for (const w of hay.words) {
        if (w.startsWith(t) || stem(w).startsWith(t)) return true;
      }
    }
    return false;
  });
}

export function matchesQuery(p: SearchableProduct, q: string): boolean {
  const groups = queryTokens(q);
  if (!groups.length) return false;
  const hay = haystackOf(p);
  // Exact SKU (ignoring hyphens/case) always wins.
  const compactQ = q.trim().toLowerCase().replace(/[\s-]/g, "");
  const compactSku = (p.sku ?? "").toLowerCase().replace(/[\s-]/g, "");
  if (compactQ && compactSku && (compactSku === compactQ || compactSku.includes(compactQ))) {
    if (groups.length === 1) return true;
  }
  return groups.every((g) => tokenHits(g, hay));
}

/** Higher is better. Used to put "Prisha … Watch" above a weak tag hit. */
export function scoreQuery(p: SearchableProduct, q: string): number {
  if (!matchesQuery(p, q)) return 0;
  const groups = queryTokens(q);
  const name = haystackOf({ name: p.name, sku: p.sku, category: p.category });
  const full = haystackOf(p);
  let score = 1;
  for (const g of groups) {
    if (tokenHits(g, name)) score += 8;
    else if (tokenHits(g, full)) score += 2;
  }
  const qlc = q.trim().toLowerCase();
  if ((p.name ?? "").toLowerCase().includes(qlc)) score += 12;
  if ((p.sku ?? "").toLowerCase() === qlc) score += 40;
  return score;
}

export function rankSearch<T extends SearchableProduct>(items: T[], q: string): T[] {
  const query = q.trim();
  if (!query) return [];
  return items
    .map((p) => ({ p, s: scoreQuery(p, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name))
    .map((x) => x.p);
}
