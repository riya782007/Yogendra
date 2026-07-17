import { NextResponse } from "next/server";

// Always run fresh so this reflects the CURRENTLY-DEPLOYED build, never a cached value.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The build identifier of the running production. A browser tab opened on an older deploy will
 *  read a different value here than the one baked into its page → the app knows it's outdated and
 *  offers a one-click refresh. Vercel injects VERCEL_GIT_COMMIT_SHA at build time. */
export function GET() {
  const v = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
  return NextResponse.json({ v }, { headers: { "cache-control": "no-store, max-age=0" } });
}
