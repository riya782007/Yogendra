/**
 * lib/content.ts — product content resolver. Requirement 2.2-2.3.
 * NEVER calls a model on the request path: cached generated_content else a rich
 * deterministic template. SEO-strong by default (tags, keywords, occasion terms).
 */
export type GeneratedContent = {
  title: string;
  description: string;
  specs: Record<string, string>;
  tags: string[];
  seo: { metaTitle: string; metaDescription: string; keywords: string[] };
};

export type ProductLike = {
  name: string;
  sku: string;
  categoryName?: string;
  colors?: string[];
  keywords?: string[];
  generated_content?: GeneratedContent | null;
  /** Optional product photo (base64, no data: prefix) so the AI can look at the piece
   *  when writing the title & description. Ignored by the deterministic template fallback. */
  imageBase64?: string;
  imageMime?: string;
};

const LOCATION = ["Sadar Bazar", "Rui Mandi", "Delhi", "artificial jewellery wholesale Delhi", "imitation jewellery online India"];
const OCCASIONS = ["wedding", "festive", "party wear", "daily wear", "gifting"];

// BlytheDIVA house style: every product title STARTS with a unique Indian girl's first name.
// Used by the deterministic fallback (the AI picks its own from a wider set).
export const DIVA_NAMES = [
  "Ananya", "Dhyani", "Rutvika", "Khyati", "Nashvika", "Drishika", "Gitanjali", "Tanisha", "Rumatra",
  "Rashika", "Priyanshi", "Nidhi", "Aaradhya", "Ishika", "Myra", "Saanvi", "Vanya", "Aaravi", "Kiara",
  "Anvita", "Reyna", "Navya", "Prisha", "Aadhya", "Mahika", "Siya", "Tara", "Inaya", "Riya", "Avni",
  "Meher", "Kashvi", "Vaidehi", "Charvi", "Diya", "Hiya", "Zara", "Nitya", "Samaira", "Aisha",
];
/**
 * The owner curates every product name in the exact house format he wants:
 *   {Girl name} {design / material} {product type}   e.g. "Divya American Diamond Stone Jhumkas".
 * That curated name IS the title he wants shown — so we ALWAYS prefer it and never let the AI or the
 * synthesiser rewrite it (which was inventing a new girl name and flowery wording he disliked).
 * Returns the cleaned name, or null when the name is missing/placeholder so a title can be synthesised.
 */
export function preferredTitle(p: { name?: string | null }): string | null {
  const raw = (p.name ?? "").replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+/g, " ").trim(); // drop any trailing (SKU)
  if (raw.length < 3) return null;
  if (/^(product|untitled|new product|item|sku\b)/i.test(raw)) return null; // placeholder names → synthesise
  return raw;
}

/** Deterministic, stable name pick for a product (so its fallback title doesn't change each render). */
export function pickDivaName(seed: string): string {
  let h = 0; const s = (seed || "").toString();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return DIVA_NAMES[h % DIVA_NAMES.length];
}

/** Included accessory pieces detected from the owner's spec keywords (drives "with … " in title/desc). */
export function includedPieces(keywords?: string[]): string[] {
  const t = (keywords ?? []).join(" ").toLowerCase();
  const out: string[] = [];
  if (/maang ?tik|mangtik|mang ?tik|tikka/.test(t)) out.push("Maang Tikka");
  if (/finger ?ring|\bring\b/.test(t)) out.push("Finger Ring");
  if (/ear ?ring|jhumk|jhumka|danglers|studs/.test(t)) out.push("Earrings");
  if (/bracelet|kada|kada|bangle/.test(t)) out.push("Bracelet");
  if (/nose ?pin|nath/.test(t)) out.push("Nose Pin");
  if (/haathphool|hathphool|hand ?harness/.test(t)) out.push("Haathphool");
  return out;
}
function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

