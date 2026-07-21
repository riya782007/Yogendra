"use client";
import { useRouter } from "next/navigation";
export function Back({ label = "Back" }: { label?: string }) {
  const router = useRouter();
  return (
    <button onClick={() => router.back()}
      className="group inline-flex items-center gap-2 text-sm text-muted hover:text-emerald transition-colors">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-sand bg-white transition-all group-hover:-translate-x-0.5 group-hover:border-emerald group-hover:shadow-card">←</span>
      {label}
    </button>
  );
}
