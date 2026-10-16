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

/**
 * productType — what KIND of piece a product is, from the shop's own data (sub-category, style,
 * category, name), and a check that an AI title doesn't describe a different kind.
 *
 * Owner, Oct 2026: a hair choti in "Other Accessories → Choti" got titles like "Polki Jhumka Earrings",
 * "Oxidised Silver Anklet" and "Rose Gold Hair Clip". The models read the photo (a bride wearing many
 * pieces) and guessed. The shop's sub-category is the truth; titles naming another type are dropped.
 */

const TYPES: [string, RegExp][] = [
  ["choti", /\b(choti|chotis|parandi|paranda|braid)\b/i],
  ["necklace", /\b(necklace|choker|haar|rani\s*haar|mala|neckpiece)\b/i],
  ["earrings", /\b(earrings?|jhumk[ai]s?|jhumkas|studs?|danglers?|chandbali|bali|ear\s*cuffs?|tops)\b/i],
  ["anklet", /\b(anklets?|payal|pajeb)\b/i],
  ["ring", /\b(finger\s*rings?|rings?)\b/i],
  ["bracelet", /\b(bracelets?|bangles?|kada|kangan|cuff)\b/i],
  ["maang tikka", /\b(maang\s*tikk?a|mang\s*tikk?a|tikka|matha\s*patti)\b/i],
  ["nose pin", /\b(nose\s*(pin|ring)|nath)\b/i],
  ["hair accessory", /\b(hair\s*(clip|pin|brooch|accessor(y|ies))|juda|bun\s*pin|hair\s*band|hairband|clip)\b/i],
  ["waist belt", /\b(kamar\s*bandh?|kamarband|waist\s*(belt|chain)|belt)\b/i],
  ["hathphool", /\b(hath\s*phool|haath\s*phool|hand\s*harness)\b/i],
  ["passa", /\b(passa|jhoomar|jhumar)\b/i],
  ["armlet", /\b(bajuband|armlet|bajubandh)\b/i],
  ["brooch", /\b(brooch|saree\s*pin)\b/i],
  ["mangalsutra", /\bmangalsutra\b/i],
  ["pendant", /\b(pendant|locket)\b/i],
  ["watch", /\bwatch(es)?\b/i],
];

/** Types a "set" may legitimately name alongside its main piece. */
const GOES_WITH: Record<string, string[]> = {
  necklace: ["earrings", "maang tikka", "ring", "pendant"],
  choti: ["hair accessory"],
  "hair accessory": ["choti"],
  bracelet: ["ring", "watch"],
  watch: ["bracelet"],
  hathphool: ["ring", "bracelet"],
  pendant: ["necklace", "earrings"],
};

function typesIn(text: string | null | undefined): string[] {
  const t = String(text ?? "");
  return TYPES.filter(([, re]) => re.test(t)).map(([k]) => k);
}

/** The piece's type(s) per the shop: sub-category first, then style, then name, then category. */
function shopTypes(p: { subcategoryName?: string | null; styleName?: string | null; name?: string | null; categoryName?: string | null }): string[] {
  for (const src of [p.subcategoryName, p.styleName, p.name, p.categoryName]) {
    const found = typesIn(src);
    if (found.length) return found;
  }
  return [];
}

/** Types named in `title` that the shop's type does NOT allow. Empty when the shop type is unknown. */
function conflictingTypes(title: string, allowed: string[]): string[] {
  if (!allowed.length) return [];
  const ok = new Set<string>(allowed);
  for (const a of allowed) for (const g of GOES_WITH[a] ?? []) ok.add(g);
  return typesIn(title).filter((t) => !ok.has(t));
}

/** Human label for prompts, e.g. "Choti (hair-braid accessory)". */
function typeLabel(p: { subcategoryName?: string | null; styleName?: string | null; categoryName?: string | null }): string {
  const sub = (p.subcategoryName ?? "").trim();
  const style = (p.styleName ?? "").trim();
  const base = sub || style || (p.categoryName ?? "").trim();
  if (!base) return "";
  return /choti|parandi/i.test(base) ? `${base} (hair-braid accessory)` : base;
}

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
    typeLabel(p as any) ? `THE PRODUCT IS A ${typeLabel(p as any).toUpperCase()}. Title, description and tags describe this one piece as that type — never as earrings, a necklace, anklet or any other kind, whatever else the photo shows.` : ``,
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
    // A title naming another kind of piece (e.g. "Jhumka Earrings" for a Choti) is replaced with a
    // plain, correct one built from the shop's own type.
    const allowed = shopTypes(p as any);
    const kind = typeLabel(p as any).replace(/\s*\(.*\)$/, "");
    if (content?.title && kind && conflictingTypes(content.title, allowed).length) {
      const style = ((p as any).styleName ?? "").trim();
      const polish = ((p as any).polishes ?? [])[0] ?? "";
      content.title = [forcedName, polish, style && !kind.toLowerCase().includes(style.toLowerCase()) ? style : "", kind].filter(Boolean).join(" ").replace(/\s+/g, " ");
    }
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

