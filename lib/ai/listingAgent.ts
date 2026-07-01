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
  return [
    `You are a senior e-commerce copywriter for "Blythe Diva", a premium artificial-jewellery brand in Sadar Bazar, Rui Mandi, Delhi (retail + wholesale).`,
    `Write a high-converting product page as STRICT JSON with keys: title, description, specs (object of label->value), tags (array), seo (object: metaTitle, metaDescription, keywords array).`,
    `Product name: ${p.name}. SKU: ${p.sku}. Category: ${p.categoryName ?? "Jewellery"}.${sub}${colors ? ` Available colours: ${colors}.` : ""}`,
    // TITLE is the owner's #1 complaint — the AI must NOT invent brands/names or unrelated attributes.
    `TITLE RULES (STRICT — the shop owner's house style): the "title" must be built ONLY from the real Product name above (its actual material/style/type words like Kundan, Meenakari, Temple, Polki, Pearl, Oxidised, Gold, Bracelet, Necklace, Jhumka…), the Category and the Sub-category. Clean it into a short proper product name and ALWAYS append " – ${p.sku}" at the end, exactly like "Kundan Gold Bracelet – WBR1003" or "Meenakari Peacock Jhumka – EE1024". DO NOT invent or add: brand names, any person's name, made-up model names, or descriptors (e.g. "Daily Wear", "Minimal", "Anti Tarnish") that are NOT present in the product name/category. If the name is sparse, keep the title simple and factual from the category. Title MUST be under 60 characters and end with " – ${p.sku}".`,
    `Rules: description 70-110 words, warm and aspirational; naturally weave in Google-friendly search terms (the category, the style e.g. Kundan/Meenakari/Temple/Polki/Pearl/Oxidised if applicable, occasions like wedding/festive/party/daily wear, and location terms "Sadar Bazar", "Delhi", "artificial jewellery online India"). Mention craftsmanship, brass alloy + anti-tarnish plating, lightweight comfort, COD and easy returns.`,
    `specs (object) MUST include: SKU, Category, Material, Plating, Work/Style, Occasion, Care (and Colours if provided).`,
    `tags: 8-12 short search tags mixing category, style, occasion, material.`,
    `seo.metaTitle <= 60 chars; seo.metaDescription <= 155 chars and compelling; seo.keywords 8-12 long-tail phrases such as "<category> for wedding", "<style> <category>", "artificial jewellery online", "imitation jewellery Delhi".`,
    `Return ONLY the JSON object, no markdown.`,
  ].join("\n");
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
