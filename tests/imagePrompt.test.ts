import { describe, it, expect } from "vitest";
import { buildImagePrompt, shotTypeFor } from "../lib/ai/imagePrompt";

describe("buildImagePrompt", () => {
  it("injects category-specific shot type", () => {
    expect(buildImagePrompt({ category: "necklace" })).toContain("décolletage");
    expect(buildImagePrompt({ category: "earrings" })).toContain("ear and jawline");
    expect(buildImagePrompt({ category: "ring" })).toContain("the hand");
  });
  it("keeps the non-negotiable no-text clause", () => {
    const p = buildImagePrompt({ category: "bracelet" });
    expect(p).toContain("ZERO text");
    expect(p).toContain("NON-NEGOTIABLE — PRODUCT FIDELITY");
  });
  it("respects aspect ratio", () => {
    expect(buildImagePrompt({ category: "ring", aspect: "1:1" })).toContain("1:1 for thumbnails");
  });
  it("is deterministic per index", () => {
    expect(buildImagePrompt({ category: "ring", index: 0 })).toBe(buildImagePrompt({ category: "ring", index: 0 }));
  });
  it("falls back for unknown category", () => {
    expect(shotTypeFor("tiara")).toContain("hero");
  });
});
