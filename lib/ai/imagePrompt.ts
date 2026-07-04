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

/** Plain-English statement of WHAT the piece is and WHERE it's worn — injected into every
 *  generation prompt so Gemini frames a necklace as a necklace, a kanchain on the hair, etc.,
 *  using the product's real category instead of guessing from the reference alone. */
export function categoryIdentity(category: string, subcategory?: string): string {
  const sub = (subcategory ?? "").trim();
  const cat = (category ?? "").trim();
  const where = SHOT_BY_CATEGORY[sub.toLowerCase()] ?? SHOT_BY_CATEGORY[cat.toLowerCase()];
  const label = (sub || cat || "piece of jewellery").trim();
  return where ? `It is a ${label}, worn at ${where}` : `It is a ${label}`;
}

/**
 * Build the prompt for a single COLOUR VARIANT image. Reuses the same fidelity + no-text
 * rules, but produces a clean product-only studio shot of the EXACT piece re-rendered in the
 * given colourway, so a customer can view each colour individually (Module 3).
 *
 * The reference image (passed alongside) carries the design; we change ONLY the colour.
 */
export function buildVariantImagePrompt(opts: { category: string; color: string; productName?: string; subcategory?: string; aspect?: ImageAspect }): string {
  const color = opts.color.trim();
  const aspect = opts.aspect ?? "1:1";
  const identity = categoryIdentity(opts.category, opts.subcategory);
  const productLine = opts.productName?.trim() ? `"${opts.productName.trim()}"` : "this piece";
  const aspectNote =
    aspect === "4:5"
      ? "a VERTICAL PORTRAIT 4:5 aspect ratio (taller than wide, e.g. 1080x1350)"
      : "a SQUARE 1:1 aspect ratio (equal width and height, e.g. 1024x1024), suitable for a product/colour-swatch thumbnail";

  return `This is a REAL, manufactured artificial-jewellery product (${productLine}, a ${opts.subcategory || opts.category}). ${identity}. Use the attached image as the EXACT reference. Generate a clean, professional e-commerce PRODUCT photograph (the jewellery by itself, no model) of THIS exact piece.

NON-NEGOTIABLE — REPRODUCE THE REFERENCE EXACTLY; DO NOT CHANGE OR INVENT THE COLOUR:
Reproduce the piece EXACTLY as it appears in the reference photo — the SAME colour(s), stones, beads, enamel / meenakari, metal finish, cuts, motifs, links, clasps, drops and proportions. Take the colour and EVERY detail directly FROM the reference image. DO NOT recolour, restyle, redesign, add, remove or "improve" anything, and do NOT invent, guess or force any colour — the piece's colour is whatever the reference already shows${color ? ` (this is the "${color}" option)` : ""}. NO HALLUCINATION: never add stones, motifs, drops or elements that are not present in the reference. It must look identical to the reference, just cleanly and sharply photographed.

NON-NEGOTIABLE — ABSOLUTELY NO TEXT:
Zero text of any kind — no words, letters, numbers, captions, labels, logos, watermarks, price tags, stamps, or UI. Every surface must be free of writing.

PRESENTATION: the piece laid out or standing cleanly as the single hero, sharply in focus, on a plain off-white / soft neutral seamless studio background. Soft diffused studio lighting with gentle highlights so metal catches light and stones read true and vivid. Photorealistic, high resolution, accurate colour grading, no harsh shadows. MAXIMUM SHARPNESS — every stone, bead, cut and facet must be tack-sharp and clearly defined (each cut visible), like a high-end macro product photo, with no blur or softening of detail.
OUTPUT FRAMING: Render the final image in ${aspectNote}, the jewellery centered with comfortable margins so nothing is cropped.
OUTPUT: A clean product photograph with NO text, NO watermark, NO logo and NO graphic overlays anywhere.`;
}

/**
 * Build the prompt for a SURGICAL "fix a detail" edit. The owner marks the wrong region and types
 * what it should be; we edit ONLY that area and re-anchor it to the ORIGINAL raw reference so the
 * corrected detail matches the real manufactured piece — everything else stays pixel-identical.
 */
