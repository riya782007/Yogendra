"use client";
import Link from "next/link";
import { useWishlist } from "./WishlistContext";
import { IconHeart } from "@/components/site/Icons";

export function WishlistWidget() {
  const { count } = useWishlist();
  return (
    <Link href="/wishlist" aria-label="Wishlist" title="Wishlist"
      className="relative p-2 rounded-full text-ink hover:bg-cream hover:text-rose transition-colors">
      <IconHeart />
      {count > 0 && <span className="absolute -top-0.5 -right-0.5 bg-rose text-white text-[10px] h-4 min-w-4 px-1 rounded-full grid place-items-center">{count}</span>}
    </Link>
  );
}
