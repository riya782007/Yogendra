/**
 * lib/ai/listingAgent.ts — generates a full product page via the AI gateway.
 * Chain: Groq (primary) -> OpenAI (secondary) -> deterministic template (always).
 * Output is zod-validated; any failure falls back so a page is never blank.
 */
import "server-only";
import { AiGateway, z } from "./gateway";
import { groqChat, openaiChat, geminiChat, groqConfigured, openaiConfigured, geminiTextConfigured } from "./providers";
import { templateContent, type GeneratedContent, type ProductLike } from "../content";

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
    `  • NEVER invent a stone, material, motif, colour, length, layer count, or included piece that none of the inputs mention. If the name does not say "Maang Tikka" (or the specs don't list it), the set does NOT include one — do not add it.`,
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
    `TITLE — MUST follow BlytheDIVA's exact house style:  «{First name} {material/style descriptors} {jewellery type} with {included pieces}»`,
    `  1. START with a single elegant UNIQUE Indian girl's first name (e.g. Dhyani, Khyati, Ananya, Rutvika, Nashvika, Drishika, Tanisha, Priyanshi, Nidhi, Gitanjali, Aaradhya, Myra, Vanya…). Choose one that suits the piece; do not always use the same one.`,
    `  2. Then descriptors drawn ONLY from the name + specifications: material (Kundan, Uncut Kundan, Acrylic Kundan, Meenakari, Temple, Polki, Pearl, Moissanite, Turkish Stone, Crystal, Oxidised…), style/length (Semi Long, Long, Double Layer, Layered, Single Line, Choker…), design (Chandbali, Jhumka, Danglers…).`,
    `  3. Then the jewellery TYPE from the category (Necklace Set, Choker Set, Earrings, Ring, Bracelet…). If it ships with extra pieces, use "Set".`,
    `  4. If the specifications list included pieces (earrings, maang tikka, finger ring…), append "with {those pieces}" — e.g. "with Maang Tikka", "with Maang Tikka and Finger Ring".`,
    `  LENGTH: aim for 5-10 words with 2-4 descriptors — rich like BlytheDIVA's live catalogue, not a bare 3-word title.`,
    `  REAL live BlytheDIVA titles to mirror in style & length: "Dhyani Semi Long Uncut Kundan Necklace Set with Maang Tikka", "Rutvika Double Layer Uncut Kundan Long Necklace Set with Maang Tikka", "Khyati Layered Kundan Necklace Set with Maang Tikka and Finger Ring", "Ananya Acrylic Kundan Chandbali Hanging Pearls", "Gitanjali Turkish Stone Single Line Choker", "Tanisha Moissanite Choker Set", "Rashika Meenakari Chandbali with Hanging Pearls", "Nidhi Kundan Chandbali with Hanging Jhumka", "Priyanshi Crystal Stone Danglers".`,
    `  ABSOLUTELY DO NOT put a SKU, any product code, price, hyphen+code, or the word "BlytheDIVA" in the title. Title Case, under ~70 characters.`,
    ``,
    `REGISTER — read the name + specifications and pick the RIGHT voice:`,
    `  • If they say western, daily wear, office, casual, minimal, anti-tarnish, contemporary, modern (and it is NOT a kundan/temple/polki/bridal set): write a WESTERN / DAILY-WEAR description — everyday styling, work-to-evening, pairs with dresses, jeans, kurtis, co-ords & western outfits; mention anti-tarnish/lightweight/skin-friendly/gift-ready if relevant. DO NOT mention brides, sarees, lehengas, weddings, sangeet or "royal/bridal".`,
    `  • Otherwise use the ETHNIC / BRIDAL voice below. Weave the owner's keywords in naturally for SEO either way.`,
    ``,
    `DESCRIPTION — write a fluent, SEO-optimised marketing paragraph of 100-125 words. This is the owner's reference style (a ChatGPT "Digital marketing expert" product description written for Google ranking). ONE flowing paragraph — NO headings, NO labelled blocks, NO bullet points. Build it in this order, grounded in the PHOTO + the inputs:`,
    `  1. Hook naming the piece: "Elevate your jewellery collection with this …" (ethnic) or "Add an effortless touch to your style with this …" (western) — state the type, the finish/tone and the materials/design you can actually see or that the inputs give (e.g. multi-layer, pearl strands, gold beads, Kundan, American Diamond, contemporary chain detailing).`,
    `  2. Styling & occasions matching the register: ethnic/bridal → "complements ethnic, Indo-western and modern outfits; perfect for weddings, festive celebrations, parties and special occasions"; western/daily → "office, college, parties and casual outings; pairs with dresses, kurtis and co-ords". If it is a SET, add that the matching pieces complete the look.`,
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

export function buildGateway() {
  // GROQ is the PRIMARY writer (free + fast) — the owner sets GROQ_API_KEY; titles + descriptions are
  // generated from the product's name + CATEGORY + SUB-CATEGORY + keywords. OpenAI (vision-capable) is
  // the FALLBACK when Groq is missing or fails; deterministic template is the always-there final hop.
  const groqPrimary = groqConfigured();
  const openaiFallback = openaiConfigured();
  const SYSTEM = "You are BlytheDIVA's product copywriter. Return only valid minified JSON.";
  return new AiGateway({
    primary: {
      name: groqPrimary ? "groq" : (openaiFallback ? "openai" : "gemini"),
      run: async (call: any) => {
        if (groqPrimary) return JSON.parse(await groqChat({ system: SYSTEM, user: call._prompt, json: true }));
        // No Groq key → go straight to a vision model so the photo still informs the copy.
        return JSON.parse(await (openaiFallback ? openaiChat : geminiChat)({
          system: SYSTEM, user: call._prompt, json: true,
          imageBase64: call._product?.imageBase64, imageMime: call._product?.imageMime,
        }));
      },
    },
    secondary: {
      // Fallback writer: OpenAI (gpt-4o-mini, vision) when configured, else Gemini — both can also read
      // the product photo for extra grounding when Groq is unavailable.
      name: openaiFallback ? "openai" : "gemini",
      run: async (call: any) => JSON.parse(await (openaiFallback ? openaiChat : geminiChat)({
        system: SYSTEM, user: call._prompt, json: true,
        imageBase64: call._product?.imageBase64, imageMime: call._product?.imageMime,
      })),
    },
    deterministic: (call: any) => templateContent(call._product) as GeneratedContent,
    budgetPaise: Number(process.env.AI_BUDGET_PAISE ?? 500000),
    maxRetries: 1,
    breakerThreshold: 3,
    log: (e) => console.log("[ai]", JSON.stringify(e)),
  });
}

export async function generateProductContent(p: ProductLike): Promise<{ content: GeneratedContent; provider: string; fallbackUsed: boolean }> {
  const gateway = buildGateway();
  const call: any = { feature: "listing", cacheKey: `listing:${p.sku}`, schema, estCostPaise: 50, _prompt: prompt(p), _product: p };
  const r = await gateway.run(call);
  return { content: r.data as GeneratedContent, provider: r.provider, fallbackUsed: r.fallbackUsed };
}

export function aiProvidersStatus() {
  return { groq: groqConfigured(), openai: openaiConfigured() };
}
