export function Stars({ rating, count, size = "sm" }: { rating: number; count?: number; size?: "sm" | "md" }) {
  const px = size === "md" ? "text-base" : "text-xs";
  // No fake averages: when there are no reviews yet, say so instead of showing a made-up rating.
  if (count === 0) {
    return <span className={`inline-flex items-center gap-1 ${px} text-muted`}><span className="text-sand" aria-hidden>{"★".repeat(5)}</span>No reviews yet</span>;
  }
  const full = Math.round(rating);
  return (
    <span className={`inline-flex items-center gap-1 ${px}`}>
      <span className="text-gold tracking-tight" aria-hidden>
        {"★".repeat(full)}<span className="text-sand">{"★".repeat(5 - full)}</span>
      </span>
      <span className="text-muted">{rating.toFixed(1)}{count != null ? ` (${count})` : ""}</span>
    </span>
  );
}
