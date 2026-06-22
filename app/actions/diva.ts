"use server";
/**
 * DIVA — the console operator. Two server actions:
 *   divaPlan(command)      → LLM turns a voice/text command into an ordered list of steps.
 *   divaRun(tool, args)    → executes ONE step (read / navigate / mutate), permission-checked.
 *
 * Owner is logged in via the console passcode → DIVA gets ALL permissions. The granular
 * gate is wired so per-staff roles can scope DIVA later.
 */
import { groqChat, openaiChat, groqConfigured, openaiConfigured } from "@/lib/ai/providers";
import { supabaseServer } from "@/lib/supabase/server";
import {
  getChannelReport, getInventoryClassified, getProductsPage, getDashboardData, getStorefront,
} from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { liveOffer } from "@/lib/offers";
import { DIVA_TOOLS, PAGE_MAP, toolByName } from "@/lib/diva/tools";
import { ALL_PERMISSIONS, hasPermission } from "@/lib/permissions";
import { generateContentAction } from "@/app/actions/aiContent";
import { revalidatePath } from "next/cache";

export type DivaStep = { tool: string; args: Record<string, any>; label: string; kind: string; needsConfirm: boolean };
export type DivaPlan = { ok: boolean; reply: string; steps: DivaStep[] };

/** Owner permissions — everything. (Hook for future per-staff scoping.) */
function ownerPerms(): string[] { return ALL_PERMISSIONS; }

function isoDaysAgo(d: number) { return new Date(Date.now() - d * 86400000).toISOString(); }

// ---------------------------------------------------------------- PLAN
export async function divaPlan(command: string): Promise<DivaPlan> {
  const cmd = (command ?? "").trim().slice(0, 600);
  if (!cmd) return { ok: false, reply: "Tell me what you'd like done — e.g. “show me this week's sales” or “add 20 pieces to BD1004”.", steps: [] };

  const catalog = DIVA_TOOLS.map((t) => `- ${t.name}(${t.params.map((p) => p.name + (p.required ? "*" : "")).join(", ")}) [${t.kind}] — ${t.desc}`).join("\n");
  const system =
    `You are DIVA, the operations agent inside the Blythe Diva jewellery admin console (Sadar Bazar, Delhi). ` +
    `Turn the owner's command into an ordered plan using ONLY these tools:\n${catalog}\n\n` +
    `Rules: break the request into the minimum number of concrete steps. Each step must be one tool with its args. ` +
    `Use open_page to take the owner to a screen when they want to "go to"/"open"/"show" a section. ` +
    `Prefer read tools to answer questions. Use mutate tools only when the owner clearly asks to change something. ` +
    `Respond ONLY as compact JSON: {"reply": "<one friendly sentence about what you'll do>", "steps": [{"tool":"<name>","args":{...},"label":"<short human label>"}]}. ` +
    `If nothing matches, return an empty steps array and explain in reply.`;

  let parsed: any = null;
  try {
    let raw: string;
    if (groqConfigured()) raw = await groqChat({ system, user: cmd, json: true });
    else if (openaiConfigured()) raw = await openaiChat({ system, user: cmd, json: true });
    else return heuristicPlan(cmd);
    parsed = JSON.parse(raw);
  } catch {
    return heuristicPlan(cmd);
  }

  const steps: DivaStep[] = [];
  for (const s of Array.isArray(parsed?.steps) ? parsed.steps : []) {
    const tool = toolByName(String(s?.tool));
    if (!tool) continue;
    steps.push({ tool: tool.name, args: s?.args ?? {}, label: String(s?.label ?? tool.desc).slice(0, 80), kind: tool.kind, needsConfirm: !!tool.confirm });
  }
  if (steps.length === 0) return heuristicPlan(cmd, String(parsed?.reply ?? ""));
  return { ok: true, reply: String(parsed?.reply ?? "On it.").slice(0, 200), steps };
}

/** Deterministic fallback when no LLM / parse fails. */
function heuristicPlan(cmd: string, reply?: string): DivaPlan {
  const c = cmd.toLowerCase();
  const steps: DivaStep[] = [];
  const push = (tool: string, args: any, label: string) => { const t = toolByName(tool)!; steps.push({ tool, args, label, kind: t.kind, needsConfirm: !!t.confirm }); };

  for (const [name, path] of Object.entries(PAGE_MAP)) {
    if ((c.includes("open") || c.includes("go to") || c.includes("show me the") || c.includes("take me")) && c.includes(name)) { push("open_page", { page: name }, `Open ${name}`); break; }
  }
  if (steps.length === 0) {
    if (/(sales|revenue|sold|earn)/.test(c)) push("analyze_sales", { days: /week/.test(c) ? 7 : 30 }, "Analyse sales");
    else if (/(dead|low|out of stock|inventory|stock level)/.test(c)) push("inventory_status", {}, "Check inventory");
    else if (/(summary|overview|how.*doing|pulse|brief)/.test(c)) push("business_summary", { days: 30 }, "Business summary");
    else push("business_summary", { days: 30 }, "Business summary");
  }
  return { ok: true, reply: reply || "Here's what I found.", steps };
}

// ---------------------------------------------------------------- RUN
export type DivaResult = { ok: boolean; message: string; navigate?: string; data?: any; denied?: boolean };

