/**
 * lib/content.ts — product content resolver. Requirement 2.2-2.3.
 * NEVER calls a model on the request path: cached generated_content else a rich
 * deterministic template. SEO-strong by default (tags, keywords, occasion terms).
 */
export type GeneratedContent = {
  title: string;
  description: string;
  specs: Record<string, string>;
  tags: string[];
  seo: { metaTitle: string; metaDescription: string; keywords: string[] };
};

export type ProductLike = {
  name: string;
  sku: string;
  categoryName?: string;
  colors?: string[];
  keywords?: string[];
  generated_content?: GeneratedContent | null;
};

const LOCATION = ["Sadar Bazar", "Rui Mandi", "Delhi", "artificial jewellery wholesale Delhi", "imitation jewellery online India"];
const OCCASIONS = ["wedding", "festive", "party wear", "daily wear", "gifting"];

function styleHints(name: string): string[] {
  const n = name.toLowerCase(); const t: string[] = [];
  if (n.includes("kundan")) t.push("Kundan");
  if (n.includes("meena") || n.includes("meenakari")) t.push("Meenakari");
  if (n.includes("temple") || n.includes("lakshmi")) t.push("Temple jewellery");
  if (n.includes("polki")) t.push("Polki");
  if (n.includes("pearl")) t.push("Pearl");
  if (n.includes("oxidis") || n.includes("oxidiz") || n.includes("silver")) t.push("Oxidised silver");
  if (n.includes("jhumka")) t.push("Jhumka");
  if (n.includes("choker")) t.push("Choker");
  return t;
}

export function templateContent(p: ProductLike): GeneratedContent {
  const cat = p.categoryName ?? "Jewellery";
  const catL = cat.toLowerCase();
  const styles = styleHints(p.name);
  const colorPhrase = p.colors && p.colors.length ? ` Available in ${p.colors.join(", ")}.` : "";
  const styleWord = styles[0] ? `${styles[0]} ` : "";
  const description =
    `${p.name} — a ${styleWord}artificial ${catL} handcrafted by Blythe Diva in Sadar Bazar, Delhi.${colorPhrase} ` +
    `Made on a brass-alloy base with anti-tarnish gold-tone plating, it's lightweight, skin-friendly and finished for a premium look. ` +
    `Perfect for weddings, festive occasions and party wear, and an easy gift. Shop ${catL} online with COD, free shipping over ₹999, and easy 7-day returns.`;

  const specs: Record<string, string> = {
    SKU: p.sku,
    Category: cat,
    Material: "Brass alloy",
    Plating: "Anti-tarnish gold-tone",
    Work: styles.length ? styles.join(", ") : "Handcrafted",
    Occasion: "Wedding, festive, party & daily wear",
    Care: "Keep away from water & perfume; store dry",
    ...(p.colors && p.colors.length ? { Colours: p.colors.join(", ") } : {}),
  };

  const tags = Array.from(new Set([
    cat, "artificial jewellery", "imitation jewellery", "fashion jewellery",
    ...styles, ...OCCASIONS.slice(0, 3), ...(p.colors ?? []),
  ])).slice(0, 14);

  const keywords = Array.from(new Set([
    p.name, `${catL} for wedding`, `${catL} for festive wear`, `${styleWord}${catL}`.trim(),
    "artificial jewellery", ...(p.keywords ?? []), ...LOCATION,
  ])).filter(Boolean).slice(0, 12);

  return {
    title: p.name,
    description,
    specs,
    tags,
    seo: {
      metaTitle: `${p.name} | ${cat} | Blythe Diva Delhi`.slice(0, 60),
      metaDescription: `Buy ${p.name} (${p.sku}) — ${styleWord}${catL} at retail & wholesale from Blythe Diva, Sadar Bazar Delhi. COD, free shipping over ₹999.`.slice(0, 158),
      keywords,
    },
  };
}

export function resolveProductContent(p: ProductLike): GeneratedContent {
  if (p.generated_content && p.generated_content.title) return p.generated_content;
  return templateContent(p);
}
