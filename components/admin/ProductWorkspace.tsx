"use client";
/**
 * ProductWorkspace — the single place to manage a product (Phase 2).
 *
 * One tabbed surface so the team never page-hops between catalogue / inventory /
 * media. Each tab's content is server-rendered upstream and passed in as a node,
 * so all the existing server actions keep working untouched. We keep every panel
 * mounted (toggling `hidden`) so in-progress form input is never lost when switching
 * tabs. The active tab is reflected in the URL (?tab=) so it's deep-linkable and
 * survives a refresh — handy for DIVA links like "open photos for BD1001".
 */
import { useState, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type TabKey = "basic" | "pricing" | "inventory" | "photos" | "variants" | "catalog" | "history";
export type WorkspaceTab = { key: TabKey; label: string; icon: string; badge?: string; node: React.ReactNode };

export function ProductWorkspace({ tabs, initial = "basic" }: { tabs: WorkspaceTab[]; initial?: TabKey }) {
  const [active, setActive] = useState<TabKey>(tabs.some((t) => t.key === initial) ? initial : tabs[0]?.key ?? "basic");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const select = useCallback((key: TabKey) => {
    setActive(key);
    // Reflect the tab in the URL without a full navigation (shallow, no scroll jump).
    const next = new URLSearchParams(params?.toString());
    next.set("tab", key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  return (
    <div className="max-w-4xl">
      {/* Tab bar */}
      <div role="tablist" aria-label="Product sections"
        className="flex flex-wrap gap-1 mb-5 bg-white/70 backdrop-blur rounded-2xl border border-sand p-1.5 shadow-card sticky top-2 z-10">
        {tabs.map((t) => {
          const on = active === t.key;
          return (
            <button key={t.key} role="tab" aria-selected={on} type="button" onClick={() => select(t.key)}
              className={`px-3.5 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-1.5 ${
                on ? "bg-ink text-white shadow-sm" : "text-muted hover:text-ink hover:bg-cream"}`}>
              <span aria-hidden>{t.icon}</span>
              <span>{t.label}</span>
              {t.badge != null && (
                <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${on ? "bg-white/20 text-white" : "bg-cream text-muted"}`}>{t.badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Panels — all mounted, only the active one shown */}
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" hidden={active !== t.key} aria-hidden={active !== t.key}>
          {t.node}
        </div>
      ))}
    </div>
  );
}
