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

  const material = styles.find((s) => /kundan|meenakari|temple|polki|pearl|moissanite|turkish|crystal|oxidised/i.test(s)) ?? "";
  const styleWord = styles.filter((s) => /semi long|long|double layer|layered|choker|chandbali|jhumka/i.test(s)).join(" ");

  // TITLE — {UniqueName} {descriptors from keywords/name} {Type} with {pieces}. No SKU, ever.
  const titleDescriptors = (western ? wStyles : [styleWord, material].filter(Boolean)).slice(0, 3).join(" ").trim();
  const title = [name, titleDescriptors, type].filter(Boolean).join(" ") + withPieces;

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
      `Designed in a graceful ${styleWord || "classic"} style, this ${catL} features ${materialLine}. ` +
      `${includesLine}for weddings, engagement ceremonies, sangeet, haldi-mehendi functions, festive celebrations and family occasions. ` +
      `Its elegant ethnic design pairs beautifully with sarees, lehengas, anarkalis, shararas and bridal outfits. ` +
      `Perfect for brides, bridesmaids and women who love statement Indian jewellery, this ${catL} adds charm, richness and timeless beauty to special-occasion styling.`;
    specOccasion = "Wedding, festive, party & daily wear";
    specMaterial = material || "Brass alloy, anti-tarnish plating";
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
    ...(p.colors && p.colors.length ? { Colours: p.colors.join(", ") } : {}),
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
  if (p.generated_content && p.generated_content.title) return p.generated_content;
  return templateContent(p);
}
