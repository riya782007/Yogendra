/**
 * lib/colors.ts — canonical colour catalog.
 *
 * The 75 colours Yogendra runs on, with their short scanner-friendly barcode codes.
 * This is duplicated in `supabase/migrations/0016_color_barcode_codes.sql` (which seeds
 * the DB); the TS copy is the source of truth for the UI (datalists, previews, demos,
 * and any place that needs the list before the migration has run).
 *
 * Barcode rule: full variant barcode = `{productSku}-{barcode_code}`.
 * e.g. red variant of product BD2024 → BD2024-RED.
 */

export type ColorEntry = {
  /** Human-readable colour name (also the primary key in variant_options). */
  name: string;
  /** Short barcode suffix that prints on the label (RED, MULTI1, SBLUE…). */
  code: string;
  /** Display order in the colours master (low = earliest). */
  sort: number;
};

export const COLOR_CATALOG: readonly ColorEntry[] = [
  { name: "Red",             code: "RED",     sort: 1  },
  { name: "Green",           code: "GREEN",   sort: 2  },
  { name: "Yellow",          code: "YELLOW",  sort: 3  },
  { name: "Black",           code: "BLACK",   sort: 4  },
  { name: "White",           code: "WHITE",   sort: 5  },
  { name: "Wine",            code: "WINE",    sort: 6  },
  { name: "Purple",          code: "PURPLE",  sort: 7  },
  { name: "Mint",            code: "MINT",    sort: 8  },
  { name: "Peach",           code: "PEACH",   sort: 9  },
  { name: "Multicolor 1",    code: "MULTI1",  sort: 10 },
  { name: "Multicolor 2",    code: "MULTI2",  sort: 11 },
  { name: "Sky Blue",        code: "SBLUE",   sort: 12 },
  { name: "Royal Blue",      code: "RBLUE",   sort: 13 },
  { name: "Navy Blue",       code: "NBLUE",   sort: 14 },
  { name: "Maroon",          code: "MAROON",  sort: 15 },
  { name: "Peacock Green",   code: "PGREEN",  sort: 16 },
  { name: "Silver",          code: "SILVER",  sort: 17 },
  { name: "Golden",          code: "GOLD",    sort: 18 },
  { name: "Lavender",        code: "LAV",     sort: 19 },
  { name: "Blush Pink",      code: "PINK",    sort: 20 },
  { name: "Magenta",         code: "RANI",    sort: 21 },
  { name: "Orange",          code: "ORANGE",  sort: 22 },
  { name: "Ruby",            code: "RUBY",    sort: 23 },
  { name: "Mehndi",          code: "MEH",     sort: 24 },
  { name: "Pink Mint",       code: "PMINT",   sort: 25 },
  { name: "Grey",            code: "GREY",    sort: 26 },
  { name: "Gajri",           code: "GAJRI",   sort: 27 },
  { name: "Peacock Blue",    code: "PBLUE",   sort: 28 },
  { name: "Baby Pink",       code: "BPINK",   sort: 29 },
  { name: "Maroon Green",    code: "MGREEN",  sort: 30 },
  { name: "White Maroon",    code: "WMAROON", sort: 31 },
  { name: "White Green",     code: "WGREEN",  sort: 32 },
  { name: "White Magenta",   code: "WRANI",   sort: 33 },
  { name: "White Red",       code: "WRED",    sort: 34 },
  { name: "White Pink Mint", code: "WPMINT",  sort: 35 },
  { name: "White Multi",     code: "WMULTI",  sort: 36 },
  { name: "Rose Gold",       code: "RGOLD",   sort: 37 },
  { name: "Teal Green",      code: "TGREEN",  sort: 38 },
  { name: "Green Red",       code: "GRED",    sort: 39 },
  { name: "Ruby Green",      code: "RGREEN",  sort: 40 },
  { name: "Brown",           code: "BROWN",   sort: 41 },
  { name: "All",             code: "ALL",     sort: 42 },
  { name: "Lemon",           code: "LEMON",   sort: 43 },
  { name: "Mustard",         code: "MUSTARD", sort: 44 },
  { name: "Off White",       code: "OWHITE",  sort: 45 },
  { name: "Matte Gold",      code: "MGOLD",   sort: 46 },
  { name: "Rainbow",         code: "RAIN",    sort: 47 },
  { name: "Pearl",           code: "PEARL",   sort: 48 },
  { name: "Matte Silver",    code: "MSLVER",  sort: 49 },
  { name: "Multicolor 3",    code: "MULTI3",  sort: 50 },
  { name: "Multicolor 4",    code: "MULTI4",  sort: 51 },
  { name: "Multicolor 5",    code: "MULTI5",  sort: 52 },
  { name: "Golden 2",        code: "GOLD2",   sort: 53 },
  { name: "Silver 2",        code: "SILVER2", sort: 54 },
  { name: "Ocean Blue",      code: "OBLUE",   sort: 55 },
  { name: "Move",            code: "MOVE",    sort: 56 },
  { name: "Peach 2",         code: "PEACH2",  sort: 57 },
  { name: "Peach 3",         code: "PEACH3",  sort: 58 },
  { name: "Gajri 2",         code: "GAJRI2",  sort: 59 },
  { name: "Gajri 3",         code: "GAJRI3",  sort: 60 },
  { name: "Golden 3",        code: "GOLD3",   sort: 61 },
  { name: "Golden 4",        code: "GOLD4",   sort: 62 },
  { name: "Silver 3",        code: "SILVER3", sort: 63 },
  { name: "Silver 4",        code: "SILVER4", sort: 64 },
  { name: "Mint 2",          code: "MINT2",   sort: 65 },
  { name: "Dual Tone",       code: "DTONE",   sort: 66 },
  { name: "Red 2",           code: "RED2",    sort: 67 },
  { name: "Lavender 2",      code: "LAV2",    sort: 68 },
  { name: "Golden 5",        code: "GOLD5",   sort: 69 },
  { name: "Light Golden",    code: "LGOLD",   sort: 70 },
  { name: "Feroji",          code: "FEROJI",  sort: 71 },
  { name: "Black and White", code: "BWHITE",  sort: 72 },
  { name: "Ruby Mint",       code: "RMINT",   sort: 73 },
  { name: "Ruby 2",          code: "RUBY2",   sort: 74 },
  { name: "Green Mint",      code: "GMINT",   sort: 75 },
] as const;

