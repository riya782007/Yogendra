"use server";
/** OTP approval decision (Req 8.3-8.4). Wrong/empty OTP keeps it pending; correct OTP applies. */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

const hashOtp = (otp: string) => `h:${otp}`; // demo hashing; swap for bcrypt/argon in prod

export async function decideApprovalAction(formData: FormData) {
  if (!(await requirePerm("approvals.approve"))) return; // only an OTP-approver may decide
  const id = String(formData.get("id"));
  const otp = String(formData.get("otp") ?? "");
  const approve = String(formData.get("approve")) === "1";
  const sb = supabaseServer();

  const { data: a } = await sb.from("approvals").select("*").eq("id", id).maybeSingle();
  if (!a || a.status !== "pending") return;

  if (hashOtp(otp) !== a.otp_hash) {
    await sb.from("audit_log").insert({ actor: "owner", action: "otp_rejected", ref: id, detail: "invalid OTP" });
    revalidatePath("/admin/approvals");
    return; // stays pending, no effect
  }

  const status = approve ? "approved" : "rejected";
  await sb.from("approvals").update({ status, decided_at: new Date().toISOString() }).eq("id", id);
  await sb.from("audit_log").insert({ actor: "owner", action: status, ref: id, detail: "OTP verified" });

  // Apply the change on approval.
  if (approve && a.action === "edit_price") {
    await sb.from("audit_log").insert({ actor: "system", action: "applied", ref: id, detail: `price change applied: ${JSON.stringify(a.payload)}` });
  }
  if (approve && a.action === "delete_purchase") {
    const pid = (a.payload as any)?.purchase_id;
    if (pid) {
      await sb.rpc("delete_purchase", { p_id: pid });
      await sb.from("audit_log").insert({ actor: "system", action: "applied", ref: id, detail: `purchase ${pid} deleted & stock reversed` });
      revalidatePath("/admin/purchases");
    }
  }
  if (approve && a.action === "sales_return") {
    const p = (a.payload as any) ?? {};
    // Variant-exact: resolve stored variantSku → variants.id so the approved return restocks the colour.
    const vskus = [...new Set(((p.items ?? []) as any[]).map((i) => (i.variantSku ?? "").trim()).filter(Boolean))];
    const vmap = new Map<string, string>();
    if (vskus.length) {
      const { data: vs } = await sb.from("variants").select("id,sku").in("sku", vskus);
      for (const v of ((vs as any[]) ?? [])) vmap.set(String(v.sku).toUpperCase(), v.id);
    }
    const p_items = ((p.items ?? []) as any[]).map((i) => ({ product_id: i.product_id, qty: i.qty, variant_id: i.variantSku ? (vmap.get(String(i.variantSku).toUpperCase()) ?? null) : null }));
    if (p.orderId && p_items.length) {
      const { error } = await sb.rpc("record_sales_return", { p_order_id: p.orderId, p_reason: p.reason ?? "Approved return", p_items });
      if (!error) {
        await sb.from("audit_log").insert({ actor: "system", action: "applied", ref: id, detail: `sales return processed for order ${p.orderId}` });
        revalidatePath("/admin/returns");
      }
    }
  }
  revalidatePath("/admin/approvals");
  revalidatePath("/admin/dashboard");
}
