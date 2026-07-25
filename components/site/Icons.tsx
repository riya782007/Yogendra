/** Clean, universally-recognised line icons (stroke = currentColor), sized on a 24px grid
 *  with a consistent 1.6 stroke so the header set reads as one cohesive family. */
const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function IconSearch({ className = "w-5 h-5" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} {...base}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></svg>;
}
export function IconHeart({ className = "w-5 h-5" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} {...base}><path d="M12 20.3l-1.35-1.23C6.4 15.22 4 13.05 4 10.3 4 8.1 5.72 6.4 7.9 6.4c1.23 0 2.4.57 3.1 1.48l1 1.3 1-1.3c.7-.91 1.87-1.48 3.1-1.48 2.18 0 3.9 1.7 3.9 3.9 0 2.75-2.4 4.92-6.65 8.77L12 20.3z" /></svg>;
}
export function IconUser({ className = "w-5 h-5" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} {...base}><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg>;
}
export function IconBag({ className = "w-5 h-5" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} {...base}><path d="M6.2 8h11.6l.7 11a2 2 0 0 1-2 2.1H7.5a2 2 0 0 1-2-2.1l.7-11z" /><path d="M9 10V7a3 3 0 0 1 6 0v3" /></svg>;
}
export function IconMenu({ className = "w-6 h-6" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} {...base}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
}
