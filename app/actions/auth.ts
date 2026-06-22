"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { OWNER_TOKEN, STAFF_TOKEN } from "@/lib/auth";

const OWNER_PASSCODE = () => process.env.OWNER_PASSCODE ?? "blythe2026";
const COOKIE = { httpOnly: true, sameSite: "lax" as const, secure: true, path: "/", maxAge: 60 * 60 * 12 };

export async function loginAction(formData: FormData) {
  const code = String(formData.get("passcode") ?? "").trim();
  const next = String(formData.get("next") ?? "/admin/dashboard");
  const dest = next.startsWith("/admin") ? next : "/admin/dashboard";
  const c = cookies();

  // 1) Owner passcode → full access.
  if (code === OWNER_PASSCODE()) {
    c.set("bd_session", OWNER_TOKEN(), COOKIE);
    c.set("bd_role", "owner", COOKIE);
    c.set("bd_rolename", "Owner", COOKIE);
    c.set("bd_perms", "*", COOKIE);
    redirect(dest);
  }

  // 2) Role passcode → scoped staff session.
  if (code) {
    const { data: role } = await supabaseServer()
      .from("roles").select("id,name,permissions").eq("passcode", code.toUpperCase()).maybeSingle();
    if (role) {
      const perms: string[] = (role as any).permissions ?? [];
      c.set("bd_session", STAFF_TOKEN(), COOKIE);
      c.set("bd_role", (role as any).id, COOKIE);
      c.set("bd_rolename", (role as any).name, COOKIE);
      c.set("bd_perms", perms.join(","), COOKIE);
      redirect(dest);
    }
  }

  redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
}

export async function logoutAction() {
  const c = cookies();
  for (const k of ["bd_session", "bd_role", "bd_rolename", "bd_perms"]) c.set(k, "", { httpOnly: true, path: "/", maxAge: 0 });
  redirect("/login");
}
