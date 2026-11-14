"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { requirePerm } from "@/lib/auth";

function selectedPerms(formData: FormData): string[] {
  return ALL_PERMISSIONS.filter((p) => formData.get(`perm:${p}`) === "on");
}

/** Readable 6-char passcode (no ambiguous chars). */
function genPasscode(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = ""; for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

export async function createRoleAction(formData: FormData) {
  if (!(await requirePerm("roles.manage"))) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await supabaseServer().from("roles").insert({ name, permissions: selectedPerms(formData), passcode: genPasscode() });
  revalidatePath("/admin/roles");
}

export async function updateRoleAction(formData: FormData) {
  if (!(await requirePerm("roles.manage"))) return;
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;
  await supabaseServer().from("roles").update({ name, permissions: selectedPerms(formData) }).eq("id", id);
  revalidatePath("/admin/roles");
}

export async function regenerateRolePasscodeAction(formData: FormData) {
  if (!(await requirePerm("roles.manage"))) return;
  const id = String(formData.get("id"));
  if (!id) return;
  await supabaseServer().from("roles").update({ passcode: genPasscode() }).eq("id", id);
  revalidatePath("/admin/roles");
}

/** Owner picks an easy passcode for a role (instead of the random one). Login upper-cases what staff
 *  type before matching, so it is stored upper-case; it must be unique and must not equal the owner passcode. */
export async function setRolePasscodeAction(id: string, raw: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await requirePerm("roles.manage"))) return { ok: false, error: "Not allowed." };
  const code = String(raw ?? "").trim().toUpperCase();
  if (!id) return { ok: false, error: "Missing role." };
  if (code.length < 4 || code.length > 20) return { ok: false, error: "Passcode must be 4–20 characters." };
  if (!/^[A-Z0-9@#_.\-]+$/.test(code)) return { ok: false, error: "Use only letters, numbers and @ # _ . -" };
  const owner = (process.env.OWNER_PASSCODE ?? "blythe2026").trim().toUpperCase();
  if (code === owner) return { ok: false, error: "That is the owner passcode — choose a different one." };
  const sb = supabaseServer();
  const { data: clash } = await sb.from("roles").select("id,name").eq("passcode", code).neq("id", id).limit(1);
  if (clash && clash.length) return { ok: false, error: `Already used by the "${(clash[0] as any).name}" role — choose another.` };
  const { error } = await sb.from("roles").update({ passcode: code }).eq("id", id);
  if (error) return { ok: false, error: "Could not save — try again." };
  revalidatePath("/admin/roles");
  return { ok: true };
}

export async function deleteRoleAction(formData: FormData) {
  if (!(await requirePerm("roles.manage"))) return;
  const id = String(formData.get("id"));
  await supabaseServer().from("roles").delete().eq("id", id);
  revalidatePath("/admin/roles");
}
