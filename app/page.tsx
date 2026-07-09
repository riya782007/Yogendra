import { redirect } from "next/navigation";

// The brand storefront lives under the (retail) group at /shop (with full header, nav,
// cart, promos, etc.). The domain root sends shoppers straight there.
export default function Home() {
  redirect("/shop");
}
