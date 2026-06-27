"use server";
/**
 * "Sell with us" — product submissions from customers (storefront) and approved wholesalers
 * (trade panel). Two halves:
 *
 *   1. submitProductAction(formData)  — PUBLIC. Anyone on the storefront, or a logged-in
 *                                       wholesaler, proposes a product (name, price, qty, photo).
 *                                       It's stored as 'pending' and the owner is pinged on
 *                                       WhatsApp. Nothing touches the live catalogue yet.
 *   2. decideSubmissionAction(formData) — ADMIN (catalog.create). Approve → the submission is
 *                                       turned into a DRAFT catalogue product (reusing the same
 *                                       creation engine staff use), then the owner can publish it
 *                                       from the catalogue. Reject → archived with a note.
 *
 * Keeping approved items as DRAFT (not auto-published) is deliberate: a stranger's submission
 * never appears on the storefront without a human saying "publish".
 */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { getWholesaleSession } from "@/lib/wholesale";
import { createProductAction } from "@/app/actions/catalog";
import { logActivity } from "@/lib/audit";
import { sendWhatsAppText, toE164 } from "@/lib/whatsapp";

const BUCKET = "product-media";
const STORE = () => process.env.NEXT_PUBLIC_STORE_NAME || "Blythe Diva";

async function ensureMediaBucket(sb: ReturnType<typeof supabaseServer>) {
  await sb.storage.createBucket(BUCKET, { public: true }).catch(() => {});
}

