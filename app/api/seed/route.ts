/** Guarded reseed endpoint (non-prod). Re-runs the deterministic seed SQL is handled out-of-band;
 *  here we expose a no-op confirmation to avoid accidental data loss in the demo. */
import { NextResponse } from "next/server";

export async function POST() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED !== "true") {
    return NextResponse.json({ ok: false, error: "seeding disabled in production" }, { status: 403 });
  }
  return NextResponse.json({ ok: true, note: "Seed is managed via supabase/migrations + seed SQL; data already loaded." });
}
