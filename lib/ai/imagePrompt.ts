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

// ===================== AI Photography Studio (Product Photos) =====================
export type ShotType =
  | "hero" | "model" | "closeup" | "lifestyle" | "side" | "angle45" | "back" | "detail"
  | "catalog_white" | "transparent" | "social_crop"
  | "enhance_shadows" | "enhance_sparkle" | "remove_bg" | "upscale";

export const SHOT_META: Record<ShotType, { label: string; frame: string; aspect: ImageAspect; productOnly?: boolean; extra?: string }> = {
  hero:          { label: "Hero", frame: "a close, tightly-cropped editorial beauty shot of the worn piece filling the frame as the unmistakable hero — the model's face cropped out or reduced to a soft out-of-focus edge", aspect: "4:5" },
  model:         { label: "Model Shot", frame: "a close cropped shot of the piece worn on the body, the jewellery large and dominant in the frame, the model's face mostly out of frame", aspect: "4:5" },
  closeup:       { label: "Close-up", frame: "an extreme macro close-up of the jewellery on the skin, every stone tack-sharp", aspect: "1:1" },
  lifestyle:     { label: "Lifestyle", frame: "an aspirational close lifestyle crop in a soft real environment, the worn jewellery filling the frame, the face incidental and out of focus", aspect: "4:5" },
  side:          { label: "Side View", frame: "a close side-on crop of the worn piece from the side, jewellery dominant and tack-sharp, face cropped", aspect: "4:5" },
  angle45:       { label: "45°", frame: "a close 45-degree crop of the worn piece, jewellery large and tack-sharp, face minimal/cropped", aspect: "4:5" },
  back:          { label: "Back View", frame: "a back view showing the clasp / nape drape of the piece", aspect: "4:5" },
  detail:        { label: "Detail Shot", frame: "a detail shot isolating the craftsmanship — clasp, motif and stone setting", aspect: "1:1" },
  catalog_white: { label: "Catalog White", frame: "a clean catalog product shot of the jewellery ALONE on a pure white seamless background", aspect: "1:1", productOnly: true },
  transparent:   { label: "Transparent PNG", frame: "the jewellery ALONE perfectly isolated on a flat pure-white background with crisp clean edges, ready to cut out", aspect: "1:1", productOnly: true },
  social_crop:   { label: "Social Crop", frame: "a square social-media crop, model and jewellery centred with comfortable breathing room", aspect: "1:1" },
  enhance_shadows: { label: "Add Shadows", frame: "a model wearing the piece", aspect: "4:5", extra: "Add natural, soft contact shadows and gentle depth so the piece feels grounded and three-dimensional." },
  enhance_sparkle: { label: "Enhance Sparkle", frame: "a model wearing the piece", aspect: "4:5", extra: "Maximise gemstone brilliance and sparkle with crisp specular highlights; make metal gleam." },
  remove_bg:     { label: "Remove Background", frame: "the jewellery ALONE isolated on a pure white seamless background, crisp clean edges", aspect: "1:1", productOnly: true, extra: "Remove any background entirely — flat pure white only." },
  upscale:       { label: "Upscale", frame: "a model wearing the piece", aspect: "4:5", extra: "Render at ultra-high resolution with maximum sharpness, fine detail and clean noise-free output." },
};

export type StudioSettings = {
  lighting?: string; modelStyle?: string; background?: string; focus?: string;
  ethnicity?: string; age?: string; skinTone?: string; hair?: string; makeup?: string;
  pose?: string; cameraAngle?: string; lens?: string; mood?: string; luxury?: string; emphasis?: string;
};

const FIDELITY = `This is a REAL, manufactured jewellery product the customer will physically receive — the design in your output MUST be a pixel-faithful reproduction of the attached reference image. Same metal colour & finish, same gemstone cut/colour/size/placement, same engravings, links, clasps and proportions. Do NOT redesign, restyle, embellish or "improve" the piece.`;
const NO_TEXT = `ABSOLUTELY NO TEXT of any kind anywhere — no words, letters, numbers, captions, labels, logos, watermarks, price tags or UI. Every surface must be free of writing.`;

// The client's #1 art-direction rule: shoot CLOSE, crop tight on the piece, the model's face is
// NOT the subject. This block is injected into every model (worn) prompt so the jewellery — not the
// face — fills the frame, the way a real jewellery advertisement is shot.
const FRAMING = `FRAMING & CROP — THE MOST IMPORTANT RULE:
Shoot CLOSE and TIGHT on the exact body area where the piece is worn, as if using a macro / 100mm product-beauty lens. The jewellery must fill roughly 50–70% of the frame, large, dominant and edge-to-edge, with EVERY stone, bead, link, motif and clasp clearly visible so the buyer sees the complete piece authentically — nothing cut off, nothing tiny or far away. DO NOT shoot from a distance and DO NOT make a full-body or head-and-shoulders portrait.
The model is only a stand to display the jewellery: her FACE IS NOT THE SUBJECT. Crop the face out of frame, or show at most a small, soft, out-of-focus sliver at the very edge — never centre, feature, or sharply render the face, eyes or expression. Show only the minimum skin/body needed to present the piece naturally (e.g. just the wrist & hand for a bracelet, the neckline & collarbone for a necklace, the earlobe & jaw for earrings). The piece is the single hero, tack-sharp and brilliantly lit.`;

