/**
 * lib/notify/notifications.ts — send + SLA + escalation + audit. Requirement 11.2-11.4.
 *
 * THE INVARIANT: when an agent/flow reaches a human-required step, it MUST call
 * requireHuman(). That creates a task AND sends a notification AND writes an audit
 * record. There is no code path where a human-required step passes silently.
 */
import type { Assignment, AssignmentStore, Channel, Contact, Responsibility } from "./assignments";
import { resolveAssignee } from "./assignments";

export type NotificationStatus = "sent" | "acked" | "escalated";

export type Notification = {
  id: string;
  assignmentId: string;
  contactId: string;
  channel: Channel;
  subject: string;
  deepLink: string;
  status: NotificationStatus;
  sentAt: number;
  ackedAt?: number;
  escalatedAt?: number;
};

export type AuditEntry = {
  at: number;
  actor: string;        // contact id, "system", or owner
  action: string;       // "notified" | "acknowledged" | "escalated" | ...
  ref: string;          // notification id / task id
  detail?: string;
};

export type Sender = (channel: Channel, contact: Contact, subject: string, deepLink: string) => Promise<void>;

export type NotifyDeps = {
  store: AssignmentStore;
  send: Sender;
  audit: (e: AuditEntry) => Promise<void>;
  saveNotification: (n: Notification) => Promise<void>;
  newId: () => string;
  now: () => number;
};

/**
 * requireHuman — the single entry point for every human-required step (Req 11.2).
 * Creates the task, notifies the assigned contact, and records the audit trail.
 * Returns the notification so the caller can attach it to a task/approval.
 */
export async function requireHuman(
  deps: NotifyDeps,
  args: { responsibility: Responsibility; subject: string; deepLink: string }
): Promise<Notification> {
  const { assignment, contact } = await resolveAssignee(deps.store, args.responsibility);

  const n: Notification = {
    id: deps.newId(),
    assignmentId: assignment.id,
    contactId: contact.id,
    channel: assignment.channel,
    subject: args.subject,
    deepLink: args.deepLink,
    status: "sent",
    sentAt: deps.now(),
  };

  await deps.send(assignment.channel, contact, args.subject, args.deepLink);
  await deps.saveNotification(n);
  await deps.audit({ at: n.sentAt, actor: "system", action: "notified", ref: n.id, detail: `${args.responsibility} -> ${contact.name}` });
  return n;
}

/** Mark acknowledged within SLA (Req 11.4 audit). */
export async function acknowledge(deps: NotifyDeps, n: Notification, actorContactId: string): Promise<Notification> {
  const updated = { ...n, status: "acked" as const, ackedAt: deps.now() };
  await deps.saveNotification(updated);
  await deps.audit({ at: updated.ackedAt!, actor: actorContactId, action: "acknowledged", ref: n.id });
  return updated;
}

/**
 * escalateIfBreached — Req 11.3. If not acknowledged within SLA, escalate to backup,
 * then to owner. Returns the new notification sent to the escalation target, or null
 * if no escalation was due.
 */
export async function escalateIfBreached(
  deps: NotifyDeps,
  n: Notification,
  assignment: Assignment,
  ownerContact: Contact
): Promise<Notification | null> {
  if (n.status === "acked") return null;
  const ageMin = (deps.now() - n.sentAt) / 60000;
  if (ageMin < assignment.slaMinutes) return null;

  // choose escalation target: backup first, else owner
  let target: Contact | undefined;
  if (assignment.backupContactId) target = await deps.store.contact(assignment.backupContactId);
  if (!target) target = ownerContact;

  const esc: Notification = {
    id: deps.newId(),
    assignmentId: assignment.id,
    contactId: target.id,
    channel: assignment.channel,
    subject: `[ESCALATED] ${n.subject}`,
    deepLink: n.deepLink,
    status: "sent",
    sentAt: deps.now(),
  };
  await deps.send(assignment.channel, target, esc.subject, esc.deepLink);
  await deps.saveNotification({ ...n, status: "escalated", escalatedAt: deps.now() });
  await deps.saveNotification(esc);
  await deps.audit({ at: esc.sentAt, actor: "system", action: "escalated", ref: n.id, detail: `-> ${target.name}` });
  return esc;
}
