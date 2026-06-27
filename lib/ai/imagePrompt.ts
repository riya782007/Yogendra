/**
 * lib/ai/imagePrompt.ts — builds the exact, locked image-generation prompt per product.
 * Shot type and subject are chosen by category; the rest of the prompt is the client's
 * non-negotiable fidelity + no-text + technical spec, verbatim.
 */
export type ImageAspect = "4:5" | "1:1";

// Shot framing per jewellery TYPE — matched against category/subcategory keywords so each
// piece is shown where it's actually worn (a kanchain on the hair/back, not "a hair accessory").
const SHOT_BY_CATEGORY: Record<string, string> = {
  kanchain: "the hair and nape from a graceful three-quarter back angle, the chain draped along the parting/braid",
  "maang tikka": "the centre forehead and hair parting, slight downward gaze",
  tikka: "the centre forehead and hair parting, slight downward gaze",
  borla: "the forehead and hair parting (Rajasthani borla), three-quarter turn",
  hathphool: "the back of the hand and fingers, fingers gently splayed",
  bangle: "the wrist and forearm, hand softly posed",
  nathni: "the nose and cheek, delicate side profile",
  nath: "the nose and cheek, delicate side profile",
  payal: "the ankle and foot, seated or mid-step",
  kamarband: "the waist, three-quarter turn",
  necklace: "close-up on the décolletage and neckline",
  bracelet: "the hand and wrist",
  anklet: "the ankle and foot, seated or mid-step",
  earrings: "the ear and jawline, slight three-quarter turn",
  earring: "the ear and jawline, slight three-quarter turn",
  ring: "the hand, fingers gently relaxed",
};

// Western / international styling uses a Western model; everything else uses an Indian model.
const WESTERN_SUBJECTS = [
  "a poised young woman with fair Western/European features, soft natural makeup, loose styled hair, an elegant confident expression — clean modern international editorial look",
  "an elegant woman in her late 20s with light Western features, minimal dewy makeup, sleek hair, a graceful aspirational expression — refined contemporary look",
];

/** True when the piece is styled "western/fusion/modern" — then use a Western model (per owner's
 *  rule: western necklace → foreign model, Indian necklace → Indian model). */
export function isWesternStyle(hint: string): boolean {
  return /\bwestern\b|fusion|minimalist|minimalistic|modern|contemporary|korean|chic|dainty/i.test(hint || "");
}

// Indian models only — luminous, well-lit complexions (NOT dark/muddy), unmistakably
// South Asian / Indian features. Deterministic per index.
const SUBJECTS = [
  "a beautiful young Indian (South Asian) woman in her mid-20s, with a luminous fair-to-wheatish Indian complexion that is bright and evenly lit (not dark, not muddy), expressive dark almond eyes, soft kohl, natural dewy glam makeup, sleek glossy dark hair, a warm confident graceful expression — classic Indian beauty",
  "an elegant Indian (South Asian) woman around 28, radiant wheatish skin that catches the light beautifully and reads bright and healthy, delicate features, subtle natural makeup, dark hair in a soft elegant style, poised aspirational expression — refined traditional Indian charm",
  "a graceful young Indian (South Asian) woman in her early 20s, glowing light-wheatish skin, kohl-lined dark eyes, minimal fresh makeup, loose soft dark waves, a serene confident look — youthful Indian elegance",
];

const BACKGROUNDS = [
  "clean bright off-white / soft ivory seamless studio backdrop, high-key premium minimalist aesthetic",
  "softly lit warm-cream interior with gentle shallow depth of field, bright and airy, never dim",
];

export function shotTypeFor(category: string): string {
  return SHOT_BY_CATEGORY[category.toLowerCase()] ?? "the piece worn naturally, jewelry as the clear hero";
}

/**
 * Build the prompt for a single COLOUR VARIANT image. Reuses the same fidelity + no-text
 * rules, but produces a clean product-only studio shot of the EXACT piece re-rendered in the
 * given colourway, so a customer can view each colour individually (Module 3).
 *
 * The reference image (passed alongside) carries the design; we change ONLY the colour.
 */
export function buildVariantImagePrompt(opts: { category: string; color: string; aspect?: ImageAspect }): string {
  const color = opts.color.trim();
  const aspect = opts.aspect ?? "1:1";
  const aspectNote =
    aspect === "4:5"
      ? "a VERTICAL PORTRAIT 4:5 aspect ratio (taller than wide, e.g. 1080x1350)"
      : "a SQUARE 1:1 aspect ratio (equal width and height, e.g. 1024x1024), suitable for a product/colour-swatch thumbnail";

  return `This is a REAL, manufactured artificial-jewellery product. Use the attached image as the EXACT product reference for the design. Generate a clean, professional e-commerce PRODUCT photograph (the jewellery by itself, no model) of THIS exact piece rendered in a "${color}" colourway.

NON-NEGOTIABLE — SAME DESIGN, ONLY THE COLOUR CHANGES:
The shape, layout, stone/bead placement, motifs, links, clasps, engraving and overall design must be IDENTICAL to the reference. Change ONLY the colour: re-render the coloured elements (enamel / meenakari work / stones / beads / thread) in "${color}" and its natural complementary shades, keeping the metal finish and craftsmanship the same. Do not redesign, restyle, add, or remove anything. It must look like the very same product offered in the "${color}" colour option.

NON-NEGOTIABLE — ABSOLUTELY NO TEXT:
Zero text of any kind — no words, letters, numbers, captions, labels, logos, watermarks, price tags, stamps, or UI. Every surface must be free of writing.

PRESENTATION: the piece laid out or standing cleanly as the single hero, sharply in focus, on a plain off-white / soft neutral seamless studio background. Soft diffused studio lighting with gentle highlights so metal catches light and stones read true and vivid. Photorealistic, high resolution, accurate colour grading, no harsh shadows.
OUTPUT FRAMING: Render the final image in ${aspectNote}, the jewellery centered with comfortable margins so nothing is cropped.
OUTPUT: A clean product photograph with NO text, NO watermark, NO logo and NO graphic overlays anywhere.`;
}

