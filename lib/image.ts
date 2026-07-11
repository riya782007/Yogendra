/**
 * Client-side image compression. Resizes a photo to a max dimension and re-encodes
 * as JPEG so a multi-MB phone shot becomes a few hundred KB before upload — fast,
 * and safely under the server-action body limit. Falls back to the original on error.
 *
 * `fitRatio` (e.g. 4/5 for product cards): if the image's aspect ratio differs from the target,
 * it is PADDED (letterboxed) to that ratio with a sampled background colour — never cropped. This
 * guarantees the storefront's object-cover shows the WHOLE image, so no jewellery is ever cut off.
 */
// fitRatio defaults to 4/5 (the product-card ratio); pass 0 to disable (e.g. wide promo banners).
export async function compressImage(file: File, maxDim = 1600, quality = 0.82, fitRatio: number = 4 / 5): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const srcRatio = w / h;

    const canvas = document.createElement("canvas");
    let padded = false;

    if (fitRatio && Math.abs(srcRatio - fitRatio) > 0.02) {
      // Ratio mismatch → letterbox to the target ratio (add bars), NEVER crop the jewellery out.
      let cw: number, ch: number;
      if (srcRatio > fitRatio) { cw = w; ch = Math.round(w / fitRatio); }   // too wide → pad top & bottom
      else { ch = h; cw = Math.round(h * fitRatio); }                        // too tall → pad left & right
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      // Sample a corner pixel for the pad colour so the bars blend with the photo's own background.
      let bg = "#faf6ef";
      try {
        const t = document.createElement("canvas"); t.width = w; t.height = h;
        const tc = t.getContext("2d");
        if (tc) { tc.drawImage(bitmap, 0, 0, w, h); const p = tc.getImageData(1, 1, 1, 1).data; bg = `rgb(${p[0]},${p[1]},${p[2]})`; }
      } catch { /* keep the ivory default */ }
      ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(bitmap, Math.round((cw - w) / 2), Math.round((ch - h) / 2), w, h);
      padded = true;
    } else {
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, w, h);
    }

    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob) return file;
    // Only skip the re-encode when NOT padding — a padded image must always replace the original.
    if (!padded && blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
