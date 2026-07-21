/**
 * Deterministic SEO title builder — turns a descriptive product NAME into a ChatGPT-style storefront
 * title: "{Girl name} {Materials} {Design} {Type}[ Set][ with Maang Tikka] for Women". No AI, no cost,
 * reliable at catalogue scale. It only RESTRUCTURES words already present in the name (plus the
 * jewellery type from the category) — it never invents a stone/design that isn't there.
 *
 * SAFETY: it returns null (→ caller leaves the product untouched, for the AI/vision flow) unless the
 * name has a real girl-name lead AND at least one genuine material or design word. That skips SKU-only
 * names ("E1068"), placeholder junk ("Bzbzbbszb"), and one-word names — so those never get a bogus
 * "Earrings for Women" slapped on them.
 */

const MATERIALS: [RegExp, string][] = [
  [/\buncut\b/i, "Uncut"], [/\bkundan\b/i, "Kundan"], [/\bpolki\b/i, "Polki"],
  [/\bmeenakari\b/i, "Meenakari"], [/\btemple\b/i, "Temple"], [/\boxidi[sz]ed\b/i, "Oxidised"],
  [/\bamerican diamond\b|\bcz\b/i, "American Diamond"],
  [/\bmoissanite\b|\bmosonite\b|\bmonalisa\b/i, "Moissanite"], [/\bzircon\b/i, "Zircon"],
  [/\bcrystal\b/i, "Crystal"], [/\bpearl(s)?\b/i, "Pearl"], [/\bruby\b/i, "Ruby"],
  [/\bemerald\b/i, "Emerald"], [/\bstone(s)?\b/i, "Stone"], [/\bacrylic\b/i, "Acrylic"],
  [/\bmirror\b/i, "Mirror"], [/\bbead(ed|s)?\b/i, "Beaded"], [/\bvictorian\b/i, "Victorian"],
];

const DESIGNS: [RegExp, string][] = [
  [/\bchandbali(s)?\b/i, "Chandbali"], [/\bjhumk(a|i|as|is|ies)\b/i, "Jhumka"],
  [/\bdangler(s)?\b/i, "Danglers"], [/\bstud(ded|s)?\b/i, "Stud"], [/\bdrop(s)?\b/i, "Drop"],
  [/\blayered\b/i, "Layered"], [/\bhalo\b/i, "Halo"], [/\bsolitaire\b/i, "Solitaire"],
  [/\blotus\b/i, "Lotus"], [/\bfloral\b|\bflower\b/i, "Floral"], [/\bpeacock\b/i, "Peacock"],
  [/\bbutterfly\b/i, "Butterfly"], [/\bheart\b/i, "Heart"], [/\bmarquise\b/i, "Marquise"],
  [/\bleaf\b/i, "Leaf"], [/\bstatement\b/i, "Statement"], [/\bfusion\b/i, "Fusion"],
  [/\bminimal(istic)?\b/i, "Minimal"], [/\btriangle\b/i, "Triangle"], [/\bround\b/i, "Round"],
  [/\bsleek\b/i, "Sleek"], [/\bvintage\b/i, "Vintage"], [/\blong\b/i, "Long"],
];

const TYPE_BY_CAT: [RegExp, string][] = [
  [/earring/i, "Earrings"], [/jhumk/i, "Earrings"], [/chandbali/i, "Earrings"],
  [/choker/i, "Choker"], [/necklace/i, "Necklace"], [/pendant/i, "Pendant"],
  [/\bchain\b/i, "Chain"], [/\bring/i, "Ring"], [/bracelet/i, "Bracelet"], [/bangle/i, "Bangle"],
];

const looksLikeCode = (name: string) => /^[a-z]{1,5}[- ]?\d/i.test(name.trim()) || /^earrings?-?\d/i.test(name.trim());

/** First token is the assigned girl name IF it's a plain Capitalised word (not a material/design/junk). */
function leadName(tokens: string[]): string | null {
  const w = tokens[0] ?? "";
  if (!/^[A-Z][a-z]{2,}$/.test(w)) return null;               // Capitalised, ≥3 letters, has lowercase
  if ([...MATERIALS, ...DESIGNS].some(([re]) => re.test(w))) return null;
  return w;
}

function typeWord(categoryName: string | undefined, name: string): string | null {
  const hay = `${categoryName ?? ""} ${name}`;
  for (const [re, t] of TYPE_BY_CAT) if (re.test(hay)) return t;
  return null;
}

export function seoTitleFromName(name: string, categoryName?: string): string | null {
  const raw = (name ?? "").trim();
  if (!raw || looksLikeCode(raw)) return null;

  const tokens = raw.split(/\s+/);
  const girl = leadName(tokens);
  if (!girl) return null;                                     // no real name → leave to AI

  const found = (list: [RegExp, string][]) => {
    const out: string[] = [];
    for (const [re, canon] of list) if (re.test(raw) && !out.includes(canon)) out.push(canon);
    return out;
  };
  const materials = found(MATERIALS);
  const designs = found(DESIGNS);
  // GUARD: only restructure names with genuine jewellery vocabulary (not just a category type).
  if (!materials.length && !designs.length) return null;

  let type = typeWord(categoryName, raw);
  const hasSet = /\bset\b/i.test(raw);
  const hasTikka = /\bmaang\b|\btikka\b/i.test(raw);

  const parts: string[] = [girl, ...materials, ...designs];
  if (type && type !== designs[designs.length - 1]) parts.push(type);
  if (hasSet) parts.push("Set");

  // De-dupe (case-insensitive), keep order, Title Case already, cap length.
  const seen = new Set<string>();
  let words = parts.filter((w) => { const k = w.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  let title = words.join(" ");
  const tail = hasTikka ? " with Maang Tikka" : " for Women";
  if ((title + tail).length <= 70) title += tail;

  return title.split(" ").length >= 3 ? title : null;
}
