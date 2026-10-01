import { describe, it, expect } from "vitest";
import { isCodOrder, isCodPaymentMode, isFullyPaid, isPrepaidOrder, isStorefrontPrepaidOrder } from "../lib/orderPayment";

describe("isCodPaymentMode", () => {
  it("accepts any casing of cod", () => {
    expect(isCodPaymentMode("cod")).toBe(true);
    expect(isCodPaymentMode("COD")).toBe(true);
    expect(isCodPaymentMode(" Cod ")).toBe(true);
  });
  it("rejects prepaid modes", () => {
    expect(isCodPaymentMode("online")).toBe(false);
    expect(isCodPaymentMode("upi")).toBe(false);
    expect(isCodPaymentMode("razorpay")).toBe(false);
    expect(isCodPaymentMode(null)).toBe(false);
  });
});

describe("isFullyPaid", () => {
  it("true when paid covers the total", () => {
    expect(isFullyPaid(50000, 50000)).toBe(true);
    expect(isFullyPaid(60000, 50000)).toBe(true);
  });
  it("false when unpaid or zero bill", () => {
    expect(isFullyPaid(0, 50000)).toBe(false);
    expect(isFullyPaid(100, 50000)).toBe(false);
    expect(isFullyPaid(0, 0)).toBe(false);
  });
});

describe("COD vs prepaid queues", () => {
  it("unpaid COD belongs only on the COD tab", () => {
    const o = { payment_mode: "cod", amount_paid: 0, total: 250000 };
    expect(isCodOrder(o)).toBe(true);
    expect(isPrepaidOrder(o)).toBe(false);
  });
  it("Razorpay/online belongs only on Storefront Orders", () => {
    const o = { payment_mode: "online", amount_paid: 250000, total: 250000 };
    expect(isCodOrder(o)).toBe(false);
    expect(isPrepaidOrder(o)).toBe(true);
  });
  it("a paid COD order is not actionable from the storefront prepaid queue", () => {
    const o = { payment_mode: "cod", amount_paid: 180000, total: 180000 };
    expect(isCodOrder(o)).toBe(false);
    expect(isPrepaidOrder(o)).toBe(true);
    expect(isStorefrontPrepaidOrder(o)).toBe(false);
  });
  it("unpaid online (awaiting verify) is still prepaid, not COD", () => {
    const o = { payment_mode: "upi", amount_paid: 0, total: 90000 };
    expect(isCodOrder(o)).toBe(false);
    expect(isPrepaidOrder(o)).toBe(true);
    expect(isStorefrontPrepaidOrder(o)).toBe(true);
  });
});
