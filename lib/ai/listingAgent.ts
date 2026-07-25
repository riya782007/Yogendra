/**
 * lib/ai/listingAgent.ts — generates a full product page via the AI gateway.
 * Chain: Groq (primary) -> OpenAI (secondary) -> deterministic template (always).
 * Output is zod-validated; any failure falls back so a page is never blank.
 */
import "server-only";
import { AiGateway, z } from "./gateway";
import { groqChat, openaiChat, geminiChat, groqConfigured, openaiConfigured, geminiTextConfigured } from "./providers";
import { templateContent, pickDivaName, DIVA_NAMES, type GeneratedContent, type ProductLike } from "../content";
import { seoTitleFromName } from "../seoTitle";

/** Force the title to START with the per-SKU assigned girl name. If the model led with a DIFFERENT
 *  girl name (it clusters on a few), swap that first token for the assigned one; otherwise prepend it. */
function enforceName(title: string, forced: string): string {
  const t = (title ?? "").trim();
  if (!t) return forced;
  const first = t.split(/\s+/)[0];
  if (first.toLowerCase() === forced.toLowerCase()) return t; // already correct
  const namePool = new Set(DIVA_NAMES.map((n) => n.toLowerCase()));
  if (namePool.has(first.toLowerCase())) return forced + t.slice(first.length); // replace the model's name
  return `${forced} ${t}`; // no leading name — prepend the assigned one
}

const schema = z.object({
  title: z.string().min(2),
  description: z.string().min(60),
  specs: z.record(z.string()),
  tags: z.array(z.string()).min(4),
  seo: z.object({ metaTitle: z.string(), metaDescription: z.string(), keywords: z.array(z.string()).min(5) }),
});

