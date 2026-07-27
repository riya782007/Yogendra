"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { getWholesaleSession } from "@/lib/wholesale";
import { getPricingFormula } from "@/lib/supabase/queries";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { wholesaleShippingPaise, WHOLESALE_COD_FEE_PAISE } from "@/lib/wholesaleShipping";
import { GST_RATE } from "@/lib/business";

const COOKIE = { httpOnly: true, sameSite: "lax" as const, secure: true, path: "/", maxAge: 60 * 60 * 12 };

function genCode(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = ""; for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

/**
 * PUBLIC dealer application (from the /trade/login "Become a dealer" form). Creates a PENDING wholesale
 * customer (auto-appears on Admin → Customers), stores the business-proof image, and pings the owner so
 * he can approve + issue an access code. No auth — this is how new resellers request wholesale access.
 */
export async function applyForWholesaleAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const name = String(formData.get("name") ?? "").trim();
  // Keep ALL digits (including any country code) so INTERNATIONAL numbers work — a US "+1 415…" or a
  // UK "+44 20…" is stored whole, not truncated to 10. Login later matches by suffix, so any format
  // (with/without country code, spaces, dashes, leading 0) still logs the same dealer in.
  const phone = String(formData.get("phone") ?? "").replace(/\D/g, "");
  if (name.length < 2) return { ok: false, error: "Please enter your name or firm name." };
  if (phone.length < 7 || phone.length > 15) return { ok: false, error: "Please enter a valid phone number (with country code for international numbers)." };
  const city = String(formData.get("city") ?? "").trim() || null;
  const gstin = String(formData.get("gstin") ?? "").trim().toUpperCase() || null;
  const address = String(formData.get("address") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  const sb = supabaseServer();

  // Business-proof image (GST cert / shop photo / visiting card) — OPTIONAL. Small resellers were put
  // off by a mandatory upload ("log soch rahe the jaise kidney maang li"), so an application never
  // blocks on it. If one IS provided we still upload it so the owner can verify faster.
  let proofUrl: string | null = null;
  const file = formData.get("proof");
  if (file instanceof File && file.size > 0) {
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const ext = (file.type?.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
      const path = `dealer-proofs/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const up = await sb.storage.from("product-media").upload(path, bytes, { contentType: file.type || "image/jpeg", upsert: true });
      if (!up.error) proofUrl = sb.storage.from("product-media").getPublicUrl(path).data.publicUrl;
    } catch { /* proof is best-effort — never blocks the application */ }
  }

  // Create / refresh the customer as a PENDING wholesale dealer (owner approves next).
  const notes = `Dealer application via website${proofUrl ? ` · Business proof: ${proofUrl}` : " · (no proof uploaded)"}`;
  const { data: existing } = await sb.from("customers").select("id").ilike("phone", `%${phone.slice(-10)}`).limit(1);
  const row: any = { name, phone, email, type: "wholesale", gstin, address, city, notes, wholesale_approved: false };
  if (existing && (existing as any[])[0]) await sb.from("customers").update(row).eq("id", (existing as any[])[0].id);
  else await sb.from("customers").insert(row);

  // Ping the owner (best-effort WhatsApp) — the dashboard "Pending dealer applications" card also lists it.
  try {
    const owner = process.env.OWNER_WHATSAPP_NUMBER;
    if (owner) {
      const lines = [`🔔 New DEALER application`, `Name: ${name}`, `Phone: ${phone}`, city ? `City: ${city}` : "", gstin ? `GSTIN: ${gstin}` : "", proofUrl ? `Proof: ${proofUrl}` : "", `Approve & issue code in Owner Console → Customers.`].filter(Boolean);
      await sendWhatsAppText(owner, lines.join("\n")).catch(() => {});
    }
  } catch { /* never block the applicant */ }

  revalidatePath("/admin/customers"); revalidatePath("/admin/dashboard");
  return { ok: true };
}

/** Two phone numbers are the SAME dealer if the shorter (≥8 digits) is a suffix of the longer. This makes
 *  login format- AND country-code-agnostic: "+1 415 555 1234", "4155551234", "0091-98765 43210" etc. all
 *  match the stored number whether or not the country code was included on either side. */
function samePhone(a: string, b: string): boolean {
  const na = String(a ?? "").replace(/\D/g, "");
  const nb = String(b ?? "").replace(/\D/g, "");
  const [s, l] = na.length <= nb.length ? [na, nb] : [nb, na];
  return s.length >= 8 && l.endsWith(s);
}

/** Wholesale customer logs in with just their PHONE (must be an owner-approved dealer). The access-code
 *  step was removed (owner: "code wala system faltu lagra hai, hata do") — approval alone gates access. */
export async function wholesaleLoginAction(formData: FormData) {
  // INTERNATIONAL-SAFE: normalise to digits and match by suffix (see samePhone) so ANY format the dealer
  // types — with or without country code, spaces, dashes, leading 0 — logs the same approved dealer in.
  const entered = String(formData.get("phone") ?? "").replace(/\D/g, "");
  if (entered.length < 8) redirect("/trade/login?error=format"); // clear "phone format" hint
  const { data } = await supabaseServer()
    .from("customers").select("id,phone")
    .eq("type", "wholesale").eq("wholesale_approved", true).ilike("phone", `%${entered.slice(-8)}`)
    .limit(50);
  const match = ((data as any[]) ?? []).find((c) => samePhone(c.phone, entered));
  if (!match) redirect("/trade/login?error=1");
  cookies().set("bd_wholesale", match.id, COOKIE);
  redirect("/trade");
}

export async function wholesaleLogoutAction() {
  cookies().set("bd_wholesale", "", { httpOnly: true, path: "/", maxAge: 0 });
  redirect("/trade/login");
}

/** Owner: approve/revoke wholesale access and (re)issue an access code. */
export async function approveWholesaleAction(formData: FormData) {
  if (!(await requirePerm("customers.manage"))) return;
  const id = String(formData.get("id") ?? "");
  const approve = String(formData.get("approve") ?? "") === "1";
  if (!id) return;
  const sb = supabaseServer();
  if (approve) {
    const { data: cur } = await sb.from("customers").select("login_code").eq("id", id).maybeSingle();
    const code = (cur as any)?.login_code || genCode();
    await sb.from("customers").update({ wholesale_approved: true, type: "wholesale", login_code: code }).eq("id", id);
  } else {
    await sb.from("customers").update({ wholesale_approved: false }).eq("id", id);
  }
  revalidatePath(`/admin/customer/${id}`); revalidatePath("/admin/customers"); revalidatePath("/admin/dashboard");
}

export async function regenWholesaleCodeAction(formData: FormData) {
  if (!(await requirePerm("customers.manage"))) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await supabaseServer().from("customers").update({ login_code: genCode() }).eq("id", id);
  revalidatePath(`/admin/customer/${id}`);
}

/** Dealer uploads a payment SCREENSHOT (owner's preferred proof) → stored in the public payment-proofs bucket. */
export async function uploadPaymentProofAction(formData: FormData): Promise<{ ok: boolean; url?: string; error?: string }> {
  const sess = await getWholesaleSession();
  if (!sess) return { ok: false, error: "Please log in as an approved wholesale customer." };
  const file = formData.get("file") as unknown as File | null;
  if (!file || typeof (file as any).arrayBuffer !== "function") return { ok: false, error: "No image selected." };
  const sb = supabaseServer();
  const type = (file as any).type || "image/jpeg";
  const ext = (String(type).split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
  const path = `${sess.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buf = Buffer.from(await (file as any).arrayBuffer());
  const { error } = await sb.storage.from("payment-proofs").upload(path, buf, { contentType: type, upsert: false });
  if (error) return { ok: false, error: error.message };
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  return { ok: true, url: `${base}/storage/v1/object/public/payment-proofs/${path}` };
}

/** Guest self-checkout screenshot upload — no session yet (the account is created when the order is
 *  placed). Stored in the same public bucket so it reaches the owner's Wholesale Payments dashboard. */
export async function uploadGuestPaymentProofAction(formData: FormData): Promise<{ ok: boolean; url?: string; error?: string }> {
  const file = formData.get("file") as unknown as File | null;
  if (!file || typeof (file as any).arrayBuffer !== "function") return { ok: false, error: "No image selected." };
  const sb = supabaseServer();
  const type = (file as any).type || "image/jpeg";
  if (!String(type).startsWith("image/")) return { ok: false, error: "Please upload an image." };
  const ext = (String(type).split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
  const path = `guest/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buf = Buffer.from(await (file as any).arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) return { ok: false, error: "Image is too large — please use one under 8 MB." };
  const { error } = await sb.storage.from("payment-proofs").upload(path, buf, { contentType: type, upsert: false });
  if (error) return { ok: false, error: error.message };
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  return { ok: true, url: `${base}/storage/v1/object/public/payment-proofs/${path}` };
}

/**
 * Place a wholesale order. Prices are recomputed server-side at the wholesale rate.
 * Payment is by direct UPI (the dealer scans the owner's QR and pays) — NO Razorpay, so the owner
 * keeps 100% of the revenue. The dealer submits the UPI reference (UTR); we record it on the order
 * and WhatsApp the owner to verify the payment and dispatch.
 */
export async function placeWholesaleOrderAction(
  items: { sku: string; qty: number }[],
  opts?: { paymentRef?: string; cod?: boolean; proofPath?: string },
): Promise<{ ok: boolean; orderId?: string; total?: number; error?: string }> {
  const sess = await getWholesaleSession();
  if (!sess) return { ok: false, error: "Please log in as an approved wholesale customer." };
  return placeWholesaleCore({ id: sess.id, name: (sess as any).name ?? null }, items, opts);
}

/**
 * GUEST wholesale checkout — direct, standard-shopping style (owner: "no approval, seedha checkout").
 * A new buyer fills name / phone / city at the payment step and orders immediately. We auto-create (and
 * auto-APPROVE) their dealer record so they show on the owner's Customers list and can reorder later by
 * phone with no re-typing, and we sign them into the trade session. Payment still runs the same way —
 * scan QR, upload screenshot — and that screenshot lands on the owner's Wholesale Payments dashboard.
 *
 * Trade-off the owner accepted: with no approval gate, anyone with a phone number can order at wholesale
 * rates. The ₹3,000 minimum and the pay-first-then-dispatch flow remain the only guards.
 */
export async function placeGuestWholesaleOrderAction(
  buyer: { name: string; phone: string; city?: string; address?: string; pincode?: string },
  items: { sku: string; qty: number }[],
  opts?: { paymentRef?: string; cod?: boolean; proofPath?: string },
): Promise<{ ok: boolean; orderId?: string; total?: number; error?: string }> {
  const name = String(buyer?.name ?? "").trim();
  const phone = String(buyer?.phone ?? "").replace(/\D/g, "");
  const city = String(buyer?.city ?? "").trim() || null;
  const address = String(buyer?.address ?? "").trim();
  const pincode = String(buyer?.pincode ?? "").replace(/\D/g, "");
  if (name.length < 2) return { ok: false, error: "Please enter your name or firm name." };
  if (phone.length < 7 || phone.length > 15) return { ok: false, error: "Please enter a valid WhatsApp number." };
  // A courier order can't ship without these — require them before the dealer pays.
  if (address.length < 5) return { ok: false, error: "Please enter your full delivery address." };
  if (pincode.length !== 6) return { ok: false, error: "Please enter a valid 6-digit pincode." };
  const fullAddress = [address, city, pincode].filter(Boolean).join(", ");

  const sb = supabaseServer();
  // Reuse an existing record for this number (so repeat buyers don't duplicate); else create one.
  const { data: existing } = await sb.from("customers").select("id").ilike("phone", `%${phone.slice(-10)}`).limit(1);
  let customerId: string;
  if (existing && (existing as any[])[0]) {
    customerId = (existing as any[])[0].id;
    await sb.from("customers").update({ name, city, type: "wholesale", wholesale_approved: true }).eq("id", customerId);
  } else {
    const { data: created, error: cErr } = await sb.from("customers")
      .insert({ name, phone, city, type: "wholesale", wholesale_approved: true, notes: "Self-checkout dealer (auto-approved)" })
      .select("id").single();
    if (cErr || !created) return { ok: false, error: cErr?.message ?? "Could not save your details." };
    customerId = (created as any).id;
  }
  // Sign them into the trade session so history / reorder work without a separate login.
  cookies().set("bd_wholesale", customerId, COOKIE);
  // Save the delivery address on the dealer's account too (best-effort — column set may vary).
  await (sb.from("customers") as any).update({ address: fullAddress, pincode }).eq("id", customerId).then(() => {}, () => {});

  const res = await placeWholesaleCore({ id: customerId, name }, items, opts);
  // The courier needs the address ON the order — record it so the packing slip / bill can ship it.
  if (res.ok && res.orderId) {
    await sb.from("orders").update({ buyer_address: fullAddress, customer_phone: phone }).eq("id", res.orderId).then(() => {}, () => {});
  }
  return res;
}

/** Shared order-placement core used by both the logged-in dealer and the guest self-checkout. */
async function placeWholesaleCore(
  customer: { id: string; name: string | null },
  items: { sku: string; qty: number }[],
  opts?: { paymentRef?: string; cod?: boolean; proofPath?: string },
): Promise<{ ok: boolean; orderId?: string; total?: number; error?: string }> {
  const sess = { id: customer.id, name: customer.name } as any;
  const clean = (items ?? []).filter((i) => i.sku && i.qty > 0).map((i) => ({ sku: i.sku, qty: Math.floor(i.qty) }));
  if (!clean.length) return { ok: false, error: "Enter quantities for at least one product." };
  const sb = supabaseServer();
  // Authoritative pricing: load the global quantity-break tiers from the DB (never trust the client)
  // and hand them to the RPC, which applies the per-line discount as it records the order.
  const formula = await getPricingFormula().catch(() => null);
  const pTiers = (formula?.wholesaleTiers ?? []).map((t) => ({ min_qty: t.minQty, pct_off: t.pctOff }));
  const { data, error } = await sb.rpc("place_wholesale_order", { p_customer: sess.id, p_items: clean, p_allow_oversell: false, p_tiers: pTiers });
  if (error) return { ok: false, error: error.message };
  const orderId = (data as any)?.order_id as string | undefined;
  let total = (data as any)?.total as number | undefined;
  const ref = (opts?.paymentRef ?? "").trim().slice(0, 40);
  const proof = (opts?.proofPath ?? "").trim().slice(0, 400);

  if (orderId) {
    await sb.rpc("assign_invoice_no", { p_order: orderId });

    // SHIPPING (owner's fixed slabs) + COD fee belong IN the bill. Above ₹30k shipping is quoted
    // separately, so nothing is auto-added there.
    const itemsOnly = (total ?? 0) as number;
    // Dealer-facing prices are GST-inclusive (imitation jewellery 3%), so charge the same GST on the
    // recorded total — what the dealer saw equals what they pay. The shipping slab is judged on the
    // GST-inclusive item value too, matching the dealer panel.
    const itemsGst = Math.round(itemsOnly * (1 + GST_RATE / 100));
    // COD CEILING — high-value COD is risky, so wholesale orders above ₹5,000 must be prepaid.
    if (opts?.cod && itemsGst > 500000) {
      await sb.rpc("cancel_order", { p_order_id: orderId, p_reason: "COD not available above ₹5,000" }).then(() => {}, () => {});
      return { ok: false, error: "Cash on Delivery isn't available for orders above ₹5,000 — please pay online (prepaid)." };
    }
    const ship = wholesaleShippingPaise(itemsGst);
    const codFee = opts?.cod ? WHOLESALE_COD_FEE_PAISE : 0;
    total = itemsGst + ship + codFee;
    await sb.from("orders").update({ total, extra_courier: ship + codFee }).eq("id", orderId).then(() => {}, () => {});
    // Record the dealer's UPI payment claim so the owner can match it against his bank/UPI history.
    if (ref) await sb.from("orders").update({ payment_ref: ref, payment_mode: "upi" }).eq("id", orderId);
    // Dealer's payment SCREENSHOT (owner's preferred proof) — stored on the order for one-tap verify.
    if (proof) await sb.from("orders").update({ payment_proof_path: proof, payment_mode: "upi" }).eq("id", orderId);
    // COD wholesale order: nothing received yet — dues stay on the dealer's ledger until collected.
    if (opts?.cod) await sb.from("orders").update({ payment_mode: "cod", amount_paid: 0 }).eq("id", orderId).then(() => {}, () => {});

    // Notify the owner on WhatsApp to verify the UPI payment and dispatch — best-effort, never blocks.
    try {
      const owner = process.env.OWNER_WHATSAPP_NUMBER;
      if (owner) {
        const { data: o } = await sb.from("orders").select("invoice_no,total,customer_name").eq("id", orderId).maybeSingle();
        const inv = (o as any)?.invoice_no || orderId.slice(0, 8).toUpperCase();
        const amt = Math.round((((o as any)?.total ?? total ?? 0) as number) / 100).toLocaleString("en-IN");
        const shipNote = wholesaleShippingPaise((total ?? 0) as number) === 0 && ((total ?? 0) as number) > 3000000
          ? "🚚 Above ₹30,000 — CONTACT the dealer to quote shipping."
          : null;
        const dealer = (sess as any).name || (o as any)?.customer_name || "Dealer";
        const lines = [
          `🔔 New WHOLESALE order ${inv}`,
          `Dealer: ${dealer}`,
          `Amount: ₹${amt}`,
          opts?.cod ? `💵 COD (incl. ₹120 COD fee) — collect ₹${amt} on delivery.` : proof ? `📷 Payment screenshot submitted — verify & dispatch.` : ref ? `UPI ref (UTR): ${ref} — verify this in your UPI/bank, then dispatch.` : `Payment: to be collected.`,
          ...(proof ? [`Proof: ${proof}`] : []),
          ...(shipNote ? [shipNote] : []),
          `Open the Owner Console → Sales to confirm.`,
        ];
        await sendWhatsAppText(owner, lines.join("\n"));
      }
    } catch (e) { console.warn("[wholesale] owner notify failed:", (e as any)?.message); }
  }

  revalidatePath("/admin/sales"); revalidatePath("/admin/dashboard");
  return { ok: true, orderId, total };
}

/**
 * RFQ — a dealer requests a quote for a bulk / custom order (quantities, designs, budget, timeline).
 * We store it and WhatsApp the owner so he can reply with a price. Best-effort notify never blocks.
 */
export async function requestQuoteAction(details: string): Promise<{ ok: boolean; error?: string }> {
  const sess = await getWholesaleSession();
  if (!sess) return { ok: false, error: "Please log in as an approved wholesale customer." };
  const body = (details ?? "").trim();
  if (body.length < 5) return { ok: false, error: "Please add a few details about what you need." };
  const sb = supabaseServer();
  const { data: cust } = await sb.from("customers").select("name,phone").eq("id", sess.id).maybeSingle();
  const dealerName = (sess as any).name || (cust as any)?.name || "Dealer";
  const dealerPhone = (cust as any)?.phone ?? null;

  const { error } = await sb.from("wholesale_quote_requests").insert({
    customer_id: sess.id, dealer_name: dealerName, dealer_phone: dealerPhone, details: body.slice(0, 2000),
  });
  if (error) return { ok: false, error: error.message };

  try {
    const owner = process.env.OWNER_WHATSAPP_NUMBER;
    if (owner) {
      const lines = [
        `📝 New QUOTE REQUEST (wholesale)`,
        `Dealer: ${dealerName}${dealerPhone ? ` · ${dealerPhone}` : ""}`,
        ``,
        body.slice(0, 600),
        ``,
        `Reply to the dealer with your best trade price.`,
      ];
      await sendWhatsAppText(owner, lines.join("\n"));
    }
  } catch (e) { console.warn("[wholesale] rfq notify failed:", (e as any)?.message); }

  return { ok: true };
}

/** Owner: mark a quote request open/closed. */
export async function setQuoteStatusAction(formData: FormData) {
  if (!(await requirePerm("customers.manage"))) return;
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "closed") === "open" ? "open" : "closed";
  if (!id) return;
  await supabaseServer().from("wholesale_quote_requests").update({ status }).eq("id", id);
  revalidatePath("/admin/quotes");
}

/**
 * Owner places a wholesale order ON BEHALF of a dealer, straight from a captured cart (the dealer
 * reached checkout but finished the deal on a call/video — the "inform me, close on video call" flow).
 * Resolves the dealer by the cart's phone, bills the cart's items at live wholesale prices, and marks
 * the cart recovered so it drops off the "not completed" list. `markPaid` records it as already paid.
 */
export async function placeWholesaleOrderFromCartAction(input: { sessionId: string; markPaid?: boolean }): Promise<{ ok: boolean; error?: string; orderId?: string; total?: number }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't place orders." };
  const sid = (input.sessionId ?? "").trim();
  if (!sid) return { ok: false, error: "Missing cart." };
  const sb = supabaseServer();
  const { data: cart } = await sb.from("abandoned_carts").select("session_id,customer_name,phone,items,channel").eq("session_id", sid).maybeSingle();
  if (!cart) return { ok: false, error: "Cart not found (maybe already ordered)." };
  const items = (((cart as any).items as any[]) ?? []).filter((i) => i?.sku && Number(i?.qty) > 0).map((i) => ({ sku: String(i.sku), qty: Math.floor(Number(i.qty)) }));
  if (!items.length) return { ok: false, error: "This cart has no billable items." };

  // Resolve the dealer by phone — must be an approved wholesale customer. Suffix match handles any
  // format (with/without country code), same as wholesale login.
  const digits = String((cart as any).phone ?? "").replace(/\D/g, "");
  let dealerId: string | null = null;
  if (digits.length >= 8) {
    const { data: c } = await sb.from("customers").select("id").eq("type", "wholesale").eq("wholesale_approved", true).ilike("phone", `%${digits.slice(-8)}`).limit(1).maybeSingle();
    dealerId = (c as any)?.id ?? null;
  }
  if (!dealerId) return { ok: false, error: `No approved wholesale dealer found for ${(cart as any).phone ?? "this cart"}. Approve them under Customers first, then place the order.` };

  const formula = await getPricingFormula().catch(() => null);
  const pTiers = (formula?.wholesaleTiers ?? []).map((t) => ({ min_qty: t.minQty, pct_off: t.pctOff }));
  const { data, error } = await sb.rpc("place_wholesale_order", { p_customer: dealerId, p_items: items, p_allow_oversell: false, p_tiers: pTiers });
  if (error) return { ok: false, error: error.message };
  const orderId = (data as any)?.order_id as string | undefined;
  const total = (data as any)?.total as number | undefined;
  if (orderId) {
    await sb.rpc("assign_invoice_no", { p_order: orderId }).then(() => {}, () => {});
    await sb.from("orders").update({ payment_mode: "upi", admin_note: "Placed by owner from captured cart (dealer confirmed on call)" }).eq("id", orderId).then(() => {}, () => {});
    if (input.markPaid && total) await sb.from("orders").update({ amount_paid: total }).eq("id", orderId).then(() => {}, () => {});
  }
  // Mark the cart recovered so it leaves the "not completed" list.
  await sb.from("abandoned_carts").update({ recovered: true }).eq("session_id", sid).then(() => {}, () => {});
  revalidatePath("/admin/abandoned"); revalidatePath("/admin/dashboard"); revalidatePath("/admin/wholesale-payments");
  return { ok: true, orderId, total };
}

/**
 * Owner reviews a dealer's UPI payment screenshot and APPROVES or REJECTS it.
 *  • Approve → marks the order fully paid (amount_paid = total) and records the money as received into
 *    the UPI account (so Bank & Cash updates), then the owner can dispatch. The stock was already
 *    committed at order time, so nothing else changes.
 *  • Reject → flags the order so the owner follows up; nothing is marked paid.
 */
export async function verifyWholesalePaymentAction(input: { orderId: string; approve: boolean }): Promise<{ ok: boolean; error?: string }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't verify payments." };
  const id = (input.orderId ?? "").trim();
  if (!id) return { ok: false, error: "Missing order." };
  const sb = supabaseServer();
  const { data: o } = await sb.from("orders").select("total,amount_paid,channel,invoice_no").eq("id", id).maybeSingle();
  if (!o) return { ok: false, error: "Order not found." };
  if ((o as any).channel !== "wholesale") return { ok: false, error: "Not a wholesale order." };
  const total = (o as any).total ?? 0;
  if (input.approve) {
    await sb.from("orders").update({ amount_paid: total, payment_mode: "upi", admin_note: "✓ Payment verified by owner" }).eq("id", id);
    // Money received into the UPI account → post to that account's book so Bank & Cash reflects it.
    try {
      const { data: m } = await sb.from("payment_methods").select("id").eq("is_default", true).limit(1).maybeSingle();
      const methodId = (m as any)?.id ?? null;
      if (methodId && total > 0) {
        await sb.from("payment_method_transactions").insert({
          method_id: methodId, txn_type: "sale", direction: "in", amount: total,
          ref_type: "order", ref_id: id, note: `Wholesale payment verified · ${(o as any).invoice_no ?? ""}`.trim(), created_by: "owner",
        }).then(() => {}, () => {});
      }
    } catch { /* cash-book best-effort */ }
  } else {
    // Reject = CANCEL the unpaid order. Previously we only wrote a note, so the order stayed in the
    // awaiting list (owner: "reject nahi ho raha") and its stock stayed deducted ("jabardasti stock less
    // ho rakha"). cancel_order releases the held stock back to inventory (restocks every line + reverses
    // any payment) and flips status to 'cancelled', which drops it off the awaiting list for good.
    const { error: cErr } = await sb.rpc("cancel_order", { p_order_id: id, p_reason: "Wholesale payment rejected — dealer didn't confirm" });
    if (cErr) return { ok: false, error: `Couldn't release the order: ${cErr.message}` };
    await sb.from("orders").update({ admin_note: "⚠ Payment REJECTED — order cancelled, stock released" }).eq("id", id);
  }
  revalidatePath("/admin/wholesale-payments"); revalidatePath("/admin/dashboard"); revalidatePath(`/admin/invoice/${id}`);
  // Reject restocks the items — refresh the catalogue/inventory views so the freed stock shows at once.
  revalidatePath("/admin/catalogue"); revalidatePath("/admin/inventory"); revalidateTag("storefront");
  return { ok: true };
}
