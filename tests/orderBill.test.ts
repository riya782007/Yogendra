import { describe, expect, it } from "vitest";
import {
  billTypeFromTax,
  gstModeFromTax,
  orderPayablePaise,
  orderStoredTotalPaise,
  taxFromBill,
} from "../lib/orderBill";

describe("orderStoredTotalPaise", () => {
  it("adds packing, courier and adjustment on top of the goods", () => {
    expect(orderStoredTotalPaise({
      itemsPaise: 100000,
      packingPaise: 2500,
      courierPaise: 8000,
      adjustmentPaise: -100,
    })).toBe(110400);
  });

  it("folds 3% GST into wholesale GST bills (same as add_order_line)", () => {
    expect(orderStoredTotalPaise({
      itemsPaise: 100000,
      packingPaise: 0,
      courierPaise: 0,
      channel: "wholesale",
      billType: "gst",
    })).toBe(103000);
  });

  it("does not mark up retail or cash bills", () => {
    expect(orderStoredTotalPaise({ itemsPaise: 100000, channel: "retail", billType: "gst" })).toBe(100000);
    expect(orderStoredTotalPaise({ itemsPaise: 100000, channel: "wholesale", billType: "cash" })).toBe(100000);
  });
});

describe("orderPayablePaise / tax mapping", () => {
  it("adds GST on top only when exclusive", () => {
    expect(orderPayablePaise(100000, "exclusive")).toBe(103000);
    expect(orderPayablePaise(100000, "inclusive")).toBe(100000);
    expect(orderPayablePaise(100000, "none")).toBe(100000);
  });

  it("maps cash memo vs GST inclusive/exclusive the way the create-bill screen does", () => {
    expect(billTypeFromTax("none")).toBe("cash");
    expect(gstModeFromTax("none")).toBeNull();
    expect(billTypeFromTax("exclusive")).toBe("gst");
    expect(gstModeFromTax("inclusive")).toBe("inclusive");
    expect(taxFromBill("cash", null)).toBe("none");
    expect(taxFromBill("gst", "exclusive")).toBe("exclusive");
    expect(taxFromBill("gst", null)).toBe("inclusive");
  });
});