/** Ethnic/bridal material & style descriptors detected from the name + spec keywords. */
function styleHints(name: string, keywords?: string[]): string[] {
  const n = (name + " " + (keywords ?? []).join(" ")).toLowerCase(); const t: string[] = [];
  if (n.includes("american diamond") || n.includes("americandiamond") || n.includes("ad stone")) t.push("American Diamond");
  if (n.includes("zircon") || n.includes("zircorn")) t.push("Zircon");
  if (n.includes("uncut kundan")) t.push("Uncut Kundan");
  else if (n.includes("kundan")) t.push("Kundan");
  if (n.includes("meena") || n.includes("meenakari")) t.push("Meenakari");
  if (n.includes("temple") || n.includes("lakshmi")) t.push("Temple");
  if (n.includes("polki")) t.push("Polki");
  if (n.includes("moissanite")) t.push("Moissanite");
  if (n.includes("turkish")) t.push("Turkish Stone");
  if (n.includes("crystal")) t.push("Crystal Stone");
  if (n.includes("pearl")) t.push("Pearl");
  if (n.includes("oxidis") || n.includes("oxidiz")) t.push("Oxidised");
  if (n.includes("chandbali") || n.includes("chandabali")) t.push("Chandbali");
  if (n.includes("jhumka")) t.push("Jhumka");
  if (n.includes("choker")) t.push("Choker");
  if (n.includes("semi long")) t.push("Semi Long");
  else if (n.includes("long")) t.push("Long");
  if (n.includes("double layer")) t.push("Double Layer");
  else if (n.includes("layered") || n.includes("layer")) t.push("Layered");
  return [...new Set(t)];
}

/** Western / daily-wear descriptors detected from the name + spec keywords (title-cased for the title). */
function westernHints(name: string, keywords?: string[]): string[] {
  const n = (name + " " + (keywords ?? []).join(" ")).toLowerCase(); const t: string[] = [];
  if (/anti[- ]?tarnish/.test(n)) t.push("Anti-Tarnish");
  if (n.includes("western")) t.push("Western");
  if (/daily ?wear|everyday/.test(n)) t.push("Daily Wear");
  if (n.includes("minimal")) t.push("Minimal");
  if (n.includes("rose gold")) t.push("Rose Gold");
  else if (/gold ?plat|gold ?tone|golden/.test(n)) t.push("Gold-Plated");
  if (n.includes("silver") || n.includes("rhodium")) t.push("Silver-Tone");
  if (/american diamond|\bad\b/.test(n)) t.push("American Diamond");
  if (n.includes("zircon") || n.includes("cz")) t.push("Zircon");
  if (n.includes("solitaire")) t.push("Solitaire");
  if (n.includes("cuff")) t.push("Cuff");
  if (n.includes("charm")) t.push("Charm");
  if (n.includes("chain")) t.push("Chain");
  return [...new Set(t)];
}

// Signals that tip a piece from BlytheDIVA's default ethnic/bridal register into a western/daily one.
const WESTERN_RE = /western|daily ?wear|\bdaily\b|office|work ?wear|corporate|casual|minimal|everyday|contemporary|modern|\bchic\b|trendy|anti[- ]?tarnish|waterproof|college|\bjeans\b|dress(es)?\b|co-?ord/;
const BRIDAL_RE = /kundan|polki|temple|meenakari|choker|maang|tikka|rani ?haar|matha|bridal|dulhan|jhumk|chandbali|sabyasachi/;

