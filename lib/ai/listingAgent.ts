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
import { normalizeListing, parseModelJson } from "./normalizeListing";

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
    hasImage ? `• PHOTO attached — use it for materials, colours, polish and included pieces. Do NOT decide the TYPE from the photo (a model wearing several pieces is not a "set").` : ``,
    `• Product name: ${p.name}`,
    `• Category: ${p.categoryName ?? "Jewellery"}.${sub}`,
    colors ? `• Colours: ${colors}.` : ``,
    kw ? `• Specs keywords: ${kw}.` : ``,
    ``,
    `GROUNDING RULES (STRICT):`,
    `  • The shop's CATEGORY and SUB-CATEGORY are ground truth for TYPE${(p as any).subcategoryName ? ` — this piece IS a "${(p as any).subcategoryName}" (${p.categoryName ?? "Jewellery"})` : p.categoryName ? ` — this piece IS in "${p.categoryName}"` : ""}. Title, description, specs.Category and tags must describe THAT type, never another.`,
    `  • Indian names: Choti / Parandi = hair-braid accessory; Juda = bun accessory; Kamarbandh / Kamarband = waist belt; Hathphool = hand harness; Bajuband = armlet; Passa / Jhoomar = side head ornament; Maang Tikka = forehead ornament; Payal = anklet.`,
    `  • PRODUCT NAME is also ground truth for TYPE. If the name says Necklace / Choker / Earring / Bracelet / Pendant / Mangalsutra / Anklet — that IS the type.`,
    `  • NEVER tag or set Category to Nose Pin / Nath / Nose Ring unless the product NAME itself contains nath / nose pin / nose ring.`,
    `  • NEVER invent stones, motifs, or extra pieces not in the name, keywords, or photo.`,
    `  • A "Set" does not automatically mean earrings — only list pieces that are named or visible.`,
    ``,
    lockedTitle
      ? `TITLE — use EXACTLY: «${lockedTitle}».`
      : `TITLE — start with EXACTLY «${forcedName}», then 5-7 descriptive words naming a REAL feature (stone/work, motif, polish, occasion). Title Case, under ~70 chars. Never use Elegant, Statement, Artisanal or colour-count words like Multi Color.`,
    `DESCRIPTION — 100-125 word SEO paragraph. End with retail/wholesale CTA mentioning BlytheDIVA.`,
    `specs MUST include: Category (correct type from NAME), "Box Containing", Material, Work/Style, Occasion, Care.`,
    `tags: 8-12 search tags matching the REAL type (not nose pin unless it is one).`,
    `Return ONLY minified JSON.`,
  ].filter(Boolean).join("\n");
}

/** timeoutMs aborts each model request (the host kills a request at 10 s, so a caller with a deadline
 *  passes what it can afford); imageDetail "low" reads the photo at 512px — several times faster than
 *  "high" and plenty to tell a choker from a jhumka; onLog sees every attempt (used to report the real
 *  reason when no model answers). */
type GatewayOpts = { visionFirst?: boolean; timeoutMs?: number; imageDetail?: "low" | "high" | "auto"; onLog?: (e: any) => void };

export function buildGateway(opts?: GatewayOpts) {
  const openaiOn = openaiConfigured();
  const geminiOn = geminiTextConfigured();
  const wantVision = !!opts?.visionFirst && (openaiOn || geminiOn);
  const groqPrimary = groqConfigured() && !wantVision;
  const SYSTEM = "You are BlytheDIVA's product copywriter. Return only valid minified JSON.";
  const visionRun = async (call: any) => {
    const args = {
      system: SYSTEM, user: call._prompt, json: true,
      imageBase64: call._product?.imageBase64, imageMime: call._product?.imageMime,
      ...(opts?.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts?.imageDetail ? { imageDetail: opts.imageDetail } : {}),
    };
    if (openaiOn) {
      try { return normalizeListing(parseModelJson(await openaiChat(args))); }
      catch (e) { if (!geminiOn) throw e; }
    }
    return normalizeListing(parseModelJson(await geminiChat(args)));
  };
  const groqRun = async (call: any) => normalizeListing(parseModelJson(await groqChat({ system: SYSTEM, user: call._prompt, json: true, ...(opts?.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) })));
  return new AiGateway({
    primary: {
      name: groqPrimary ? "groq" : (openaiOn ? "openai" : "gemini"),
      run: async (call: any) => (groqPrimary ? groqRun(call) : visionRun(call)),
    },
    secondary: {
      name: groqPrimary ? (openaiOn ? "openai" : "gemini") : "groq",
      run: async (call: any) => (groqPrimary ? visionRun(call) : groqRun(call)),
    },
    deterministic: (call: any) => templateContent(call._product) as GeneratedContent,
    budgetPaise: Number(process.env.AI_BUDGET_PAISE ?? 500000),
    maxRetries: 1,
    breakerThreshold: 3,
    log: (e) => { console.log("[ai]", JSON.stringify(e)); try { opts?.onLog?.(e); } catch { /* ignore */ } },
  });
}

