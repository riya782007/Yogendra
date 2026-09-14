import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import manifest from "./feature-manifest.json";

/**
 * Guards against the failure mode that has repeatedly wiped working features out of this repo:
 * an edit that was supposed to change part of a file instead replaced the whole file with a stub.
 *
 * It really happened. In the sibling repo, commit 1582e92 landed lib/supabase/queries.ts on main as the single word
 * "PLACEHOLDER" — 1969 lines gone — and deployed. Across this repo and its sibling there are 13
 * commits where a source file was replaced by two lines or fewer, each followed by a "fix:
 * restore ..." commit days later, after an owner noticed a feature had vanished.
 *
 * Nothing caught them because nothing ran before a merge. These tests do.
 *
 * If a failure here is INTENTIONAL (you really did delete or shrink a file), run
 *     node scripts/feature-manifest.mjs
 * and commit the updated manifest, so the removal shows up in the diff as a deliberate choice.
 */

const ROOT = join(__dirname, "..");
const EXT = /\.(ts|tsx|mjs)$/;
const SKIP_DIR = new Set(["node_modules", ".next", ".git", "out", "coverage"]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (EXT.test(name)) out.push(full);
  }
  return out;
}

const tracked = manifest.files as Record<string, number>;
const sourceFiles = ["app", "components", "lib", "tests", "scripts"]
  .flatMap((d) => walk(join(ROOT, d)))
  .map((f) => relative(ROOT, f).split(sep).join("/"));

describe("no file was replaced by a placeholder or stub", () => {
  // The literal markers seen in the incidents, plus the "rest of file unchanged" family that an
  // editor emits when it summarises instead of writing the real content.
  const MARKERS = [
    /^\s*PLACEHOLDER\s*$/m,
    /^\s*(?:\/\/|\/\*|\*)?\s*\.\.\.\s*(?:the\s+)?(?:rest|remaining|remainder|existing)\b/im,
    /^\s*(?:\/\/|\/\*|\*)?\s*(?:rest|remainder)\s+of\s+(?:the\s+)?file\s+(?:is\s+)?unchanged/im,
    /^\s*(?:\/\/|\/\*|\*)?\s*unchanged\s*\.\.\./im,
    /^\s*(?:\/\/|\/\*|\*)?\s*\[\s*(?:truncated|snip|omitted)\s*\]/im,
  ];

  it("contains no truncation markers in any source file", () => {
    const offenders: string[] = [];
    for (const rel of sourceFiles) {
      // This test file necessarily contains the patterns it searches for.
      if (rel === "tests/no-regressions.test.ts") continue;
      const body = readFileSync(join(ROOT, rel), "utf8");
      if (MARKERS.some((m) => m.test(body))) offenders.push(rel);
    }
    expect(offenders, `truncation marker found — these files look like stubs, not real code:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("has no suspiciously empty source file", () => {
    const empties = sourceFiles.filter((rel) => readFileSync(join(ROOT, rel), "utf8").trim().length < 20);
    expect(empties, `effectively empty source files:\n${empties.join("\n")}`).toEqual([]);
  });
});

describe("no tracked file disappeared or lost its body", () => {
  it("every file in the manifest still exists", () => {
    const present = new Set(sourceFiles);
    const missing = Object.keys(tracked).filter((f) => !present.has(f));
    expect(
      missing,
      `these files are in the manifest but gone from the tree — if you deleted them on purpose, run \`node scripts/feature-manifest.mjs\` and commit:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("no tracked file shrank by more than 60%", () => {
    const shrunk: string[] = [];
    for (const [rel, was] of Object.entries(tracked)) {
      if (!sourceFiles.includes(rel)) continue;      // covered by the test above
      if (was < 25) continue;                         // tiny files move around too much to police
      const now = readFileSync(join(ROOT, rel), "utf8").split("\n").length;
      if (now < was * 0.4) shrunk.push(`${rel}: ${was} -> ${now} lines`);
    }
    expect(
      shrunk,
      `these files lost most of their content — that is what a "replaced the whole file with a stub" edit looks like. If it is deliberate, run \`node scripts/feature-manifest.mjs\` and commit:\n${shrunk.join("\n")}`,
    ).toEqual([]);
  });
});

describe("critical customer-facing entry points still exist", () => {
  // Routes and modules the shop cannot trade without. Each has been broken at least once.
  const MUST_EXIST = [
    "app/(admin)/admin/catalogue/page.tsx",     // landed on main as a stub once
    "app/(admin)/admin/cod/page.tsx",           // COD queue — gutted and restored
    "app/(admin)/admin/estimate/[id]/page.tsx", // estimate holds — 404'd for owners
    "app/actions/billing.ts",                   // billing — once lost 857 lines in one commit
    "app/actions/fixNath.ts",                   // wrong-type tag repair
    "lib/supabase/queries.ts",                  // every data read in the app
    "lib/content.base.ts",                      // product copy — restored 4x in one day
    "lib/ai/listingAgent.ts",                   // AI listing writer — lost 313 lines once
    "components/admin/EditBillPanel.tsx",       // Edit bill — gutted twice
    "components/admin/POSClient.tsx",
    "app/(trade)/trade/page.tsx",               // dealer portal
  ];

  it.each(MUST_EXIST)("%s is present and non-trivial", (rel) => {
    const body = readFileSync(join(ROOT, rel), "utf8");
    expect(body.trim().length).toBeGreaterThan(200);
  });
});

describe("features that were lost and restored stay present", () => {
  // Each entry below is a feature an owner reported missing after a deploy. Keeping a named
  // assertion means the next agent that removes one gets a red test naming the feature.
  const CONTRACTS: Array<[string, string, RegExp]> = [
    ["catalogue reads page past the 1000-row cap", "lib/supabase/queries.ts", /allRows/],
    ["AI listing writer", "lib/ai/listingAgent.ts", /export async function generateProductContent/],
    ["title options for the picker", "lib/ai/listingAgent.ts", /export async function generateTitleOptions/],
    ["product name wins over mislabelled AI tags", "lib/content.base.ts", /export function templateContent/],
    ["house title name picker", "lib/content.base.ts", /export function pickDivaName/],
    ["storefront search box", "components/site/SearchField.tsx", /name="q"/],
  ];

  it.each(CONTRACTS)("%s", (_label, rel, pattern) => {
    expect(readFileSync(join(ROOT, rel), "utf8")).toMatch(pattern);
  });
});