// ---- Spec-keyword parsing so the title mirrors what the owner typed, cleanly ordered ----
// Jewellery TYPE words (removed from descriptors — the type is appended once at the end).
const TYPE_WORD_RE = /\b(necklaces?|chokers?|earrings?|jhumkas?|jhumki|danglers?|studs?|rings?|bracelets?|kada|bangles?|pendants?|maang ?tikka|mangtikka|nose ?pins?|nath|haathphool|sets?|jewellery|jewelry|collection)\b/gi;
// Pure "vibe" filler that clutters a title — dropped (BlytheDIVA titles don't carry these).
const FILLER_WORDS = new Set(["ethnic","elegant","royal","beautiful","designer","fancy","latest","new","gorgeous","stylish","premium","trendy","classic","piece","women","womens","women's","girls","ladies","the","a","an","for","with","and","in","of","style","look","wear","artificial","imitation"]);
// A phrase mentioning any of these is a MATERIAL/STONE (goes after the style adjectives).
const MATERIAL_RE = /kundan|polki|meenakari|temple|moissanite|turkish|monalisa|mona ?lisa|crystal|pearl|stone|diamond|zircon|american diamond|\bad\b|\bcz\b|gold|silver|rose ?gold|rhodium|oxidis|oxidiz|brass|glass|acrylic|bead|enamel|jadau|jadtar|kemp/i;
// A phrase mentioning any of these is a STYLE / SHAPE adjective (goes first).
const STYLE_RE = /sleek|semi ?long|\blong\b|layered|double ?layer|single ?line|choker|statement|minimal|delicate|chunky|antique|contemporary|western|\bshort\b|multi ?layer|bold|dainty|hanging|drop|\bchand?bali\b|jhumka|anti[- ]?tarnish/i;

