import { describe, it, expect, vi } from "vitest";
import type { Assignment, Contact, AssignmentStore } from "../lib/notify/assignments";
import { resolveAssignee } from "../lib/notify/assignments";
import { requireHuman, acknowledge, escalateIfBreached, type Notification, type NotifyDeps } from "../lib/notify/notifications";
import { requestApproval, decideApproval, type Approval, type ApprovalDeps } from "../lib/notify/approvals";

const owner: Contact = { id: "owner", name: "Yogendra" };
const staff: Contact = { id: "c1", name: "Aman", whatsapp: "+9199..." };
const backup: Contact = { id: "c2", name: "Backup" };

const assignment: Assignment = {
  id: "a1", responsibility: "approval", assignedContactId: "c1",
  backupContactId: "c2", channel: "whatsapp", slaMinutes: 30,
};

function makeStore(withAssignment = true): AssignmentStore {
  const contacts: Record<string, Contact> = { owner, c1: staff, c2: backup };
  return {
    forResponsibility: async (r) => (withAssignment ? assignment : undefined),
    contact: async (id) => contacts[id],
  };
}

function makeDeps(store: AssignmentStore, clock = { t: 1000 }) {
  const sent: any[] = [];
  const audits: any[] = [];
  const notifs = new Map<string, Notification>();
  let n = 0;
  const deps: NotifyDeps = {
    store,
    send: async (channel, contact, subject, deepLink) => { sent.push({ channel, contact, subject, deepLink }); },
    audit: async (e) => { audits.push(e); },
    saveNotification: async (x) => { notifs.set(x.id, x); },
    newId: () => `id${++n}`,
    now: () => clock.t,
  };
  return { deps, sent, audits, notifs, clock };
}

describe("human-in-the-loop invariant", () => {
  it("requireHuman creates a notification AND an audit record AND sends", async () => {
    const store = makeStore();
    const { deps, sent, audits } = makeDeps(store);
    const n = await requireHuman(deps, { responsibility: "approval", subject: "Approve price change", deepLink: "/approvals/1" });
    expect(n.status).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(audits.some((a) => a.action === "notified")).toBe(true);
  });

  it("a human-required step CANNOT pass silently when unassigned (throws)", async () => {
    const store = makeStore(false);
    await expect(resolveAssignee(store, "approval")).rejects.toThrow(/pass silently/);
  });
});

describe("SLA escalation (Req 11.3)", () => {
  it("does not escalate before SLA", async () => {
    const store = makeStore();
    const clock = { t: 1000 };
    const { deps } = makeDeps(store, clock);
    const n = await requireHuman(deps, { responsibility: "approval", subject: "x", deepLink: "/x" });
    clock.t = 1000 + 10 * 60000; // 10 min < 30 min SLA
    const esc = await escalateIfBreached(deps, n, assignment, owner);
    expect(esc).toBeNull();
  });

  it("escalates to backup after SLA breach", async () => {
    const store = makeStore();
    const clock = { t: 1000 };
    const { deps, sent } = makeDeps(store, clock);
    const n = await requireHuman(deps, { responsibility: "approval", subject: "x", deepLink: "/x" });
    clock.t = 1000 + 31 * 60000; // breach
    const esc = await escalateIfBreached(deps, n, assignment, owner);
    expect(esc).not.toBeNull();
    expect(esc!.contactId).toBe("c2");
    expect(esc!.subject).toContain("ESCALATED");
  });

  it("acknowledged notifications never escalate", async () => {
    const store = makeStore();
    const clock = { t: 1000 };
    const { deps } = makeDeps(store, clock);
    let n = await requireHuman(deps, { responsibility: "approval", subject: "x", deepLink: "/x" });
    n = await acknowledge(deps, n, "c1");
    clock.t = 1000 + 99 * 60000;
    expect(await escalateIfBreached(deps, n, assignment, owner)).toBeNull();
  });
});

describe("OTP approvals (Req 8.3-8.4)", () => {
  function makeApprovalDeps(store: AssignmentStore, clock = { t: 1000 }) {
    const base = makeDeps(store, clock);
    const approvals = new Map<string, Approval>();
    const deps: ApprovalDeps = {
      ...base.deps,
      saveApproval: async (a) => { approvals.set(a.id, a); },
      getApproval: async (id) => approvals.get(id),
      hashOtp: (otp) => `h:${otp}`,
    };
    return { deps, approvals, sent: base.sent };
  }

  it("requesting a sensitive action creates pending approval AND notifies owner", async () => {
    const { deps, approvals, sent } = makeApprovalDeps(makeStore());
    const a = await requestApproval(deps, { action: "edit_price", payload: { sku: "X" }, requestedBy: "c1", otp: "123456", deepLink: "/a/1" });
    expect(a.status).toBe("pending");
    expect(approvals.size).toBe(1);
    expect(sent.length).toBe(1); // owner notified
  });

  it("wrong OTP leaves it pending and takes no effect", async () => {
    const { deps } = makeApprovalDeps(makeStore());
    const a = await requestApproval(deps, { action: "edit_price", payload: {}, requestedBy: "c1", otp: "123456", deepLink: "/a/1" });
    const r = await decideApproval(deps, { approvalId: a.id, otp: "000000", approve: true });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("pending");
  });

  it("correct OTP approves", async () => {
    const { deps } = makeApprovalDeps(makeStore());
    const a = await requestApproval(deps, { action: "edit_price", payload: {}, requestedBy: "c1", otp: "123456", deepLink: "/a/1" });
    const r = await decideApproval(deps, { approvalId: a.id, otp: "123456", approve: true });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("approved");
  });
});