function rupees(paise: number): string {
  return "₹" + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

/** PUBLIC — a customer or logged-in wholesaler proposes a product for the store to stock. */
export async function submitProductAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const sb = supabaseServer();

  // Channel: 'wholesale' only counts when there's a verified, approved wholesale session;
  // otherwise it's a regular storefront ('retail') submission.
  const requestedChannel = String(formData.get("channel") ?? "retail");
  const session = requestedChannel === "wholesale" ? await getWholesaleSession() : null;
  const channel = session ? "wholesale" : "retail";

  const productName = String(formData.get("productName") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const categoryId = String(formData.get("categoryId") ?? "").trim() || null;
  const categoryOther = String(formData.get("categoryOther") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const color = String(formData.get("color") ?? "").trim() || null;
  const askingRupees = Number(formData.get("askingPrice")) || 0;
  const qty = Math.max(0, Math.floor(Number(formData.get("qty")) || 0));

  // Validation — keep it friendly for a public form.
  if (!productName) return { ok: false, error: "Please add the product name." };
  if (!(askingRupees > 0)) return { ok: false, error: "Please enter the price you're asking (in ₹)." };
  if (!session) {
    // Storefront submitters must leave a way to reach them.
    if (!name) return { ok: false, error: "Please add your name." };
    if (!phone) return { ok: false, error: "Please add a phone number so we can reach you." };
  }

  // Resolve verified contact details for a logged-in wholesaler from the CRM.
  let submitterName = name || null;
  let submitterPhone = phone || null;
  let submitterCustomerId: string | null = null;
  if (session) {
    submitterCustomerId = session.id;
    submitterName = session.name || submitterName;
    const { data: cust } = await sb.from("customers").select("phone").eq("id", session.id).maybeSingle();
    submitterPhone = (cust as any)?.phone || submitterPhone;
  }

  const { data: row, error } = await sb
    .from("product_submissions")
    .insert({
      channel,
      submitter_customer_id: submitterCustomerId,
      submitter_name: submitterName,
      submitter_phone: submitterPhone,
      submitter_email: email || null,
      product_name: productName,
      category_id: categoryId,
      category_other: categoryOther,
      description,
      color,
      asking_price: Math.round(askingRupees * 100),
      qty,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  const id = (row as any).id as string;

  // Optional photo → product-media bucket under submissions/<id>.<ext>.
  const file = formData.get("image") as File | null;
  if (file && typeof file === "object" && file.size > 0) {
    try {
      await ensureMediaBucket(sb);
      const ext = ((file.type.split("/")[1]) || "jpg").replace("jpeg", "jpg");
      const path = `submissions/${id}.${ext}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: file.type || "image/jpeg", upsert: true });
      if (!up.error) {
        const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
        await sb.from("product_submissions").update({ image_path: pub.publicUrl }).eq("id", id);
      }
    } catch {
      /* photo is optional — never fail the submission on an upload hiccup */
    }
  }

  // Ping the owner on WhatsApp (best-effort, non-blocking).
  const owner = toE164(process.env.OWNER_WHATSAPP_NUMBER);
  if (owner) {
    const who = session ? `Wholesaler ${submitterName}` : `${submitterName || "A customer"}`;
    await sendWhatsAppText(
      owner,
      `🆕 New product submission for ${STORE()}\n${who} (${submitterPhone || "no phone"})\n“${productName}” · ${rupees(Math.round(askingRupees * 100))} · ${qty} pc(s)\nReview it in Admin → Submissions.`,
    ).catch(() => {});
  }

  await logActivity({ action: "product_submitted", ref: id, detail: `${channel} submission “${productName}” from ${submitterName || "unknown"}.` }).catch(() => {});
  revalidatePath("/admin/submissions");
  return { ok: true, id };
}

/** ADMIN — approve (→ draft catalogue product) or reject a submission. */
export async function decideSubmissionAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; sku?: string }> {
  if (!(await requirePerm("catalog.create"))) return { ok: false, error: "Your role can't review submissions." };
  const id = String(formData.get("id") ?? "").trim();
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!id) return { ok: false, error: "Missing submission id." };

  const sb = supabaseServer();
  const { data: sub } = await sb.from("product_submissions").select("*").eq("id", id).maybeSingle();
  if (!sub) return { ok: false, error: "Submission not found." };
  if ((sub as any).status !== "pending") return { ok: false, error: "This submission was already reviewed." };
  const s = sub as any;

  // ---- Reject ----
  if (decision !== "approve") {
    await sb.from("product_submissions").update({ status: "rejected", review_note: note, decided_at: new Date().toISOString() }).eq("id", id);
    await logActivity({ action: "submission_rejected", ref: id, detail: `Rejected “${s.product_name}”.` }).catch(() => {});
    revalidatePath("/admin/submissions");
    return { ok: true };
  }

  // ---- Approve → create a DRAFT catalogue product via the standard creation engine ----
  // Allow the reviewer to override the category at decision time (a stranger may not have
  // picked the right one); fall back to whatever they submitted.
  const categoryId = String(formData.get("categoryId") ?? "").trim() || s.category_id;
  if (!categoryId) return { ok: false, error: "Pick a category before approving." };
  const basePriceRupees = (Number(s.asking_price) || 0) / 100;
  if (!(basePriceRupees > 0)) return { ok: false, error: "Submission has no valid price." };

  const color = (s.color ?? "").trim();
  const res = await createProductAction({
    categoryId,
    name: s.product_name,
    basePriceRupees,
    qty: Math.max(0, Math.floor(Number(s.qty) || 0)),
    type: color ? "configurable" : "simple",
    colors: color ? [color] : [],
  });
  if (!res.ok || !res.sku) return { ok: false, error: res.error || "Couldn't create the product." };

  // Carry the submitted photo over to the new product so the reviewer doesn't re-upload.
  if (s.image_path) {
    const { data: prod } = await sb.from("products").select("id").eq("sku", res.sku).maybeSingle();
    if (prod) await sb.from("product_images").insert({ product_id: (prod as any).id, path: s.image_path, kind: "flatlay", sort: 0 });
  }

  await sb.from("product_submissions").update({
    status: "approved",
    review_note: note,
    created_product_sku: res.sku,
    decided_at: new Date().toISOString(),
  }).eq("id", id);

  await logActivity({ action: "submission_approved", ref: res.sku, detail: `Approved “${s.product_name}” → ${res.sku} (draft).` }).catch(() => {});

  // Let the submitter know we accepted it (best-effort).
  const subPhone = toE164(s.submitter_phone);
  if (subPhone) {
    await sendWhatsAppText(subPhone, `Good news! ${STORE()} has accepted your product “${s.product_name}”. Our team will be in touch about the next steps. 💛`).catch(() => {});
  }

  revalidatePath("/admin/submissions");
  revalidatePath("/admin/catalogue");
  return { ok: true, sku: res.sku };
}