/** Letters+digits only, lowercased — so "Silver 2", "silver2", "SILVER-2" are the same key. */
export function compactColorKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const m = a.length, n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

/** Shop typos / synonyms that compact-match would miss (gold ≠ golden, silvar ≠ silver). */
const COLOR_ALIASES: Record<string, string> = {
  silvar: "Silver", silwer: "Silver", sliver: "Silver", slivar: "Silver", siler: "Silver", silvr: "Silver",
  gold: "Golden", golden: "Golden", gld: "Golden",
  gray: "Grey", grey: "Grey",
  gren: "Green", grn: "Green", greeen: "Green", greene: "Green",
  rani: "Magenta", ranipink: "Magenta", magent: "Magenta",
  ferozi: "Feroji", firozi: "Feroji", firoji: "Feroji",
  oxodised: "skip", oxidised: "skip", oxidized: "skip", // polish, never a colour
  rumimint: "Ruby Mint",
  offwhite: "Off White", offwhte: "Off White",
  rosegold: "Rose Gold", rosegld: "Rose Gold",
  skyblue: "Sky Blue", royalblue: "Royal Blue", navyblue: "Navy Blue",
  peacockgreen: "Peacock Green", peacockblue: "Peacock Blue",
  babypink: "Baby Pink", blushpink: "Blush Pink",
  lightgold: "Light Golden", lightgolden: "Light Golden",
  mattegold: "Matte Gold", mattesilver: "Matte Silver", matteslver: "Matte Silver",
  blackwhite: "Black and White", blackandwhite: "Black and White", bnw: "Black and White",
  dualtone: "Dual Tone", dual: "Dual Tone",
  multi1: "Multicolor 1", multi2: "Multicolor 2", multi3: "Multicolor 3",
  multi4: "Multicolor 4", multi5: "Multicolor 5",
  multicolor1: "Multicolor 1", multicolor2: "Multicolor 2",
  multicolour1: "Multicolor 1", multicolour2: "Multicolor 2",
};

const BY_NAME = new Map<string, ColorEntry>(
  COLOR_CATALOG.map((c) => [c.name.toLowerCase(), c]),
);
const BY_COMPACT = new Map<string, ColorEntry>();
for (const c of COLOR_CATALOG) {
  const k = compactColorKey(c.name);
  const prev = BY_COMPACT.get(k);
  if (!prev || c.name.length >= prev.name.length) BY_COMPACT.set(k, c);
}
const COMPACT_KEYS = [...BY_COMPACT.keys()];

