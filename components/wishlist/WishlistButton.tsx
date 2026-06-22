"use client";
import { useWishlist, type WishItem } from "./WishlistContext";
import { useToast } from "@/components/ui/Toast";
import { IconHeart } from "@/components/site/Icons";

export function WishlistButton({ item, className = "" }: { item: WishItem; className?: string }) {
  const { has, toggle } = useWishlist();
  const { toast } = useToast();
  const active = has(item.sku);
  return (
    <button aria-label={active ? "Remove from wishlist" : "Save to wishlist"} title={active ? "Saved" : "Save to wishlist"}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(item); toast(active ? "Removed from wishlist" : "Saved to wishlist", active ? "info" : "success"); }}
      className={`${className} grid place-items-center ${active ? "bg-rose text-white" : "bg-white/85 text-rose hover:bg-rose hover:text-white"}`}>
      <IconHeart className={`w-4 h-4 ${active ? "fill-current" : ""}`} />
    </button>
  );
}