export function buildRefinePrompt(opts: {
  instruction: string;
  /** true when the original raw product photo is supplied as a reference for the true design. */
  hasReference: boolean;
  /** true when the image being edited carries a visible marker/outline around the target area. */
  hasMarker: boolean;
  productName?: string;
  typeLabel?: string;
}): string {
  const piece = (opts.typeLabel || "jewellery piece").trim();
  const named = opts.productName?.trim() ? ` ("${opts.productName.trim()}")` : "";
  return [
    `You are retouching an existing e-commerce photograph of a REAL, manufactured ${piece}${named}. This is a precise LOCAL edit, NOT a new image.`,
    `INPUT IMAGES (in order):`,
    opts.hasMarker
      ? `  • IMAGE 1 — the photo to edit, with a bright outline/mark drawn around the EXACT area to change. The mark only shows you WHERE to edit; do NOT render the mark in your output.`
      : `  • IMAGE 1 — the photo to edit.`,
    `  • IMAGE 2 — the same generated photo, clean (no mark).`,
    opts.hasReference ? `  • IMAGE 3 — the ORIGINAL raw product photo: the GROUND TRUTH for the piece's true design (real shape, stones, beads, colour, proportions).` : ``,
    ``,
    `THE EDIT:`,
    opts.hasMarker
      ? `Change ONLY the marked area. Leave every pixel outside the mark exactly as it is.`
      : `Change ONLY the specific detail described below. Leave the rest of the image exactly as it is.`,
    `Owner's correction (do exactly this): "${opts.instruction.trim()}"`,
    opts.hasReference
      ? `Reproduce the corrected detail to MATCH THE ORIGINAL REFERENCE (IMAGE 3) exactly — its real shape, stone/bead layout, colour and proportions. Do not invent anything not present in the reference.`
      : `Keep the correction consistent with the rest of the piece; do not invent new elements.`,
    ``,
    `KEEP EVERYTHING ELSE PIXEL-IDENTICAL: the model, face crop, pose, hands, framing, zoom, lighting, background, colours and all other parts of the jewellery must remain exactly as in IMAGE 1. Do NOT re-pose, re-light, re-crop, recolour or regenerate the whole scene. Make the smallest change that satisfies the correction.`,
    `ABSOLUTELY NO TEXT, watermark, logo, or editing mark anywhere in the final image.`,
    `Output the COMPLETE edited photograph at the same composition and aspect ratio as IMAGE 1.`,
  ].filter(Boolean).join("\n");
}

