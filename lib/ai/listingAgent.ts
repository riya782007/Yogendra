/**
 * listingAgent — generates product page via AI gateway.
 * Chain: Groq/OpenAI/Gemini → deterministic template.
 * NAME is ground truth for type; sanitize strips wrong Nose Pin tags.
 */
import "server-only";
import { AiGateway, z } from "./gateway";
import { groqChat, openaiChat, geminiChat, groqConfigured, openaiConfigured, geminiTextConfigured } from "./providers";
import { templateContent, pickDivaName, DIVA_NAMES, type GeneratedContent, type ProductLike } from "../content";
import { sanitizeJewelleryContent } from "../jewelleryType";
import { seoTitleFromName } from "../seoTitle";

function enforceName(title: string, forced: string): string {
  const t = (title ?? "").trim();
  if (!t) return forced;
  const first = t.split(/\s+/)[0];
  if (first.toLowerCase() === forced.toLowerCase()) return t;
  const namePool = new Set(DIVA_NAMES.map((n) => n.toLowerCase()));
  if (namePool.has(first.toLowerCase())) return forced + t.slice(first.length);
  return `${forced} ${t}`;
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
  const sub = (p as any).subcategoryName ? ` Sub-category: ${(p as any).subcategoryName}.` : "";
  const kw = (p.keywords ?? []).filter(Boolean).join(", ");
  const hasImage = !!p.imageBase64;
  const forcedName = pickDivaName(((p as any).sku as string) || p.name || "");
  const lockedTitle = ((p as any).lockedTitle as string | undefined)?.trim();
  return [
    `You are the senior product copywriter for "BlytheDIVA", premium artificial jewellery (Sadar Bazar, Delhi).`,
    `Write ONE product page as STRICT minified JSON: title, description, specs (object), tags (array), seo (metaTitle, metaDescription, keywords).`,
    hasImage ? `• PHOTO attached — base type, materials, colours and included pieces on WHAT YOU SEE.` : ``,
    `• Product name: ${p.name}`,
    `• Category: ${p.categoryName ?? "Jewellery"}.${sub}`,
    colors ? `• Colours: ${colors}.` : ``,
    kw ? `• Specs keywords: ${kw}.` : ``,
    ``,
    `GROUNDING RULES (STRICT):`,
    `  • PRODUCT NAME is ground truth for TYPE. If the name says Necklace / Choker / Earring / Bracelet / Pendant / Mangalsutra / Anklet — that IS the type.`,
    `  • NEVER tag or set Category to Nose Pin / Nath / Nose Ring unless the product NAME itself contains nath / nose pin / nose ring.`,
    `  • NEVER invent stones, motifs, or extra pieces not in the name, keywords, or photo.`,
    `  • A "Set" does not automatically mean earrings — only list pieces that are named or visible.`,
    ``,
    lockedTitle
      ? `TITLE — use EXACTLY: «${lockedTitle}».`
      : `TITLE — start with EXACTLY «${forcedName}», then 5-7 descriptive words. Title Case, under ~70 chars.`,
    `DESCRIPTION — 100-125 word SEO paragraph. End with retail/wholesale CTA mentioning BlytheDIVA.`,
    `specs MUST include: Category (correct type from NAME), "Box Containing", Material, Work/Style, Occasion, Care.`,
    `tags: 8-12 search tags matching the REAL type (not nose pin unless it is one).`,
    `Return ONLY minified JSON.`,
  ].filter(Boolean).join("\n");
}

