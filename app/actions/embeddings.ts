"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { getEmbedding, embeddingsConfigured } from "@/lib/ai/embeddings";
import { resolveProductContent } from "@/lib/content";

export async function generateEmbeddingsAction(): Promise<{ ok: boolean; done: number; total: number; needsKey?: boolean }> {
  if (!(await requirePerm("catalog.ai"))) return { ok: false, done: 0, total: 0 };
  if (!embeddingsConfigured()) return { ok: false, done: 0, total: 0, needsKey: true };
  const sb = supabaseServer();
  const { data: products } = await sb.from("products").select("id,sku,name,generated_content,category:categories(name)").eq("status", "published");
  const list = (products as any[]) ?? [];
  let done = 0;
  for (const p of list) {
    const c = resolveProductContent({ name: p.name, sku: p.sku, categoryName: p.category?.name, generated_content: p.generated_content });
    const text = `${p.name}. Category: ${p.category?.name}. ${c.description} Tags: ${(c.tags || []).join(", ")}`;
    const emb = await getEmbedding(text);
    if (emb) { await sb.from("products").update({ embedding: emb }).eq("id", p.id); done++; }
  }
  revalidatePath("/admin/catalogue");
  return { ok: true, done, total: list.length };
}