function prompt(p: ProductLike) {
  const colors = (p.colors ?? []).join(", ");
  const sub = (p as any).subcategoryName ? ` Sub-category (type): ${(p as any).subcategoryName}.` : "";
  const kw = (p.keywords ?? []).filter(Boolean).join(", ");
  const hasImage = !!p.imageBase64;
  // The girl's first name is ASSIGNED deterministically from the SKU (not left to the model) — the model
  // kept defaulting to the same name so many designs shared one (owner: "5 designs me same naam diya").
  // Seeding on the SKU means each design gets its own stable, different name.
  const forcedName = pickDivaName(((p as any).sku as string) || p.name || "");
  // When the owner has already PICKED one of the suggested titles, it's locked — we only write the rest
  // of the page (description/specs/tags/seo) to MATCH that exact title.
  const lockedTitle = ((p as any).lockedTitle as string | undefined)?.trim();
  return [
    `You are the senior product copywriter for "BlytheDIVA", a premium artificial/imitation jewellery brand (Sadar Bazar, Rui Mandi, Delhi; retail + wholesale).`,
    `Write ONE product page as STRICT minified JSON with keys: title, description, specs (object label->value), tags (array), seo (object: metaTitle, metaDescription, keywords array).`,
    `INPUTS —`,
    hasImage
      ? `• A PHOTO of the actual piece is attached — LOOK AT IT CAREFULLY. Identify the EXACT type from what you see (necklace set, choker, jhumka, chandbali, ring, bracelet, bangle/kada, anklet, WATCH / bracelet-watch — a piece with a DIAL is a watch, brooch, hair accessory…), the material/work (Kundan, Polki, Meenakari, Pearl, Temple, Oxidised, Moissanite/AD stones…), colours of the stones/beads/enamel, the length/layers, and any included pieces (earrings, maang tikka). Base the title, description, specs, colours and included pieces on WHAT YOU SEE. If the photo and the typed text ever disagree, TRUST THE PHOTO. Never claim a component that is not visible in the photo and not in the specifications.`
      : ``,
    `• Product name the owner typed: ${p.name}`,
    `• Category: ${p.categoryName ?? "Jewellery"}.${sub}`,
    (p as any).styleName ? `• Style: ${(p as any).styleName}.` : ``,
    ((p as any).polishes ?? []).filter(Boolean).length ? `• Polish / finish: ${[...new Set(((p as any).polishes ?? []).filter(Boolean))].join(", ")}.` : ``,
    colors ? `• Colours: ${colors}.` : ``,
    `USE all of the above — name, category, sub-category, style, polish/finish, colours and keywords — to describe THIS piece specifically.`,
    ``,
    `GROUNDING RULES (STRICT — the owner REJECTS anything invented or generic):`,
    `  • The CATEGORY and SUB-CATEGORY the owner selected guide the STYLING and are usually the type (e.g. Category "Earrings" + Sub-category "Kundan Earrings" → a Kundan earring; Sub-category "Temple Necklace" → a temple-style necklace). BUT the PHOTO is the ground truth for WHAT THE ITEM ACTUALLY IS: when the photo clearly shows something more specific than a generic category label, name what you SEE — most importantly, if it has a DIAL it is a WATCH ("Watch" / "Bracelet Watch"), never a plain "Bracelet" or "Hand Accessory"; likewise a bangle/kada, anklet, brooch or hair-accessory. Do not force a vague category word onto a piece the photo shows to be something specific. (This is about the correct TYPE only — you still must NEVER invent stones, motifs or extra pieces that aren't there.)`,
    `  • Use ONLY the facts given above (name, category, sub-category, style, polish/finish, colours, keywords/specifications) and the attached photo. Nothing else.`,
    `  • NEVER invent a stone, material, motif, colour, length, layer count, or included piece that none of the inputs mention. If the name does not say "Maang Tikka" (or the specs don't list it), it does NOT include one — do not add it.`,
    `  • A "Set" in the NAME does NOT mean the piece includes earrings or any second piece (a "Pendant Set" can be a single pendant). List earrings ONLY if the word earrings / jhumka / danglers literally appears; list a maang tikka / ring ONLY if named. If only one piece is named, "Box Containing" is just that one piece (e.g. "One pendant") and the description must NOT say "the matching earrings complete the set".`,
    `  • Do NOT claim properties that aren't stated: no "anti-tarnish", "gold-plated", "925 / real silver", "handmade", "hypoallergenic", "adjustable", "waterproof" unless an input says so.`,
    `  • If the inputs are thin, keep the description SHORT and factual. Never pad with empty praise like "royal elegance", "timeless beauty", "adds charm and richness", "attention to detail", "carries a rich festive appeal".`,
    `  • Occasion & styling must fit the piece type ONLY — an ethnic/bridal set → weddings/festive/sarees-lehengas; a western/daily piece → office/college/casual/dresses-kurtis. Never mix the two.`,
    `  • Every sentence must be something the owner could verify by looking at the piece. When unsure, say less.`,
    kw
      ? `• Jewellery SPECIFICATIONS the owner provided — USE THESE to decide the material, style, type AND which pieces the set includes: ${kw}.`
      : hasImage
        ? `• No extra specifications given — infer the material, style, type and included pieces from the ATTACHED PHOTO and the product name & category; do not invent anything not visible in the photo.`
        : `• No extra specifications given — infer ONLY from the product name & category; do not invent components or materials.`,
    ``,
    lockedTitle
      ? `TITLE — ALREADY CHOSEN by the owner. Use EXACTLY this title verbatim, do not change a single word: «${lockedTitle}». Then write the description, specs, tags and seo so they MATCH this exact title and the photo.`
      : `TITLE — MUST follow BlytheDIVA's exact house style:  «{First name} {material/style descriptors} {jewellery type} with {included pieces}»`,
    `  1. START the title with EXACTLY this first name — do NOT choose your own, do NOT substitute, do NOT default to "Ananya"/"Vanya": «${forcedName}». Use it verbatim as the first word of the title, then continue with the descriptors below. (This name is pre-assigned per design so no two designs share a name.)`,
    `  2. AFTER the name, write a natural, SEO-optimised DESCRIPTIVE phrase of 5-7 words — behave EXACTLY like a "give me an SEO-optimised descriptive title of 5-7 words for this piece" request in ChatGPT, describing THE PIECE IN THE PHOTO. Pattern: «{tone/colour + material/finish} {design} {jewellery type} [for Women]». Real ChatGPT examples the owner approved for a gold bar pendant chain: "Gold Bar Pendant Chain Necklace for Women", "Minimal Gold Bar Pendant Necklace Chain", "Elegant Gold Bar Pendant Chain Necklace". Mirror that voice and length.`,
    `  3. GROUND EVERY WORD IN WHAT YOU ACTUALLY SEE (plus the owner's typed keywords, which OVERRIDE the photo${kw ? ` — here: "${kw}"` : ""} and must never be dropped). Read the photo: the tone (gold / rose-gold / silver / oxidised), the material/work (plain metal, Kundan, Polki, Pearl, American Diamond, Meenakari, Temple…), the design (bar, heart, solitaire, chandbali, jhumka, choker, layered…) and the true jewellery type.`,
    `  4. NEVER invent or append a component that is NOT clearly visible in the photo and NOT in the typed keywords. This is the owner's #1 rule — a wrong component is unacceptable. Do NOT write "Mangalsutra", "with Maang Tikka", "with Earrings", "Set", "Bridal", "Kundan", "Temple", etc. unless it is genuinely there. A plain gold-tone pendant on a chain is a "Pendant Chain Necklace" — NOT a "Pendant Set with Mangalsutra". Only say "Set" / "with {piece}" when the extra piece is actually shown or typed.`,
    `  LENGTH: the whole title = the name + 5-7 descriptive words (about 6-8 words total). Title Case, under ~70 characters.`,
    `  Accurate BlytheDIVA-style examples (each descriptor is REAL for that piece): "Dhyani Uncut Kundan Necklace Set with Maang Tikka" (only because a tikka is shown), "Gitanjali Turkish Stone Single Line Choker", "Tanisha Moissanite Choker Set", "Priyanshi Crystal Stone Danglers", "Kiara Gold Bar Pendant Chain Necklace", "Navya Minimal Gold Heart Pendant Necklace". If the piece is a simple daily-wear pendant, keep it simple and western like the ChatGPT examples — do NOT force ethnic/bridal words onto it.`,
    `  CRITICAL — the "product name" the owner typed may be JUST a code / SKU (e.g. "WN111", "ADN186", "E903"). If the name looks like a code (a few letters followed by numbers), IGNORE it completely and build the whole title from the CATEGORY, SUB-CATEGORY, STYLE and POLISH/finish + a random girl name. NEVER put a SKU, product code, hyphen+code, price, or the word "BlytheDIVA" anywhere in the title.`,
    `  Draw the descriptors from the CATEGORY, SUB-CATEGORY, STYLE and POLISH the owner selected — e.g. Sub-category "Kundan Earrings" + Polish "Gold" → "…Gold Kundan …Earrings"; Style "Layered Sets" → "Layered … Set"; Sub-category "Oxidised Necklace" → "Oxidised … Necklace". Title Case, under ~70 characters.`,
    ``,
    `REGISTER — read the name + specifications and pick the RIGHT voice:`,
    `  • If they say western, daily wear, office, casual, minimal, anti-tarnish, contemporary, modern (and it is NOT a kundan/temple/polki/bridal set): write a WESTERN / DAILY-WEAR description — everyday styling, work-to-evening, pairs with dresses, jeans, kurtis, co-ords & western outfits; mention anti-tarnish/lightweight/skin-friendly/gift-ready if relevant. DO NOT mention brides, sarees, lehengas, weddings, sangeet or "royal/bridal".`,
    `  • Otherwise use the ETHNIC / BRIDAL voice below. Weave the owner's keywords in naturally for SEO either way.`,
    ``,
    `DESCRIPTION — write a fluent, SEO-optimised marketing paragraph of 100-125 words. This is the owner's reference style (a ChatGPT "Digital marketing expert" product description written for Google ranking). ONE flowing paragraph — NO headings, NO labelled blocks, NO bullet points. Build it in this order, grounded in the PHOTO + the inputs:`,
    `  1. Hook naming the piece: "Elevate your jewellery collection with this …" (ethnic) or "Add an effortless touch to your style with this …" (western) — state the type, the finish/tone and the materials/design you can actually see or that the inputs give (e.g. multi-layer, pearl strands, gold beads, Kundan, American Diamond, contemporary chain detailing).`,
    `  2. Styling & occasions matching the register: ethnic/bridal → "complements ethnic, Indo-western and modern outfits; perfect for weddings, festive celebrations, parties and special occasions"; western/daily → "office, college, parties and casual outings; pairs with dresses, kurtis and co-ords". ONLY mention matching/extra pieces (earrings, maang tikka, mangalsutra…) if they are ACTUALLY VISIBLE in the photo or listed in the keywords — never claim a "matching mangalsutra/earrings completes the set" for a single piece. When only one piece is shown, describe just that piece.`,
    `  3. Benefits: high-quality / skin-friendly materials, a refined finish, lightweight comfort, durability, and a sophisticated & elegant (or clean, modern) look.`,
    `  4. Audience + CTA — ALWAYS end with this (BlytheDIVA sells retail AND wholesale): "Whether you're a retailer, reseller or wholesale buyer, this trendy piece is a must-have addition to your collection. Shop premium artificial jewellery online from BlytheDIVA for the latest wholesale and retail designs at competitive prices."`,
    `  Weave the owner's keywords in naturally for SEO. Marketing adjectives (elegant, sophisticated, lightweight, luxurious) are welcome — BUT still obey the GROUNDING RULES: never claim a stone, motif or included piece that is not in the inputs or the photo.`,
    ``,
    `specs (object) MUST include: Category, "Box Containing" (the exact pieces, e.g. "One necklace with a pair of earrings and a maang tikka" — only real pieces), Material (ONLY the material(s) actually used), Work/Style, Occasion, Care${colors ? ", Colours" : ""}. DO NOT include the SKU.`,
    `tags: 8-12 short search tags mixing type, style, material, occasion.`,
    `seo.metaTitle <= 60 chars (title + " | BlytheDIVA"); seo.metaDescription <= 155 chars, compelling; seo.keywords 8-12 long-tail phrases like "kundan necklace set for wedding", "artificial jewellery online India", "bridal jewellery Delhi".`,
    `Return ONLY the JSON object, minified, no markdown.`,
  ].filter(Boolean).join("\n");
}

