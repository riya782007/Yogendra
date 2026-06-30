import { permanentRedirect } from "next/navigation";

// Backward-compat only: any old /wholesale link now lands on the isolated trade
// portal sign-in. This route is unlinked from the storefront and blocked in robots.
export const metadata = { robots: { index: false, follow: false } };

export default function LegacyWholesale() {
  permanentRedirect("/trade/login");
}
