import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

/**
 * Force-refresh the cached storefront. Called by the DATABASE (a pg_net trigger) whenever any product's
 * stock crosses the in-stock ↔ out-of-stock line, so a sold-out design disappears (and a restocked one
 * reappears) no matter WHICH path changed the stock — a sale, a manual edit, an import, DIVA, or even a
 * direct database fix. The app's server actions already call revalidateTag on their own; this is the
 * belt-and-suspenders that makes it reliable from the root.
 *
 * Lightly protected by a shared token (a cache-bust endpoint is low-risk; worst case someone refreshes the
 * cache). Set REVALIDATE_TOKEN in Vercel to override the built-in default — the DB trigger sends the same
 * value, so no env is strictly required.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOKEN = process.env.REVALIDATE_TOKEN || "bd-revalidate-7k2p9x";

function handle(req: Request) {
  const url = new URL(req.url);
  const token = req.headers.get("x-revalidate-token") || url.searchParams.get("token");
  if (token !== TOKEN) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  revalidateTag("storefront");
  revalidateTag("trade-catalog");
  return NextResponse.json({ ok: true, revalidated: ["storefront", "trade-catalog"], at: Date.now() });
}

export async function GET(req: Request) { return handle(req); }
export async function POST(req: Request) { return handle(req); }
