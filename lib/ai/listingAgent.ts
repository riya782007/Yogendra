/**
 * lib/ai/listingAgent.ts — generates a full product page via the AI gateway.
 * Chain: Groq (primary) -> OpenAI (secondary) -> deterministic template (always).
 * Output is zod-validated; any failure falls back so a page is never blank.
 */
import "server-only";
import { AiGateway, z } from "./gateway";
import { groqChat, openaiChat, groqConfigured, openaiConfigured } from "./providers";
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
  return [
    `You are the senior product copywriter for "BlytheDIVA", a premium artificial/imitation jewellery brand (Sadar Bazar, Rui Mandi, Delhi; retail + wholesale).`,
    `Write ONE product page as STRICT minified JSON with keys: title, description, specs (object label->value), tags (array), seo (object: metaTitle, metaDescription, keywords array).`,
    `INPUTS —`,
    `• Product name the owner typed: ${p.name}`,
    `• Category: ${p.categoryName ?? "Jewellery"}.${sub}`,
    colors ? `• Colours: ${colors}.` : ``,
    kw
      ? `• Jewellery SPECIFICATIONS the owner provided — USE THESE to decide the material, style, type AND which pieces the set includes: ${kw}.`
      : `• No extra specifications given — infer ONLY from the product name & category; do not invent components or materials.`,
    ``,
    `TITLE — MUST follow BlytheDIVA's exact house style:  «{First name} {material/style descriptors} {jewellery type} with {included pieces}»`,
    `  1. START with a single elegant UNIQUE Indian girl's first name (e.g. Dhyani, Khyati, Ananya, Rutvika, Nashvika, Drishika, Tanisha, Priyanshi, Nidhi, Gitanjali, Aaradhya, Myra, Vanya…). Choose one that suits the piece; do not always use the same one.`,
    `  2. Then descriptors drawn ONLY from the name + specifications: material (Kundan, Uncut Kundan, Acrylic Kundan, Meenakari, Temple, Polki, Pearl, Moissanite, Turkish Stone, Crystal, Oxidised…), style/length (Semi Long, Long, Double Layer, Layered, Single Line, Choker…), design (Chandbali, Jhumka, Danglers…).`,
    `  3. Then the jewellery TYPE from the category (Necklace Set, Choker Set, Earrings, Ring, Bracelet…). If it ships with extra pieces, use "Set".`,
    `  4. If the specifications list included pieces (earrings, maang tikka, finger ring…), append "with {those pieces}" — e.g. "with Maang Tikka", "with Maang Tikka and Finger Ring".`,
    `  REAL examples of the required style: "Khyati Layered Kundan Necklace Set with Maang Tikka and Finger Ring", "Ananya Acrylic Kundan Chandbali Hanging Pearls", "Nashvika Double Layer Uncut Kundan Necklace Set", "Tanisha Moissanite Choker Set".`,
    `  ABSOLUTELY DO NOT put a SKU, any product code, price, hyphen+code, or the word "BlytheDIVA" in the title. Title Case, under ~70 characters.`,
    ``,
    `DESCRIPTION — match BlytheDIVA's voice EXACTLY, 70-120 words, in this order:`,
    `  a) Open: "Add royal elegance to your festive look with {the exact title you wrote} by BlytheDIVA."`,
    `  b) Design: "Designed in a {style} style, this {type} features {material} detailing that gives a rich traditional and bridal appeal."`,
    `  c) Included + occasions: if it's a set, state the exact pieces included (from the specifications, e.g. "a matching pair of earrings and maang tikka"), then "making it a complete jewellery choice for weddings, engagement ceremonies, sangeet, haldi-mehendi functions, festive celebrations, and family occasions."`,
    `  d) Pairing: "Its elegant ethnic design pairs beautifully with sarees, lehengas, anarkalis, shararas, and bridal outfits."`,
    `  e) Close: "Perfect for brides, bridesmaids, and women who love statement Indian jewellery, this {type} adds charm, richness, and timeless beauty to special occasion styling."`,
    `  CRITICAL: claim ONLY the pieces/materials supported by the name or the specifications — never invent components that were not provided.`,
    ``,
    `specs (object) MUST include: Category, Material, Work/Style, Occasion, Care${colors ? ", Colours" : ""}, and Includes (if it's a set). DO NOT include the SKU.`,
    `tags: 8-12 short search tags mixing type, style, material, occasion.`,
    `seo.metaTitle <= 60 chars (title + " | BlytheDIVA"); seo.metaDescription <= 155 chars, compelling; seo.keywords 8-12 long-tail phrases like "kundan necklace set for wedding", "artificial jewellery online India", "bridal jewellery Delhi".`,
    `Return ONLY the JSON object, minified, no markdown.`,
  ].filter(Boolean).join("\n");
}

export function buildGateway() {
  return new AiGateway({
    primary: {
      name: "groq",
      run: async (call: any) => JSON.parse(await groqChat({ system: "Return only valid minified JSON.", user: call._prompt, json: true })),
    },
    secondary: {
      name: "openai",
      run: async (call: any) => JSON.parse(await openaiChat({ system: "Return only valid minified JSON.", user: call._prompt, json: true })),
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
