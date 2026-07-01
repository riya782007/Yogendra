"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { uploadProductImageAction, deleteProductImageAction, setHeroImageAction } from "@/app/actions/media";
import { generateOneAction } from "@/app/actions/images";
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
  async function generate() {
    setBusy("gen");
    const res = await generateOneAction(p.sku, kw);
    setBusy("");
    if (res.ok) { toast(`Model photo generated for ${p.sku} ✓`); router.refresh(); }
    else {
      const friendly = GEN_MSG[res.reason ?? ""];
      const detail = res.error ? ` — ${res.error}` : "";
      toast(friendly ?? `Couldn't generate: ${res.reason}${detail}`, "error");
      if (res.error) console.error("[generate]", res.reason, res.error);
    }
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
        <button onClick={generate} disabled={busy === "gen" || !hasRaw} title={!geminiReady ? "Add GEMINI_API_KEY to enable" : !hasRaw ? "Upload a raw photo first" : ""}
          className="px-3 py-1.5 rounded-full bg-gold/15 text-gold-dark text-xs font-medium hover:bg-gold/25 transition-colors disabled:opacity-50">{busy === "gen" ? "Generating…" : "✨ Generate model photo"}</button>

        <input ref={angleRef} type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0], "angle")} />
        <button onClick={() => angleRef.current?.click()} disabled={busy === "angle"} className="px-3 py-1.5 rounded-full border border-sand text-ink text-xs font-medium hover:border-emerald transition-colors disabled:opacity-50">{busy === "angle" ? "Uploading…" : "+ Add angle"}</button>
      </div>
      {!geminiReady && <p className="text-[11px] text-gold-dark mt-2">Add GEMINI_API_KEY in settings to turn raw photos into professional model shots.</p>}
    </div>
  );
}
