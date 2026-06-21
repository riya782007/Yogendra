"use client";
import { createContext, useContext, useState, useCallback } from "react";

type ToastType = "success" | "info" | "error";
type Toast = { id: number; msg: string; type: ToastType };
const Ctx = createContext<{ toast: (msg: string, type?: ToastType) => void } | null>(null);

const STYLE: Record<ToastType, string> = {
  success: "bg-emerald text-white",
  info: "bg-ink text-cream",
  error: "bg-rose text-white",
};
const ICON: Record<ToastType, string> = { success: "✓", info: "✦", error: "!" };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((msg: string, type: ToastType = "success") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, type }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3000);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] space-y-2 pointer-events-none w-max max-w-[92vw]">
        {items.map((t) => (
          <div key={t.id} className={`flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium shadow-luxe animate-[fadeUp_.3s_ease] ${STYLE[t.type]}`}>
            <span className="opacity-90">{ICON[t.type]}</span>{t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export function useToast() { return useContext(Ctx) ?? { toast: () => {} }; }
