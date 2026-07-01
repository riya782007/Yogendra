"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { deleteProductAction } from "@/app/actions/catalog";

export function DeleteProductButton({ sku, className = "", label }: { sku: string; className?: string; label?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function confirmDelete() {
    setBusy(true);
    const fd = new FormData(); fd.set("sku", sku);
    const r = await deleteProductAction(fd);
    setBusy(false); setOpen(false);
    toast(r.message, r.ok ? "success" : "error");
    router.refresh();
  }

  return (
    <>
      <button onClick={() => setOpen(true)} disabled={busy} title="Delete product"
        className={className || "text-muted hover:text-rose text-xs"}>{label ?? "🗑 Delete"}</button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-luxe max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
            <p className="font-medium text-ink">Delete <span className="font-mono">{sku}</span>?</p>
            <p className="text-sm text-muted mt-1">This permanently removes the product. If it has past orders, it&apos;s hidden from the store instead, so your records stay intact.</p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setOpen(false)} disabled={busy} className="px-4 py-2 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10">Cancel</button>
              <button onClick={confirmDelete} disabled={busy} className="px-4 py-2 rounded-xl bg-rose text-white text-sm hover:opacity-90 disabled:opacity-50">{busy ? "Deleting…" : "Delete"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
