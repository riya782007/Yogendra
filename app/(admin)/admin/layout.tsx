import { AdminNav } from "@/components/AdminNav";
import { Diva } from "@/components/admin/Diva";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-diva-cream">
      <AdminNav />
      {/* pt-14 clears the fixed mobile top bar; lg has the in-flow sidebar instead */}
      <div className="flex-1 min-w-0 pt-14 lg:pt-0">{children}</div>
      <Diva />
    </div>
  );
}
