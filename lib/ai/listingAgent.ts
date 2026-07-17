/**
 * lib/ai/listingAgent.ts — generates a full product page via the AI gateway.
 * Chain: Groq (primary) -> OpenAI (secondary) -> deterministic template (always).
 * Output is zod-validated; any failure falls back so a page is never blank.
 */
import "server-only";
import { AiGateway, z } from "./gateway";
import { groqChat, openaiChat, geminiChat, groqConfigured, openaiConfigured, geminiTextConfigured } from "./providers";
import { templateContent, pickDivaName, DIVA_NAMES, type GeneratedContent, type ProductLike } from "../content";

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
      ? `• A PHOTO of the actual jewellery piece is attached — LOOK AT IT CAREFULLY. Identify the jewellery type (necklace set, choker, jhumka, chandbali, ring, bracelet…), the material/work (Kundan, Polki, Meenakari, Pearl, Temple, Oxidised, Moissanite/AD stones…), colours of the stones/beads/enamel, the length/layers, and any included pieces (earrings, maang tikka). Base the title, description, specs, colours and included pieces on WHAT YOU SEE. If the photo and the typed text ever disagree, TRUST THE PHOTO. Never claim a component that is not visible in the photo and not in the specifications.`
      : ``,
    `• Product name the owner typed: ${p.name}`,
    `• Category: ${p.categoryName ?? "Jewellery"}.${sub}`,
    (p as any).styleName ? `• Style: ${(p as any).styleName}.` : ``,
    ((p as any).polishes ?? []).filter(Boolean).length ? `• Polish / finish: ${[...new Set(((p as any).polishes ?? []).filter(Boolean))].join(", ")}.` : ``,
    colors ? `• Colours: ${colors}.` : ``,
    `USE all of the above — name, category, sub-category, style, polish/finish, colours and keywords — to describe THIS piece specifically.`,
    ``,
    `GROUNDING RULES (STRICT — the owner REJECTS anything invented or generic):`,
    `  • The CATEGORY and SUB-CATEGORY the owner selected are the PRIMARY truth for what this piece IS (the jewellery type) and how it should be styled — lead the description with them (e.g. Category "Earrings" + Sub-category "Kundan Earrings" → a Kundan earring; Sub-category "Temple Necklace" → a temple-style necklace). The description MUST match the selected category/sub-category, not guess a different type.`,
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
  const visionRun = async (call: any) => JSON.parse(await (openaiOn ? openaiChat : geminiChat)({
    system: SYSTEM, user: call._prompt, json: true,
    imageBase64: call._product?.imageBase64, imageMime: call._product?.imageMime,
  }));
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
export async function generateTitleOptions(p: ProductLike, n = 4): Promise<{ titles: string[]; provider: string; usedImage: boolean }> {
  const forcedName = pickDivaName(((p as any).sku as string) || p.name || "");
  const wantVision = !!p.imageBase64;
  const sub = (p as any).subcategoryName ? ` Sub-category: ${(p as any).subcategoryName}.` : "";
  const style = (p as any).styleName ? ` Style: ${(p as any).styleName}.` : "";
  const polishes = [...new Set(((p as any).polishes ?? []).filter(Boolean))].join(", ");
  const kw = (p.keywords ?? []).filter(Boolean).join(", ");
  const userPrompt = [
    `You are BlytheDIVA's senior SEO copywriter for premium artificial/imitation jewellery.`,
    wantVision
      ? `LOOK CAREFULLY at the attached product PHOTO. Identify the jewellery type (earrings/jhumka/drop/stud, necklace, choker, ring, bracelet…), the design/shape (rectangle, floral, halo, chandbali, solitaire, bar, drop, statement…), the material/work (American Diamond/CZ, Kundan, Polki, Pearl, Meenakari, Temple, Moissanite…) and the finish/tone (gold-plated, rose-gold, silver, oxidised).`
      : `Infer the piece from the fields below (no photo available).`,
    `Category: ${p.categoryName ?? "Jewellery"}.${sub}${style}`,
    polishes ? `Polish / finish: ${polishes}.` : ``,
    kw ? `Owner keywords (MUST use, they override the photo): ${kw}.` : ``,
    ``,
    `Produce ${n} DISTINCT, SEO-optimised website titles as STRICT minified JSON: {"titles":["…","…"]}.`,
    `RULES for every title:`,
    `  • Start EXACTLY with the first name «${forcedName}», then descriptive keywords so the WHOLE title is 5–7 words total (name + 4–6 keyword words). Title Case, under ~70 chars, SEO-optimised.`,
    `  • Use ONLY AUTHENTIC keywords — descriptors that are clearly VISIBLE in the photo, or present in the category/sub-category/style/polish/keywords above. NEVER invent a stone, material, motif or piece that isn't there (no "Mangalsutra", no "Kundan" on a plain CZ piece, no earrings unless it's an earring).`,
    `  • Make each option a DIFFERENT angle using strong search keywords jewellery buyers type — e.g. Designer, Statement, Rectangle/Floral/Drop, Stone, American Diamond, Gold Plated, Party Wear, Bridal, for Women. Example style the owner loves: "Designer Rectangle Stone Drop Earrings", "American Diamond Statement Drop Earrings", "Gold Plated Party Wear Earrings".`,
    `  • The jewellery TYPE at the end must be correct for the piece. Return ONLY the JSON.`,
  ].filter(Boolean).join("\n");

  const SYSTEM = "You are BlytheDIVA's product copywriter. Return only valid minified JSON.";
  const call = { system: SYSTEM, user: userPrompt, json: true, imageBase64: p.imageBase64, imageMime: p.imageMime };
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
      if (cleaned.length) { titles = cleaned; provider = nm; break; }
    } catch { /* try next provider */ }
  }
  if (!titles.length) {
    // Deterministic fallback so the owner always gets at least one option.
    const t = (templateContent(p) as GeneratedContent).title;
    if (t) titles = [t];
    provider = provider || "deterministic";
  }
  // Enforce the assigned name on every option + dedupe.
  const seen = new Set<string>();
  titles = titles
    .map((t) => enforceName(t, forcedName))
    .filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, n);
  return { titles, provider, usedImage: wantVision };
}

export function aiProvidersStatus() {
  return { groq: groqConfigured(), openai: openaiConfigured() };
}
