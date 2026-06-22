import { AdminNav } from "@/components/AdminNav";
import { Diva } from "@/components/admin/Diva";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = getSession();
  return (
    <div className="flex min-h-screen bg-diva-cream">
      <AdminNav perms={s.permissions} roleName={s.roleName} />
      {/* pt-14 clears the fixed mobile top bar; lg has the in-flow sidebar instead */}
      <div className="flex-1 min-w-0 pt-14 lg:pt-0">{children}</div>
      <Diva roleName={s.roleName} />
    </div>
  );
}
