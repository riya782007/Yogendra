import { redirect } from "next/navigation";
import { AdminNav } from "@/components/AdminNav";
import { Diva } from "@/components/admin/Diva";
import { getSession } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = getSession();
  // Defense-in-depth: never render the console for an unauthenticated request.
  if (!s.authed) redirect("/login");
  // Nav badges — pending submissions awaiting review (best-effort; never block the console).
  let pendingSubmissions = 0;
  try {
    const { count } = await supabaseServer().from("product_submissions").select("id", { count: "exact", head: true }).eq("status", "pending");
    pendingSubmissions = count ?? 0;
  } catch { /* badge is optional */ }
  return (
    <div className="flex min-h-screen bg-diva-cream">
      <AdminNav perms={s.permissions} roleName={s.roleName} badges={{ "/admin/submissions": pendingSubmissions }} />
      {/* pt-14 clears the fixed mobile top bar; lg has the in-flow sidebar instead */}
      <div className="flex-1 min-w-0 pt-14 lg:pt-0">{children}</div>
      <Diva roleName={s.roleName} />
    </div>
  );
}
