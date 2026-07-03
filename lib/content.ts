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
  if (n.includes("oxidis") || n.includes("oxidiz") || n.includes("silver")) t.push("Oxidised");
  if (n.includes("chandbali") || n.includes("chandabali")) t.push("Chandbali");
  if (n.includes("jhumka")) t.push("Jhumka");
  if (n.includes("choker")) t.push("Choker");
  if (n.includes("semi long")) t.push("Semi Long");
  else if (n.includes("long")) t.push("Long");
  if (n.includes("double layer")) t.push("Double Layer");
  else if (n.includes("layered") || n.includes("layer")) t.push("Layered");
  return [...new Set(t)];
}

export function templateContent(p: ProductLike): GeneratedContent {
  const cat = p.categoryName ?? "Jewellery";
  const styles = styleHints(p.name, p.keywords);
  const pieces = includedPieces(p.keywords);
  const isSet = pieces.length > 0 || /set/i.test(p.name);
  // Jewellery TYPE, e.g. "Necklace Set" / "Earrings" — singularise the category and add "Set" when it
  // ships with extra pieces, matching BlytheDIVA's titles.
  const baseType = cat.replace(/s$/i, "");
  const type = isSet && !/set/i.test(baseType) ? `${baseType} Set` : (baseType || "Jewellery");
  const material = styles.find((s) => /kundan|meenakari|temple|polki|pearl|moissanite|turkish|crystal|oxidised/i.test(s)) ?? "";
  const styleWord = styles.filter((s) => /semi long|long|double layer|layered|choker|chandbali|jhumka/i.test(s)).join(" ");
  const descriptorStr = [styleWord, material].filter(Boolean).join(" ").trim();

  // TITLE — BlytheDIVA house style: {UniqueName} {descriptors} {Type} with {included pieces}. No SKU.
  const withPieces = pieces.length ? ` with ${joinAnd(pieces)}` : "";
  const name = pickDivaName(p.sku || p.name);
  const title = [name, descriptorStr, type].filter(Boolean).join(" ") + withPieces;

  const catL = type.toLowerCase();
  const includesLine = pieces.length ? `The set includes ${joinAnd(pieces.map((x) => x.toLowerCase()))}, making it a complete jewellery choice ` : "This piece is a graceful choice ";
  const materialLine = material ? `${material.toLowerCase()} detailing that gives a rich traditional and bridal appeal` : "elegant craftsmanship with a rich traditional appeal";
  const description =
    `Add royal elegance to your festive look with ${title} by BlytheDIVA. ` +
    `Designed in a graceful ${styleWord || "classic"} style, this ${catL} features ${materialLine}. ` +
    `${includesLine}for weddings, engagement ceremonies, sangeet, haldi-mehendi functions, festive celebrations and family occasions. ` +
    `Its elegant ethnic design pairs beautifully with sarees, lehengas, anarkalis, shararas and bridal outfits. ` +
    `Perfect for brides, bridesmaids and women who love statement Indian jewellery, this ${catL} adds charm, richness and timeless beauty to special-occasion styling.`;

  const specs: Record<string, string> = {
    Category: cat,
    Material: material || "Brass alloy, anti-tarnish plating",
    "Work / Style": styles.length ? styles.join(", ") : "Handcrafted",
    ...(pieces.length ? { Includes: joinAnd(pieces) } : {}),
    Occasion: "Wedding, festive, party & daily wear",
    Care: "Keep away from water & perfume; store dry",
    ...(p.colors && p.colors.length ? { Colours: p.colors.join(", ") } : {}),
  };

  const tags = Array.from(new Set([
    type, "artificial jewellery", "imitation jewellery", "bridal jewellery",
    ...styles, ...pieces, ...OCCASIONS.slice(0, 3), ...(p.colors ?? []),
  ])).filter(Boolean).slice(0, 14);

  const keywords = Array.from(new Set([
    `${descriptorStr} ${catL}`.trim(), `${catL} for wedding`, `${catL} for festive wear`,
    "artificial jewellery online India", "bridal jewellery Delhi", ...(p.keywords ?? []), ...LOCATION,
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