/** Resolve any spelling/casing/spacing of a colour to the catalog entry, or null. */
export function findColor(name: string | null | undefined): ColorEntry | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const exact = BY_NAME.get(trimmed.toLowerCase());
  if (exact) return exact;
  const key = compactColorKey(trimmed);
  if (!key) return null;
  const alias = COLOR_ALIASES[key];
  if (alias === "skip") return null;
  if (alias) return BY_NAME.get(alias.toLowerCase()) ?? null;
  const compact = BY_COMPACT.get(key);
  if (compact) return compact;
  // Missing a letter: "gren" is a prefix of "green" (+1). Prefer that over a same-distance
  // substitution ("grey") — at the jewellery counter gren always means Green.
  if (key.length >= 4) {
    const missingLetter = COMPACT_KEYS.filter((ck) => ck.startsWith(key) && ck.length === key.length + 1);
    if (missingLetter.length === 1) return BY_COMPACT.get(missingLetter[0])!;
    const extraLetter = COMPACT_KEYS.filter((ck) => key.startsWith(ck) && key.length === ck.length + 1);
    if (extraLetter.length === 1) return BY_COMPACT.get(extraLetter[0])!;
  }
  // One-character typo against a unique catalog key (SILVAR → Silver). Skip when several
  // colours are equally close so "Silver" never swallows "Silver 2". If they tie, the
  // missing-letter (prefix) candidate still wins.
  if (key.length >= 4) {
    let best: ColorEntry | null = null;
    let bestD = 99;
    let ties = 0;
    const d1: string[] = [];
    for (const ck of COMPACT_KEYS) {
      if (Math.abs(ck.length - key.length) > 1) continue;
      const d = editDistance(key, ck);
      if (d === 1) d1.push(ck);
      if (d > 1 || (d >= bestD && d !== 0)) {
        if (d === bestD && d <= 1) ties++;
        continue;
      }
      if (d < bestD) { bestD = d; best = BY_COMPACT.get(ck)!; ties = 1; }
    }
    if (best && ties === 1 && bestD === 1) return best;
    if (bestD === 1 && d1.length > 1) {
      const prefix = d1.filter((ck) => ck.startsWith(key) && ck.length === key.length + 1);
      if (prefix.length === 1) return BY_COMPACT.get(prefix[0])!;
    }
  }
  return null;
}

/** Canonical display name ("Silver") for storage, or null if this isn't a known colour. */
export function canonicalColorName(name: string | null | undefined): string | null {
  return findColor(name)?.name ?? null;
}

/** Snap a typed value to the catalog name when we can; otherwise keep the trimmed original. */
export function snapColorName(name: string | null | undefined): string {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return "";
  return canonicalColorName(trimmed) ?? trimmed;
}

/** True when `value` is a misspelling / case-duplicate of a catalog colour (safe to drop from master). */
export function isRedundantColorOption(value: string): boolean {
  const canon = canonicalColorName(value);
  if (!canon) return false;
  return canon !== value.trim();
}

/** The barcode suffix for a colour, or a sensible fallback derived from the name. */
export function barcodeCodeForColor(name: string | null | undefined): string | null {
  if (!name) return null;
  const hit = findColor(name);
  if (hit) return hit.code;
  // Fallback: uppercase, alphanum-only, first 6 chars — never returns "" so the caller
  // can always append it to a parent SKU and get a unique-ish variant code.
  const fallback = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return fallback || null;
}

/** Catalog colours first, then any genuine custom colours — never SILVAR / silver / Silver2 duplicates. */
export function uniqueColorOptions(dbValues: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of COLOR_CATALOG) {
    seen.add(c.name.toLowerCase());
    out.push(c.name);
  }
  for (const raw of dbValues) {
    const v = String(raw ?? "").trim();
    if (!v || seen.has(v.toLowerCase()) || isRedundantColorOption(v)) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}

/** Build the canonical variant SKU for a given parent SKU + colour name (and optional
 *  size / polish). Used by every auto-SKU code path so the printed barcode is consistent. */
export function buildVariantSku(parentSku: string, parts: { color?: string | null; size?: string | null; polish?: string | null }): string {
  const colorCode = parts.color ? barcodeCodeForColor(parts.color) : null;
  const sizeCode = parts.size ? parts.size.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) : null;
  const polishCode = parts.polish ? parts.polish.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) : null;
  const suffix = [colorCode, sizeCode, polishCode].filter(Boolean).join("-") || "VAR";
  return `${parentSku}-${suffix}`;
}
