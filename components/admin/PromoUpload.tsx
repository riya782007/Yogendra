"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { compressImage } from "@/lib/image";
import { signPromoUploadAction, savePromoUploadAction } from "@/app/actions/promotions";

type Cat = { name: string; slug: string };

/**
 * Owner's "banner manager" — upload a ready creative (image OR short video) + details and publish it
 * to the storefront home, a category, and/or the wholesale panel. No AI; the owner brings the art.
 * The file uploads STRAIGHT to storage via a signed URL, so large images and videos both work.
 */
export function PromoUpload({ categories = [] }: { categories?: Cat[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [title, setTitle] = useState("");
  const [cta, setCta] = useState("");
  const [placement, setPlacement] = useState<"home" | "category" | "wholesale" | "everywhere">("home");
  const [categorySlug, setCategorySlug] = useState("");
  const [aspect, setAspect] = useState("16:9");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);

  const isVideo = !!file && file.type.startsWith("video");

  // Make the banner on Gemini (free) — copy a tailored prompt + open Gemini; owner uploads the result below.
  function makeOnGemini() {
    const offer = title.trim() || "our latest offer";
    const prompt = `Design a professional, festive e-commerce PROMOTIONAL BANNER for a premium artificial-jewellery brand called "Blythe Diva". The promotion: ${offer}. Style: elegant Indian jewellery aesthetic, warm gold and maroon festive tones, a graceful model wearing kundan/polki jewellery, soft bokeh lights. Include the offer text "${offer}" in a refined elegant font and the brand name "BlytheDIVA" small in a top corner. Wide 16:9 landscape banner, high resolution, tasteful, NO spelling mistakes and no extra text. Output one ready-to-publish banner image.`;
    try { navigator.clipboard.writeText(prompt).catch(() => {}); } catch { /* clipboard may be blocked */ }
    window.open("https://gemini.google.com/app", "_blank", "noopener");
    setMsg({ t: "Prompt copied — in Gemini: paste, press send, download the banner, then upload it here.", ok: true });
  }

  function pick(f: File | undefined) {
    if (!f) return;
    setMsg(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    if (f.type.startsWith("video")) setAspect("16:9");
  }

  async function publish() {
    if (!file) { setMsg({ t: "Choose an image or video first.", ok: false }); return; }
    if (!title.trim()) { setMsg({ t: "Give the promotion a title.", ok: false }); return; }
    if (placement === "category" && !categorySlug) { setMsg({ t: "Pick a category for this banner.", ok: false }); return; }
    setBusy(true); setMsg(null);
    try {
      // Compress images to keep them light; send videos as-is.
      let toUpload: File = file;
      if (file.type.startsWith("image")) { try { toUpload = await compressImage(file, 2000, 0.85); } catch { /* use original */ } }

      const signed = await signPromoUploadAction({ filename: toUpload.name || (isVideo ? "promo.mp4" : "promo.jpg"), contentType: toUpload.type });
      if (!signed.ok || !signed.signedUrl || !signed.publicUrl) { setMsg({ t: signed.error || "Could not start upload.", ok: false }); setBusy(false); return; }

      const put = await fetch(signed.signedUrl, { method: "PUT", headers: { "content-type": toUpload.type, "x-upsert": "true" }, body: toUpload });
      if (!put.ok) { setMsg({ t: `Upload failed (${put.status}). Try a smaller file.`, ok: false }); setBusy(false); return; }

      const showRetail = placement === "home" || placement === "category" || placement === "everywhere";
      const showWholesale = placement === "wholesale" || placement === "everywhere";
      const res = await savePromoUploadAction({
        publicUrl: signed.publicUrl,
        mediaType: isVideo ? "video" : "image",
        title, ctaHref: cta,
        showRetail, showWholesale,
        categorySlug: placement === "category" ? categorySlug : null,
        aspect,
      });
      if (!res.ok) { setMsg({ t: res.error || "Could not publish.", ok: false }); setBusy(false); return; }

      setMsg({ t: "Published to your storefront ✓", ok: true });
      setFile(null); setPreview(""); setTitle(""); setCta(""); if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (e) {
      setMsg({ t: e instanceof Error ? e.message : "Something went wrong.", ok: false });
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald";
  return (
    <div className="bg-white rounded-2xl shadow-card border border-sand p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">🖼️</span>
        <h2 className="font-display text-2xl text-ink">Upload your own banner</h2>
      </div>
      <p className="text-sm text-muted mb-4">Bring a ready image or short video, add the details, and publish it to your storefront or wholesale panel — like the big brands.</p>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Left: file + preview */}
        <div>
          <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <button onClick={() => fileRef.current?.click()} className="w-full aspect-[16/9] rounded-2xl border-2 border-dashed border-sand hover:border-emerald grid place-items-center text-center overflow-hidden bg-cream/40">
            {preview ? (
              isVideo ? <video src={preview} className="w-full h-full object-cover" muted autoPlay loop playsInline />
                      : <img src={preview} alt="preview" className="w-full h-full object-cover" />
            ) : (
              <span className="text-sm text-muted px-4">Tap to choose an <b>image</b> or <b>video</b><br /><span className="text-xs">JPG / PNG / MP4 · keep videos short (&lt;30s)</span></span>
            )}
          </button>
          {file && <button onClick={() => { setFile(null); setPreview(""); if (fileRef.current) fileRef.current.value = ""; }} className="text-xs text-muted hover:text-rose mt-2">Remove file</button>}
          <button onClick={makeOnGemini} className="mt-2 w-full px-3 py-1.5 rounded-full bg-ink text-white text-xs font-medium hover:bg-ink/90">✦ No creative? Make one on Gemini (free)</button>
        </div>

        {/* Right: details */}
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-muted">Promotion title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Diwali Sale — Flat 30% off" className={field} />
          </div>
          <div>
            <label className="text-[11px] text-muted">Where should it go?</label>
            <select value={placement} onChange={(e) => setPlacement(e.target.value as any)} className={field}>
              <option value="home">Storefront home (main hero)</option>
              <option value="category">A specific category page</option>
              <option value="wholesale">Wholesale / dealer panel</option>
              <option value="everywhere">Everywhere (retail + wholesale)</option>
            </select>
          </div>
          {placement === "category" && (
            <div>
              <label className="text-[11px] text-muted">Category</label>
              <select value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} className={field}>
                <option value="">Choose a category…</option>
                {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-[11px] text-muted">Link when tapped <span className="text-muted/70">(optional)</span></label>
            <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="/shop/c/necklace  or leave blank" className={field} />
          </div>
          <button onClick={publish} disabled={busy} className="btn-primary w-full py-2.5 text-sm font-medium disabled:opacity-50">{busy ? "Publishing…" : "Publish banner"}</button>
          {msg && <p className={`text-sm ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.t}</p>}
        </div>
      </div>
    </div>
  );
}