export function buildGateway(opts?: { visionFirst?: boolean }) {
  // GROQ is the default PRIMARY writer (free + fast) for BULK generation. But for a SINGLE product where
  // the owner clicks "Generate" and wants a rich title, we prefer a VISION model (OpenAI → Gemini) so the
  // copy is built from the actual PHOTO (Groq is text-only and can't see the piece). Falls back to Groq
  // text, then the deterministic template — a title/description is never blank.
  const openaiOn = openaiConfigured();
  const geminiOn = geminiTextConfigured();
  const wantVision = !!opts?.visionFirst && (openaiOn || geminiOn);
  const groqPrimary = groqConfigured() && !wantVision;
  const SYSTEM = "You are BlytheDIVA's product copywriter. Return only valid minified JSON.";
  const visionRun = async (call: any) => {
    const args = {
      system: SYSTEM, user: call._prompt, json: true,
      imageBase64: call._product?.imageBase64, imageMime: call._product?.imageMime,
    };
    // Prefer OpenAI vision, but if its key is dead / quota-exhausted (429), fall straight to GEMINI
    // vision — both can actually SEE the photo. Previously we jumped from a dead OpenAI to the text-only
    // secondary (Groq), which can't see the piece, so titles went vague and count flip-flopped. Only if
    // neither vision model is usable do we let the gateway drop to the text secondary.
    if (openaiOn) {
      try { return JSON.parse(await openaiChat(args)); }
      catch (e) { if (!geminiOn) throw e; }
    }
    return JSON.parse(await geminiChat(args));
  };
  const groqRun = async (call: any) => JSON.parse(await groqChat({ system: SYSTEM, user: call._prompt, json: true }));
  return new AiGateway({
    primary: {
      name: groqPrimary ? "groq" : (openaiOn ? "openai" : "gemini"),
      run: async (call: any) => (groqPrimary ? groqRun(call) : visionRun(call)),
    },
    secondary: {
      // If Groq led, fall back to a vision model; if a vision model led, fall back to Groq text.
      name: groqPrimary ? (openaiOn ? "openai" : "gemini") : "groq",
      run: async (call: any) => (groqPrimary ? visionRun(call) : groqRun(call)),
    },
    deterministic: (call: any) => templateContent(call._product) as GeneratedContent,
    budgetPaise: Number(process.env.AI_BUDGET_PAISE ?? 500000),
    maxRetries: 1,
    breakerThreshold: 3,
    log: (e) => console.log("[ai]", JSON.stringify(e)),
  });
}