export function buildGateway(opts?: { visionFirst?: boolean }) {
  const openaiOn = openaiConfigured();
  const geminiOn = geminiTextConfigured();
  const wantVision = !!opts?.visionFirst && (openaiOn || geminiOn);
  const groqPrimary = groqConfigured() && !wantVision;
  const SYSTEM = "You are BlytheDIVA's product copywriter. Return only valid minified JSON.";
  const visionArgs = (call: any) => ({
    system: SYSTEM, user: call._prompt, json: true,
    imageBase64: call._product?.imageBase64, imageMime: call._product?.imageMime,
  });
  const openaiRun = async (call: any) => JSON.parse(await openaiChat(visionArgs(call)));
  const geminiRun = async (call: any) => JSON.parse(await geminiChat(visionArgs(call)));
  const groqRun = async (call: any) => JSON.parse(await groqChat({ system: SYSTEM, user: call._prompt, json: true }));
  // Keep each provider as an independent gateway hop: a failed OpenAI response now reaches
  // Gemini and Groq rather than repeating the same provider inside a wrapper.
  const providers = [
    ...(groqPrimary ? [{ name: "groq", run: groqRun }] : []),
    ...(openaiOn ? [{ name: "openai", run: openaiRun }] : []),
    ...(geminiOn ? [{ name: "gemini", run: geminiRun }] : []),
    ...(!groqPrimary && groqConfigured() ? [{ name: "groq", run: groqRun }] : []),
  ];
  return new AiGateway({
    primary: providers[0] ?? { name: "unavailable", run: async () => { throw new Error("no AI provider configured"); } },
    secondary: providers[1],
    fallbacks: providers.slice(2),
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
    content.title = locked;
  } else {
    const forcedName = pickDivaName(((p as any).sku as string) || p.name || "");
    if (content?.title) content.title = enforceName(content.title, forcedName);
  }
  // Strip wrong Nose Pin / nath tags & specs when NAME is necklace/earring/etc.
  const fixed = sanitizeJewelleryContent(content, p.name ?? "", p.categoryName);
  return { content: fixed, provider: r.provider, fallbackUsed: r.fallbackUsed };
}

const FILLER_WORDS = [
  "classic", "elegant", "designer", "beautiful", "stylish", "premium", "exclusive", "trendy", "fancy",
  "attractive", "gorgeous", "charming", "lovely", "stunning", "luxury", "luxurious", "chic", "modern",
];

export async function generateTitleOptions(p: ProductLike, n = 4): Promise<{ titles: string[]; provider: string; usedImage: boolean }> {
  const forcedName = pickDivaName(((p as any).sku as string) || p.name || "");
  const wantVision = !!p.imageBase64;
  const sub = (p as any).subcategoryName ? ` Sub-category: ${(p as any).subcategoryName}.` : "";
  const kw = (p.keywords ?? []).filter(Boolean).join(", ");
  const userPrompt = [
    `You are BlytheDIVA SEO copywriter. Produce ${n} DISTINCT website titles as JSON {"titles":["…"]}.`,
    wantVision ? `Look at the photo. NAME is ground truth for type — never call a necklace a nose pin.` : `Infer from fields.`,
    `Category: ${p.categoryName ?? "Jewellery"}.${sub}`,
    kw ? `Keywords: ${kw}.` : ``,
    `Each title starts with «${forcedName}», 5–7 words total, Title Case.`,
    `Banned fillers: ${FILLER_WORDS.join(", ")}.`,
    `Return ONLY JSON.`,
  ].filter(Boolean).join("\n");
  const SYSTEM = "Return only valid minified JSON.";
  const call = { system: SYSTEM, user: userPrompt, json: true, imageBase64: p.imageBase64, imageMime: p.imageMime, temperature: 0.95 };
  const order: [string, (a: any) => Promise<string>][] = [];
  if (wantVision && openaiConfigured()) order.push(["openai", openaiChat]);
  if (wantVision && geminiTextConfigured()) order.push(["gemini", geminiChat]);
  if (groqConfigured()) order.push(["groq", groqChat]);
  if (openaiConfigured() && !order.some(([nm]) => nm === "openai")) order.push(["openai", openaiChat]);

  let titles: string[] = [];
  let provider = "";
  for (const [nm, fn] of order) {
    try {
      const raw = JSON.parse(await fn(call));
      const arr = Array.isArray(raw?.titles) ? raw.titles : Array.isArray(raw) ? raw : [];
      const cleaned = arr.map((t: any) => String(t ?? "").trim()).filter(Boolean);
      if (cleaned.length > titles.length) { titles = cleaned; provider = nm; }
      if (titles.length >= n) break;
    } catch { /* next */ }
  }
  if (!titles.length) {
    const t = (templateContent(p) as GeneratedContent).title;
    if (t) titles = [t];
    provider = provider || "deterministic";
  }
  if (!wantVision) {
    const det = seoTitleFromName(p.name ?? "", (p as any).categoryName);
    if (det) titles = [det, ...titles.filter((t) => t.toLowerCase() !== det.toLowerCase())];
  }
  const seen = new Set<string>();
  titles = titles
    .map((t) => enforceName(t, forcedName))
    .filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, n);
  return { titles, provider, usedImage: wantVision };
}

export function aiProvidersStatus() {
  return { groq: groqConfigured(), openai: openaiConfigured(), gemini: geminiTextConfigured() };
}
