export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";

/**
 * The dealer portal was removed (owner: "no login, no friction"). The catalogue is fully open and
 * anyone can check out directly. This route is kept only so old links / shared QR codes that still
 * point at /trade/login land on the open catalogue instead of a 404.
 */
export default function TradeLoginRemoved() {
  redirect("/trade");
}
