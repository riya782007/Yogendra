/**
 * lib/business.ts — Seller profile + GST/invoice helpers (B2B jewellery).
 *
 * EDIT THIS ONE FILE with Yogendra's real registration details and they flow into
 * every Tax Invoice, Cash Memo and Estimate/Quotation across the console.
 *
 * Imitation/artificial jewellery → HSN 7117, GST 3% (CGST 1.5 + SGST 1.5 intra-state,
 * or IGST 3% inter-state). Change GST_RATE / HSN if the product mix differs.
 */
export const BUSINESS = {
  brand: "Blythe Diva",
  legalName: "Yogendra Industries (India)",
  address: "5150-B, Rui Mandi, Sadar Bazar, Delhi-110006",
  stateName: "Delhi",
  stateCode: "07", // GST state code for Delhi
  gstin: "07AAIPJ3244P1ZD",
  pan: "AAIPJ3244P",
  tin: "07200035767",
  phone: "+91 98731 51767",
  email: "hello@blythediva.in",
  bank: {
    name: "Kotak Mahindra Bank",
    account: "", // ← add the A/c number
    ifsc: "",    // ← add the IFSC
    branch: "Delhi",
  },
  terms: [
    "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
    "Interest @18% p.a. is charged on bills not paid within 15 days.",
    "Subject to Delhi jurisdiction only.",
  ],
} as const;

export const HSN_JEWELLERY = "7117";
export const GST_RATE = 3; // percent, for imitation jewellery

/** Split an inclusive total (paise) into taxable value + GST at GST_RATE. */
export function splitGstInclusive(totalPaise: number) {
  const taxable = Math.round(totalPaise / (1 + GST_RATE / 100));
  const tax = totalPaise - taxable;
  return { taxable, tax };
}

/** Decide intra- vs inter-state from the buyer's GST state code (first 2 of GSTIN). */
export function gstSplit(totalPaise: number, buyerStateCode?: string | null) {
  const { taxable, tax } = splitGstInclusive(totalPaise);
  const interState = !!buyerStateCode && buyerStateCode !== BUSINESS.stateCode;
  if (interState) {
    return { taxable, interState, igst: tax, cgst: 0, sgst: 0, tax };
  }
  const cgst = Math.round(tax / 2);
  const sgst = tax - cgst;
  return { taxable, interState, igst: 0, cgst, sgst, tax };
}

/**
 * GST-EXCLUSIVE split (#13): the input is the taxable value and GST is added ON TOP.
 * Used for wholesale (B2B) tax invoices, where the wholesale rate is pre-tax.
 * Returns the same shape as gstSplit; grand total = taxable + tax.
 */
export function gstSplitExclusive(taxablePaise: number, buyerStateCode?: string | null) {
  const taxable = Math.round(taxablePaise);
  const tax = Math.round((taxable * GST_RATE) / 100);
  const interState = !!buyerStateCode && buyerStateCode !== BUSINESS.stateCode;
  if (interState) return { taxable, interState, igst: tax, cgst: 0, sgst: 0, tax };
  const cgst = Math.round(tax / 2);
  const sgst = tax - cgst;
  return { taxable, interState, igst: 0, cgst, sgst, tax };
}

/** First two digits of a GSTIN = state code. */
export function stateCodeFromGstin(gstin?: string | null): string | null {
  if (!gstin) return null;
  const m = gstin.trim().slice(0, 2);
  return /^\d{2}$/.test(m) ? m : null;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10), o = n % 10;
  return TENS[t] + (o ? " " + ONES[o] : "");
}

/** Indian-system words for a whole rupee amount. */
function rupeesToWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = Math.floor(n / 100); n %= 100;
  if (crore) parts.push(twoDigits(crore) + " Crore");
  if (lakh) parts.push(twoDigits(lakh) + " Lakh");
  if (thousand) parts.push(twoDigits(thousand) + " Thousand");
  if (hundred) parts.push(ONES[hundred] + " Hundred");
  if (n) parts.push((parts.length ? "and " : "") + twoDigits(n));
  return parts.join(" ");
}

/** "Rupees … Only" from an integer paise amount, including paise. */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  let out = "Rupees " + rupeesToWords(rupees);
  if (p) out += " and " + twoDigits(p) + " Paise";
  return out + " Only";
}