function settingsBlock(s: StudioSettings): string {
  const lines: string[] = [];
  const add = (k: string, v?: string) => { if (v && v.trim()) lines.push(`- ${k}: ${v.trim()}`); };
  add("Model ethnicity", s.ethnicity); add("Model age", s.age); add("Skin tone", s.skinTone);
  add("Hair", s.hair); add("Makeup", s.makeup); add("Pose", s.pose);
  add("Camera angle", s.cameraAngle); add("Lens", s.lens); add("Luxury level", s.luxury);
  add("Jewellery emphasis", s.emphasis); add("Model style", s.modelStyle);
  return lines.length ? `\nART-DIRECTION OVERRIDES (follow exactly):\n${lines.join("\n")}` : "";
}

/** Build a studio prompt for a specific SHOT TYPE with art-direction overrides + detected attrs. */
export function buildStudioPrompt(opts: {
  category: string; subcategory?: string; shotType: ShotType; settings?: StudioSettings;
  detected?: { category?: string; material?: string; style?: string; attributes?: string[] } | null;
  index?: number; style?: "auto" | "indian" | "western";
}): { prompt: string; aspect: ImageAspect } {
  const meta = SHOT_META[opts.shotType] ?? SHOT_META.hero;
  const i = opts.index ?? 0;
  const s = opts.settings ?? {};
  const styleHint = `${opts.category} ${opts.subcategory ?? ""} ${opts.detected?.style ?? ""}`;
  const western = opts.style === "western" ? true : opts.style === "indian" ? false : isWesternStyle(styleHint);
  const subject = (western ? WESTERN_SUBJECTS : SUBJECTS)[i % 2];
  const background = s.background?.trim() || BACKGROUNDS[i % BACKGROUNDS.length];
  const shot = shotTypeFor(opts.subcategory || opts.category);
  const aspectNote = meta.aspect === "1:1"
    ? "a SQUARE 1:1 aspect ratio (e.g. 1024x1024)"
    : "a VERTICAL PORTRAIT 4:5 aspect ratio (e.g. 1080x1350), comfortable margins so nothing is cropped";
  const detectedNote = opts.detected
    ? `\nDETECTED PIECE: ${[opts.detected.category, opts.detected.material, opts.detected.style, ...(opts.detected.attributes ?? [])].filter(Boolean).join(", ")}.`
    : "";
  const subjectBlock = meta.productOnly
    ? `PRESENTATION: the jewellery laid out / standing cleanly as the single hero, sharply in focus, on ${background}. No model, no hands.`
    : `SUBJECT (a display stand for the jewellery — keep her minimal, face not featured): ${subject}.${western ? " Polished international look." : " Clearly Indian/South Asian."} Skin bright, luminous, well-exposed.
SHOT TYPE: ${meta.frame} — worn at ${shot}.
${FRAMING}
BACKGROUND & MOOD: ${background}. ${s.mood?.trim() || "Calm, aspirational, luxury Indian brand feel."}`;

  const prompt = `${FIDELITY}
${detectedNote}

${subjectBlock}

THE JEWELLERY IS THE HERO: it must be the brightest, sharpest, most eye-catching element — light and expose FOR the piece so metal gleams and every stone sparkles and reads vivid and true.
LIGHTING: ${s.lighting?.trim() || "bright, clean, high-key studio beauty lighting"}; crisp directional key on the jewellery; no dark/muddy tones, no heavy face shadows, no blown highlights.
TECHNICAL: photorealistic, ${s.lens?.trim() || "85mm lens look"}, ${s.focus?.trim() || "shallow depth of field, jewellery tack-sharp"}, high resolution, natural skin texture, professional colour grading.${meta.extra ? `\nENHANCEMENT: ${meta.extra}` : ""}${settingsBlock(s)}

${NO_TEXT}
OUTPUT FRAMING: render in ${aspectNote}.
OUTPUT: a clean photograph with NO text, NO watermark, NO logo and NO graphic overlays.`;
  return { prompt, aspect: meta.aspect };
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

SUBJECT (a display stand for the jewellery only — her face is NOT the subject and must not be featured): ${subject}.${western ? " A polished international look suits this western/fusion style." : " The model MUST look clearly Indian/South Asian."} Her skin must be bright, luminous and well-exposed — never dark, dull, or muddy.
SHOT TYPE: ${shot}.

${FRAMING}

THE JEWELLERY IS THE HERO (CRITICAL):
The piece must be the brightest, sharpest, most eye-catching element in the entire frame — prominent, large in the composition, and tack-sharp. Expose and light specifically FOR the jewellery so the metal gleams with crisp specular highlights and every stone/bead sparkles and reads vivid and true. The piece must visibly POP against the skin and clothing with clear contrast and separation — it should be the first thing the eye lands on. Do not let the model, hair, or background draw attention away from the jewellery.

STYLING & WARDROBE: minimal, neutral clothing (soft beige, ivory, blush, or muted tone) with a simple neckline that showcases the piece. No competing jewelry or accessories. No printed text, slogans, or graphics on the clothing.
LIGHTING: bright, clean, high-key studio beauty lighting — soft and flattering on the skin so the model reads luminous, with crisp directional key light on the jewellery to make metal catch light and gemstones sparkle. No dark, dim, or muddy tones; no heavy shadows on the face; no blown-out highlights on the piece. Colour-accurate so metal and stones read true and rich.
BACKGROUND & MOOD: ${background}. Calm, aspirational, trustworthy — luxury Indian brand feel. The background must be plain, bright and free of any text, signage, or writing.
TECHNICAL: photorealistic, shot on a 85mm lens look, shallow depth of field with the jewelry tack-sharp, high resolution, natural skin texture (real pores, no plastic airbrushing), professional color grading.
OUTPUT FRAMING: Render the final image in ${aspectNote}.
OUTPUT: A clean photograph with NO text, NO watermark, NO logo, and NO graphic overlays anywhere.`;
}
