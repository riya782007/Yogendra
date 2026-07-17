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
  /** The owner's chosen subcategory (e.g. "Western Pendant Set", "Bridal Sets") — drives the copy tone
   *  and the real piece type, so a western piece never gets bridal/festive wording. */
  subcategoryName?: string;
  /** The owner's chosen style (Choker, Long Necklace, Layered Set, Pendant Set & Mangalsutra…). */
  styleName?: string;
  /** The variant polish/finish values (Silver, Gold, Antique Gold, Oxidised…) — used for the metal tone. */
  polishes?: string[];
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
  // Wider pool so 700+ designs don't repeat a name every few products (owner: "5 designs me same naam").
  "Aarohi", "Ahana", "Amaira", "Anaya", "Anika", "Anushka", "Bhavya", "Devika", "Eesha", "Ela",
  "Gauri", "Hansika", "Ira", "Jhanvi", "Kavya", "Keya", "Lavanya", "Mannat", "Manvi", "Meera",
  "Mishka", "Mohana", "Naina", "Nandini", "Netra", "Oorja", "Palak", "Pari", "Pihu", "Rachita",
  "Radhika", "Raina", "Rhea", "Ridhima", "Rittika", "Ruhi", "Saira", "Sanjana", "Sara", "Shanaya",
  "Shreya", "Simran", "Sneha", "Suhana", "Tanvi", "Trisha", "Urvi", "Vamika", "Vanshika", "Vedika",
  "Vidhi", "Yashvi", "Zoya", "Aanya", "Amyra", "Bhoomi", "Chhavi", "Damini", "Divisha", "Falak",
  "Garima", "Heer", "Jiya", "Kimaya", "Lisha", "Mahi", "Naisha", "Nayra", "Ojasvi", "Ramya",
  "Sanchi", "Shivika", "Taashi", "Unnati", "Vaani", "Wamika", "Yashika", "Aaruhi", "Bhavika", "Chitra",
  "Deepika", "Esha", "Gunjan", "Harshita", "Jasmine", "Komal", "Mira", "Poorvi", "Ahaana", "Nayanika",
];
/**
 * The owner curates every product name in the exact house format he wants:
 *   {Girl name} {design / material} {product type}   e.g. "Divya American Diamond Stone Jhumkas".
 * That curated name IS the title he wants shown — so we ALWAYS prefer it and never let the AI or the
 * synthesiser rewrite it (which was inventing a new girl name and flowery wording he disliked).
 * Returns the cleaned name, or null when the name is missing/placeholder so a title can be synthesised.
 */
