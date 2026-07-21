import { Back } from "./Back";
import { PAGES } from "@/lib/siteContent";

export function ContentPage({ k }: { k: string }) {
  const page = PAGES[k];
  if (!page) return null;
  return (
    <div className="max-w-3xl mx-auto px-5 py-10">
      <div className="mb-5"><Back label="Back" /></div>
      <p className="text-gold-dark tracking-[0.25em] uppercase text-xs">Blythe Diva</p>
      <h1 className="font-display text-5xl text-ink mt-1">{page.title}</h1>
      <p className="text-muted mt-3 text-lg">{page.intro}</p>
      <div className="mt-8 space-y-7">
        {page.sections.map((s, i) => (
          <div key={i}>
            {s.h && <h2 className="font-medium text-ink text-lg mb-1.5">{s.h}</h2>}
            <p className="text-ink/80 leading-relaxed">{s.p}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
