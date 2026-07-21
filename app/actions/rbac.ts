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

export async function deleteRoleAction(formData: FormData) {
  if (!(await requirePerm("roles.manage"))) return;
  const id = String(formData.get("id"));
  await supabaseServer().from("roles").delete().eq("id", id);
  revalidatePath("/admin/roles");
}
