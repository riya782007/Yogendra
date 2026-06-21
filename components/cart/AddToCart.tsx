"use client";
import { useState } from "react";
import { useCart, type CartItem } from "./CartContext";
import { useToast } from "@/components/ui/Toast";

export function AddToCart({ item, qty = 1, variant = "card" }: { item: Omit<CartItem, "qty">; qty?: number; variant?: "card" | "full" }) {
  const { add } = useCart();
  const { toast } = useToast();
  const [done, setDone] = useState(false);
  const onClick = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); add(item, qty); toast(`${item.name} added to bag`); setDone(true); setTimeout(() => setDone(false), 1400); };
  if (variant === "card")
    return <button onClick={onClick} className="btn-gold block w-full text-center text-sm font-medium py-2.5">{done ? "✓ Added" : "Quick add +"}</button>;
  return <button onClick={onClick} className="btn-primary flex-1 py-3.5 text-sm font-medium">{done ? "✓ Added to cart" : "Add to cart"}</button>;
}
