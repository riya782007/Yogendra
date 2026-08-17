import { SITE } from "@/lib/siteUrl";

/**
 * The default warm wholesale-lead outreach message. One source of truth so the per-visitor card, the
 * bulk sender and the AI-refine step all start from exactly the same text. The owner can edit it (or ask
 * DIVA to improve it) before it opens in WhatsApp — nothing is sent automatically.
 */
export function defaultLeadMessage(name?: string | null): string {
  const who = (name ?? "").trim() || "ji";
  return `Namaste ${who}! 🙏 This is Blythe Diva (Sadar Bazar, Delhi) — thank you for viewing our wholesale catalogue!\n\n✨ 2000+ latest designs · best trade rates · new arrivals every week.\n\nMain aapko first order me help karna chahungi — bas 2 minute lagenge:\n👉 ${SITE}/trade\n\nAgar koi dikkat aayi ho — rate, minimum order, ya koi design nahi mili — bas reply kar dijiye, main khud aapke liye sort kar dungi. 🌸`;
}

import { waMeHref } from "@/lib/phone";

/** Build the wa.me deep link for a lead, given the (possibly owner-edited) message text. */
export function waLinkFor(phone?: string | null, message?: string): string | null {
  return waMeHref(phone, message ?? "");
}
