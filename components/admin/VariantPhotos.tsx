"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { addVariantImageAction, deleteVariantImageAction, setVariantLeadImageAction } from "@/app/actions/variants";
import { compressImage } from "@/lib/image";

/**
 * Pillar 16 — reliable per-variant photo upload. Mirrors the product photo flow:
 * compress each photo client-side (also re-encodes phone shots to JPEG), upload with a
 * clear busy state, and show success/error — so uploads never silently fail.
 */
export function VariantPhotos({ variantId, productSku, color, images }: { variantId: string; productSku: string; color: string | null; images: string[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("id", variantId);
      fd.set("product_sku", productSku);
      for (const f of Array.from(files)) fd.append("images", await compressImage(f));
      const res = await addVariantImageAction(fd);
      if (res.ok) { toast(`Photo added${color ? ` for ${color}` : ""} ✓`); router.refresh(); }
      else toast(res.error ?? "Upload failed", "error");
    } catch {
      toast("Upload failed — try again or use a smaller photo", "error");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  async function del(url: string) {
    const fd = new FormData();
    fd.set("id", variantId); fd.set("product_sku", productSku); fd.set("url", url);
    await deleteVariantImageAction(fd);
    router.refresh();
  }

  async function makeMain(url: string) {
    const fd = new FormData();
    fd.set("id", variantId); fd.set("product_sku", productSku); fd.set("url", url);
    await setVariantLeadImageAction(fd);
    toast("Set as main photo ✓");
    router.refresh();
  }

  return (
    <>
      {images.map((u, i) => (
        <div key={u} className={`relative h-14 w-14 rounded-lg overflow-hidden border ${i === 0 ? "border-emerald ring-1 ring-emerald" : "border-sand"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u} alt={color ?? ""} className="h-full w-full object-cover" />
          {i === 0
            ? <span className="absolute bottom-0 inset-x-0 bg-emerald text-white text-[8px] leading-none text-center py-0.5" title="This photo leads this colour (and the storefront cover if it's the default colour)">★ Main</span>
            : <button onClick={() => makeMain(u)} className="absolute bottom-0 inset-x-0 bg-ink/70 text-white text-[8px] leading-none py-0.5 hover:bg-emerald" title="Make this the main photo for this colour">Make main</button>}
          <button onClick={() => del(u)} className="absolute top-0 right-0 bg-ink/70 text-white text-[10px] leading-none px-1 py-0.5 rounded-bl" title="Remove photo">✕</button>
        </div>
      ))}
      <input ref={ref} type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
      <button onClick={() => ref.current?.click()} disabled={busy} className="px-2.5 py-1.5 rounded-lg bg-emerald text-white text-xs disabled:opacity-50">{busy ? "Uploading…" : "+ Add photo"}</button>
    </>
  );
}
