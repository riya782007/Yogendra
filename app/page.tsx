import Link from "next/link";

export default function Home() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-20 text-center">
      <p className="text-diva-gold tracking-[0.3em] text-xs uppercase mb-3">Yogendra Industries</p>
      <h1 className="font-serif text-5xl text-diva-ink mb-4">Blythe Diva</h1>
      <p className="text-diva-ink/70 mb-10">Handcrafted artificial jewellery. Sadar Bazar, Delhi.</p>
      <div className="flex gap-4 justify-center">
        <Link href="/shop" className="px-6 py-3 rounded-full bg-diva-rose text-white font-medium">Shop the boutique</Link>
        <Link href="/admin/catalogue" className="px-6 py-3 rounded-full border border-diva-ink/20 text-diva-ink font-medium">Owner console</Link>
      </div>
    </main>
  );
}
