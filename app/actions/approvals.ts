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
  revalidatePath("/admin/approvals");
  revalidatePath("/admin/dashboard");
}