export async function generateProductContent(p: ProductLike, opts?: { visionFirst?: boolean }): Promise<{ content: GeneratedContent; provider: string; fallbackUsed: boolean }> {
  const gateway = buildGateway(opts);
  const call: any = { feature: "listing", cacheKey: `listing:${p.sku}`, schema, estCostPaise: 50, _prompt: prompt(p), _product: p };
  const r = await gateway.run(call);
  const content = r.data as GeneratedContent;
  const locked = ((p as any).lockedTitle as string | undefined)?.trim();
  if (locked) {
    // Owner picked this title — it wins verbatim, no renaming.
    content.title = locked;
  } else {
    // Safety net: guarantee the title leads with the per-SKU assigned name even if the model ignored it.
    const forcedName = pickDivaName(((p as any).sku as string) || p.name || "");
    if (content?.title) content.title = enforceName(content.title, forcedName);
  }
  return { content, provider: r.provider, fallbackUsed: r.fallbackUsed };
}

/**
 * Suggest 3–4 SEO title OPTIONS from the product PHOTO + its category/subcategory/style/polish/keywords
 * — the "analyse the jewellery and give SEO titles" flow the owner likes in ChatGPT. Each option starts
 * with the design's assigned girl name, then 5–7 keyword-rich, AUTHENTIC descriptors (only what's in the
 * photo or the typed fields — never invented). Vision model first (OpenAI/Gemini), Groq text as fallback.
 */