function titleCasePhrase(s: string): string {
  return s.split(/\s+/).filter(Boolean).map((w) => {
    const lw = w.toLowerCase();
    if (lw === "ad") return "AD"; if (lw === "cz") return "CZ";
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");
}

/** Turn the owner's raw spec keywords into ordered, title-ready descriptors: strip the jewellery type
 *  and filler words, then classify each phrase as a STYLE adjective (first) or a MATERIAL (after). */
function parseSpecKeywords(keywords?: string[]): { styles: string[]; materials: string[]; ordered: string[] } {
  const styles: string[] = [], materials: string[] = [], others: string[] = [];
  for (const raw of (keywords ?? [])) {
    const cleaned = raw.toLowerCase().replace(TYPE_WORD_RE, " ").split(/\s+/).filter((w) => w && !FILLER_WORDS.has(w)).join(" ").trim();
    if (!cleaned) continue;
    const tc = titleCasePhrase(cleaned);
    if (MATERIAL_RE.test(cleaned)) materials.push(tc);
    else if (STYLE_RE.test(cleaned)) styles.push(tc);
    else others.push(tc);
  }
  const uniq = (a: string[]) => [...new Set(a)];
  // order: style adjectives → other descriptors → materials/stones (BlytheDIVA reads best this way)
  return { styles: uniq(styles), materials: uniq(materials), ordered: uniq([...styles, ...others, ...materials]) };
}

export function templateContent(p: ProductLike): GeneratedContent {
  const cat = p.categoryName ?? "Jewellery";
  const blob = (p.name + " " + (p.keywords ?? []).join(" ")).toLowerCase();
  // Register: default to the brand's ethnic/festive voice; switch to western/daily when the owner's
  // keywords or name clearly say so AND there's no strong bridal material — so a "Western anti-tarnish
  // bracelet" never gets wedding/saree copy (the bug the owner reported on WBR1006).
  const western = WESTERN_RE.test(blob) && !BRIDAL_RE.test(blob);

  const styles = styleHints(p.name, p.keywords);
  const wStyles = westernHints(p.name, p.keywords);
  const pieces = includedPieces(p.keywords);
  const isSet = pieces.length > 0 || /set/i.test(p.name);
  const baseType = cat.replace(/s$/i, "");
  const type = isSet && !/set/i.test(baseType) ? `${baseType} Set` : (baseType || "Jewellery");
  const catL = type.toLowerCase();
  const name = pickDivaName(p.sku || p.name);
  const withPieces = pieces.length ? ` with ${joinAnd(pieces)}` : "";

  // Prefer the owner's own spec keywords (cleanly parsed & ordered) — this is what he curated, so the
  // title mirrors it faithfully. Fall back to name/word detection only when no keywords were given.
  const parsed = parseSpecKeywords(p.keywords);
  const hasKw = parsed.ordered.length > 0;
  const material = parsed.materials.join(", ") || (styles.find((s) => /american diamond|zircon|kundan|meenakari|temple|polki|pearl|moissanite|turkish|crystal|oxidised/i.test(s)) ?? "");
  const styleWord = parsed.styles.join(" ") || styles.filter((s) => /semi long|long|double layer|layered|choker|chandbali|jhumka/i.test(s)).join(" ");

  // TITLE — {UniqueName} {ordered descriptors} {Type} with {pieces}. No SKU, ever.
  // Word-level dedupe (drops repeats + any leftover type word) and cap length so it stays catalogue-tidy.
  const rawDescriptorWords = (hasKw ? parsed.ordered.join(" ") : (western ? wStyles.join(" ") : [styleWord, material].filter(Boolean).join(" "))).split(/\s+/);
  const typeWords = new Set(type.toLowerCase().split(/\s+/));
  const seen = new Set<string>(); const descWords: string[] = [];
  for (const w of rawDescriptorWords) {
    const lw = w.toLowerCase();
    if (!lw || seen.has(lw) || typeWords.has(lw)) continue;
    seen.add(lw); descWords.push(w);
    if (descWords.length >= 5) break;
  }
  const titleDescriptors = descWords.join(" ").trim();
  // Prefer the owner's curated name verbatim; only synthesise a {name}{descriptors}{type} title when
  // the product has no real name yet.
  const title = preferredTitle(p) ?? ([name, titleDescriptors, type].filter(Boolean).join(" ") + withPieces);

  let description: string;
  let specOccasion: string, specMaterial: string;
  if (western) {
    const finish = wStyles.find((s) => /gold|silver|rose|american diamond|zircon/i.test(s));
    const antiTarnish = /anti[- ]?tarnish/.test(blob);
    description =
      `Make everyday styling effortless with ${title} by BlytheDIVA. ` +
      `${finish ? `Finished in a ${finish.toLowerCase()} tone, it` : "It"} carries a clean, contemporary look that's light on the skin and easy to carry from work to evenings out. ` +
      `${antiTarnish ? "Its anti-tarnish plating keeps the shine and colour lasting through regular, everyday use. " : ""}` +
      `This ${catL} pairs effortlessly with dresses, jeans, kurtis, co-ords and western outfits — an easy pick for daily wear, office, college and casual outings. ` +
      `Lightweight, skin-friendly and gift-ready, it adds a modern, minimal shine to any look.`;
    specOccasion = "Daily wear, office, college, parties & gifting";
    specMaterial = antiTarnish ? "Anti-tarnish plated alloy" : (finish ? `${finish} plated alloy` : "Skin-friendly plated alloy");
  } else {
    const includesLine = pieces.length ? `The set includes ${joinAnd(pieces.map((x) => x.toLowerCase()))}, making it a complete jewellery choice ` : "This piece is a graceful choice ";
    const materialLine = material ? `${material.toLowerCase()} detailing that gives a rich traditional and bridal appeal` : "elegant craftsmanship with a rich traditional appeal";
    description =
      `Add royal elegance to your festive look with ${title} by BlytheDIVA. ` +
      `Designed in a graceful ${(styleWord || "classic").toLowerCase()} style, this ${catL} features ${materialLine}. ` +
      `${includesLine}for weddings, engagement ceremonies, sangeet, haldi-mehendi functions, festive celebrations and family occasions. ` +
      `Its elegant ethnic design pairs beautifully with sarees, lehengas, anarkalis, shararas and bridal outfits. ` +
      `Perfect for brides, bridesmaids and women who love statement Indian jewellery, this ${catL} adds charm, richness and timeless beauty to special-occasion styling.`;
    specOccasion = "Wedding, festive, party & daily wear";
    // Don't claim "anti-tarnish" by default — it isn't true for every piece. Use the detected material
    // (American Diamond, Kundan, etc.) when known, else a plain, safe "Brass alloy".
    specMaterial = material || "Brass alloy";
  }

  const descriptorStr = titleDescriptors;
  const allStyles = western ? wStyles : styles;
  const specs: Record<string, string> = {
    Category: cat,
    Material: specMaterial,
    "Work / Style": allStyles.length ? allStyles.join(", ") : "Handcrafted",
    ...(pieces.length ? { Includes: joinAnd(pieces) } : {}),
    Occasion: specOccasion,
    Care: "Keep away from water & perfume; store dry",
    // Colours intentionally omitted from specs — the variant/colour selector already shows them, so
    // repeating them here is redundant (owner's note).
  };

  const tags = Array.from(new Set([
    type, "artificial jewellery", "imitation jewellery",
    ...(western ? ["western jewellery", "daily wear jewellery", "anti tarnish jewellery", "minimal jewellery"] : ["bridal jewellery", "ethnic jewellery", ...OCCASIONS.slice(0, 3)]),
    ...allStyles, ...pieces, ...(p.keywords ?? []), ...(p.colors ?? []),
  ])).filter(Boolean).slice(0, 14);

  const keywords = Array.from(new Set([
    `${descriptorStr} ${catL}`.trim(),
    ...(western
      ? [`${catL} for daily wear`, `western ${catL}`, `anti tarnish ${catL}`, "western jewellery online India"]
      : [`${catL} for wedding`, `${catL} for festive wear`, "artificial jewellery online India", "bridal jewellery Delhi"]),
    ...(p.keywords ?? []), ...LOCATION,
  ])).filter(Boolean).slice(0, 12);

  return {
    title,
    description,
    specs,
    tags,
    seo: {
      metaTitle: `${title} | BlytheDIVA`.slice(0, 60),
      metaDescription: `Buy ${title} — ${descriptorStr || "artificial"} ${catL} at retail & wholesale from BlytheDIVA, Sadar Bazar Delhi. COD, easy returns.`.slice(0, 158),
      keywords,
    },
  };
}

export function resolveProductContent(p: ProductLike): GeneratedContent {
  if (p.generated_content && p.generated_content.title) {
    const gc = p.generated_content;
    const tpl = templateContent(p); // deterministic, complete — used to fill any field left empty
    const curated = preferredTitle(p);
    const title = curated || gc.title;
    // The AI often wrote its OWN (flowery) title into the description & SEO prose (e.g. "...with Aaradhya
    // American Diamond Stone Jhumka Earrings by BlytheDIVA"). Since the shown title is the owner's clean
    // curated name, swap that old title string OUT of every text field so the name is consistent
    // everywhere — the root cause of "title is right but the description shows the old name".
    const fixName = (s: string | undefined, fallback: string): string => {
      const out = (s && s.trim()) ? s : fallback;
      return (curated && gc.title && curated !== gc.title) ? out.split(gc.title).join(curated) : out;
    };
    // TITLE is always the owner's curated name; other fields keep the saved value when present, else
    // fall back to the complete template — so no product ever shows an empty field ("yeh sab khali").
    return {
      title,
      description: fixName(gc.description, tpl.description),
      specs: gc.specs && Object.keys(gc.specs).length > 0 ? gc.specs : tpl.specs,
      tags: gc.tags && gc.tags.length > 0 ? gc.tags : tpl.tags,
      seo: {
        metaTitle: fixName(gc.seo?.metaTitle, tpl.seo.metaTitle),
        metaDescription: fixName(gc.seo?.metaDescription, tpl.seo.metaDescription),
        keywords: gc.seo?.keywords && gc.seo.keywords.length > 0 ? gc.seo.keywords : tpl.seo.keywords,
      },
    };
  }
  return templateContent(p);
}