export async function generateProductContent(p: ProductLike, opts?: GatewayOpts): Promise<{ content: GeneratedContent; provider: string; fallbackUsed: boolean }> {
  const gateway = buildGateway(opts);
  const call: any = { feature: "listing", cacheKey: `listing:${p.sku}`, schema, estCostPaise: 50, _prompt: prompt(p), _product: p };
  const r = await gateway.run(call);
  const content = r.data as GeneratedContent;
  const locked = ((p as any).lockedTitle as string | undefined)?.trim();
  if (locked) {
    content.title = locked;
  } else {
    const forcedName = pickDivaName(((p as any).sku as string) || p.name || "");
    if (content?.title) content.title = enforceName(cleanTitleWords(content.title), forcedName);
  }
  // Strip wrong Nose Pin / nath tags & specs when NAME is necklace/earring/etc.
  const fixed = sanitizeJewelleryContent(content, p.name ?? "", p.categoryName);
  return { content: fixed, provider: r.provider, fallbackUsed: r.fallbackUsed };
}

/** The no-model version of generateProductContent — same naming and type clean-up, written from the
 *  product's fields. Used when the models are too slow to answer inside the host's time limit. */
export function fallbackProductContent(p: ProductLike): { content: GeneratedContent; provider: string; fallbackUsed: boolean } {
  const content = templateContent(p) as GeneratedContent;
  const forcedName = pickDivaName(((p as any).sku as string) || p.name || "");
  if (content?.title) content.title = enforceName(content.title, forcedName);
  return { content: sanitizeJewelleryContent(content, p.name ?? "", p.categoryName), provider: "template", fallbackUsed: true };
}

const FILLER_WORDS = [
  "classic", "elegant", "designer", "beautiful", "stylish", "premium", "exclusive", "trendy", "fancy",
  "attractive", "gorgeous", "charming", "lovely", "stunning", "luxury", "luxurious", "chic", "modern",
  "statement", "artisanal", "exquisite", "graceful", "glamorous", "timeless", "dazzling", "multi color",
];

/**
 * Owner, Oct 2026: "Sabme 3 common words — Elegant, Statement, Multi Color." The models kept using the
 * same filler even when told not to, so strip it AFTER they answer: filler adjectives and colour-count
 * words ("Multi Color", "Multicolour", "Multi-Coloured") say nothing about the piece. Never empties a title.
 */
const TITLE_STRIP = new RegExp(
  "\\b(" + [
    "multi[\\s-]*colou?r(?:ed|s)?", "multicolou?r(?:ed)?", "colou?rful",
    ...FILLER_WORDS.filter((w) => !/multi/.test(w)),
  ].join("|") + ")\\b", "gi");
export function cleanTitleWords(t: string): string {
  const out = String(t ?? "").replace(TITLE_STRIP, " ").replace(/\s*[,&]\s*(?=[,&]|$)/g, " ").replace(/\s{2,}/g, " ").trim();
  return out.split(/\s+/).length >= 2 ? out : String(t ?? "").trim();
}

