"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { getShotPromptAction, setProductThumbnailAction } from "@/app/actions/studio";
import { addVariantImageAction } from "@/app/actions/variants";
import { uploadStorefrontPhotoAction } from "@/app/actions/media";
import { compressImage } from "@/lib/image";

type Variant = { id: string; sku: string; color: string | null; image: string | null; images?: string[] };
type Data = {
  product: { id: string; sku: string; name: string; category?: { name?: string; slug?: string } };
  images: { id: string; path: string; sort: number; kind?: string | null }[];
  variants?: Variant[];
  thumbnailPath?: string | null;
};

const GEMINI = "https://gemini.google.com/app";

/**
 * Gemini-powered photo studio (no image API, no billing). For EVERY variant the owner makes a MODEL
 * shot and a STAND shot: click → the tailored prompt is copied and Gemini opens → upload the raw
 * colour photo in Gemini → download the result → upload it back here. Then pick the thumbnail.
 */
export function GeminiStudio({ data }: { data: Data }) {
  const router = useRouter();
  const { toast } = useToast();
  const p = data.product;
  const variants = data.variants ?? [];
  const [busy, setBusy] = useState("");
  // Per (variantId|shotType) upload input refs.
  const upRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function copyPromptAndOpen(variantId: string | null, shotType: "model" | "branded_stand", label: string) {
    setBusy(`${variantId ?? "p"}-${shotType}`);
    try {
      const r = await getShotPromptAction({ productId: p.id, variantId, shotType });
      if (!r.ok || !r.prompt) { toast(r.error || "Could not build the prompt", "error"); return; }
      try { await navigator.clipboard.writeText(r.prompt); } catch { /* clipboard may be blocked; still open */ }
      window.open(GEMINI, "_blank", "noopener");
      toast(`${label} prompt copied — in Gemini: paste (Ctrl+V), attach your photo, send.`, "success");
    } finally { setBusy(""); }
  }

  async function uploadToVariant(variantId: string, file: File | undefined) {
    if (!file) return;
    setBusy(`up-${variantId}`);
    try {
      const small = await compressImage(file);
      const fd = new FormData(); fd.set("id", variantId); fd.set("product_sku", p.sku); fd.append("images", small);
      const r = await addVariantImageAction(fd);
      if (r.ok) { toast("Uploaded to this colour ✓", "success"); router.refresh(); } else toast(r.error ?? "Upload failed", "error");
    } catch { toast("Upload failed — try a smaller photo", "error"); }
    finally { setBusy(""); }
  }

  async function uploadToProduct(file: File | undefined) {
    if (!file) return;
    setBusy("up-product");
    try {
      const small = await compressImage(file);
      const fd = new FormData(); fd.set("sku", p.sku); fd.set("image", small);
      const r = await uploadStorefrontPhotoAction(fd);
      if (r.ok) { toast("Published to the site ✓", "success"); router.refresh(); } else toast(r.error ?? "Upload failed", "error");
    } catch { toast("Upload failed — try a smaller photo", "error"); }
    finally { setBusy(""); }
  }

  async function setThumb(url: string) {
    setBusy("thumb");
    try {
      const r = await setProductThumbnailAction({ productId: p.id, url });
      if (r.ok) { toast("Set as thumbnail — now leads the product ✓", "success"); router.refresh(); }
      else toast("Could not set thumbnail", "error");
    } finally { setBusy(""); }
  }

  const isThumb = (url: string) => data.thumbnailPath === url;
  const promptBtn = "px-3 py-1.5 rounded-full bg-ink text-white text-xs font-medium hover:bg-ink/90 disabled:opacity-50";
  const upBtn = "px-3 py-1.5 rounded-full border border-emerald text-emerald-dark text-xs font-medium hover:bg-emerald-mist disabled:opacity-50";

  /** One variant (or the product itself) with its Model + Stand slots and its uploaded images. */
  function Row({ variantId, title, sub, imgs }: { variantId: string | null; title: string; sub: string; imgs: string[] }) {
    const kModel = `${variantId ?? "p"}-model`, kStand = `${variantId ?? "p"}-branded_stand`, kUp = `${variantId ?? "p"}-up`;
    return (
      <div className="bg-white rounded-2xl border border-sand shadow-card p-4">
        <div className="flex items-center justify-between mb-2">
          <div><p className="font-medium text-ink">{title}</p><p className="text-[11px] text-muted">{sub}</p></div>
        </div>

        {/* Uploaded images for this variant — pick any as the product thumbnail */}
        {imgs.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
            {imgs.map((u, i) => (
              <div key={i} className="relative shrink-0 w-20">
                <img src={u} alt="" className={`w-20 h-24 object-cover rounded-lg border ${isThumb(u) ? "border-emerald ring-2 ring-emerald" : "border-sand"}`} />
                <button onClick={() => setThumb(u)} disabled={busy === "thumb"} className={`mt-1 w-full text-[10px] rounded ${isThumb(u) ? "bg-emerald text-white" : "bg-ink/5 hover:bg-ink/10 text-ink"}`}>{isThumb(u) ? "★ Thumbnail" : "Set thumbnail"}</button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => copyPromptAndOpen(variantId, "model", "Model")} disabled={busy === kModel} className={promptBtn}>{busy === kModel ? "…" : "✦ Model prompt → Gemini"}</button>
          <button onClick={() => copyPromptAndOpen(variantId, "branded_stand", "Stand")} disabled={busy === kStand} className={promptBtn}>{busy === kStand ? "…" : "✦ Stand prompt → Gemini"}</button>
          <input ref={(el) => { upRefs.current[kUp] = el; }} type="file" accept="image/*" className="hidden"
            onChange={(e) => variantId ? uploadToVariant(variantId, e.target.files?.[0]) : uploadToProduct(e.target.files?.[0])} />
          <button onClick={() => upRefs.current[kUp]?.click()} disabled={busy === `up-${variantId ?? "product"}`} className={upBtn}>⬆ Upload result</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* How it works */}
      <div className="rounded-2xl border border-emerald/30 bg-emerald-mist/40 p-4 mb-5 text-sm text-ink">
        <p className="font-medium mb-1">Make a Model + Stand photo for every colour — free, on Gemini</p>
        <ol className="list-decimal ml-5 space-y-0.5 text-[13px] text-ink/80">
          <li>Click <b>Model prompt</b> or <b>Stand prompt</b> — the tailored prompt copies and Gemini opens.</li>
          <li>In Gemini: <b>paste</b> (Ctrl+V), <b>attach</b> the raw colour photo, press send.</li>
          <li><b>Download</b> the image Gemini makes, then <b>⬆ Upload result</b> here.</li>
          <li>Pick your favourite as the <b>thumbnail</b> — it leads the product card &amp; page.</li>
        </ol>
        <p className="text-[11px] text-muted mt-1">Stand shots carry the elegant “blythediva” nameplate. The prompt keeps the exact piece — every stone, colour and part of the set.</p>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-display text-2xl text-ink">{p.name}</h2>
          <p className="text-xs text-muted">{p.category?.name} · {p.sku}</p>
        </div>
        <a href={`/shop/${p.category?.slug ?? "all"}/${p.sku}`} target="_blank" className="text-sm text-emerald nav-link">View product page ↗</a>
      </div>

      <div className="space-y-3">
        {variants.length === 0 ? (
          <Row variantId={null} title="This product" sub={p.sku} imgs={data.images.filter((i) => i.kind !== "source" && i.kind !== "flatlay").map((i) => i.path)} />
        ) : (
          variants.map((v) => (
            <Row key={v.id} variantId={v.id} title={v.color || v.sku} sub={v.sku} imgs={(v.images ?? (v.image ? [v.image] : [])) as string[]} />
          ))
        )}
      </div>
    </div>
  );
}
