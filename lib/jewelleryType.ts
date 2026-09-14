/**
 * Shared jewellery type detection — product NAME is ground truth.
 * Prevents necklace sets being tagged/spec'd as Nose Pin from stale category or tags.
 */

export function nameSaysNath(name: string): boolean {
  return /\bnath\b|nathni|nose\s*pin|nosepin|nose\s*ring/i.test(name ?? "");
}

export function nameSaysOtherJewellery(name: string): boolean {
  const n = name ?? "";
  if (nameSaysNath(n)) return false;
  return /necklace|choker|earring|jhumka|jhumki|dangler|bracelet|bangle|kada|pendant|mangalsutra|anklet|payal|haar|maang\s*tikka|brooch|haathphool/i.test(n);
}

export function baseTypeFromName(name: string, fallbackCategory: string): string {
  const nameL = (name ?? "").toLowerCase();
  if (nameSaysNath(name)) return "Nose Pin";
  if (/necklace|haar/.test(nameL)) return "Necklace";
  if (/choker/.test(nameL)) return "Choker";
  if (/earring|jhumka|jhumki|dangler/.test(nameL)) return "Earring";
  if (/bracelet|bangle|kada/.test(nameL)) return "Bracelet";
  if (/pendant/.test(nameL)) return "Pendant";
  if (/mangalsutra/.test(nameL)) return "Mangalsutra";
  if (/anklet|payal/.test(nameL)) return "Anklet";
  if (/maang\s*tikka|tikka/.test(nameL)) return "Maang Tikka";
  return (fallbackCategory || "Jewellery").replace(/s$/i, "");
}

const NATH_TAG = /^(nath|nathni|nose\s*pin|nosepin|nose\s*ring)$/i;

/** Align AI/template tags & specs with the real type implied by the product name. */
export function sanitizeJewelleryContent<T extends {
  title?: string;
  tags?: string[];
  specs?: Record<string, string>;
  seo?: { keywords?: string[] };
}>(content: T, productName: string, categoryName?: string): T {
  const nameL = `${productName ?? ""} ${content.title ?? ""}`.toLowerCase();
  const isNath = nameSaysNath(nameL);
  const isNecklace = /necklace|choker|haar/i.test(nameL) && !isNath;
  const isEarring = /earring|jhumka|jhumki|dangler|\bstud\b/i.test(nameL) && !isNath;
  const isBracelet = /bracelet|bangle|kada/i.test(nameL) && !isNath;
  const isPendant = /\bpendant\b/i.test(nameL) && !isNath && !isNecklace;
  const isOther = isNecklace || isEarring || isBracelet || isPendant
    || (/mangalsutra|anklet|payal|maang\s*tikka/i.test(nameL) && !isNath);

  if (!content.specs) (content as any).specs = {};
  if (!Array.isArray(content.tags)) (content as any).tags = [];

  if (isOther && !isNath) {
    content.tags = content.tags!.filter((t) => !NATH_TAG.test(String(t).trim()));
    const cat = String(content.specs!.Category ?? "");
    if (/nose|nath/i.test(cat)) {
      if (isNecklace) content.specs!.Category = /set/i.test(nameL) ? "Necklace Set" : "Necklace";
      else if (isEarring) content.specs!.Category = "Earrings";
      else if (isBracelet) content.specs!.Category = "Bracelet";
      else if (isPendant) content.specs!.Category = "Pendant";
      else content.specs!.Category = categoryName ?? "Jewellery";
    }
    const box = String(content.specs!["Box Containing"] ?? content.specs!["Box containing"] ?? "");
    if (/nose pin|one nath/i.test(box)) {
      if (isNecklace) content.specs!["Box Containing"] = /set/i.test(nameL) ? "One necklace set" : "One necklace";
      else if (isEarring) content.specs!["Box Containing"] = "A pair of earrings";
      else if (isBracelet) content.specs!["Box Containing"] = "One bracelet";
      else if (isPendant) content.specs!["Box Containing"] = "One pendant";
    }
    if (content.seo?.keywords) {
      content.seo.keywords = content.seo.keywords.filter((k) => !/\bnath\b|nose\s*pin|nose\s*ring/i.test(k));
    }
  }
  if (isNath) {
    content.specs!.Category = "Nose Pin";
    if (!content.tags!.some((t) => NATH_TAG.test(String(t).trim()))) {
      content.tags = [...content.tags!, "nath", "nose pin", "nose ring"].slice(0, 14);
    }
  }
  return content;
}
