import "server-only";
import { cookies } from "next/headers";

/** Owner gets full access; staff get a per-role scoped session. */
export const OWNER_TOKEN = () => process.env.ADMIN_SESSION_TOKEN ?? "bd-owner-session-v1";
export const STAFF_TOKEN = () => (process.env.ADMIN_SESSION_TOKEN ?? "bd-owner-session-v1") + "-staff";

export type Session = {
  authed: boolean;
  isOwner: boolean;
  roleId: string;
  roleName: string;
  permissions: string[] | "*";
};

/** Read the current session from cookies (set at login). Synchronous, no DB. */
export function getSession(): Session {
  const c = cookies();
  const s = c.get("bd_session")?.value;
  const isOwner = s === OWNER_TOKEN();
  const authed = isOwner || s === STAFF_TOKEN();
  const permsRaw = c.get("bd_perms")?.value ?? "";
  return {
    authed,
    isOwner,
    roleId: c.get("bd_role")?.value ?? "",
    roleName: c.get("bd_rolename")?.value ?? (isOwner ? "Owner" : "Staff"),
    permissions: isOwner ? "*" : (permsRaw ? permsRaw.split(",").filter(Boolean) : []),
  };
}

/** Does this session grant `perm`? Owner always true; undefined perm = open to all signed-in. */
export function can(session: Session, perm?: string): boolean {
  if (!perm) return true;
  if (session.permissions === "*") return true;
  return session.permissions.includes(perm);
}
