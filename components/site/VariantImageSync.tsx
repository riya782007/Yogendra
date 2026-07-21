"use client";
import { createContext, useContext, useState } from "react";

/**
 * Shares the "currently chosen colour's photo" between the BuyBox (colour swatches, right column) and
 * the Gallery (main hero image, left column). They're separate client islands, so without this a colour
 * click updated the price but never switched the big photo ("colour change nahi hota"). BuyBox writes the
 * selected variant's image path here; the Gallery reads it and jumps its hero to that image.
 */
type Ctx = { activePath: string | null; setActivePath: (p: string | null) => void };
const VariantImageCtx = createContext<Ctx | null>(null);

export function VariantImageProvider({ children }: { children: React.ReactNode }) {
  const [activePath, setActivePath] = useState<string | null>(null);
  return <VariantImageCtx.Provider value={{ activePath, setActivePath }}>{children}</VariantImageCtx.Provider>;
}

/** No-op safe when used outside a provider, so both components still work standalone. */
export function useVariantImage(): Ctx {
  return useContext(VariantImageCtx) ?? { activePath: null, setActivePath: () => {} };
}
