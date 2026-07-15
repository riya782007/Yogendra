"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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
  const phone = String(formData.get("phone") ?? "").replace(/\D/g, "").slice(-10);
  if (name.length < 2) return { ok: false, error: "Please enter your name or firm name." };
  if (phone.length !== 10) return { ok: false, error: "Please enter a valid 10-digit phone number." };
  const city = String(formData.get("city") ?? "").trim() || null;
  const gstin = String(formData.get("gstin") ?? "").trim().toUpperCase() || null;
  const address = String(formData.get("address") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  const sb = supabaseServer();

  // Business-proof image (GST cert / shop photo / visiting card) — stored so the team can verify.
  let proofUrl: string | null = null;
  const file = formData.get("proof");
  if (file && file instanceof File && file.size > 0) {
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const ext = (file.type?.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
      const path = `dealer-proofs/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const up = await sb.storage.from("product-media").upload(path, bytes, { contentType: file.type || "image/jpeg", upsert: true });
      if (!up.error) proofUrl = sb.storage.from("product-media").getPublicUrl(path).data.publicUrl;
    } catch { /* proof is best-effort — the application still goes through */ }
  }

  // Create / refresh the customer as a PENDING wholesale dealer (owner approves + issues code next).
  const notes = `Dealer application via website${proofUrl ? ` · Business proof: ${proofUrl}` : " · (no proof uploaded)"}`;
  const { data: existing } = await sb.from("customers").select("id").ilike("phone", `%${phone}`).limit(1);
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

/** Wholesale customer logs in with phone + access code (must be approved). */
export async function wholesaleLoginAction(formData: FormData) {
  // Match on the last 10 digits + code so any phone format the dealer types (+91, spaces, leading 0)
  // still works — an exact string match was rejecting valid, approved dealers.
  const phone10 = String(formData.get("phone") ?? "").replace(/\D/g, "").slice(-10);
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  if (phone10.length !== 10) redirect("/trade/login?error=format"); // clear "phone format" hint
  if (!code) redirect("/trade/login?error=1");
  const { data } = await supabaseServer()
    .from("customers").select("id,phone")
    .eq("type", "wholesale").eq("wholesale_approved", true).eq("login_code", code)
    .limit(20);
  const match = ((data as any[]) ?? []).find((c) => String(c.phone ?? "").replace(/\D/g, "").slice(-10) === phone10);
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