/** Build the full prompt. `index` makes subject/background deterministic per product.
 *  `subcategory` (and the category) drive BOTH the shot framing (where the piece is worn)
 *  and the model: western/fusion styles get a Western model, everything else an Indian model. */
export function buildImagePrompt(opts: {
  category: string;
  subcategory?: string;
  index?: number;
  aspect?: ImageAspect;
  /** Explicit per-subcategory choice (Pillar 12). 'auto'/undefined falls back to name detection. */
  style?: "auto" | "indian" | "western";
}): string {
  const i = opts.index ?? 0;
  const styleHint = `${opts.category} ${opts.subcategory ?? ""}`;
  const western = opts.style === "western" ? true : opts.style === "indian" ? false : isWesternStyle(styleHint);
  const pool = western ? WESTERN_SUBJECTS : SUBJECTS;
  const subject = pool[i % pool.length];
  const background = BACKGROUNDS[i % BACKGROUNDS.length];
  // Prefer the subcategory for framing (more specific: "kanchain", "maang tikka", …).
  const shot = shotTypeFor(opts.subcategory || opts.category);
  const aspect = opts.aspect ?? "4:5";
  const aspectNote =
    aspect === "1:1"
      ? "a SQUARE 1:1 aspect ratio (equal width and height, e.g. 1024x1024), suitable for a product grid thumbnail"
      : "a VERTICAL PORTRAIT 4:5 aspect ratio (taller than it is wide, e.g. 1080 wide by 1350 tall), suitable for a product-page hero — compose the model and jewelry centered with comfortable margins so nothing important is cropped at the edges";

  return `This is a REAL, manufactured jewellery product that a customer will physically receive — the design in your output MUST be a pixel-faithful reproduction of the reference image. Use the attached image as the EXACT product reference. Generate a professional, editorial-grade e-commerce photograph of a model wearing this exact piece of jewelry.

NON-NEGOTIABLE — PRODUCT FIDELITY:
The jewelry in the output must be IDENTICAL to the reference image — same metal color and finish, same gemstone cut, color, size, and placement, same engravings, links, clasps, and proportions. Do not redesign, restyle, embellish, or "improve" the piece. Treat it as a real product that must match what the customer will receive.

NON-NEGOTIABLE — ABSOLUTELY NO TEXT:
The image must contain ZERO text of any kind. No words, no letters, no numbers, no captions, no labels, no logos, no watermarks, no brand names, no price tags, no signatures, no stamps, no UI elements, no borders with writing. The background, clothing, jewelry, and every surface must be completely free of any written or typographic elements. If any text would normally appear, leave that area clean and blank.

SUBJECT: ${subject}.${western ? " A polished international look suits this western/fusion style." : " The model MUST look clearly Indian/South Asian."} Her skin must be bright, luminous and well-exposed — never dark, dull, or muddy.
SHOT TYPE: ${shot} — framed so the jewelry is the clear hero and sharply in focus.

THE JEWELLERY IS THE HERO (CRITICAL):
The piece must be the brightest, sharpest, most eye-catching element in the entire frame — prominent, large in the composition, and tack-sharp. Expose and light specifically FOR the jewellery so the metal gleams with crisp specular highlights and every stone/bead sparkles and reads vivid and true. The piece must visibly POP against the skin and clothing with clear contrast and separation — it should be the first thing the eye lands on. Do not let the model, hair, or background draw attention away from the jewellery.

STYLING & WARDROBE: minimal, neutral clothing (soft beige, ivory, blush, or muted tone) with a simple neckline that showcases the piece. No competing jewelry or accessories. No printed text, slogans, or graphics on the clothing.
LIGHTING: bright, clean, high-key studio beauty lighting — soft and flattering on the skin so the model reads luminous, with crisp directional key light on the jewellery to make metal catch light and gemstones sparkle. No dark, dim, or muddy tones; no heavy shadows on the face; no blown-out highlights on the piece. Colour-accurate so metal and stones read true and rich.
BACKGROUND & MOOD: ${background}. Calm, aspirational, trustworthy — luxury Indian brand feel. The background must be plain, bright and free of any text, signage, or writing.
TECHNICAL: photorealistic, shot on a 85mm lens look, shallow depth of field with the jewelry tack-sharp, high resolution, natural skin texture (real pores, no plastic airbrushing), professional color grading.
OUTPUT FRAMING: Render the final image in ${aspectNote}.
OUTPUT: A clean photograph with NO text, NO watermark, NO logo, and NO graphic overlays anywhere.`;
}
