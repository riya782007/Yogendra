"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { deleteCategoryAction } from "@/app/actions/catalog";

/**
 * DeleteCategoryButton — deletes a category after an explicit confirmation. Deleting a category
 * NEVER deletes its inventory: any products in it are moved to an "Uncategorized" category, and the
 * confirmation makes that clear before the owner proceeds.
 */
export function DeleteCategoryButton({ id, name, productCount }: { id: string; name: string; productCount: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirmDelete() {
    setBusy(true);
    const r = await deleteCategoryAction(id);
    setBusy(false);
    if (!r.ok) { toast(r.error ?? "Couldn't delete the category.", "error"); return; }
    setOpen(false);
    toast(r.moved ? `Category deleted · ${r.moved} product${r.moved === 1 ? "" : "s"} moved to Uncategorized` : "Category deleted", "success");
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }} title="Delete category" className="text-muted hover:text-rose text-sm">🗑</button>
      {open && (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4" onClick={(e) => e.stopPropagation()}>
          <div className="absolute inset-0 bg-ink/40" onClick={() => !busy && setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-luxe border border-sand p-5 max-w-sm w-full">
            <p className="font-medium text-ink mb-1">Delete “{name}”?</p>
            <p className="text-sm text-muted">
              {productCount > 0
                ? <>This category has <b className="text-ink">{productCount} product{productCount === 1 ? "" : "s"}</b>. They will <b>not</b> be deleted — they&apos;ll be moved to an <b>Uncategorized</b> category so no inventory is lost. Its subcategories will be removed.</>
                : <>This category is empty. Its subcategories (if any) will be removed. No inventory is affected.</>}
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setOpen(false)} disabled={busy} className="px-4 py-2 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10 disabled:opacity-50">Cancel</button>
              <button onClick={confirmDelete} disabled={busy} className="px-4 py-2 rounded-xl bg-rose text-white text-sm hover:opacity-90 disabled:opacity-50">{busy ? "Deleting…" : "Delete category"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
