import { describe, it, expect } from "vitest";
import { normalizeListing, parseModelJson } from "../lib/ai/normalizeListing";
import { z } from "zod";

const schema = z.object({
  title: z.string().min(2), description: z.string().min(60), specs: z.record(z.string()),
  tags: z.array(z.string()).min(4),
  seo: z.object({ metaTitle: z.string(), metaDescription: z.string(), keywords: z.array(z.string()).min(5) }),
});
const desc = "A regal kundan necklace set with pearl drops and a matching maang tikka, made for weddings. Shop at BlytheDIVA.";

describe("normalizeListing", () => {
  it("fixes the common model slips so the schema passes", () => {
    const raw = {
      Title: "Aanya Kundan Pearl Bridal Necklace Set", Description: desc,
      Specs: { Category: "Necklace Set", "Box Containing": ["Necklace", "Maang Tikka"], Material: "Alloy" },
      tags: "kundan, bridal necklace, pearl, wedding jewellery",
      SEO: { meta_title: "Kundan Bridal Necklace", keywords: "kundan necklace, bridal set" },
    };
    const r = schema.safeParse(normalizeListing(raw));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.specs["Box Containing"]).toBe("Necklace, Maang Tikka");
      expect(r.data.seo.metaTitle).toBe("Kundan Bridal Necklace");
      expect(r.data.seo.keywords.length).toBeGreaterThanOrEqual(5);
    }
  });
  it("unwraps { product: {...} }, builds missing seo and reads spec arrays", () => {
    const raw = { product: { title: "Aanya Set", description: desc, specs: [{ key: "Material", value: "Alloy" }, "Care: Keep dry"], tags: ["a", "b", "c", "d", "e"] } };
    const r = schema.safeParse(normalizeListing(raw));
    expect(r.success).toBe(true);
    if (r.success) { expect(r.data.specs).toEqual({ Material: "Alloy", Care: "Keep dry" }); expect(r.data.seo.metaTitle).toBe("Aanya Set"); }
  });
  it("parses fenced JSON", () => {
    expect(parseModelJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});
