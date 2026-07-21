"use client";
import { useRef, useEffect, useState } from "react";

/** Work out how to play a reel from its stored URL. */
function resolve(url: string | null): { kind: "instagram" | "video" | "none"; src: string } {
  if (!url) return { kind: "none", src: "" };
  const ig = url.match(/instagram\.com\/(reel|reels|p|tv)\/([\w-]+)/i);
  if (ig) {
    const type = ig[1] === "reels" ? "reel" : ig[1];
    return { kind: "instagram", src: `https://www.instagram.com/${type}/${ig[2]}/embed/` };
  }
  if (/\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(url) || /\/storage\/v1\/object\//.test(url)) {
    return { kind: "video", src: url };
  }
  return { kind: "none", src: url };
}

/**
 * Renders a reel that actually plays:
 *  - Instagram links  → Instagram's embed player (plays on tap, like Shopping Tree).
 *  - Direct video files → autoplay, muted, looping (true reel feel); tap to toggle sound.
 *  - Anything else     → branded gradient with the caption.
 */
export function ReelPlayer({ videoUrl, caption }: { videoUrl: string | null; caption: string }) {
  const { kind, src } = resolve(videoUrl);
  const vid = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  // Autoplay only while the reel is on screen (saves data, feels like a feed).
  useEffect(() => {
    const el = vid.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) el.play().catch(() => {}); else el.pause(); });
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [src]);

  if (kind === "instagram") {
    return (
      <iframe
        src={src}
        title={caption}
        className="w-full h-full"
        loading="lazy"
        scrolling="no"
        allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
        allowFullScreen
        style={{ border: 0 }}
      />
    );
  }

  if (kind === "video") {
    return (
      <button onClick={() => { const m = !muted; setMuted(m); if (vid.current) vid.current.muted = m; }} className="relative w-full h-full block group" aria-label="Toggle sound">
        <video ref={vid} src={src} muted={muted} loop playsInline preload="metadata" className="w-full h-full object-cover" />
        <span className="absolute inset-0 bg-gradient-to-t from-ink/60 to-transparent pointer-events-none" />
        <span className="absolute bottom-3 right-3 h-8 w-8 rounded-full bg-white/85 grid place-items-center text-ink text-xs">{muted ? "🔇" : "🔊"}</span>
        <span className="absolute bottom-3 left-3 right-12 text-cream text-sm font-medium drop-shadow text-left">{caption}</span>
      </button>
    );
  }

  return (
    <div className="relative w-full h-full" style={{ background: "linear-gradient(160deg,#241B2E,#0F5C4D,#C8A24C)" }}>
      <div className="absolute inset-0 bg-gradient-to-t from-ink/70 to-transparent" />
      <span className="absolute top-3 left-3 h-9 w-9 rounded-full bg-white/85 grid place-items-center text-ink">▶</span>
      <p className="absolute bottom-3 left-3 right-3 text-cream text-sm font-medium drop-shadow">{caption}</p>
    </div>
  );
}