// ===================== AI Photography Studio (Product Photos) =====================
export type ShotType =
  | "hero" | "model" | "closeup" | "lifestyle" | "side" | "angle45" | "back" | "detail"
  | "catalog_white" | "transparent" | "social_crop" | "branded_stand"
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
  branded_stand: { label: "On Stand", frame: "the jewellery displayed ALONE on an elegant matte jewellery display stand / bust (a necklace draped on a neck bust, earrings on an ear stand, a bangle on a T-bar, a ring on a ring cone), premium boutique presentation on a soft neutral studio backdrop, tasteful soft shadow", aspect: "1:1", productOnly: true, extra: "Leave a clean, empty margin of space at the BOTTOM of the frame (no jewellery there) so a brand wordmark can be placed under the piece afterwards." },
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
  category: string; subcategory?: string; productName?: string; variantColor?: string; shotType: ShotType; settings?: StudioSettings;
  detected?: { category?: string; material?: string; style?: string; attributes?: string[] } | null;
  index?: number; style?: "auto" | "indian" | "western";
  /** When true, recolour the piece to the variant's colour NAME. Default false = the reference PHOTO
   *  wins (reproduce its true colour), so a green photo stays green even if the label says "Black". */
  forceColour?: boolean;
}): { prompt: string; aspect: ImageAspect } {
  const meta = SHOT_META[opts.shotType] ?? SHOT_META.hero;
  const i = opts.index ?? 0;
  const s = opts.settings ?? {};
  const styleHint = `${opts.category} ${opts.subcategory ?? ""} ${opts.detected?.style ?? ""}`;
  const western = opts.style === "western" ? true : opts.style === "indian" ? false : isWesternStyle(styleHint);
  const subject = (western ? WESTERN_SUBJECTS : SUBJECTS)[i % 2];
  const background = s.background?.trim() || BACKGROUNDS[i % BACKGROUNDS.length];
  // Where the piece is worn is decided by the product's OWN category/subcategory only.
  const shot = shotTypeFor(opts.subcategory || opts.category);
  const identity = categoryIdentity(opts.category, opts.subcategory);
  const typeLabel = (opts.subcategory || opts.category || "piece of jewellery").trim();
  const productLine = opts.productName?.trim() ? `"${opts.productName.trim()}"` : "this piece";
  const worn = !meta.productOnly; // stand / catalog / transparent / remove_bg = product-only, NEVER on a person
  const colour = opts.variantColor?.trim();
  const aspectNote = meta.aspect === "1:1"
    ? "a SQUARE 1:1 aspect ratio (e.g. 1024x1024)"
    : "a VERTICAL PORTRAIT 4:5 aspect ratio (e.g. 1080x1350), comfortable margins so nothing is cropped";
  // PRODUCT IDENTITY — the single most important instruction. It fixes WHAT the piece is and, per shot
  // type, whether it is worn (model shots) or shown alone on a stand (product-only shots) — so a
  // necklace is a necklace, and a "stand" shot is never rendered on a human.
  const identityBlock = worn
    ? `PRODUCT IDENTITY (highest priority — obey exactly): The piece is ${productLine}, a ${typeLabel}. ${identity}. You MUST photograph, place and frame it AS a ${typeLabel}, worn in the correct location for that jewellery type — NEVER on a different body part and NEVER as a different category of jewellery (e.g. do not render a necklace as a bracelet/bangle, or earrings as a ring). If any detected/reference cue disagrees with this, IGNORE it and follow this identity.`
    : `PRODUCT IDENTITY (highest priority — obey exactly): The piece is ${productLine}, a ${typeLabel}. This is a PRODUCT-ONLY shot: show the jewellery BY ITSELF — absolutely NO model, NO person, NO hands, NO body parts, and NOT worn. Present it on an appropriate display prop for a ${typeLabel} (a necklace on a neck bust/stand, earrings on an ear stand, a bangle/bracelet on a T-bar, a ring on a ring cone) or laid flat, whichever suits a ${typeLabel}. Keep it unmistakably a ${typeLabel}.`;
  // Variant colourway. Default: the reference PHOTO is the source of truth — reproduce its actual
  // colour exactly (a green photo stays green even if the label says "Black"). Only when the owner
  // explicitly asks to recolour (forceColour) do we repaint the piece to the colour NAME.
  const colourBlock = colour
    ? (opts.forceColour
        ? `\nVARIANT COLOURWAY (recolour requested): This is the "${colour}" option. Repaint the piece's colour to ${colour} — the metal tone, stones, beads and enamel must read clearly as ${colour} — while keeping the EXACT same design, shape, stone layout and proportions as the reference.`
        : `\nVARIANT COLOURWAY: This is the "${colour}" option, but the REFERENCE PHOTO is the source of truth — reproduce the piece's colour EXACTLY as it appears in the reference. Do NOT recolour to match the label; if the photo and the "${colour}" label disagree, follow the PHOTO.`)
    : "";
  // Only material/style/attribute FLAVOUR from vision detection is surfaced — the detected CATEGORY is
  // deliberately dropped so a vision mis-read can never override the identity above.
  const flavour = [opts.detected?.material, opts.detected?.style, ...(opts.detected?.attributes ?? [])].filter(Boolean).join(", ");
  const detectedNote = flavour ? `\nSURFACE QUALITIES (material/style flavour only — do NOT change the piece's type): ${flavour}.` : "";
  const subjectBlock = meta.productOnly
    ? `PRESENTATION: ${meta.frame}. The ${typeLabel} is the single hero, sharply in focus, on ${background}. NO model, NO person, NO hands — product only.`
    : `SUBJECT (a display stand for the jewellery — keep her minimal, face not featured): ${subject}.${western ? " Polished international look." : " Clearly Indian/South Asian."} Skin bright, luminous, well-exposed.
SHOT TYPE: ${meta.frame} — worn at ${shot} (this is a ${typeLabel}).
${FRAMING}
BACKGROUND & MOOD: ${background}. ${s.mood?.trim() || "Calm, aspirational, luxury Indian brand feel."}`;

  const prompt = `${FIDELITY}

${identityBlock}${colourBlock}${detectedNote}

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
  /** The product's real name, e.g. "Kundan Necklace" — anchors Gemini on the right piece. */
  productName?: string;
  /** Extra known specs (colours, material, tags) pulled from the product to guide the render. */
  details?: string[];
  /** Owner's own 1–2 keywords typed at generation time (e.g. "polki, peacock motif") — highest priority. */
  keywords?: string;
}): string {
  const i = opts.index ?? 0;
  const styleHint = `${opts.category} ${opts.subcategory ?? ""} ${opts.productName ?? ""}`;
  const western = opts.style === "western" ? true : opts.style === "indian" ? false : isWesternStyle(styleHint);
  const pool = western ? WESTERN_SUBJECTS : SUBJECTS;
  const subject = pool[i % pool.length];
  const background = BACKGROUNDS[i % BACKGROUNDS.length];
  // Frame by the most specific known type (subcategory → category).
  const shot = shotTypeFor(opts.subcategory || opts.category);
  const identity = categoryIdentity(opts.category, opts.subcategory);
  const productLine = opts.productName?.trim() ? `"${opts.productName.trim()}"` : "this piece";
  const detailLine = opts.details && opts.details.length ? ` Known specifications: ${opts.details.slice(0, 8).join(", ")}.` : "";
  const keywordLine = opts.keywords?.trim() ? ` OWNER-SPECIFIED DETAILS (must be accurately shown): ${opts.keywords.trim()}.` : "";
  const aspect = opts.aspect ?? "4:5";
  const aspectNote =
    aspect === "1:1"
      ? "a SQUARE 1:1 aspect ratio (equal width and height, e.g. 1024x1024), suitable for a product grid thumbnail"
      : "a VERTICAL PORTRAIT 4:5 aspect ratio (taller than it is wide, e.g. 1080 wide by 1350 tall), suitable for a product-page hero — compose the model and jewelry centered with comfortable margins so nothing important is cropped at the edges";

  return `This is a REAL, manufactured jewellery product that a customer will physically receive — the design in your output MUST be a pixel-faithful reproduction of the reference image. Use the attached image as the EXACT product reference. Generate a professional, editorial-grade e-commerce photograph of a model wearing this exact piece of jewelry.

PRODUCT IDENTITY (use this to frame the shot correctly): The piece is ${productLine}, categorised as ${opts.subcategory || opts.category}. ${identity}. Photograph and style it AS a ${opts.subcategory || opts.category} — worn and framed in the correct place for that jewellery type, never as a different category of jewellery.${detailLine}${keywordLine}

NON-NEGOTIABLE — PRODUCT FIDELITY (the owner's #1 rule — CHANGE AS LITTLE AS POSSIBLE):
The jewellery in the output must be IDENTICAL to the reference image — same shape, same metal colour and finish, same gemstone/bead CUT, colour, size and exact placement, same enamel/meenakari, engravings, links, tassels, drops, clasps and proportions. Keep EVERY stone, bead, cut and facet exactly as in the reference — do NOT add, remove, resize, restyle, rearrange, or RECOLOUR anything, and do not "improve" the piece. If in doubt, copy the reference exactly. It must match what the customer physically receives. NO HALLUCINATION: never invent, guess or add any stone, motif, drop, colour or element that is not clearly visible in the reference — reproduce ONLY what is actually there.

MAXIMUM SHARPNESS & DETAIL (critical — the owner wants every cut visible):
Render the jewellery ultra-sharp, crisp and high-resolution so EACH individual stone, bead, facet, cut and engraving is clearly defined and separated — tack-sharp, no blur, no softening, no smudging or melting of detail on the piece. Fine details must read crisply, like a high-end macro product photograph.

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
