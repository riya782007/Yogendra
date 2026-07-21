/**
 * lib/notify/approvals.ts — OTP-gated sensitive actions. Requirement 8.3-8.4.
 *
 * A sensitive action creates a PENDING approval + notifies the owner (via requireHuman).
 * The action does NOT take effect until a valid owner OTP approves it. Wrong/absent OTP
 * leaves it pending.
 */
import type { NotifyDeps } from "./notifications";
import { requireHuman } from "./notifications";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type Approval = {
  id: string;
  action: string;
  payload: unknown;
  status: ApprovalStatus;
  otpHash: string;
  requestedBy: string;
  createdAt: number;
  decidedAt?: number;
};

export type ApprovalDeps = NotifyDeps & {
  saveApproval: (a: Approval) => Promise<void>;
  getApproval: (id: string) => Promise<Approval | undefined>;
  hashOtp: (otp: string) => string;
};

/** Create a pending, OTP-gated approval and notify the owner. */
export async function requestApproval(
  deps: ApprovalDeps,
  args: { action: string; payload: unknown; requestedBy: string; otp: string; deepLink: string }
): Promise<Approval> {
  const approval: Approval = {
    id: deps.newId(),
    action: args.action,
    payload: args.payload,
    status: "pending",
    otpHash: deps.hashOtp(args.otp),
    requestedBy: args.requestedBy,
    createdAt: deps.now(),
  };
  await deps.saveApproval(approval);
  // Non-negotiable: a sensitive action ALWAYS notifies the assigned human (owner).
  await requireHuman(deps, {
    responsibility: "approval",
    subject: `Approval needed: ${args.action}`,
    deepLink: args.deepLink,
  });
  return approval;
}

/** Apply an OTP decision. Action only takes effect on correct OTP + approve. */
export async function decideApproval(
  deps: ApprovalDeps,
  args: { approvalId: string; otp: string; approve: boolean }
): Promise<{ ok: boolean; status: ApprovalStatus; error?: string }> {
  const a = await deps.getApproval(args.approvalId);
  if (!a) return { ok: false, status: "rejected", error: "approval not found" };
  if (a.status !== "pending") return { ok: false, status: a.status, error: "already decided" };
  if (deps.hashOtp(args.otp) !== a.otpHash) {
    // Wrong OTP => remains pending, takes no effect (Req 8.4).
    await deps.audit({ at: deps.now(), actor: "owner", action: "otp_rejected", ref: a.id });
    return { ok: false, status: "pending", error: "invalid OTP" };
  }
  const status: ApprovalStatus = args.approve ? "approved" : "rejected";
  await deps.saveApproval({ ...a, status, decidedAt: deps.now() });
  await deps.audit({ at: deps.now(), actor: "owner", action: status === "approved" ? "approved" : "rejected", ref: a.id });
  return { ok: true, status };
}
