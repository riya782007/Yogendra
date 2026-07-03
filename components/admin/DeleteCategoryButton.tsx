"use client";
import { deleteCategoryAction } from "@/app/actions/catalog";

/** Delete a category with a confirmation prompt. Deleting NEVER removes inventory — products in the
 *  category are moved to an "Uncategorised" bucket (server-side) so nothing is lost. */
export function DeleteCategoryButton({ id, name, productCount }: { id: string; name: string; productCount: number }) {
  return (
    <form
      action={deleteCategoryAction}
      onSubmit={(e) => {
        const msg = productCount > 0
          ? `Delete category “${name}”?\n\nIts ${productCount} product${productCount === 1 ? "" : "s"} will be MOVED to “Uncategorised” (NOT deleted — you can re-assign them later). Its sub-categories and styles will be removed.`
          : `Delete empty category “${name}”?`;
        if (!confirm(msg)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" title={`Delete “${name}”`} className="text-muted hover:text-rose text-sm">🗑</button>
    </form>
  );
}
