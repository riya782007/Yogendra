import { redirect } from "next/navigation";

// Discreet dealer entry alias. Like /trade, it's unlinked from the storefront,
// blocked in robots, and gated by middleware + the dealer session check.
export const metadata = { robots: { index: false, follow: false } };

export default function Partner() {
  redirect("/trade");
}
