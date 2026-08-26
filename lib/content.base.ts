/**
 * Product content resolver. NAME is ground truth for jewellery type.
 * NEVER calls a model on the request path: cached generated_content else template.
 */
import { baseTypeFromName, nameSaysNath, nameSaysOtherJewellery, sanitizeJewelleryContent } from "./jewelleryType";

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
  subcategoryName?: string;
  styleName?: string;
  polishes?: string[];
  colors?: string[];
  keywords?: string[];
  generated_content?: GeneratedContent | null;
  imageBase64?: string;
  imageMime?: string;
};

const LOCATION = ["Sadar Bazar", "Rui Mandi", "Delhi", "artificial jewellery wholesale Delhi", "imitation jewellery online India"];

export const DIVA_NAMES = [
  "Ananya", "Dhyani", "Rutvika", "Khyati", "Nashvika", "Drishika", "Gitanjali", "Tanisha", "Rumatra",
  "Rashika", "Priyanshi", "Nidhi", "Aaradhya", "Ishika", "Myra", "Saanvi", "Vanya", "Aaravi", "Kiara",
  "Anvita", "Reyna", "Navya", "Prisha", "Aadhya", "Mahika", "Siya", "Tara", "Inaya", "Riya", "Avni",
  "Meher", "Kashvi", "Vaidehi", "Charvi", "Diya", "Hiya", "Zara", "Nitya", "Samaira", "Aisha",
  "Aarohi", "Ahana", "Amaira", "Anaya", "Anika", "Anushka", "Bhavya", "Devika", "Eesha", "Ela",
  "Gauri", "Hansika", "Ira", "Jhanvi", "Kavya", "Keya", "Lavanya", "Mannat", "Manvi", "Meera",
  "Mishka", "Mohana", "Naina", "Nandini", "Netra", "Oorja", "Palak", "Pari", "Pihu", "Rachita",
  "Radhika", "Raina", "Rhea", "Ridhima", "Rittika", "Ruhi", "Saira", "Sanjana", "Sara", "Shanaya",
  "Shreya", "Simran", "Sneha", "Suhana", "Tanvi", "Trisha", "Urvi", "Vamika", "Vanshika", "Vedika",
  "Vidhi", "Yashvi", "Zoya", "Aanya", "Amyra", "Bhoomi", "Chhavi", "Damini", "Divisha", "Falak",
  "Garima", "Heer", "Jiya", "Kimaya", "Lisha", "Mahi", "Naisha", "Nayra", "Ojasvi", "Ramya",
  "Sanchi", "Shivika", "Taashi", "Unnati", "Vaani", "Wamika", "Yashika", "Aaruhi", "Bhavika", "Chitra",
];

