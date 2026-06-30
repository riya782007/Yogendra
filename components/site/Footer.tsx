import Link from "next/link";

export function Footer({ categories }: { categories: { name: string; slug: string }[] }) {
  return (
    <footer className="bg-ink text-cream/80 mt-20">
      <div className="max-w-7xl mx-auto px-5 py-14 grid md:grid-cols-4 gap-10">
        <div>
          <p className="font-display text-3xl text-ivory">Blythe Diva</p>
          <p className="text-sm mt-3 text-cream/60 leading-relaxed">Where elegance meets empowerment. Handcrafted artificial jewellery from Sadar Bazar, Delhi.</p>
          <div className="flex gap-3 mt-5">
            <a href="https://wa.me/919873151767" target="_blank" rel="noopener" aria-label="WhatsApp" title="WhatsApp"
              className="w-9 h-9 grid place-items-center rounded-full bg-white/10 hover:bg-gold hover:text-ink transition-colors">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2zm5.8 14.2c-.2.7-1.4 1.3-2 1.4-.5.1-1.2.1-1.9-.1-.4-.1-1-.3-1.7-.6-3-1.3-4.9-4.3-5-4.5-.2-.2-1.2-1.6-1.2-3s.7-2.1 1-2.4c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.4.5-.3.3c-.2.2-.3.4-.2.6.2.4.8 1.3 1.6 2 1 .9 1.9 1.2 2.2 1.3.2.1.4.1.6-.1l.7-.9c.2-.2.4-.2.6-.1l1.9.9c.3.1.5.2.5.4.1.2.1.7-.1 1.4z"/></svg>
            </a>
            <a href="#" aria-label="Instagram" title="Instagram"
              className="w-9 h-9 grid place-items-center rounded-full bg-white/10 hover:bg-gold hover:text-ink transition-colors">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>
            </a>
            <a href="#" aria-label="Facebook" title="Facebook"
              className="w-9 h-9 grid place-items-center rounded-full bg-white/10 hover:bg-gold hover:text-ink transition-colors">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor"><path d="M14 9h2.5l.5-3H14V4.5c0-.9.3-1.5 1.6-1.5H17V.3C16.7.2 15.8.1 14.8.1 12.5.1 11 1.5 11 4.1V6H8.5v3H11v8h3V9z"/></svg>
            </a>
          </div>
        </div>
        <div>
          <p className="text-gold-light text-xs uppercase tracking-widest mb-4">Shop</p>
          <ul className="space-y-2 text-sm">
            {categories.slice(0, 6).map((c) => (
              <li key={c.slug}><Link href={`/shop/c/${c.slug}`} className="hover:text-gold transition-colors">{c.name}</Link></li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-gold-light text-xs uppercase tracking-widest mb-4">Information</p>
          <ul className="space-y-2 text-sm">
            <li><Link href="/sell" className="hover:text-gold transition-colors">Sell with us</Link></li>
            <li><Link href="/shipping" className="hover:text-gold transition-colors">Shipping Policy</Link></li>
            <li><Link href="/returns" className="hover:text-gold transition-colors">Returns &amp; Cancellation</Link></li>
            <li><Link href="/about" className="hover:text-gold transition-colors">About Us</Link></li>
            <li><Link href="/contact" className="hover:text-gold transition-colors">Contact</Link></li>
            <li><Link href="/account" className="hover:text-gold transition-colors">Track Order</Link></li>
            <li><Link href="/faq" className="hover:text-gold transition-colors">FAQ</Link></li>
            <li><Link href="/size-guide" className="hover:text-gold transition-colors">Size &amp; Length Guide</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-gold-light text-xs uppercase tracking-widest mb-4">Stay in touch</p>
          <p className="text-sm text-cream/60 mb-3">Subscribe for new drops &amp; exclusive offers.</p>
          <form className="flex">
            <input placeholder="Your email" className="flex-1 rounded-l-full px-4 py-2 text-sm text-ink outline-none" />
            <button className="btn-gold rounded-l-none px-4 text-sm font-medium">Join</button>
          </form>
          <p className="text-xs text-cream/50 mt-4">WhatsApp orders: +91 98731 51767</p>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-5 py-5 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-cream/50">
          <span>© 2026 Blythe Diva · Yogendra Industries. All rights reserved.</span>
          <span className="flex gap-2 items-center text-cream/40">
            Visa · Mastercard · UPI · Paytm · COD
            <Link href="/trade/login" className="ml-3 text-cream/30 hover:text-cream/60 transition-colors">Dealer Login</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
