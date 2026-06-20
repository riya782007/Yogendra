import { formatPaise } from "@/lib/pricing";

export function BarChart({ data }: { data: { label: string; revenue: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.revenue));
  return (
    <div className="flex items-end gap-3 h-44">
      {data.map((d, i) => {
        const h = Math.max(4, (d.revenue / max) * 100);
        return (
          <div key={d.label} className="flex-1 flex flex-col items-center justify-end group">
            <span className="text-[10px] text-muted opacity-0 group-hover:opacity-100 transition-opacity mb-1">{formatPaise(d.revenue)}</span>
            <div className="w-full rounded-t-lg bar-grow bg-gradient-to-t from-emerald to-emerald-light hover:from-gold hover:to-gold-light transition-colors"
              style={{ height: `${h}%`, animationDelay: `${i * 80}ms` }} />
            <span className="text-[10px] text-muted mt-1.5">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}
