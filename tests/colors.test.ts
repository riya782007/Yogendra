import { describe, it, expect } from "vitest";
import { canonicalColorName, findColor, snapColorName, isRedundantColorOption, barcodeCodeForColor } from "../lib/colors";

describe("canonical colour snap (bulk-upload typos)", () => {
  it("maps every Silver spelling to Silver, not a new colour", () => {
    for (const s of ["silver", "SILVER", "Silver", "Silvar", "SILVAR", "silwer", " sliver "]) {
      expect(canonicalColorName(s), s).toBe("Silver");
    }
  });

  it("keeps numbered silvers distinct from plain Silver", () => {
    expect(canonicalColorName("Silver 2")).toBe("Silver 2");
    expect(canonicalColorName("silver2")).toBe("Silver 2");
    expect(canonicalColorName("SILVER2")).toBe("Silver 2");
    expect(canonicalColorName("Silver 3")).toBe("Silver 3");
    expect(canonicalColorName("Silver4")).toBe("Silver 4");
    expect(canonicalColorName("Silver")).toBe("Silver");
  });

  it("does not collapse Matte Silver into Silver", () => {
    expect(canonicalColorName("Matte Silver")).toBe("Matte Silver");
    expect(canonicalColorName("mattesilver")).toBe("Matte Silver");
  });

  it("maps Gold to Golden (catalog name) without touching Rose Gold", () => {
    expect(canonicalColorName("gold")).toBe("Golden");
    expect(canonicalColorName("GOLDEN")).toBe("Golden");
    expect(canonicalColorName("Rose Gold")).toBe("Rose Gold");
    expect(canonicalColorName("Matte Gold")).toBe("Matte Gold");
  });

  it("treats case/space duplicates as redundant master rows", () => {
    expect(isRedundantColorOption("SILVAR")).toBe(true);
    expect(isRedundantColorOption("silver")).toBe(true);
    expect(isRedundantColorOption("Silver2")).toBe(true);
    expect(isRedundantColorOption("Silver")).toBe(false);
    expect(isRedundantColorOption("Silver 2")).toBe(false);
    expect(isRedundantColorOption("Champagne")).toBe(false);
  });

  it("barcode codes follow the canonical colour", () => {
    expect(barcodeCodeForColor("SILVAR")).toBe("SILVER");
    expect(barcodeCodeForColor("silver2")).toBe("SILVER2");
    expect(barcodeCodeForColor("gold")).toBe("GOLD");
  });

  it("snap keeps unknown names so a real new colour is not invented", () => {
    expect(snapColorName("Champagne")).toBe("Champagne");
    expect(snapColorName("  SILVAR ")).toBe("Silver");
    expect(findColor("oxidised")).toBeNull();
  });
});
