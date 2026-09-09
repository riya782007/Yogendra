#!/usr/bin/env node
/**
 * scripts/feature-manifest.mjs — regenerate tests/feature-manifest.json.
 *
 * The manifest is a census of every source file and how many lines it has. tests/no-regressions
 * .test.ts fails when a listed file disappears or loses most of its body, which is the exact
 * signature of the incidents that kept wiping features out of this repo (a 1969-line
 * lib/supabase/queries.ts once landed on main as the single word "PLACEHOLDER", and shipped).
 *
 * Run this ONLY when you have deliberately deleted or shrunk a file:
 *     node scripts/feature-manifest.mjs
 * then commit the updated manifest. The point is that a deletion has to appear in the diff as a
 * deliberate act, instead of silently reaching production.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components", "lib", "tests", "scripts"];
const EXT = /\.(ts|tsx|mjs)$/;
const SKIP_DIR = new Set(["node_modules", ".next", ".git", "out", "coverage"]);

function walk(dir, out = []) {
  let entries;
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

export function buildManifest(root = ROOT) {
  const files = {};
  for (const d of SCAN_DIRS) {
    for (const full of walk(join(root, d))) {
      const rel = relative(root, full).split(sep).join("/");
      const lines = readFileSync(full, "utf8").split("\n").length;
      files[rel] = lines;
    }
  }
  return { generated: "run `node scripts/feature-manifest.mjs` to refresh", files };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = buildManifest();
  const target = join(ROOT, "tests", "feature-manifest.json");
  writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`feature-manifest.json updated — ${Object.keys(manifest.files).length} files tracked`);
}
