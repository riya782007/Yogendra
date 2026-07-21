/**
 * lib/ai/promo.ts — turn the owner's rough promo idea into a rich, poster-ready image prompt.
 * OpenAI (ChatGPT) is the creative director: it refines the idea using the live catalogue + festival
 * context and picks the most-suited category. Gemini (Nano Banana) then renders the poster from the
 * `refinedPrompt` (done in the server action). Server-only.
 */
import "server-only";
import { openaiChat, openaiConfigured, geminiChat, geminiTextConfigured } from "./providers";

export type PromoBrief = { title: string; refinedPrompt: string; categorySlug: string | null };

const REFINE_SYSTEM =
  `You are the senior creative director for "BlytheDIVA", a premium Indian artificial/imitation jewellery brand (Sadar Bazar, Delhi). ` +
  `You turn the owner's rough idea into ONE richly detailed prompt for an AI image generator (Google Gemini / Nano Banana) that will produce a STUNNING, high-conversion PROMOTIONAL POSTER used as the storefront hero banner. Return only valid minified JSON.`;

export async function refinePromoPrompt(input: {
  idea: string;
  categories: { name: string; slug: string }[];
  productHints?: string[];
}): Promise<PromoBrief> {
  const cats = input.categories.map((c) => `${c.name} (${c.slug})`).join(", ");
  const hints = (input.productHints ?? []).filter(Boolean).slice(0, 12).join(", ");
  const user = [
    `OWNER'S ROUGH IDEA: "${input.idea.trim()}"`,
    `BRAND: BlytheDIVA — premium Kundan, Uncut Kundan, Polki, Meenakari, Temple, Pearl & AD (American Diamond) artificial jewellery. Palette: royal gold, deep maroon, emerald green, ivory/cream. Audience: Indian women shopping for festive, bridal and party jewellery.`,
    `AVAILABLE CATEGORIES (choose the ONE most relevant to this promo, return its slug): ${cats || "necklace, earrings"}.`,
    hints ? `SOME LIVE PRODUCTS / THEMES for grounding: ${hints}.` : ``,
    ``,
    `Return STRICT minified JSON with keys: title, refinedPrompt, categorySlug.`,
    `• title — a short campaign name (e.g. "Diwali Kundan Sale", "Karwa Chauth Edit").`,
    `• categorySlug — the single most-suited category slug from the list above (or the closest match).`,
    `• refinedPrompt — a vivid, specific, advertising-grade prompt for the poster. It MUST describe:`,
    `   – the FESTIVE THEME/occasion implied by the idea (Diwali, Karwa Chauth, Navratri, wedding season, Raksha Bandhan, sale, etc.), with tasteful Indian festive accents (soft-focus diyas, marigold, bokeh fairy lights, silk drape, subtle rangoli/paisley motifs) — elegant, never cluttered;`,
    `   – the JEWELLERY HERO: a specific piece type (e.g. a gold Kundan necklace set / Polki choker / jhumkas) worn by an elegant, radiant Indian woman OR shown as a luxe flat-lay, sharply lit as the clear focal point;`,
    `   – the brand palette (royal gold, maroon, emerald, ivory), premium editorial studio lighting, rich depth and gleam on the metal and stones;`,
    `   – CLEARLY LEGIBLE promotional TEXT reproducing the EXACT offer/greeting the owner implied (e.g. the discount like "UP TO 40% OFF", "FESTIVE SALE", or a festival greeting) in an elegant modern serif/display font with strong contrast and correct spelling — keep the text SHORT (a headline + the offer);`,
    `   – composition: a wide 16:9 hero banner with a clear focal area on one side and clean negative space for the headline on the other; photorealistic, ultra-detailed, 4K, advertising-grade.`,
    `   Do NOT invent a fake third-party logo; you MAY include the wordmark "BlytheDIVA" subtly. Spell every word exactly. Keep on-image text minimal and correctly spelled.`,
  ].filter(Boolean).join("\n");

  // OpenAI when enabled; Gemini otherwise (OpenAI billing capped) — refine keeps working either way.
  const chatFn = openaiConfigured() ? openaiChat : geminiTextConfigured() ? geminiChat : openaiChat;
  const raw = await chatFn({ system: REFINE_SYSTEM, user, json: true, timeoutMs: 30_000 });
  const j = JSON.parse(raw);
  return {
    title: String(j.title ?? "Festive Campaign").slice(0, 80),
    refinedPrompt: String(j.refinedPrompt ?? input.idea),
    categorySlug: j.categorySlug ? String(j.categorySlug).trim() : null,
  };
}