/** Empty adjectives that carry ZERO search value. The model reaches for these by default, which is why
 *  seven different designs all came back "Classic / Elegant / Designer". Banned outright — unless the
 *  owner deliberately typed one as a keyword, in which case he wins. */
const FILLER_WORDS = [
  "classic", "elegant", "designer", "beautiful", "stylish", "premium", "exclusive", "trendy", "fancy",
  "attractive", "gorgeous", "charming", "lovely", "stunning", "luxury", "luxurious", "chic", "modern",
  "unique", "special", "adorable", "graceful",
];

/** The four angles a jewellery title can lead with. Every suggestion must take a DIFFERENT one, so the
 *  options differ by SUBSTANCE (shape vs stone vs finish vs occasion) instead of by adjective. The
 *  starting angle rotates per SKU, so two different designs never come back phrased the same way. */
const TITLE_ANGLES: { key: string; label: string; vocab: string }[] = [
  { key: "SHAPE", label: "the design / shape / motif you can actually see",
    vocab: "Floral, Rectangle, Square, Round, Oval, Teardrop, Marquise, Leaf, Vine, Paisley, Peacock, Butterfly, Heart, Halo, Cluster, Drop, Layered, Geometric, Chandbali, Jhumka" },
  { key: "STONE", label: "the stone / craft / material you can actually see",
    vocab: "American Diamond, CZ, Zircon, Kundan, Polki, Pearl, Meenakari, Enamel, Temple, Ruby, Emerald, Stone Studded, Beaded, Mirror, Moissanite" },
  { key: "FINISH", label: "the plating / metal tone",
    vocab: "Gold Plated, Rose Gold, Silver Tone, Oxidised, Antique Finish, Matte Gold, Two Tone, Rhodium" },
  { key: "OCCASION", label: "who wears it and when",
    vocab: "Party Wear, Bridal, Wedding, Festive, Daily Wear, Office Wear, Traditional, Ethnic, Cocktail, Gifting, for Women" },
];

const hashOf = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

