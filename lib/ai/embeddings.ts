/** OpenAI embeddings (semantic recs). No-op-safe: returns null if no key. Server-only. */
import "server-only";
import { openaiKey } from "./providers";

export function embeddingsConfigured() { return !!openaiKey(); }

export async function getEmbedding(text: string): Promise<number[] | null> {
  const key = openaiKey(); if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 4000) }),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    return j?.data?.[0]?.embedding ?? null;
  } catch { return null; }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