export function preferredTitle(p: { name?: string | null; sku?: string | null }): string | null {
  const sku = (p.sku ?? "").trim();
  // Remove the SKU token wherever it appears, plus any trailing "(SKU)".
  let raw = (p.name ?? "").replace(/\s*\([^)]*\)\s*$/, "");
  if (sku) raw = raw.replace(new RegExp(`\\b${sku.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig"), " ");
  raw = raw.replace(/\s+/g, " ").trim();
  if (raw.length < 3) return null;
  if (/^(product|untitled|new product|item|sku\b)/i.test(raw)) return null; // placeholder names → synthesise
  // Reject a bare product CODE used as a name (e.g. "WN111", "ADN186", "E903") — that's a SKU, not a
  // real title, so we synthesise a proper {name}{descriptors}{type} title instead.
  if (/^[A-Za-z]{1,4}[-\s]?\d{1,6}[A-Za-z]?$/.test(raw)) return null;
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
  const sub = p.subcategoryName ?? "";
  const style = p.styleName ?? "";                       // Choker, Long Necklace, Layered Set…
  const polishText = (p.polishes ?? []).filter(Boolean).join(" "); // Silver, Gold, Antique Gold, Oxidised…
  const extra = `${sub} ${style} ${polishText}`.trim();
  // Everything the owner has told us about the piece feeds the copy: name + category + subcategory +
  // style + polish + keywords. A piece filed under "Western" reads western; a "Silver" polish reads silver.
  const blob = (`${p.name} ${cat} ${extra} ${(p.keywords ?? []).join(" ")}`).toLowerCase();
  // Register: ethnic/festive by default; switch to western/daily when the name, keywords OR the chosen
  // category/subcategory/style clearly say so AND there's no strong bridal material.
  const western = WESTERN_RE.test(blob) && !BRIDAL_RE.test(blob);

  const styles = styleHints(`${p.name} ${extra}`, p.keywords);
  const wStyles = westernHints(`${p.name} ${extra}`, p.keywords);
  const pieces = includedPieces(p.keywords);
  const isSet = pieces.length > 0 || /set/i.test(p.name) || /set/i.test(sub) || /set/i.test(style);
  // Prefer the REAL piece type from the name/subcategory (pendant, choker, mangalsutra…) over the broad
  // parent category — so a pendant is a "Pendant Set", not a "Necklace Set" or an "Other Accessorie".
  const typeHint = (p.name + " " + sub).toLowerCase();
  let baseType = cat.replace(/s$/i, "");
  if (/pendant/.test(typeHint)) baseType = "Pendant";
  else if (/mangalsutra/.test(typeHint)) baseType = "Mangalsutra";
  else if (/\bchoker\b/.test(typeHint)) baseType = "Choker";
  else if (/maang ?tikka|tikka/.test(typeHint) && !/set/i.test(typeHint)) baseType = "Maang Tikka";
  else if (/other accessor/i.test(baseType)) baseType = "Accessory";
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
  // Title: start from the owner's product name. If his SPEC KEYWORDS add descriptors or pieces the name
  // doesn't already contain, enrich it into a fuller BlytheDIVA-style title — so "Generate title" turns
  // "Ananya Necklace" + specs "American Diamond, Maang Tikka" into "Ananya American Diamond Necklace with
  // Maang Tikka". It NEVER drops a word the owner typed (falls back to his name if enrichment would).
  const baseName = preferredTitle(p);
  let title: string;
  if (!baseName) {
    // No real name (or a bare SKU code): synthesise a BlytheDIVA-style title from a random girl name +
    // the polish/finish + material/style descriptors + the type from category/sub-category. No SKU.
    const polish0 = ((p.polishes ?? []).find(Boolean) ?? "").trim();
    const polishFinish = polish0 && !new RegExp(polish0.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(titleDescriptors) ? titleCasePhrase(polish0.toLowerCase()) : "";
    title = ([name, titleDescriptors, polishFinish, type].filter(Boolean).join(" ") + withPieces).replace(/\s+/g, " ").trim();
  } else {
    const firstName = baseName.split(/\s+/)[0];
    const enriched = ([firstName, titleDescriptors, type].filter(Boolean).join(" ") + withPieces).replace(/\s+/g, " ").trim();
    const wordsOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
    const enrichedWords = new Set(wordsOf(enriched));
    const addsInfo = titleDescriptors.trim().length > 0 || withPieces.length > 0;
    const keepsEveryNameWord = wordsOf(baseName).every((w) => enrichedWords.has(w));
    title = (addsInfo && keepsEveryNameWord) ? enriched : baseName;
  }

  // ---------- Description — SIMPLE (owner's spec): just the labelled blocks, NO opening paragraph.
  //            Only BOX CONTAINING (the actual pieces) and MATERIAL & CRAFTSMANSHIP (the actual
  //            materials) vary per product; BRAND / CARE / DISCLAIMER are fixed. ----------
  const nblob = `${p.name} ${blob}`.toLowerCase();
  const isEarringType = /earring|jhumka|chandbali|stud|dangler|\bbali\b/i.test(type);

  // BOX CONTAINING — main piece, then only the extras the piece actually has, e.g.
  // "One necklace with a pair of earrings and a maang tikka."
  const boxMain = isEarringType ? "a pair of earrings" : `one ${baseType.toLowerCase()}`;
  const extras: string[] = [];
  const hasExtra = (re: RegExp) => extras.some((e) => re.test(e));
  // A "Set" in the NAME is NOT proof of earrings (a "Pendant Set" can be a single pendant). Only add
  // earrings when the name/keywords LITERALLY say so — never infer a piece that isn't named
  // (owner: "sabme earrings chipka diya" — do not stick earrings onto everything).
  if (!isEarringType && /\bearrings?\b|jhumka|jhumki|\bdanglers?\b/.test(nblob) && !hasExtra(/earring/)) extras.push("a pair of earrings");
  for (const pc of pieces.map((x) => x.toLowerCase())) {
    if (/earring|jhumka|\bbali\b|dangler/.test(pc)) { if (!isEarringType && !hasExtra(/earring/)) extras.push("a pair of earrings"); }
    else if (/tikka/.test(pc)) { if (!hasExtra(/tikka/)) extras.push("a maang tikka"); }
    else if (/ring/.test(pc)) { if (!hasExtra(/ring/)) extras.push("a finger ring"); }
    else if (/bracelet|kada|kangan|bangle/.test(pc)) { if (!hasExtra(/bracelet/)) extras.push("a bracelet"); }
    else if (/nose|nath/.test(pc)) { if (!hasExtra(/nose/)) extras.push("a nose pin"); }
    else if (/haathphool/.test(pc)) { if (!hasExtra(/haathphool/)) extras.push("a haathphool"); }
    else if (/bajuband|armlet/.test(pc)) { if (!hasExtra(/bajuband/)) extras.push("a bajuband"); }
  }
  if (/maang ?tikka|\btikka\b/.test(nblob) && !hasExtra(/tikka/)) extras.push("a maang tikka");
  if (/finger ring|with ring/.test(nblob) && !isEarringType && !hasExtra(/ring/)) extras.push("a finger ring");
  const boxPhrase = boxMain + (extras.length ? ` with ${joinAnd(extras)}` : "");
  const box = boxPhrase.charAt(0).toUpperCase() + boxPhrase.slice(1) + ".";

  // MATERIAL & CRAFTSMANSHIP — list ONLY the material(s) actually used (owner's rule: "jo lga hai wo").
  const mFound: string[] = [];
  const addM = (re: RegExp, label: string) => { if (re.test(nblob) && !mFound.includes(label)) mFound.push(label); };
  addM(/american diamond|\bad\b|cubic zircon|\bcz\b|zircon/, "American Diamond");
  addM(/kundan/, "Kundan");
  addM(/polki/, "Polki");
  addM(/meenakari|meena/, "Meenakari");
  addM(/pearl|moti/, "Pearls");
  addM(/moissanite/, "Moissanite");
  addM(/temple/, "Temple work");
  addM(/turkish/, "Turkish Stone");
  addM(/crystal/, "Crystal");
  addM(/oxidis|oxidiz/, "Oxidised finish");
  addM(/mirror/, "Mirror work");
  addM(/coloured stone|colored stone|\bstones?\b/, "Stones");
  if (mFound.length === 0 && material) mFound.push(titleCasePhrase(material));
  const materialsList = mFound.length ? joinAnd(mFound) : "premium quality materials";
  const itemNoun = isEarringType ? "these earrings" : `this ${baseType.toLowerCase()}`;
  const materialLine = `Finest quality ${materialsList} with environment-friendly non-precious metals are used to make ${itemNoun}. It is safe to wear for long hours.`;

  // Specs-table values (occasion follows register; material = exactly what we detected).
  const specOccasion = western ? "Daily wear, office, college & gifting" : "Wedding, festive & special occasions";
  const specMaterial = mFound.length ? joinAnd(mFound) : (material || "Brass alloy");

  // Description — a ~100-125 word SEO marketing paragraph in the owner's approved ChatGPT style,
  // GROUNDED: it only names the materials/pieces we actually detected, but reads as fluent SEO copy
  // for Google ranking. The structured facts (box, material, care) go in the specs table below.
  void materialLine; void itemNoun;
  const finish = /rose ?gold/.test(nblob) ? "rose-gold" : /antique/.test(nblob) ? "antique-gold" : /oxidis|oxidiz/.test(nblob) ? "oxidised-silver" : /\bsilver\b|rhodium/.test(nblob) ? "silver-tone" : /\bgold\b/.test(nblob) ? "gold-tone" : "";
  const matPhrase = materialsList !== "premium quality materials" ? materialsList.toLowerCase() : "";
  // Mention extra pieces ONLY when they are real; call it a "set" only when it genuinely has >1 piece.
  const setNote = extras.length ? ` It comes with ${joinAnd(extras)} to complete the look.` : "";
  const descNoun = extras.length ? catL : baseType.toLowerCase();
  const description = western
    ? `Add an effortless touch to your everyday style with this ${finish ? finish + " " : ""}${descNoun}${matPhrase ? ` featuring ${matPhrase}` : ""}. `
      + `Lightweight and comfortable for all-day wear, it pairs beautifully with dresses, kurtis, co-ords and western outfits — an easy pick for the office, college, parties and casual outings.${setNote} `
      + `Crafted from high-quality, skin-friendly materials with a refined finish, it offers durability and a clean, modern look. `
      + `Whether you are a retailer, reseller or wholesale buyer, this trendy ${baseType.toLowerCase()} is a must-have addition to your collection. `
      + `Shop premium fashion jewellery online from BlytheDIVA for the latest wholesale and retail designs at competitive prices.`
    : `Elevate your jewellery collection with this ${finish ? finish + " " : ""}${descNoun}${matPhrase ? ` featuring ${matPhrase}` : ""}. `
      + `Designed to complement ethnic, Indo-western and modern outfits, it is perfect for weddings, festive celebrations, parties and special occasions.${setNote} `
      + `Crafted from high-quality materials with a graceful finish, it offers lightweight comfort, durability and a sophisticated, elegant look. `
      + `Whether you are a retailer, reseller or wholesale buyer, this trendy piece is a must-have addition to your collection. `
      + `Shop premium artificial jewellery online from BlytheDIVA for the latest wholesale and retail designs at competitive prices.`;

  const descriptorStr = titleDescriptors;
  const allStyles = western ? wStyles : styles;
  const specs: Record<string, string> = {
    Category: cat,
    "Box Containing": box.replace(/\.$/, ""),
    Material: specMaterial,
    "Work / Style": allStyles.length ? allStyles.join(", ") : "Handcrafted",
    Occasion: specOccasion,
    Care: "Wipe with a soft cloth; keep away from water, sprays & perfume; store in a box",
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
    // TITLE = the owner's saved "Display title" (what he generated/typed in the editor) when present,
    // else his product name. This is why clicking "Generate title" now actually changes the storefront
    // title — we no longer force the raw product name over the generated one.
    const title = (gc.title && gc.title.trim()) ? gc.title.trim() : (preferredTitle(p) || tpl.title);
    const pick = (s: string | undefined, fallback: string): string => (s && s.trim()) ? s : fallback;
    // Other fields: keep the saved value when present, else the complete template — so no product ever
    // shows an empty field.
    return {
      title,
      description: pick(gc.description, tpl.description),
      specs: gc.specs && Object.keys(gc.specs).length > 0 ? gc.specs : tpl.specs,
      tags: gc.tags && gc.tags.length > 0 ? gc.tags : tpl.tags,
      seo: {
        metaTitle: pick(gc.seo?.metaTitle, tpl.seo.metaTitle),
        metaDescription: pick(gc.seo?.metaDescription, tpl.seo.metaDescription),
        keywords: gc.seo?.keywords && gc.seo.keywords.length > 0 ? gc.seo.keywords : tpl.seo.keywords,
      },
    };
  }
  return templateContent(p);
}