export async function generateTitleOptions(p: ProductLike, n = 4): Promise<{ titles: string[]; provider: string; usedImage: boolean }> {
  const forcedName = pickDivaName(((p as any).sku as string) || p.name || "");
  // Rotate which angle leads, keyed off the SKU — deterministic, but different for every design.
  const rot = hashOf(((p as any).sku as string) || p.name || "") % TITLE_ANGLES.length;
  const angles = [...TITLE_ANGLES.slice(rot), ...TITLE_ANGLES.slice(0, rot)].slice(0, n);
  const ownerKw = (p.keywords ?? []).map((k) => String(k).toLowerCase());
  const banned = FILLER_WORDS.filter((w) => !ownerKw.some((k) => k.includes(w)));
  const wantVision = !!p.imageBase64;
  const sub = (p as any).subcategoryName ? ` Sub-category: ${(p as any).subcategoryName}.` : "";
  const style = (p as any).styleName ? ` Style: ${(p as any).styleName}.` : "";
  const polishes = [...new Set(((p as any).polishes ?? []).filter(Boolean))].join(", ");
  const kw = (p.keywords ?? []).filter(Boolean).join(", ");
  const userPrompt = [
    `You are BlytheDIVA's senior SEO copywriter for premium artificial/imitation jewellery. Behave EXACTLY like ChatGPT does when a jeweller uploads a photo and asks "give SEO-optimised website titles for this piece" — read the image like an expert merchandiser and name what you truly see.`,
    wantVision
      ? `STEP 1 — ANALYSE THE PHOTO SILENTLY (do not output this step). Identify, as specifically as the picture allows: (a) the EXACT product TYPE — name what you TRULY SEE, even if it is not classic jewellery: teardrop/drop/danglers/jhumka/stud earrings, necklace set, choker, pendant, ring, bracelet, bangle/kada, anklet/payal, WATCH / bracelet-watch, brooch, maang-tikka, nose-pin, hair accessory, hand-harness… If the piece has a DIAL it is a WATCH — call it a "Watch" or "Bracelet Watch", NEVER a plain bracelet. Trust the PHOTO over the category label: the category can be generic or wrong, but the photo is the ground truth for WHAT THE ITEM ACTUALLY IS. (b) the STONE / craft — American Diamond (CZ), multicolor gemstone, Kundan, Polki, Pearl, Meenakari, Temple, Moissanite, ruby/emerald-colour stones…; (c) the METAL TONE / finish — gold-tone, rose-gold, silver, oxidised, two-tone; (d) the DESIGN / shape / motif — teardrop, floral, halo, cluster, chandbali, marquise, leaf, geometric, statement, layered, dial shape, chain-strap; (e) any MATCHING PIECES actually visible; (f) the natural AUDIENCE / occasion — for women, party wear, festive, bridal, daily wear. STEP 2 — turn that analysis into the titles below. Ground every descriptor in what you genuinely saw in STEP 1.`
      : `Infer the piece from the fields below (no photo available).`,
    `Category: ${p.categoryName ?? "Jewellery"}.${sub}${style}`,
    polishes ? `Polish / finish: ${polishes}.` : ``,
    kw ? `Owner keywords (MUST use, they override the photo): ${kw}.` : ``,
    ``,
    `Produce ${n} DISTINCT, SEO-optimised website titles as STRICT minified JSON: {"titles":["…","…"]}.`,
    `RULES for every title:`,
    `  • Start EXACTLY with the first name «${forcedName}», then descriptive keywords so the WHOLE title is 5–7 words total (name + 4–6 keyword words). Title Case, under ~70 chars.`,
    `  • Use ONLY AUTHENTIC keywords — descriptors clearly VISIBLE in the photo, or present in the category/sub-category/style/polish/keywords above. NEVER invent a stone, material, motif or piece that isn't there (no "Mangalsutra", no "Kundan" on a plain CZ piece, no earrings unless it's an earring).`,
    `  • The product TYPE at the end MUST match what you actually SEE in the photo — a watch is a "Watch" / "Bracelet Watch", a bangle is a "Bangle", an anklet is an "Anklet" — never mislabel it as a generic "Bracelet" or "Hand Accessory" when the photo shows something more specific.`,
    ``,
    `The ${n} titles must differ by SUBSTANCE, not by adjective. Give exactly ONE title per angle, in this order:`,
    ...angles.map((a, i) => `  ${i + 1}. ${a.key} — lead with ${a.label}. Draw from: ${a.vocab}. (Only if it is genuinely true of THIS piece.)`),
    ``,
    `  • BANNED WORDS — never output any of these, they describe nothing and make every product sound identical: ${banned.join(", ")}.`,
    `  • No descriptive word may repeat across the ${n} titles. Only «${forcedName}» and the jewellery type may appear more than once.`,
    `  • If an angle isn't truthfully available for this piece, use a different REAL detail from the photo for that slot — never pad with a filler adjective.`,
    `Return ONLY the JSON.`,
  ].filter(Boolean).join("\n");

  const SYSTEM = "You are BlytheDIVA's product copywriter. Return only valid minified JSON.";
  // Higher spread than the default: title IDEAS should vary between runs and between designs. (Detection
  // and extraction calls keep their low temperature — this override is scoped to this one request.)
  const call = { system: SYSTEM, user: userPrompt, json: true, imageBase64: p.imageBase64, imageMime: p.imageMime, temperature: 0.95 };
  const order: [string, (a: any) => Promise<string>][] = [];
  if (wantVision && openaiConfigured()) order.push(["openai", openaiChat]);
  if (wantVision && geminiTextConfigured()) order.push(["gemini", geminiChat]);
  if (groqConfigured()) order.push(["groq", groqChat]);
  if (openaiConfigured() && !order.some(([nm]) => nm === "openai")) order.push(["openai", openaiChat]);
  if (geminiTextConfigured() && !order.some(([nm]) => nm === "gemini")) order.push(["gemini", geminiChat]);

  let titles: string[] = [];
  let provider = "";
  for (const [nm, fn] of order) {
    try {
      const raw = JSON.parse(await fn(call));
      const arr = Array.isArray(raw?.titles) ? raw.titles : Array.isArray(raw) ? raw : [];
      const cleaned = arr.map((t: any) => String(t ?? "").trim()).filter(Boolean);
      // Keep the FULLEST set. Order is [OpenAI → Gemini → Groq]; if OpenAI under-delivers (e.g. 1–2, or
      // it's quota-blocked) we let the next vision model try for a complete 4 instead of settling for a
      // short/blind list. Stop as soon as any provider returns a full set of n image-based titles.
      if (cleaned.length > titles.length) { titles = cleaned; provider = nm; }
      if (titles.length >= n) break;
    } catch { /* try next provider */ }
  }
  if (!titles.length) {
    // Deterministic fallback so the owner always gets at least one option.
    const t = (templateContent(p) as GeneratedContent).title;
    if (t) titles = [t];
    provider = provider || "deterministic";
  }
  // NO PHOTO → the model can only guess from the taxonomy (→ generic "Choker Gold Necklace"), which is
  // why titles felt inconsistent (43% of products have no photo). The descriptive NAME is a far more
  // reliable, CONSISTENT source, so LEAD with the deterministic name-based SEO title in that case — it
  // follows the exact same "{Name} {Materials} {Design} {Type} for Women" pattern as the photo titles.
  if (!wantVision) {
    const det = seoTitleFromName(p.name ?? "", (p as any).categoryName);
    if (det) titles = [det, ...titles.filter((t) => t.toLowerCase() !== det.toLowerCase())];
  }
  // Belt-and-braces: if a model ignores the ban and still writes "Classic/Elegant/Designer", strip it
  // here so the owner never sees the filler again. Keep the original if removing it guts the title.
  const bannedRe = banned.length ? new RegExp(`\\b(${banned.join("|")})\\b`, "ig") : null;
  const deFiller = (t: string) => {
    if (!bannedRe) return t;
    const stripped = t.replace(bannedRe, " ").replace(/\s+/g, " ").trim();
    return stripped.split(" ").length >= 3 ? stripped : t;
  };
  // Enforce the assigned name on every option + dedupe.
  const seen = new Set<string>();
  titles = titles
    .map((t) => enforceName(deFiller(t), forcedName))
    .filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, n);
  // CONSISTENCY: the owner must always see the SAME number of options — never "kabhi 4 kabhi 1". When a
  // provider was down / quota-exhausted / photo-blind and we got fewer than n, pad with deterministic
  // name-based SEO titles so the count is stable and every option is still on-brand and on-name.
  if (titles.length < n) {
    const base = (p.name ?? "").trim();
    const cat = (p as any).categoryName as string | undefined;
    const variants = [
      seoTitleFromName(base, cat),
      base && cat ? `${base} — ${cat}` : "",
      base ? `${base} for Women` : "",
      base ? `${base} for Wedding & Festive Wear` : "",
      base ? `${base} | Artificial Jewellery` : "",
    ].map((t) => enforceName(deFiller(String(t || "")), forcedName)).filter(Boolean);
    for (const v of variants) {
      if (titles.length >= n) break;
      const k = v.toLowerCase();
      if (!seen.has(k)) { seen.add(k); titles.push(v); }
    }
  }
  return { titles, provider, usedImage: wantVision };
}

export function aiProvidersStatus() {
  return { groq: groqConfigured(), openai: openaiConfigured() };
}
