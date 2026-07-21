/**
 * lib/notify/assignments.ts — who owns what, and how to reach them. Requirement 11.1.
 * Every responsibility maps to an assigned contact + backup + channel + SLA.
 */
export type Channel = "whatsapp" | "sms" | "email" | "in_app";

export type Contact = {
  id: string;
  name: string;
  whatsapp?: string;
  phone?: string;
  email?: string;
  inAppUserId?: string;
};

/** Responsibilities the system can notify about (extensible). */
export type Responsibility =
  | "approval"
  | "low_stock"
  | "dead_stock"
  | "payment_followup"
  | "failed_delivery"
  | "support_escalation"
  | "bill_mismatch";

export type Assignment = {
  id: string;
  responsibility: Responsibility;
  assignedContactId: string;
  backupContactId?: string;
  channel: Channel;
  slaMinutes: number;
};

export type AssignmentStore = {
  forResponsibility: (r: Responsibility) => Promise<Assignment | undefined>;
  contact: (id: string) => Promise<Contact | undefined>;
};

/** Resolve who must be told for a responsibility; throws if unassigned (no silent gaps). */
export async function resolveAssignee(store: AssignmentStore, r: Responsibility): Promise<{ assignment: Assignment; contact: Contact }> {
  const assignment = await store.forResponsibility(r);
  if (!assignment) throw new Error(`No assignment configured for responsibility "${r}" — human-required step would pass silently`);
  const contact = await store.contact(assignment.assignedContactId);
  if (!contact) throw new Error(`Assignment ${assignment.id} points to missing contact`);
  return { assignment, contact };
}
