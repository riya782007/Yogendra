import { describe, it, expect } from "vitest";
import { isCodOrder, isCodPaymentMode, isFullyPaid, isPendingCodQueue, isPrepaidOrder } from "../lib/orderPayment";

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
  it("a leftover payment_mode=cod that is actually paid is PREPAID, not COD", () => {
    const o = { payment_mode: "cod", amount_paid: 180000, total: 180000 };
    expect(isCodOrder(o)).toBe(false);
    expect(isPrepaidOrder(o)).toBe(true);
  });
  it("unpaid online (awaiting verify) is still prepaid, not COD", () => {
    const o = { payment_mode: "upi", amount_paid: 0, total: 90000 };
    expect(isCodOrder(o)).toBe(false);
    expect(isPrepaidOrder(o)).toBe(true);
  });
});

describe("isPendingCodQueue", () => {
  it("held unpaid COD belongs on the dashboard COD panel", () => {
    expect(isPendingCodQueue({
      cod_hold: true, payment_mode: "cod", amount_paid: 0, total: 425160, status: "completed",
    })).toBe(true);
  });
  it("a prepaid hold does not belong on the COD panel", () => {
    expect(isPendingCodQueue({
      cod_hold: true, payment_mode: "online", amount_paid: 541550, total: 541550, status: "completed",
    })).toBe(false);
  });
  it("confirmed / cancelled COD drops off the queue", () => {
    expect(isPendingCodQueue({
      cod_hold: false, payment_mode: "cod", amount_paid: 0, total: 100, status: "completed",
    })).toBe(false);
    expect(isPendingCodQueue({
      cod_hold: true, payment_mode: "cod", amount_paid: 0, total: 100, status: "cancelled",
    })).toBe(false);
  });
});
