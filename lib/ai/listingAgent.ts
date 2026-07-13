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
    colors ? `• Colours: ${colors}.` : ``,
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
    `DESCRIPTION — write it in BlytheDIVA's EXACT house format used on blythediva.com. It is ONE string containing an opening paragraph followed by five LABELLED blocks, each block on its OWN line (put a real newline "\\n" between every block). Do NOT use flowery filler like "royal elegance", "timeless beauty", "adds charm and richness".`,
    `  OPENING (2-3 factual sentences, grounded in the ACTUAL piece): name the type, the material/stones/work, any motif (peacock, floral, evil-eye, butterfly, temple…), and the finish/tone. If it is a SET, add that the matching pieces complete the look. End with occasions that match the REGISTER you picked above:`,
    `    – ethnic/bridal → "…ideal for weddings, festive celebrations and special occasions; it pairs gracefully with sarees, lehengas and ethnic outfits."`,
    `    – western/daily → "…light and easy for daily wear, office, college and casual outings; it pairs with dresses, kurtis and co-ords." (For western pieces NEVER mention weddings, sarees, lehengas, brides or "bridal/royal".)`,
    `  Then EXACTLY these five blocks, labels in CAPS, each on a new line, values grounded in the name/specs/photo only:`,
    `    "BRAND: BlytheDIVA"`,
    `    "BOX CONTAINING: {the exact pieces, e.g. 'One necklace, a pair of earrings and a maang tikka.'}"`,
    `    "MATERIAL & CRAFTSMANSHIP: Finest quality {material}, crafted with environment-friendly non-precious metals — skin-friendly and safe to wear for long hours."`,
    `    "JEWELLERY CARE: Wipe the piece with a soft cloth after every use, store it in a jewellery box to avoid damage, and keep water, sprays and perfumes away."`,
    `    "DISCLAIMER: Product colour may vary slightly due to photographic lighting or your screen settings."`,
    `  CRITICAL: claim ONLY the pieces/materials supported by the name, specifications or photo — never invent a component. The reference style: "This exquisitely crafted Peacock Design Victorian Necklace Set… features intricately detailed peacock motifs… adorned with shimmering zircon stones… finished in an antique gold tone, ideal for weddings and festive celebrations. The matching earrings complete the look."`,
    ``,
    `specs (object) MUST include: Category, Material, Work/Style, Occasion, Care${colors ? ", Colours" : ""}, and Includes (if it's a set). DO NOT include the SKU.`,
    `tags: 8-12 short search tags mixing type, style, material, occasion.`,
    `seo.metaTitle <= 60 chars (title + " | BlytheDIVA"); seo.metaDescription <= 155 chars, compelling; seo.keywords 8-12 long-tail phrases like "kundan necklace set for wedding", "artificial jewellery online India", "bridal jewellery Delhi".`,
    `Return ONLY the JSON object, minified, no markdown.`,
  ].filter(Boolean).join("\n");
}

export function buildGateway() {
  // OpenAI is the PRIMARY writer (the owner sets OPENAI_API_KEY for high-quality BlytheDIVA titles);
  // Groq is a free secondary if present; deterministic template is the always-there final hop.
  return new AiGateway({
    primary: {
      name: openaiConfigured() ? "openai" : "gemini",
      // Vision-capable primary: OpenAI (gpt-4o-mini) when enabled, otherwise Gemini — both read the
      // owner's product photo. Gemini carries titles while OpenAI billing is capped.
      run: async (call: any) => JSON.parse(await (openaiConfigured() ? openaiChat : geminiChat)({
        system: "You are BlytheDIVA's product copywriter. Return only valid minified JSON.",
        user: call._prompt, json: true,
        imageBase64: call._product?.imageBase64, imageMime: call._product?.imageMime,
      })),
    },
    secondary: {
      // Groq's text models can't see images; it only runs if OpenAI is unavailable, as a text-only writer.
      name: "groq",
      run: async (call: any) => JSON.parse(await groqChat({ system: "You are BlytheDIVA's product copywriter. Return only valid minified JSON.", user: call._prompt, json: true })),
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