export function preferredTitle(p: { name?: string | null; sku?: string | null }): string | null {
  const sku = (p.sku ?? "").trim();
  let raw = (p.name ?? "").replace(/\s*\([^)]*\)\s*$/, "");
  if (sku) raw = raw.replace(new RegExp(`\\b${sku.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig"), " ");
  raw = raw.replace(/\s+/g, " ").trim();
  if (raw.length < 3) return null;
  if (/^(product|untitled|new product|item|sku\b)/i.test(raw)) return null;
  if (/^[A-Za-z]{1,4}[-\s]?\d{1,6}[A-Za-z]?$/.test(raw)) return null;
  return raw;
}

export function pickDivaName(seed: string): string {
  let h = 0;
  const s = (seed || "").toString();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return DIVA_NAMES[h % DIVA_NAMES.length];
}

export function includedPieces(keywords?: string[]): string[] {
  const t = (keywords ?? []).join(" ").toLowerCase();
  const out: string[] = [];
  if (/maang ?tik|mangtik|tikka/.test(t)) out.push("Maang Tikka");
  if (/finger ?ring|\bring\b/.test(t)) out.push("Finger Ring");
  if (/ear ?ring|jhumk|danglers|studs/.test(t)) out.push("Earrings");
  if (/bracelet|kada|bangle/.test(t)) out.push("Bracelet");
  if (/nose ?pin|nath/.test(t)) out.push("Nose Pin");
  if (/haathphool|hand ?harness/.test(t)) out.push("Haathphool");
  return out;
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

function styleHints(name: string, keywords?: string[]): string[] {
  const n = (name + " " + (keywords ?? []).join(" ")).toLowerCase();
  const t: string[] = [];
  if (/american diamond|\bad\b/.test(n)) t.push("American Diamond");
  if (/zircon/.test(n)) t.push("Zircon");
  if (/uncut kundan/.test(n)) t.push("Uncut Kundan");
  else if (/kundan/.test(n)) t.push("Kundan");
  if (/meena/.test(n)) t.push("Meenakari");
  if (/temple|lakshmi/.test(n)) t.push("Temple");
  if (/polki/.test(n)) t.push("Polki");
  if (/moissanite/.test(n)) t.push("Moissanite");
  if (/pearl/.test(n)) t.push("Pearl");
  if (/oxidis|oxidiz/.test(n)) t.push("Oxidised");
  if (/gold\s*plat/.test(n)) t.push("Gold Plated");
  return [...new Set(t)];
}

export function templateContent(p: ProductLike): GeneratedContent {
  const cat = p.categoryName ?? "Jewellery";
  const sub = p.subcategoryName ?? "";
  const styles = styleHints(`${p.name} ${sub}`, p.keywords);
  const pieces = includedPieces(p.keywords);

  // NAME is ground truth — never let stale category force Nose Pin on a necklace set
  let baseType = baseTypeFromName(p.name, cat);
  if (/other accessor/i.test(baseType)) baseType = "Accessory";
  const typeHint = (p.name + " " + sub).toLowerCase();
  if (!nameSaysNath(p.name) && !nameSaysOtherJewellery(p.name)) {
    if (/pendant/.test(typeHint)) baseType = "Pendant";
    else if (/mangalsutra/.test(typeHint)) baseType = "Mangalsutra";
    else if (/\bchoker\b/.test(typeHint)) baseType = "Choker";
  }

  const isSet = /set/i.test(p.name) || pieces.length > 1;
  const type = isSet && !/set/i.test(baseType) ? `${baseType} Set` : baseType;
  const catL = type.toLowerCase();
  const name = pickDivaName(p.sku || p.name);
  const withPieces = pieces.length ? ` with ${joinAnd(pieces)}` : "";
  const titleDescriptors = styles.slice(0, 4).join(" ");

  const baseName = preferredTitle(p);
  let title: string;
  if (!baseName) {
    title = ([name, titleDescriptors, type].filter(Boolean).join(" ") + withPieces).replace(/\s+/g, " ").trim();
  } else {
    title = baseName;
  }

  const isEarringType = /earring|jhumka|chandbali|stud|dangler/i.test(type);
  const isNath = nameSaysNath(p.name);
  const nblob = `${p.name} ${(p.keywords ?? []).join(" ")}`.toLowerCase();

  let box: string;
  if (isNath) box = "One nose pin.";
  else if (isEarringType) box = "A pair of earrings.";
  else if (/necklace|choker|haar/i.test(type) && isSet) box = "One necklace set.";
  else if (/necklace|choker|haar/i.test(type)) box = "One necklace.";
  else box = `One ${baseType.toLowerCase()}.`;

  const mFound: string[] = [];
  const addM = (re: RegExp, label: string) => { if (re.test(nblob) && !mFound.includes(label)) mFound.push(label); };
  addM(/american diamond|\bad\b|zircon|\bcz\b/, "American Diamond");
  addM(/kundan/, "Kundan");
  addM(/polki/, "Polki");
  addM(/pearl|moti/, "Pearls");
  addM(/gold\s*plat/, "Gold Plated");
  const materialsList = mFound.length ? joinAnd(mFound) : "premium quality materials";
  const matPhrase = materialsList !== "premium quality materials" ? materialsList.toLowerCase() : "";

  const description =
    `Elevate your jewellery collection with this ${matPhrase ? matPhrase + " " : ""}${catL}. ` +
    `Perfectly complements ethnic and Indo-western outfits, making it an ideal choice for weddings, festive celebrations, and special occasions. ` +
    `Crafted with high-quality materials, this piece ensures durability and lightweight comfort. ` +
    `Whether you're a retailer, reseller or wholesale buyer, this trendy piece is a must-have addition to your collection. ` +
    `Shop premium artificial jewellery online from BlytheDIVA for the latest wholesale and retail designs at competitive prices.`;

  const colors = (p.colors ?? []).filter(Boolean);
  const specs: Record<string, string> = {
    Category: isNath ? "Nose Pin" : type,
    "Box Containing": box.replace(/\.$/, ""),
    Material: mFound.length ? joinAnd(mFound) : "Brass alloy",
    "Work/Style": styles.length ? styles.join(", ") : "Handcrafted",
    Occasion: isNath ? "Wedding, festive & daily wear" : "Wedding, festive & special occasions",
    Care: "Keep away from water and perfume",
  };
  if (colors.length) specs.Colours = colors.join(", ");
  if (colors.length) specs.Colors = colors.join(", ");

  const tags = Array.from(new Set([
    type,
    "artificial jewellery",
    "imitation jewellery",
    ...(isNath ? ["nath", "nose pin", "nose ring"] : []),
    ...styles,
    ...(p.keywords ?? []),
  ])).filter(Boolean).slice(0, 14);

  const keywords = Array.from(new Set([
    `${titleDescriptors} ${catL}`.trim(),
    `${catL} for wedding`,
    "artificial jewellery online India",
    ...LOCATION,
    ...(p.keywords ?? []),
  ])).filter(Boolean).slice(0, 12);

  const out: GeneratedContent = {
    title,
    description,
    specs,
    tags,
    seo: {
      metaTitle: `${title} | BlytheDIVA`.slice(0, 60),
      metaDescription: `Buy ${title} — ${titleDescriptors || "artificial"} ${catL} at retail & wholesale from BlytheDIVA, Sadar Bazar Delhi.`.slice(0, 158),
      keywords,
    },
  };
  return sanitizeJewelleryContent(out, p.name, cat);
}

export function resolveProductContent(p: ProductLike): GeneratedContent {
  if (p.generated_content && p.generated_content.title) {
    const gc = p.generated_content;
    const tpl = templateContent(p);
    const title = (gc.title && gc.title.trim()) ? gc.title.trim() : (preferredTitle(p) || tpl.title);
    const pick = (s: string | undefined, fallback: string) => (s && s.trim()) ? s : fallback;
    const merged: GeneratedContent = {
      title,
      description: pick(gc.description, tpl.description),
      specs: gc.specs && Object.keys(gc.specs).length > 0 ? { ...gc.specs } : { ...tpl.specs },
      tags: gc.tags && gc.tags.length > 0 ? [...gc.tags] : [...tpl.tags],
      seo: {
        metaTitle: pick(gc.seo?.metaTitle, tpl.seo.metaTitle),
        metaDescription: pick(gc.seo?.metaDescription, tpl.seo.metaDescription),
        keywords: gc.seo?.keywords && gc.seo.keywords.length > 0 ? [...gc.seo.keywords] : [...tpl.seo.keywords],
      },
    };
    return sanitizeJewelleryContent(merged, p.name, p.categoryName);
  }
  return templateContent(p);
}
