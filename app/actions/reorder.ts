"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { getReorderCandidates } from "@/lib/supabase/queries";
import { groqChat, openaiChat, groqConfigured, openaiConfigured } from "@/lib/ai/providers";

export type Rec = { sku: string; name: string; action: "reorder" | "clear"; qty: number; urgency: "high" | "medium" | "low"; rationale: string };

function heuristic(c: any): Rec {
  if (c.cls === "low") return { sku: c.sku, name: c.name, action: "reorder", qty: 12, urgency: c.qty <= 1 ? "high" : "medium", rationale: "Selling and running low — restock to avoid stockouts." };
  return { sku: c.sku, name: c.name, action: "clear", qty: 0, urgency: "low", rationale: "No movement in 30+ days — run a clearance offer to free up capital." };
}

export async function generateReorderPlanAction(): Promise<{ ok: boolean; provider: string; recs: Rec[] }> {
  if (!(await requirePerm("inventory.view"))) return { ok: false, provider: "denied", recs: [] };
  const cands = await getReorderCandidates();
  if (cands.length === 0) return { ok: true, provider: "none", recs: [] };

  const list = cands.map((c) => `${c.sku} | ${c.name} | ${c.category} | qty:${c.qty} | dayssince:${c.daysSince ?? "never"} | cost:${Math.round(c.base_wholesale / 100)}`).join("\n");
  const system = `You are an inventory planner for "Blythe Diva", an artificial-jewellery store. For each item below, decide: action ("reorder" for fast-movers running low, "clear" for stale dead stock), qty (integer reorder quantity; 0 if clearing), urgency ("high"|"medium"|"low"), and rationale (<=14 words). Return STRICT JSON: {"recommendations":[{"sku","action","qty","urgency","rationale"}]}. Items:\n${list}`;

  try {
    let raw: string;
    if (groqConfigured()) { raw = await groqChat({ system, user: "Plan the reorders. JSON only.", json: true }); }
    else if (openaiConfigured()) { raw = await openaiChat({ system, user: "Plan the reorders. JSON only.", json: true }); }
    else throw new Error("no-ai");
    const parsed = JSON.parse(raw);
    const byName = new Map(cands.map((c) => [c.sku, c.name]));
    const recs: Rec[] = (parsed.recommendations ?? []).filter((r: any) => byName.has(r.sku)).map((r: any) => ({
      sku: r.sku, name: byName.get(r.sku)!, action: r.action === "clear" ? "clear" : "reorder",
      qty: Math.max(0, parseInt(r.qty, 10) || 0), urgency: ["high", "medium", "low"].includes(r.urgency) ? r.urgency : "medium",
      rationale: String(r.rationale ?? "").slice(0, 120) || "Recommended action.",
    }));
    if (recs.length) return { ok: true, provider: groqConfigured() ? "groq" : "openai", recs };
    throw new Error("empty");
  } catch {
    return { ok: true, provider: "rules", recs: cands.map(heuristic) };
  }
}

export async function approveReorderAction(input: { sku: string; name: string; action: string; qty: number }): Promise<{ ok: boolean }> {
  if (!(await requirePerm("purchases.create"))) return { ok: false };
  const sb = supabaseServer();
  await sb.from("agent_runs").insert({ agent: "inventory", trigger: "reorder_approved", input, output: input, confidence: 0.9, needs_human: false });
  const { data: asg } = await sb.from("assignments").select("id,assigned_contact_id,channel").eq("responsibility", input.action === "clear" ? "dead_stock" : "low_stock").maybeSingle();
  if (asg) {
    await sb.from("notifications").insert({
      assignment_id: asg.id, contact_id: asg.assigned_contact_id, channel: asg.channel,
      subject: input.action === "clear" ? `Clearance suggested: ${input.name}` : `Reorder ${input.qty}x ${input.name}`,
      deep_link: "/admin/reorder", status: "sent",
    });
  }
  await sb.from("audit_log").insert({ actor: "owner", action: "reorder_approved", ref: input.sku, detail: `${input.action} ${input.qty}` });
  revalidatePath("/admin/reorder");
  return { ok: true };
}
