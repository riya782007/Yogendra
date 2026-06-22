/** Clean, universally-recognised line icons (stroke = currentColor). */
const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function IconSearch({ className = "w-5 h-5" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} {...base}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>;
}
export function IconHeart({ className = "w-5 h-5" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} {...base}><path d="M12 20s-7-4.35-9.5-8.5C1 8.5 2.5 5 6 5c2 0 3.2 1.2 4 2.3C10.8 6.2 12 5 14 5c3.5 0 5 3.5 3.5 6.5C19 15.65 12 20 12 20z" /></svg>;
}
export function IconUser({ className = "w-5 h-5" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} {...base}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5" /></svg>;
}
export function IconBag({ className = "w-5 h-5" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} {...base}><path d="M6 8h12l-1 12H7L6 8z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>;
}
export function IconMenu({ className = "w-6 h-6" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} {...base}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
}
