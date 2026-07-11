"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { compressImage } from "@/lib/image";
import { signPromoUploadAction, savePromoUploadAction } from "@/app/actions/promotions";

type Cat = { name: string; slug: string };
type PType = "hero" | "popup" | "strip";

/**
 * Owner's campaign builder — like a big e-commerce promotions console. Pick a placement (hero banner,
 * storefront popup, or announcement strip), add a creative + copy + optional coupon and a schedule,
 * then Publish. The creative uploads straight to storage via a signed URL (images + short videos).
 */
export function PromoUpload({ categories = [] }: { categories?: Cat[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<PType>("hero");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [title, setTitle] = useState("");
  const [headline, setHeadline] = useState("");
  const [subtext, setSubtext] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [cta, setCta] = useState("");
  const [code, setCode] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [where, setWhere] = useState<"home" | "category" | "wholesale" | "everywhere">("home");
  const [categorySlug, setCategorySlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);

  const isVideo = !!file && file.type.startsWith("video");
  const needsMedia = type !== "strip";
  const aspect = type === "popup" ? "4:5" : "16:9";

  function makeOnGemini() {
    const offer = headline.trim() || title.trim() || "our latest offer";
    const shape = type === "popup" ? "vertical 4:5 poster" : "wide 16:9 landscape banner";
    const prompt = `Design a professional, festive e-commerce PROMOTIONAL ${type === "popup" ? "POPUP POSTER" : "BANNER"} for a premium artificial-jewellery brand called "Blythe Diva". The promotion: ${offer}. Style: elegant Indian jewellery aesthetic, warm gold and maroon festive tones, a graceful model wearing kundan/polki jewellery, soft bokeh lights. Include the offer text "${offer}" in a refined elegant font and the brand name "BlytheDIVA" small in a corner. ${shape}, high resolution, tasteful, NO spelling mistakes and no extra text. Output one ready-to-publish image.`;
    try { navigator.clipboard.writeText(prompt).catch(() => {}); } catch { /* clipboard may be blocked */ }
    window.open("https://flow.google.com", "_blank", "noopener");
    setMsg({ t: "Prompt copied — in Google Flow (Nano Banana 2): paste, generate, download the creative, then upload it here.", ok: true });
  }

  function pick(f: File | undefined) {
    if (!f) return;
    setMsg(null); setFile(f); setPreview(URL.createObjectURL(f));
  }

  async function publish() {
    if (!title.trim()) { setMsg({ t: "Give the promotion a title.", ok: false }); return; }
    if (needsMedia && !file) { setMsg({ t: "Choose an image or video first.", ok: false }); return; }
    if (type === "strip" && !headline.trim()) { setMsg({ t: "Enter the strip message (headline).", ok: false }); return; }
    if (where === "category" && !categorySlug) { setMsg({ t: "Pick a category.", ok: false }); return; }
    setBusy(true); setMsg(null);
    try {
      let publicUrl: string | undefined;
      if (needsMedia && file) {
        let toUpload: File = file;
        if (file.type.startsWith("image")) { try { toUpload = await compressImage(file, 2000, 0.85, 0); } catch { /* use original */ } }
        const signed = await signPromoUploadAction({ filename: toUpload.name || (isVideo ? "promo.mp4" : "promo.jpg"), contentType: toUpload.type });
        if (!signed.ok || !signed.signedUrl || !signed.publicUrl) { setMsg({ t: signed.error || "Could not start upload.", ok: false }); setBusy(false); return; }
        const put = await fetch(signed.signedUrl, { method: "PUT", headers: { "content-type": toUpload.type, "x-upsert": "true" }, body: toUpload });
        if (!put.ok) { setMsg({ t: `Upload failed (${put.status}). Try a smaller file.`, ok: false }); setBusy(false); return; }
        publicUrl = signed.publicUrl;
      }
      const showRetail = where === "home" || where === "category" || where === "everywhere";
      const showWholesale = where === "wholesale" || where === "everywhere";
      const res = await savePromoUploadAction({
        publicUrl, mediaType: isVideo ? "video" : "image", title,
        placement: type, headline, subtext, ctaLabel, ctaHref: cta, discountCode: code,
        startsAt: startsAt || null, endsAt: endsAt || null,
        showRetail, showWholesale, categorySlug: where === "category" ? categorySlug : null, aspect,
      });
      if (!res.ok) { setMsg({ t: res.error || "Could not publish.", ok: false }); setBusy(false); return; }
      setMsg({ t: "Published — it's live on your storefront ✓", ok: true });
      setFile(null); setPreview(""); setTitle(""); setHeadline(""); setSubtext(""); setCta(""); setCtaLabel(""); setCode(""); setStartsAt(""); setEndsAt("");
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (e) {
      setMsg({ t: e instanceof Error ? e.message : "Something went wrong.", ok: false });
    } finally { setBusy(false); }
  }

  const field = "w-full rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald";
  const TYPES: { key: PType; label: string; desc: string }[] = [
    { key: "hero", label: "Hero banner", desc: "Big banner on the shop/home hero" },
    { key: "popup", label: "Popup", desc: "Welcome modal with countdown + code" },
    { key: "strip", label: "Announcement strip", desc: "Scrolling text bar at the very top" },
  ];

  return (
    <div className="bg-white rounded-2xl shadow-card border border-sand p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">📣</span>
        <h2 className="font-display text-2xl text-ink">Create a promotion</h2>
      </div>
      <p className="text-sm text-muted mb-4">Run offers like the big storefronts — banners, welcome popups with a countdown &amp; coupon, or a scrolling strip. Add the details, schedule it, and publish.</p>

      {/* Placement type */}
      <div className="grid sm:grid-cols-3 gap-2 mb-4">
        {TYPES.map((t) => (
          <button key={t.key} onClick={() => setType(t.key)} className={`text-left rounded-2xl border p-3 transition ${type === t.key ? "border-emerald ring-1 ring-emerald bg-emerald-mist/40" : "border-sand hover:border-emerald/50"}`}>
            <p className="font-medium text-ink text-sm">{t.label}</p>
            <p className="text-[11px] text-muted">{t.desc}</p>
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Left: media (hero/popup) */}
        <div>
          {needsMedia ? (
            <>
              <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
              <button onClick={() => fileRef.current?.click()} className={`w-full ${type === "popup" ? "aspect-[4/5]" : "aspect-[16/9]"} rounded-2xl border-2 border-dashed border-sand hover:border-emerald grid place-items-center text-center overflow-hidden bg-cream/40`}>
                {preview ? (
                  isVideo ? <video src={preview} className="w-full h-full object-cover" muted autoPlay loop playsInline />
                          : <img src={preview} alt="preview" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-sm text-muted px-4">Tap to choose an <b>image</b> or <b>video</b><br /><span className="text-xs">{type === "popup" ? "Vertical 4:5 works best" : "Wide 16:9 works best"} · MP4 &lt;30s</span></span>
                )}
              </button>
              {file && <button onClick={() => { setFile(null); setPreview(""); if (fileRef.current) fileRef.current.value = ""; }} className="text-xs text-muted hover:text-rose mt-2">Remove file</button>}
              <button onClick={makeOnGemini} className="mt-2 w-full px-3 py-1.5 rounded-full bg-ink text-white text-xs font-medium hover:bg-ink/90">✦ No creative? Make one on Google Flow (free)</button>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-sand bg-cream/40 p-4 text-sm text-muted h-full grid place-items-center text-center">
              An announcement strip is text-only — type the message on the right. It scrolls in the bar at the very top of the shop.
            </div>
          )}
        </div>

        {/* Right: details */}
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-muted">Campaign title <span className="text-muted/70">(internal)</span></label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Diwali Sale 2026" className={field} />
          </div>
          <div>
            <label className="text-[11px] text-muted">{type === "strip" ? "Strip message" : "Headline"} {type !== "hero" && <span className="text-rose">*</span>}</label>
            <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder={type === "strip" ? "Flat 30% OFF this Diwali" : "Diwali Glow Sale"} className={field} />
          </div>
          {type === "popup" && (
            <div>
              <label className="text-[11px] text-muted">Sub-text</label>
              <input value={subtext} onChange={(e) => setSubtext(e.target.value)} placeholder="Up to 30% off kundan & polki" className={field} />
            </div>
          )}
          {type !== "strip" && (
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[11px] text-muted">Button text</label><input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} placeholder="Shop the offer" className={field} /></div>
              <div><label className="text-[11px] text-muted">Coupon code <span className="text-muted/70">(optional)</span></label><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="DIWALI30" className={field} /></div>
            </div>
          )}
          <div>
            <label className="text-[11px] text-muted">Link when tapped <span className="text-muted/70">(optional)</span></label>
            <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="/shop/c/necklaces  or leave blank" className={field} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[11px] text-muted">Starts <span className="text-muted/70">(optional)</span></label><input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={field} /></div>
            <div><label className="text-[11px] text-muted">Ends <span className="text-muted/70">(shows countdown)</span></label><input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={field} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-muted">Where</label>
              <select value={where} onChange={(e) => setWhere(e.target.value as any)} className={field}>
                <option value="home">Storefront (retail)</option>
                <option value="category">A category page</option>
                <option value="wholesale">Wholesale panel</option>
                <option value="everywhere">Everywhere</option>
              </select>
            </div>
            {where === "category" && (
              <div>
                <label className="text-[11px] text-muted">Category</label>
                <select value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} className={field}>
                  <option value="">Choose…</option>
                  {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <button onClick={publish} disabled={busy} className="btn-primary w-full py-2.5 text-sm font-medium disabled:opacity-50">{busy ? "Publishing…" : "Publish promotion"}</button>
          {msg && <p className={`text-sm ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.t}</p>}
        </div>
      </div>

      {/* Live preview — see exactly how it appears on the storefront before publishing */}
      <div className="mt-5 pt-4 border-t border-sand">
        <p className="text-[11px] uppercase tracking-wide text-muted mb-2">Live preview</p>
        {type === "strip" ? (
          <div className="bg-ink text-gold-light/90 text-xs py-2 px-4 rounded-lg overflow-hidden whitespace-nowrap">✦ {headline || "Your announcement message"} &nbsp;&nbsp; ✦ Free shipping over ₹999 &nbsp;&nbsp; ✦ Cash on Delivery</div>
        ) : type === "popup" ? (
          <div className="mx-auto max-w-[240px] bg-ivory rounded-2xl shadow-luxe overflow-hidden border border-sand">
            <div className="aspect-[4/5] bg-cream">{preview ? (isVideo ? <video src={preview} className="w-full h-full object-cover" muted /> : <img src={preview} alt="" className="w-full h-full object-cover" />) : <div className="w-full h-full grid place-items-center text-[11px] text-muted">creative</div>}</div>
            <div className="p-3 text-center">
              {headline && <p className="font-display text-lg text-ink leading-tight">{headline}</p>}
              {subtext && <p className="text-[11px] text-muted">{subtext}</p>}
              {endsAt && <p className="text-[10px] text-ink mt-1">⏳ ends {new Date(endsAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>}
              {code && <p className="mt-1 inline-block text-[11px] border border-dashed border-gold rounded-full px-2 py-0.5 text-gold-dark">Code: {code}</p>}
              <div className="btn-primary text-[11px] py-1.5 mt-2 rounded-full text-center">{ctaLabel || "Shop the offer"}</div>
            </div>
          </div>
        ) : (
          <div className="relative rounded-xl overflow-hidden border border-sand aspect-[16/6] bg-cream">
            {preview ? (isVideo ? <video src={preview} className="w-full h-full object-cover" muted /> : <img src={preview} alt="" className="w-full h-full object-cover" />) : <div className="w-full h-full grid place-items-center text-xs text-muted">banner creative</div>}
            <span className="absolute bottom-2 right-2 bg-white/90 text-ink text-[10px] px-2 py-0.5 rounded-full">{ctaLabel || "Shop now →"}</span>
          </div>
        )}
      </div>
    </div>
  );
}
