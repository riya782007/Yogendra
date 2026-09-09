import { describe, it, expect } from "vitest";
import { shouldOpenTradeLead } from "../lib/tradeLead";

describe("trade visitor overlay", () => {
  it("stays closed when the catalogue failed to load", () => {
    expect(shouldOpenTradeLead(0, false)).toBe(false);
  });

  it("opens for a guest who has designs and has not submitted", () => {
    expect(shouldOpenTradeLead(48, false)).toBe(true);
  });

  it("stays closed for a returning visitor", () => {
    expect(shouldOpenTradeLead(48, true)).toBe(false);
  });
});
