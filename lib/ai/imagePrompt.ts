/**
 * lib/ai/imagePrompt.ts — builds the exact, locked image-generation prompt per product.
 * Shot type and subject are chosen by category; the rest of the prompt is the client's
 * non-negotiable fidelity + no-text + technical spec, verbatim.
 */
export type ImageAspect = "4:5" | "1:1";

const SHOT_BY_CATEGORY: Record<string, string> = {
  necklace: "close-up on the décolletage and neckline",
  bracelet: "the hand and wrist",
  anklet: "the ankle and foot, seated or mid-step",
  earrings: "the ear and jawline, slight three-quarter turn",
  ring: "the hand, fingers gently relaxed",
};

// A small rotation of tasteful, diverse subjects (deterministic per index).
const SUBJECTS = [
  "a 28-year-old woman with warm medium skin tone, natural minimal makeup, soft loose hair, relaxed confident expression",
  "a 32-year-old woman with deep skin tone, natural minimal makeup, hair pulled back softly, calm aspirational expression",
  "a 25-year-old woman with light-medium skin tone, dewy natural makeup, loose waves, serene confident expression",
];

const BACKGROUNDS = [
  "clean off-white seamless studio backdrop, premium minimalist aesthetic",
  "soft warm-toned interior with shallow depth of field",
];

export function shotTypeFor(category: string): string {
  return SHOT_BY_CATEGORY[category.toLowerCase()] ?? "the piece worn naturally, jewelry as the clear hero";
}

/** Build the full prompt. `index` makes subject/background deterministic per product. */
export function buildImagePrompt(opts: {
  category: string;
  index?: number;
  aspect?: ImageAspect;
}): string {
  const i = opts.index ?? 0;
  const subject = SUBJECTS[i % SUBJECTS.length];
  const background = BACKGROUNDS[i % BACKGROUNDS.length];
  const shot = shotTypeFor(opts.category);
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

SUBJECT: ${subject}.
SHOT TYPE: ${shot} — framed so the jewelry is the clear hero and sharply in focus.
STYLING & WARDROBE: minimal, neutral clothing (soft beige, white, or muted tone) that does not compete with the jewelry. No other jewelry or accessories in frame unless they match the piece. No printed text, slogans, or graphics on the clothing.
LIGHTING: soft, diffused studio lighting with gentle directional highlights to make metal catch light and gemstones sparkle, no harsh shadows, no blown-out highlights on the piece. Color-accurate so the metal and stones read true.
BACKGROUND & MOOD: ${background}. Calm, aspirational, trustworthy — luxury brand feel. The background must be plain and free of any text, signage, or writing.
TECHNICAL: photorealistic, shot on a 85mm lens look, shallow depth of field with the jewelry tack-sharp, high resolution, natural skin texture (real pores, no plastic airbrushing), professional color grading.
OUTPUT FRAMING: Render the final image in ${aspectNote}.
OUTPUT: A clean photograph with NO text, NO watermark, NO logo, and NO graphic overlays anywhere.`;
}