export async function generateTitleOptions(p: ProductLike, n = 4, budgetMs = 6_500): Promise<{ titles: string[]; provider: string; usedImage: boolean; errors: string[] }> {
  const forcedName = pickDivaName(((p as any).sku as string) || p.name || "");
  const wantVision = !!p.imageBase64;
  const sub = (p as any).subcategoryName ? ` Sub-category: ${(p as any).subcategoryName}.` : "";
  const style = (p as any).styleName ? ` Style: ${(p as any).styleName}.` : "";
  const kw = (p.keywords ?? []).filter(Boolean).join(", ");
  const userPrompt = [
    `You are BlytheDIVA SEO copywriter. Produce ${n} DISTINCT website titles as JSON {"titles":["…"]}.`,
    `Write REGULAR, factual e-commerce titles a shopper would search for: material/work + exact type + one real visible detail (e.g. "Kundan Choker Necklace Set with Maang Tikka", "Oxidised Silver Jhumka Earrings with Pearl Drops"). The TYPE must match the shop's Category, Sub-category and Style below.`,
    wantVision ? `Look at the photo for colours, stones and polish. The shop's CATEGORY / SUB-CATEGORY and the NAME decide the TYPE — never call a necklace a nose pin, or a hair choti a necklace.` : `Infer from fields.`,
    `Category: ${p.categoryName ?? "Jewellery"}.${sub}${style}`,
    kw ? `Keywords: ${kw}.` : ``,
    `Each title starts with «${forcedName}», 5–7 words total, Title Case.`,
    `Make the ${n} titles GENUINELY DIFFERENT: each leads with a different real feature you can see or are told — stone/work (kundan, polki, AD/CZ, pearl, meenakari, beads), motif (peacock, floral, temple, coin, leaf), polish/finish (gold, oxidised, antique, rose gold) or occasion (bridal, festive, daily wear). Do not repeat the same descriptive word across titles.`,
    `NEVER use colour-count words (Multi Color, Multicolour, Colourful) and NEVER use: ${FILLER_WORDS.join(", ")}.`,
    `Return ONLY JSON.`,
  ].filter(Boolean).join("\n");
  const SYSTEM = "Return only valid minified JSON.";
  const call = { system: SYSTEM, user: userPrompt, json: true, imageBase64: p.imageBase64, imageMime: p.imageMime, temperature: 0.95 };
  const order: [string, (a: any) => Promise<string>][] = [];
  // Owner, Oct 2026: titles come from GEMINI reading the photo + category + sub-category + style.
  // The other models only fill in if Gemini is not set up or does not answer in time.
  if (geminiTextConfigured()) order.push(["gemini", geminiChat]);
  if (wantVision && openaiConfigured()) order.push(["openai", openaiChat]);
  if (groqConfigured()) order.push(["groq", groqChat]);
  if (openaiConfigured() && !order.some(([nm]) => nm === "openai")) order.push(["openai", openaiChat]);

  // ROOT CAUSE OF "Suggest 3-4 titles not working" (Oct 2026): the providers were tried ONE AFTER
  // ANOTHER with 18-30 s timeouts each, and the host kills the request at 10 s — so a slow first model
  // meant the rest never ran and only the template's single title came back. Now every model runs AT
  // ONCE inside one budget; titles from all of them are pooled (vision answers first) and the real
  // error of each failed model is returned so the screen can say why.
  const t0 = Date.now();
  const errors: string[] = [];
  const results: { nm: string; titles: string[] }[] = [];
  const timeoutMs = Math.max(2_000, budgetMs - 300);
  const runs = order.map(([nm, fn]) => (async () => {
    try {
      const args = nm === "groq" ? { ...call, imageBase64: undefined, imageMime: undefined } : { ...call, imageDetail: "low" };
      const raw: any = parseModelJson(await fn({ ...args, timeoutMs }));
      const arr = Array.isArray(raw) ? raw
        : Array.isArray(raw?.titles) ? raw.titles
        : (Object.values(raw ?? {}).find((v) => Array.isArray(v)) as any[] | undefined) ?? [];
      const cleaned = arr.map((t: any) => String(typeof t === "object" && t ? (t.title ?? Object.values(t)[0] ?? "") : t ?? "").trim()).filter(Boolean);
      if (!cleaned.length) throw new Error("no titles in reply");
      results.push({ nm, titles: cleaned });
    } catch (e) {
      errors.push(`${nm}: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`);
    }
  })());
  // Wait for all, but never past the budget; stop early once a vision model has given enough.
  await Promise.race([
    Promise.all(runs),
    new Promise<void>((r) => { const tick = () => { if (Date.now() - t0 >= budgetMs) return r(); if (results.some((x) => x.nm === "gemini" && x.titles.length >= n)) return r(); setTimeout(tick, 150); }; tick(); }),
  ]);
  if (Date.now() - t0 >= budgetMs) for (const [nm] of order) if (!results.some((x) => x.nm === nm) && !errors.some((e) => e.startsWith(nm + ":"))) errors.push(`${nm}: too slow`);
  const rank = (nm: string) => (nm === "gemini" ? 0 : wantVision && nm !== "groq" ? 1 : 2);
  results.sort((x, y) => rank(x.nm) - rank(y.nm));
  // Gemini answered with enough titles → use ONLY Gemini's; otherwise top up from the others.
  const gem = results.find((x) => x.nm === "gemini" && x.titles.length >= Math.min(n, 3));
  const used = gem ? [gem] : results;
  let titles: string[] = used.flatMap((x) => x.titles);
  let provider = used.map((x) => x.nm).join("+");
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
    .map((t) => enforceName(cleanTitleWords(t), forcedName))
    .filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, n);
  return { titles, provider, usedImage: wantVision, errors };
}

export function aiProvidersStatus() {
  return { groq: groqConfigured(), openai: openaiConfigured() };
}