export async function divaRun(toolName: string, args: Record<string, any>): Promise<DivaResult> {
  const tool = toolByName(toolName);
  if (!tool) return { ok: false, message: "Unknown action." };
  if (tool.permission && !hasPermission(ownerPerms(), tool.permission)) return { ok: false, denied: true, message: `You don't have permission for ${tool.name}.` };

  try {
    switch (toolName) {
      case "open_page": {
        const key = String(args.page ?? "").toLowerCase().trim();
        const path = PAGE_MAP[key] ?? Object.entries(PAGE_MAP).find(([k]) => key.includes(k) || k.includes(key))?.[1];
        if (!path) return { ok: false, message: `I don't know a page called "${args.page}".` };
        return { ok: true, message: `Opening ${key}…`, navigate: path };
      }
      case "business_summary": {
        const days = Number(args.days) || 30;
        const from = isoDaysAgo(days), to = new Date().toISOString();
        const d = await getDashboardData(from, to);
        const rep = await getChannelReport(from, to);
        const top = rep.channels.sort((a, b) => b.revenue - a.revenue)[0];
        return { ok: true, data: d, message: `Last ${days} days: ${formatPaise(d.revenue)} across ${d.orders} orders. Best channel: ${top?.channel ?? "—"}. Stock alerts: ${d.dead} dead, ${d.low} low. Products: ${d.totalProducts}.` };
      }
      case "analyze_sales": {
        const days = Number(args.days) || 30;
        const rep = await getChannelReport(isoDaysAgo(days), new Date().toISOString());
        const parts = rep.channels.map((c) => `${c.channel} ${formatPaise(c.revenue)} (${c.count})`).join(" · ");
        return { ok: true, data: rep, message: `Last ${days} days — total ${formatPaise(rep.grand)} from ${rep.count} orders. By channel: ${parts}.` };
      }
      case "inventory_status": {
        const rows = await getInventoryClassified();
        const dead = rows.filter((r) => r.cls === "dead"), low = rows.filter((r) => r.cls === "low");
        const worst = dead.slice(0, 5).map((r) => `${r.name} (${r.qty})`).join(", ") || "none";
        return { ok: true, data: { dead: dead.length, low: low.length }, message: `${dead.length} dead, ${low.length} low, ${rows.length} total. Worst dead stock: ${worst}.` };
      }
      case "low_stock": {
        const rows = await getInventoryClassified();
        const list = rows.filter((r) => r.cls === "low" || r.qty === 0).slice(0, 12);
        return { ok: true, data: list, message: list.length ? `Low/out: ${list.map((r) => `${r.name} (${r.qty})`).join(", ")}.` : "Nothing is low right now 🎉" };
      }
      case "find_product": {
        const { rows } = await getProductsPage({ q: String(args.query ?? ""), pageSize: 8 });
        const { formula } = await getStorefront();
        if (rows.length === 0) return { ok: true, message: `No products matched "${args.query}".` };
        const list = rows.map((p: any) => `${p.name} (${p.sku}) — ${formatPaise(liveOffer(p.base_wholesale, formula).price)}, ${p.qty} in stock`).join("; ");
        return { ok: true, data: rows, message: list };
      }
      case "add_stock":
      case "remove_stock": {
        const sku = String(args.sku ?? "").trim().toUpperCase();
        const qty = Math.abs(Math.trunc(Number(args.qty) || 0));
        if (!sku || !qty) return { ok: false, message: "I need a SKU and a quantity." };
        const delta = toolName === "add_stock" ? qty : -qty;
        const sb = supabaseServer();
        const { data: p } = await sb.from("products").select("id,qty,name").eq("sku", sku).maybeSingle();
        if (!p) return { ok: false, message: `No product with SKU ${sku}.` };
        const newQty = Math.max(0, ((p as any).qty ?? 0) + delta);
        await sb.from("products").update({ qty: newQty, last_movement_at: new Date().toISOString() }).eq("id", (p as any).id);
        await sb.from("stock_adjustments").insert({ product_id: (p as any).id, sku, delta, source: String(args.source ?? "DIVA command"), reason: "Adjusted by DIVA" });
        revalidatePath("/admin/inventory");
        return { ok: true, message: `${toolName === "add_stock" ? "Added" : "Removed"} ${qty} — ${(p as any).name} is now ${newQty} in stock.` };
      }
      case "generate_ai_content": {
        const sku = String(args.sku ?? "").trim().toUpperCase();
        if (!sku) return { ok: false, message: "Which SKU?" };
        await generateContentAction(sku);
        revalidatePath("/admin/catalogue");
        return { ok: true, message: `Regenerated the AI product page for ${sku}.` };
      }
      case "set_status": {
        const sku = String(args.sku ?? "").trim().toUpperCase();
        const status = String(args.status ?? "").toLowerCase().includes("pub") ? "published" : "draft";
        if (!sku) return { ok: false, message: "Which SKU?" };
        const sb = supabaseServer();
        const { error } = await sb.from("products").update({ status }).eq("sku", sku);
        if (error) return { ok: false, message: error.message };
        revalidatePath("/admin/catalogue"); revalidatePath("/shop");
        return { ok: true, message: `${sku} is now ${status}.` };
      }
      default:
        return { ok: false, message: "That action isn't wired yet." };
    }
  } catch (e) {
    return { ok: false, message: `Something went wrong: ${e instanceof Error ? e.message : "unknown error"}.` };
  }
}
