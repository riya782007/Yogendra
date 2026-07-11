"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { uploadProductImageAction, deleteProductImageAction, setHeroImageAction, uploadStorefrontPhotoAction } from "@/app/actions/media";
import { compressImage } from "@/lib/image";

type Img = { id: string; path: string; kind: string | null; sort: number };
type P = { id: string; sku: string; name: string; category: string; images: Img[] };

const GEN_MSG: Record<string, string> = {
  no_key: "Add GEMINI_API_KEY to generate",
  no_source: "Upload a raw photo first",
};

export function MediaCard({ p, geminiReady }: { p: P; geminiReady: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState("");
  const [kw, setKw] = useState(""); // owner's optional 1–2 keywords to guide the AI (jewellery details)
  const rawRef = useRef<HTMLInputElement>(null);
  const angleRef = useRef<HTMLInputElement>(null);
  const readyRef = useRef<HTMLInputElement>(null);

  const hasRaw = p.images.some((i) => i.kind === "flatlay" || i.kind === "source" || i.kind === "angle");
  const hasModel = p.images.some((i) => i.kind === "model");

  async function upload(file: File | undefined, kind: string) {
    if (!file) return;
    setBusy(kind);
    try {
      const small = await compressImage(file);
      const fd = new FormData(); fd.set("sku", p.sku); fd.set("kind", kind); fd.set("image", small);
      const res = await uploadProductImageAction(fd);
      if (res.ok) { toast(`Photo uploaded for ${p.sku}`); router.refresh(); } else toast(res.error ?? "Upload failed", "error");
    } catch {
      toast("Upload failed — try a smaller photo", "error");
    } finally {
      setBusy("");
    }
  }
  function generate() {
    // The per-variant Gemini prompt boxes + upload live in the product's AI Studio.
    router.push(`/admin/media/${p.id}`);
  }
  async function uploadReady(file: File | undefined) {
    if (!file) return;
    setBusy("ready");
    try {
      const small = await compressImage(file);
      const fd = new FormData(); fd.set("sku", p.sku); fd.set("image", small);
      const res = await uploadStorefrontPhotoAction(fd);
      if (res.ok) { toast(`Photo published to the site for ${p.sku} ✓`); router.refresh(); }
      else toast(res.error ?? "Upload failed", "error");
    } catch { toast("Upload failed — try a smaller photo", "error"); }
    finally { setBusy(""); }
  }
  async function del(id: string) { const fd = new FormData(); fd.set("id", id); await deleteProductImageAction(fd); router.refresh(); }
  async function hero(id: string) { const fd = new FormData(); fd.set("id", id); fd.set("productId", p.id); await setHeroImageAction(fd); toast("Hero image set"); router.refresh(); }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-card">
      <div className="flex items-center justify-between mb-3">
        <div><p className="font-medium text-ink">{p.name}</p><p className="text-xs text-muted">{p.category} · {p.sku}</p></div>
        {hasModel && <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-mist text-emerald-dark">AI photo ✓</span>}
      </div>

      {p.images.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
          {p.images.map((i) => (
            <div key={i.id} className="relative shrink-0 w-24">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={i.path} alt={p.name} className="w-24 h-28 object-cover rounded-lg border border-sand" />
              <span className={`absolute top-1 left-1 text-[9px] px-1.5 py-0.5 rounded-full ${i.kind === "model" ? "bg-emerald text-white" : "bg-ink/70 text-cream"}`}>{i.kind === "model" ? "AI" : i.kind === "angle" ? "angle" : "raw"}</span>
              <div className="flex justify-between mt-1">
                <button onClick={() => hero(i.id)} className="text-[10px] text-emerald hover:underline">hero</button>
                <button onClick={() => del(i.id)} className="text-[10px] text-muted hover:text-rose">delete</button>
              </div>
            </div>
          ))}
        </div>
      ) : <p className="text-xs text-muted mb-3">No photos yet — upload the raw design shot to begin.</p>}

      <div className="flex flex-wrap gap-2 items-center">
        <input ref={rawRef} type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0], "flatlay")} />
        <button onClick={() => rawRef.current?.click()} disabled={busy === "flatlay"} className="px-3 py-1.5 rounded-full border border-sand text-ink text-xs font-medium hover:border-emerald transition-colors disabled:opacity-50">{busy === "flatlay" ? "Uploading…" : hasRaw ? "Replace raw photo" : "Upload raw photo"}</button>

        <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="+ details (e.g. polki, peacock motif)" maxLength={120}
          title="Optional: add 1–2 keywords to guide the AI on important jewellery details" aria-label="Extra keywords for AI"
          className="rounded-full border border-sand px-3 py-1.5 text-xs outline-none focus:border-emerald w-52" />
        <button onClick={generate} title="Open the AI Studio to make Model + Stand photos on Google Flow (Nano Banana 2) for each colour"
          className="px-3 py-1.5 rounded-full bg-ink text-white text-xs font-medium hover:bg-ink/90 transition-colors">✦ Make photos (Studio)</button>

        {/* Emergency / manual override: drop a finished photo straight onto the storefront. */}
        <input ref={readyRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadReady(e.target.files?.[0])} />
        <button onClick={() => readyRef.current?.click()} disabled={busy === "ready"} title="Upload a ready photo and show it on the site now — no AI needed"
          className="px-3 py-1.5 rounded-full border border-emerald text-emerald-dark text-xs font-medium hover:bg-emerald-mist transition-colors disabled:opacity-50">{busy === "ready" ? "Uploading…" : "⬆ Upload ready photo"}</button>

        <input ref={angleRef} type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0], "angle")} />
        <button onClick={() => angleRef.current?.click()} disabled={busy === "angle"} className="px-3 py-1.5 rounded-full border border-sand text-ink text-xs font-medium hover:border-emerald transition-colors disabled:opacity-50">{busy === "angle" ? "Uploading…" : "+ Add angle"}</button>
      </div>
      {!geminiReady && <p className="text-[11px] text-gold-dark mt-2">Add GEMINI_API_KEY in settings to turn raw photos into professional model shots.</p>}
    </div>
  );
}
