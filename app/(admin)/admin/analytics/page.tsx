export const dynamic = "force-dynamic";

export const metadata = { title: "Owner Console · Analytics & SEO" };

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://yogendra-ten.vercel.app").replace(/\/$/, "");
const GA_ID = process.env.NEXT_PUBLIC_GA4_ID;
const PID = process.env.NEXT_PUBLIC_GA4_PROPERTY_ID; // numeric GA4 property id (optional, for deep links)
const gaBase = PID ? `https://analytics.google.com/analytics/web/#/p${PID}` : "https://analytics.google.com/";
const ga = (path: string) => (PID ? `${gaBase}${path}` : "https://analytics.google.com/");

function Card({ href, title, sub, accent }: { href: string; title: string; sub: string; accent?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      className={`block rounded-2xl p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-luxe ${accent ? "bg-ink text-cream" : "bg-white"}`}>
      <p className={`font-medium ${accent ? "text-ivory" : "text-ink"}`}>{title} <span className="opacity-60">↗</span></p>
      <p className={`text-sm mt-1 ${accent ? "text-cream/70" : "text-muted"}`}>{sub}</p>
    </a>
  );
}

export default function Analytics() {
  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">Analytics &amp; SEO</h1>
      <p className="text-sm text-muted mb-6">See exactly how your store is performing — live visitors, what's selling, and how customers find you.</p>

      <div className={`rounded-2xl px-5 py-4 mb-6 text-sm ${GA_ID ? "bg-emerald-mist text-emerald-dark" : "bg-gold/15 text-gold-dark"}`}>
        {GA_ID ? <>● Google Analytics is connected and tracking <span className="font-mono">{GA_ID}</span>. COD &amp; POS sales are captured server-side too.</>
               : <>○ Analytics not connected yet — add NEXT_PUBLIC_GA4_ID in settings to switch it on.</>}
      </div>

      <h2 className="font-medium text-ink mb-3">Open your Google Analytics</h2>
      <div className="grid sm:grid-cols-3 gap-4 mb-3">
        <Card href={ga("/realtime/overview")} title="Realtime" sub="See who's on your site right now" accent />
        <Card href={ga("/reports/intelligenthome")} title="Reports" sub="Visitors, sources, top pages" />
        <Card href="https://analytics.google.com/" title="Full dashboard" sub="Everything in Google Analytics" />
      </div>
      {!PID && <p className="text-xs text-muted mb-6">Tip: for one-click deep links straight to these reports, add <span className="font-mono">NEXT_PUBLIC_GA4_PROPERTY_ID</span> (the numeric Property ID from GA → Admin → Property Settings).</p>}

      <h2 className="font-medium text-ink mt-6 mb-3">What you'll see there</h2>
      <div className="grid sm:grid-cols-2 gap-3 mb-8">
        {[
          ["Live visitors", "How many people are browsing right now, and which products they're viewing."],
          ["Where they come from", "Google search, Instagram, WhatsApp, direct — so you know what's working."],
          ["Top products & drop-offs", "What gets viewed, added to cart, and bought — and where shoppers leave."],
          ["Every sale counted", "Online, COD and counter (POS) sales all report in — even ones that don't happen in a browser."],
        ].map(([t, s]) => (
          <div key={t} className="bg-white rounded-2xl p-5 shadow-card"><p className="font-medium text-ink">{t}</p><p className="text-sm text-muted mt-1">{s}</p></div>
        ))}
      </div>

      <h2 className="font-medium text-ink mb-3">Search visibility (SEO)</h2>
      <div className="grid sm:grid-cols-3 gap-4">
        <Card href={`${SITE}/sitemap.xml`} title="Sitemap" sub="Every product & category, for Google" />
        <Card href={`${SITE}/robots.txt`} title="Robots" sub="What search engines can crawl" />
        <Card href={`${SITE}/faq`} title="Trust pages" sub="About, Shipping, Returns, FAQ, Size guide" />
      </div>
      <p className="text-xs text-muted mt-4">Every product page already ships with location-aware SEO (Sadar Bazar, Delhi) and structured data, so your designs are discoverable on Google.</p>
    </main>
  );
}
