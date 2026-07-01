"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { uploadProductImageAction } from "@/app/actions/media";
import { setProductVisibilityAction } from "@/app/actions/catalog";
import { compressImage } from "@/lib/image";

/**
 * Catalogue-list inline image + publish controls. Lets the owner draft a product without a photo,
 * then come back to the catalogue list, add an image, and publish — all without opening the editor.
 * Backed by the same actions the product editor uses (uploadProductImageAction, setProductVisibilityAction).
 */
export function CatalogueRowActions({
  sku, status, image, canEdit, canPublish,
}: { sku: string; status: string; image: string | null; canEdit: boolean; canPublish: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<"" | "img" | "pub">("");
  const ref = useRef<HTMLInputElement>(null);
  const published = status === "published";

  async function addImage(file?: File) {
    if (!file) return;
    setBusy("img");
    try {
      const small = await compressImage(file);
      const fd = new FormData();
      fd.set("sku", sku); fd.set("kind", "flatlay"); fd.set("image", small);
      const res = await uploadProductImageAction(fd);
      if (res.ok) { toast(`Image added to ${sku}`); router.refresh(); }
      else toast(res.error ?? "Upload failed", "error");
    } catch {
      toast("Upload failed — try a smaller photo", "error");
    } finally { setBusy(""); }
  }

  async function togglePublish() {
    setBusy("pub");
    try {
      const fd = new FormData();
      fd.set("sku", sku); fd.set("status", published ? "draft" : "published");
      await setProductVisibilityAction(fd);
      toast(published ? `${sku} hidden from store` : `${sku} published ✓`);
      router.refresh();
    } finally { setBusy(""); }
  }

  return (
    <div className="flex flex-col items-start gap-1.5 w-[88px]">
      <div className="relative w-16 h-20 rounded-lg overflow-hidden border border-sand bg-cream">
        {image
          ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={image} alt={sku} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-center text-[9px] leading-tight text-muted px-1">No image yet</div>}
      </div>

      {canEdit && (
        <>
          <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => addImage(e.target.files?.[0])} />
          <button type="button" onClick={() => ref.current?.click()} disabled={busy === "img"}
            className="text-[11px] px-2 py-1 rounded-full border border-sand text-ink hover:border-emerald disabled:opacity-50 whitespace-nowrap">
            {busy === "img" ? "Uploading…" : image ? "Replace image" : "＋ Add image"}
          </button>
        </>
      )}

      {canPublish && (
        <button type="button" onClick={togglePublish} disabled={busy === "pub"}
          className={`text-[11px] px-2 py-1 rounded-full disabled:opacity-50 whitespace-nowrap ${published ? "bg-gold/15 text-gold-dark hover:bg-gold/25" : "bg-emerald text-white hover:bg-emerald-dark"}`}>
          {busy === "pub" ? "…" : published ? "Hide" : "Publish"}
        </button>
      )}
    </div>
  );
}
