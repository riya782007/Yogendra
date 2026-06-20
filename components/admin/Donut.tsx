import { formatPaise } from "@/lib/pricing";

const COLORS = ["#0F5C4D", "#C8A24C", "#B0506A", "#2E8573", "#6E2238"];

export function Donut({ data }: { data: { label: string; value: number }[] }) {
  const total = Math.max(1, data.reduce((s, d) => s + d.value, 0));
  let acc = 0;
  const stops = data.map((d, i) => {
    const start = (acc / total) * 100; acc += d.value; const end = (acc / total) * 100;
    return `${COLORS[i % COLORS.length]} ${start}% ${end}%`;
  }).join(", ");
  return (
    <div className="flex items-center gap-6">
      <div className="relative donut-in" style={{ width: 132, height: 132 }}>
        <div className="rounded-full" style={{ width: 132, height: 132, background: `conic-gradient(${stops})` }} />
        <div className="absolute inset-0 m-auto rounded-full bg-white grid place-items-center" style={{ width: 78, height: 78 }}>
          <div className="text-center"><p className="text-[10px] text-muted">Total</p><p className="text-sm font-semibold text-ink">{formatPaise(total)}</p></div>
        </div>
      </div>
      <ul className="space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="text-ink/80 capitalize">{d.label}</span>
            <span className="text-muted text-xs">· {Math.round((d.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