/** Finish families. A title may only name a finish the shop's own variants carry (owner, Oct 2026:
 *  "Gold plated kundan choker ko oxidised ke 4 option de rha h"). */
const FINISHES: [string, RegExp][] = [
  ["oxidised", /\b(oxidi[sz]ed|german\s+silver|black\s+metal)\b/i],
  ["rose gold", /\brose[\s-]?gold\b/i],
  ["mehendi", /\bmeh(e|a)nd(i|ee)\b/i],
  ["silver", /\bsilver(?!\s*(stone|bead))\b/i],
  ["gold", /\b(gold(en)?|gold[\s-]plated|matte\s+gold)\b/i],
];
function finishesIn(text: string): string[] {
  let t = String(text ?? "");
  const out: string[] = [];
  for (const [nm, re] of FINISHES) if (re.test(t)) { out.push(nm); t = t.replace(new RegExp(re.source, "gi"), " "); }
  return out;
}

export async function generateTitleOptions(p: ProductLike, n = 4, budgetMs = 6_500): Promise<{ titles: string[]; provider: string; usedImage: boolean; errors: string[] }> {
  const forcedName = pickDivaName(((p as any).sku as string) || p.name || "");
  const wantVision = !!p.imageBase64;
  const sub = (p as any).subcategoryName ? ` Sub-category: ${(p as any).subcategoryName}.` : "";
  const style = (p as any).styleName ? ` Style: ${(p as any).styleName}.` : "";
  const kw = (p.keywords ?? []).filter(Boolean).join(", ");
  const kind = typeLabel(p as any);
  const allowed = shopTypes(p as any);
  // Owner, Oct 2026: "Generate 3-4 title me ache titles nh aa rhe — kafi similar aa rhe h sab designs ke."
  // The model only ever saw ONE product, so every design in a sub-category got the same safe phrase.
  // It is now shown the titles other designs of this sub-category already carry, asked to name what
  // it actually sees, and near-copies are dropped afterwards. The FINISH is never left to the photo:
  // it comes from the variants' polish ("Gold plated kundan choker ko oxidised ke 4 option" — the old
  // prompt's examples literally said "Oxidised Silver"), and a title naming another finish is dropped.
  const polishList = [...new Set((((p as any).polishes ?? []) as string[]).map((x) => String(x ?? "").trim()).filter(Boolean))];
  const shopFinishes = new Set(polishList.flatMap((x) => finishesIn(x)));
  const finishFact = polishList.length
    ? `FINISH / POLISH (from the shop's stock — this is the TRUTH, the photo lighting can mislead): ${polishList.join(", ")}. Name only this finish; NEVER call it ${FINISHES.map(([f]) => f).filter((f) => !shopFinishes.has(f)).join(", ")}.`
    : ``;
  const avoid = [...new Set(((p as any).avoidTitles as string[] | undefined ?? [])
    .map((t) => String(t ?? "").replace(/^\S+\s+/, "").trim()).filter((t) => t.split(/\s+/).length >= 2))].slice(0, 30);
  const userPrompt = [
    `You are BlytheDIVA SEO copywriter. Produce ${n} alternative website titles for ONE product as JSON {"titles":["…"]}.`,
    kind ? `THE PRODUCT IS A ${kind.toUpperCase()}. Every title is for this same single piece and must name it as a ${kind.replace(/\s*\(.*\)$/, "")}. Never call it any other kind of jewellery (earrings, necklace, anklet, clip, ring…), even if the photo shows a model wearing other pieces.` : ``,
    `Write REGULAR, factual e-commerce titles a shopper would search for: finish + stone work + the type + one real visible detail (e.g. "Gold Plated Kundan Choker with Pink Drops", "Pearl Layered Rani Haar with Green Stones").`,
    wantVision ? `Use the photo ONLY for the stones, colours and work of this piece (the finish comes from the shop data below).` : `Infer from fields.`,
    `Category: ${p.categoryName ?? "Jewellery"}.${sub}${style}`,
    kw ? `Keywords: ${kw}.` : ``,
    `Each title starts with «${forcedName}», 5–7 words total, Title Case.`,
    finishFact,
    wantVision ? `First look closely at the photo and list in "seen" 4-6 things that are REALLY visible on this piece: the actual stone colours, the motif or shape, how it is built (layers, drops, beads, chain) and the stone-setting work. Only what you can see — do not guess, do not invent.` : ``,
    `Write the titles the way a jewellery shop owner would list this exact piece on Amazon or Myntra: plain, true and specific. Each title uses a different real detail from "seen". It is always the SAME piece and the SAME type.`,
    avoid.length ? `For reference, other designs in the shop are titled like this — don't copy them word for word:\n- ${avoid.slice(0, 12).join("\n- ")}` : ``,
    `Answer as {"seen":["…"],"titles":["…"]}.`,
    `NEVER use colour-count words (Multi Color, Multicolour, Colourful) and NEVER use: ${FILLER_WORDS.join(", ")}.`,
    `Return ONLY JSON.`,
  ].filter(Boolean).join("\n");
  const SYSTEM = "Return only valid minified JSON.";
  const call = { system: SYSTEM, user: userPrompt, json: true, imageBase64: p.imageBase64, imageMime: p.imageMime, temperature: 0.95 };
  const order: [string, (a: any) => Promise<string>][] = [];
  // Owner, Oct 2026: OpenAI is the FIRST choice for title suggestions (reads the photo + category +
  // sub-category + style); Gemini, then Groq, only fill in if OpenAI is not set up or doesn't answer.
  if (openaiConfigured()) order.push(["openai", openaiChat]);
  if (geminiTextConfigured()) order.push(["gemini", geminiChat]);
  if (groqConfigured()) order.push(["groq", groqChat]);

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
      const args = nm === "groq" ? { ...call, imageBase64: undefined, imageMime: undefined } : { ...call, imageDetail: nm === "openai" ? "auto" : "low" };
      const raw: any = parseModelJson(await fn({ ...args, timeoutMs }));
      const arr = Array.isArray(raw) ? raw
        : Array.isArray(raw?.titles) ? raw.titles
        : (Object.entries(raw ?? {}).find(([k, v]) => k !== "seen" && Array.isArray(v))?.[1] as any[] | undefined) ?? [];
      const all = arr.map((t: any) => String(typeof t === "object" && t ? (t.title ?? Object.values(t)[0] ?? "") : t ?? "").trim()).filter(Boolean);
      // Drop any title that names a different kind of piece than the shop's sub-category says.
      const cleaned = all.filter((t: string) => conflictingTypes(t, allowed).length === 0
        && (!shopFinishes.size || finishesIn(t).every((f) => shopFinishes.has(f))));
      if (!cleaned.length) throw new Error(all.length ? `titles named the wrong type or finish (${all[0].slice(0, 60)})` : "no titles in reply");
      results.push({ nm, titles: cleaned });
    } catch (e) {
      errors.push(`${nm}: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`);
    }
  })());
  // Wait for all, but never past the budget; stop early once a vision model has given enough.
  await Promise.race([
    Promise.all(runs),
    new Promise<void>((r) => { const tick = () => { if (Date.now() - t0 >= budgetMs) return r(); if (results.some((x) => x.nm === "openai" && x.titles.length >= Math.min(n, 3))) return r(); setTimeout(tick, 150); }; tick(); }),
  ]);
  if (Date.now() - t0 >= budgetMs) for (const [nm] of order) if (!results.some((x) => x.nm === nm) && !errors.some((e) => e.startsWith(nm + ":"))) errors.push(`${nm}: too slow`);
  const rank = (nm: string) => (nm === "openai" ? 0 : nm === "gemini" ? 1 : 2);
  results.sort((x, y) => rank(x.nm) - rank(y.nm));
  // OpenAI answered with enough titles → use ONLY OpenAI's; otherwise top up from the others in order.
  const first = results.find((x) => x.nm === "openai" && x.titles.length >= Math.min(n, 3));
  const used = first ? [first] : results;
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
    .filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  // Drop near-copies — of each other, and of titles other designs already carry — but never end up empty.
  const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && w !== forcedName.toLowerCase() && !["with", "and", "for", "the"].includes(w)));
  const sim = (a: Set<string>, b: Set<string>) => { let i = 0; for (const w of a) if (b.has(w)) i++; return i / Math.max(1, a.size + b.size - i); };
  const avoidW = avoid.map(words);
  const kept: string[] = []; const keptW: Set<string>[] = [];
  for (const t of titles) {
    const w = words(t);
    if (keptW.some((k) => sim(w, k) >= 0.75) || avoidW.some((k) => sim(w, k) >= 0.8)) continue;
    kept.push(t); keptW.push(w);
  }
  titles = (kept.length >= Math.min(2, titles.length) ? kept : titles).slice(0, n);
  return { titles, provider, usedImage: wantVision, errors };
}

export function aiProvidersStatus() {
  return { groq: groqConfigured(), openai: openaiConfigured() };
}
