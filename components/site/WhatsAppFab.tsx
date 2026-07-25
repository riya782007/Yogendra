import { BUSINESS } from "@/lib/business";

/**
 * Floating WhatsApp button (bottom-right) on the storefront — one tap opens a chat with the store,
 * pre-filled with a friendly message. A gentle pulse ring draws the eye without being noisy.
 */
export function WhatsAppFab() {
  const digits = (BUSINESS.phone || "").replace(/\D/g, "");
  if (!digits) return null;
  const msg = encodeURIComponent("Hi Blythe Diva! 👋 I'd like to know more about your jewellery.");
  const href = `https://wa.me/${digits}?text=${msg}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="Chat with us on WhatsApp"
      title="Chat with us on WhatsApp"
      className="fixed bottom-5 right-5 z-50 group"
    >
      <span className="absolute inset-0 rounded-full bg-[#25D366] opacity-60 animate-ping" />
      <span className="relative flex items-center justify-center h-14 w-14 rounded-full bg-[#25D366] text-white shadow-luxe ring-2 ring-white/70 group-hover:scale-105 transition-transform">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
          <path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.2-.2.3-.7.8-.9 1-.2.2-.3.2-.6.1-1.5-.8-2.5-1.4-3.5-3.1-.3-.5.3-.4.7-1.3.1-.2 0-.4 0-.5 0-.2-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.8.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2z" />
        </svg>
      </span>
    </a>
  );
}
