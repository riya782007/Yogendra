/** Elegant on-brand image placeholder used until a real/generated photo exists. */
export function isRealImage(path?: string | null): boolean {
  if (!path) return false;
  return path.startsWith("http") || path.startsWith("/generated/");
}

export function ProductImage({ src, name, className = "" }: { src?: string | null; name: string; className?: string }) {
  if (isRealImage(src)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src!} alt={name} className={`object-cover w-full h-full ${className}`} />;
  }
  const initials = name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br from-diva-rose/20 via-diva-cream to-diva-gold/20 ${className}`}>
      <span className="font-serif text-3xl text-diva-ink/40">{initials}</span>
    </div>
  );
}
