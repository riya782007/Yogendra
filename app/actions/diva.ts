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
  getProductBySku, getProductSalesStats, getCustomersDb, getPricingFormula,
} from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { liveOffer } from "@/lib/offers";
import { DIVA_TOOLS, PAGE_MAP, toolByName } from "@/lib/diva/tools";
import { interpret, type DivaContext } from "@/lib/diva/nlu";
import { requirePerm } from "@/lib/auth";
import { generateContentAction } from "@/app/actions/aiContent";
import { generateOneAction } from "@/app/actions/images";
import { computePrices, isValidPriceSet } from "@/lib/pricing";
import { createProductAction, createCategoryJsonAction } from "@/app/actions/catalog";
import { revalidatePath } from "next/cache";

export type DivaStep = { tool: string; args: Record<string, any>; label: string; kind: string; needsConfirm: boolean };
export type DivaPlan = {
  ok: boolean;
  reply: string;
  steps: DivaStep[];
  /** A clarifying question DIVA needs answered before it can act (multi-turn). */
  ask?: { slot: string; prompt: string };
  /** Conversational memory to echo back on the next turn (serialised). */
  context?: string;
};

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Wrap NLU steps into executable DivaSteps (attaching tool kind + confirm flag). */
function toDivaSteps(steps: { tool: string; args: Record<string, any>; label: string }[]): DivaStep[] {
  const out: DivaStep[] = [];
  for (const s of steps) {
    const tool = toolByName(s.tool);
    if (!tool) continue;
    out.push({ tool: tool.name, args: s.args ?? {}, label: s.label.slice(0, 80), kind: tool.kind, needsConfirm: !!tool.confirm });
  }
  return out;
}

/** Authoritative (DB-backed) check that the current session may run a tool needing `perm`. */
async function sessionCan(perm?: string): Promise<boolean> {
  if (!perm) return true;
  return requirePerm(perm);
}

function isoDaysAgo(d: number) { return new Date(Date.now() - d * 86400000).toISOString(); }

// ---------------------------------------------------------------- PLAN
/**
 * Turn a (possibly Hindi/Hinglish) command into an ordered, executable plan.
 *
 * Strategy:
 *   1. Run the deterministic multilingual NLU engine (lib/diva/nlu) — fast, free, offline,
 *      and the only path that works when no AI key is configured or the network is blocked.
 *   2. If NLU is confident (or it needs a follow-up answer, or no LLM is configured) → use it.
 *   3. Otherwise escalate the same command to the LLM for a best-effort plan, falling back
 *      to whatever the NLU produced.
 *
 * `contextJson` carries conversational memory from the previous turn (multi-turn slot fill,
 * "ye product" references). It is produced by this function and echoed back by the widget.
 */
export async function divaPlan(command: string, contextJson?: string): Promise<DivaPlan> {
  const cmd = (command ?? "").trim().slice(0, 600);
  if (!cmd) return { ok: false, reply: "Tell me what you'd like done — e.g. “show me this week's sales” or “add 20 pieces to BD1004”.", steps: [] };

  let prevCtx: DivaContext = {};
  if (contextJson) { try { prevCtx = JSON.parse(contextJson); } catch { /* ignore bad context */ } }

  // 1) Deterministic multilingual engine.
  const nlu = interpret(cmd, prevCtx);
  const nluPlan: DivaPlan = {
    ok: true, reply: nlu.reply, steps: toDivaSteps(nlu.steps),
    ask: nlu.ask, context: JSON.stringify(nlu.context),
  };

  // 2) Use NLU when confident, when it asked a question, when it has steps, or when no LLM.
  const llmAvailable = groqConfigured() || openaiConfigured();
  if (nlu.ask || nlu.confidence >= 0.45 || nluPlan.steps.length > 0 || !llmAvailable) {
    return nluPlan;
  }

  // 3) Low confidence + LLM available → ask the model, keep NLU context as memory.
  const catalog = DIVA_TOOLS.map((t) => `- ${t.name}(${t.params.map((p) => p.name + (p.required ? "*" : "")).join(", ")}) [${t.kind}] — ${t.desc}`).join("\n");
  const system =
    `You are DIVA, the operations agent inside the Blythe Diva artificial-jewellery admin console (Yogendra Industries, Sadar Bazar, Delhi). ` +
    `The console manages a catalogue of products (each has a SKU like BD1000, a price, stock, status published/draft, AI page, photos), ` +
    `online + wholesale + counter(POS) sales, estimates, purchases, suppliers, inventory health, staff roles, and analytics. ` +
    `Turn the owner's command into an ordered plan using ONLY these tools:\n${catalog}\n\n` +
    `Rules: break the request into the minimum number of concrete steps; each step is one tool with its args. ` +
    `Use open_page to navigate when they say go to / open / show a section. Use read tools to answer questions. ` +
    `Use mutate tools only when they clearly ask to change something. SKUs look like BD1234 — pass them uppercased. ` +
    `"hide"/"take off the store"=hide_product; "show"/"put back"=show_product; "delete/remove a product"=delete_product. ` +
    `Examples:\n` +
    `"how's BD1004 doing?" -> [{"tool":"product_analytics","args":{"sku":"BD1004"},"label":"Analyse BD1004"}]\n` +
    `"hide the polki choker BD1003 and tell me sales this week" -> [{"tool":"hide_product","args":{"sku":"BD1003"}},{"tool":"analyze_sales","args":{"days":7}}]\n` +
    `"add 30 to BD1010 then open inventory" -> [{"tool":"add_stock","args":{"sku":"BD1010","qty":30}},{"tool":"open_page","args":{"page":"inventory"}}]\n\n` +
    `Respond ONLY as compact JSON: {"reply": "<one friendly sentence>", "steps": [{"tool":"<name>","args":{...},"label":"<short label>"}]}. ` +
    `If nothing matches, return empty steps and explain in reply.`;

  let parsed: any = null;
  try {
    let raw: string;
    if (groqConfigured()) raw = await groqChat({ system, user: cmd, json: true });
    else if (openaiConfigured()) raw = await openaiChat({ system, user: cmd, json: true });
    else return nluPlan;
    parsed = JSON.parse(raw);
  } catch {
    return nluPlan;
  }

  const steps: DivaStep[] = [];
  for (const s of Array.isArray(parsed?.steps) ? parsed.steps : []) {
    const tool = toolByName(String(s?.tool));
    if (!tool) continue;
    steps.push({ tool: tool.name, args: s?.args ?? {}, label: String(s?.label ?? tool.desc).slice(0, 80), kind: tool.kind, needsConfirm: !!tool.confirm });
  }
  if (steps.length === 0) return { ...nluPlan, reply: String(parsed?.reply ?? nluPlan.reply).slice(0, 200) };
  return { ok: true, reply: String(parsed?.reply ?? "On it.").slice(0, 200), steps, context: nluPlan.context };
}

// ---------------------------------------------------------------- RUN
export type DivaResult = { ok: boolean; message: string; navigate?: string; data?: any; denied?: boolean };

export async function divaRun(toolName: string, args: Record<string, any>): Promise<DivaResult> {
  const tool = toolByName(toolName);
  if (!tool) return { ok: false, message: "Unknown action." };
  if (!(await sessionCan(tool.permission))) return { ok: false, denied: true, message: `Your role doesn't have permission for ${tool.name}.` };

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
      case "product_details": {
        const sku = String(args.sku ?? "").trim().toUpperCase();
        const p = await getProductBySku(sku);
        if (!p) return { ok: false, message: `No product with SKU ${sku}.` };
        const { formula } = await getStorefront();
        const o = liveOffer(p.base_wholesale, formula);
        const gc = (p.generated_content as any) ?? {};
        const tags = (gc.tags ?? []).slice(0, 6).join(", ");
        const photos = (p.images ?? []).length;
        return { ok: true, data: p, message: `${p.name} (${sku}) — ${p.category?.name}. Price ${formatPaise(o.price)} (MRP ${formatPaise(o.mrp)}). Stock ${p.qty}. Status ${p.status}. ${photos} photo(s). Tags: ${tags || "none"}.` };
      }
      case "product_analytics": {
        const sku = String(args.sku ?? "").trim().toUpperCase();
        const s = await getProductSalesStats(sku);
        if (!s) return { ok: false, message: `No product with SKU ${sku}.` };
        return { ok: true, data: s, message: `${s.name} (${sku}): ${s.units} units sold across ${s.orders} orders, ${formatPaise(s.revenue)} revenue. Currently ${s.stock} in stock, status ${s.status}.` };
      }
      case "generate_ai_content": {
        const sku = String(args.sku ?? "").trim().toUpperCase();
        if (!sku) return { ok: false, message: "Which SKU?" };
        const r = await generateContentAction(sku);
        revalidatePath("/admin/catalogue");
        return { ok: r.ok, message: r.ok ? `Regenerated the AI product page for ${sku}.` : `Couldn't write the page for ${sku}.` };
      }
      case "generate_photo": {
        const sku = String(args.sku ?? "").trim().toUpperCase();
        if (!sku) return { ok: false, message: "Which SKU?" };
        const r = await generateOneAction(sku);
        revalidatePath("/admin/catalogue"); revalidatePath("/admin/media");
        return { ok: r.ok, message: r.ok ? `Generated a model photo for ${sku}.` : `Couldn't generate a photo for ${sku} (${r.reason ?? "error"}).` };
      }
      case "hide_product":
      case "show_product": {
        const sku = String(args.sku ?? "").trim().toUpperCase();
        if (!sku) return { ok: false, message: "Which SKU?" };
        const status = toolName === "show_product" ? "published" : "draft";
        const sb = supabaseServer();
        const { error } = await sb.from("products").update({ status }).eq("sku", sku);
        if (error) return { ok: false, message: error.message };
        revalidatePath("/admin/catalogue"); revalidatePath("/shop");
        return { ok: true, message: `${sku} is now ${status === "published" ? "visible on the store" : "hidden from the store"}.` };
      }
      case "delete_product": {
        const sku = String(args.sku ?? "").trim().toUpperCase();
        if (!sku) return { ok: false, message: "Which SKU?" };
        const sb = supabaseServer();
        const { data: p } = await sb.from("products").select("id,name").eq("sku", sku).maybeSingle();
        if (!p) return { ok: false, message: `No product with SKU ${sku}.` };
        const pid = (p as any).id;
        await sb.from("product_images").delete().eq("product_id", pid);
        await sb.from("variants").delete().eq("product_id", pid);
        const { error } = await sb.from("products").delete().eq("id", pid);
        revalidatePath("/admin/catalogue"); revalidatePath("/shop");
        if (error) {
          // Has past orders → can't hard-delete; hide instead.
          await sb.from("products").update({ status: "draft" }).eq("id", pid);
          return { ok: true, message: `${sku} has past orders, so I hid it from the store instead of deleting (keeps your books intact).` };
        }
        return { ok: true, message: `Deleted ${(p as any).name} (${sku}).` };
      }
      case "delete_role": {
        const name = String(args.name ?? "").trim();
        if (!name) return { ok: false, message: "Which role?" };
        const sb = supabaseServer();
        const { data: role } = await sb.from("roles").select("id,name").ilike("name", name).maybeSingle();
        if (!role) return { ok: false, message: `No role called "${name}".` };
        await sb.from("roles").delete().eq("id", (role as any).id);
        revalidatePath("/admin/roles");
        return { ok: true, message: `Deleted the "${(role as any).name}" role.` };
      }

      // -------- intelligence-layer executors (multilingual DIVA) --------
      case "get_price": {
        const sku = String(args.sku ?? "").trim().toUpperCase();
        const p = sku ? await getProductBySku(sku) : await resolveProductByName(String(args.query ?? ""));
        if (!p) return { ok: false, message: `I couldn't find ${sku || `"${args.query}"`}.` };
        const { formula } = await getStorefront();
        const o = liveOffer(p.base_wholesale, formula);
        const tier = String(args.tier ?? "all");
        const wholesale = formatPaise(p.base_wholesale);
        if (tier === "wholesale") return { ok: true, data: p, message: `${p.name} (${p.sku}) wholesale price is ${wholesale}.` };
        if (tier === "retail") return { ok: true, data: p, message: `${p.name} (${p.sku}) retail price is ${formatPaise(o.price)}.` };
        if (tier === "mrp") return { ok: true, data: p, message: `${p.name} (${p.sku}) MRP is ${formatPaise(o.mrp)}.` };
        return { ok: true, data: p, message: `${p.name} (${p.sku}) — Wholesale ${wholesale} · Retail ${formatPaise(o.price)} · MRP ${formatPaise(o.mrp)}.` };
      }
      case "inventory_of": {
        const p = await resolveProductByName(String(args.query ?? ""));
        if (!p) return { ok: false, message: `I couldn't match "${args.query}" to a product. Try the SKU.` };
        const cls = p.qty === 0 ? "out of stock" : p.qty <= 2 ? "low" : "healthy";
        return { ok: true, data: p, message: `${p.name} (${p.sku}) has ${p.qty} in stock (${cls}).` };
      }
      case "pending_orders": {
        const sb = supabaseServer();
        const { data } = await sb.from("orders")
          .select("invoice_no,customer_name,total,status,created_at")
          .not("status", "in", "(completed,delivered,cancelled,refunded)")
          .order("created_at", { ascending: false }).limit(15);
        const rows = (data as any[]) ?? [];
        if (rows.length === 0) return { ok: true, data: [], message: "No pending orders — you're all caught up 🎉" };
        const list = rows.slice(0, 8).map((o) => `${o.invoice_no ?? o.customer_name ?? "order"} (${formatPaise(o.total ?? 0)}, ${o.status})`).join("; ");
        return { ok: true, data: rows, message: `${rows.length} pending: ${list}.` };
      }
      case "find_customer": {
        const rows = await getCustomersDb({ q: String(args.query ?? "") });
        if (rows.length === 0) return { ok: true, message: `No customer matched "${args.query}".` };
        const c = rows[0];
        return { ok: true, data: rows, message: `${c.name}${c.phone ? ` · ${c.phone}` : ""} — ${c.type}${c.city ? ` · ${c.city}` : ""}${c.gstin ? ` · GST ${c.gstin}` : ""}.` };
      }
      case "add_stock_by_name":
      case "remove_stock_by_name": {
        const p = await resolveProductByName(String(args.query ?? ""));
        if (!p) return { ok: false, message: `I couldn't match "${args.query}" to a product. Try the SKU.` };
        const qty = Math.abs(Math.trunc(Number(args.qty) || 0));
        if (!qty) return { ok: false, message: "How many units?" };
        const delta = toolName === "add_stock_by_name" ? qty : -qty;
        const sb = supabaseServer();
        const newQty = Math.max(0, (p.qty ?? 0) + delta);
        await sb.from("products").update({ qty: newQty, last_movement_at: new Date().toISOString() }).eq("id", p.id);
        await sb.from("stock_adjustments").insert({ product_id: p.id, sku: p.sku, delta, source: String(args.source ?? "DIVA command"), reason: "Adjusted by DIVA (by name)" });
        revalidatePath("/admin/inventory");
        return { ok: true, message: `${delta > 0 ? "Added" : "Removed"} ${qty} — ${p.name} (${p.sku}) is now ${newQty} in stock.` };
      }
      case "record_damage": {
        const sku = String(args.sku ?? "").trim().toUpperCase();
        const qty = Math.abs(Math.trunc(Number(args.qty) || 0));
        if (!qty) return { ok: false, message: "How many pieces are damaged?" };
        const prod = sku ? await getProductBySku(sku) : await resolveProductByName(String(args.query ?? ""));
        if (!prod) return { ok: false, message: `I couldn't find ${sku || `"${args.query}"`}.` };
        const sb = supabaseServer();
        const newQty = Math.max(0, (prod.qty ?? 0) - qty);
        await sb.from("products").update({ qty: newQty, last_movement_at: new Date().toISOString() }).eq("id", prod.id);
        await sb.from("stock_adjustments").insert({ product_id: prod.id, sku: prod.sku, delta: -qty, source: "Damaged — removed", reason: String(args.reason ?? "").trim() || null, kind: "damage" });
        revalidatePath("/admin/inventory"); revalidatePath(`/admin/catalogue/${prod.sku}`);
        return { ok: true, message: `Marked ${qty} ${prod.name} (${prod.sku}) as damaged — stock is now ${newQty}.` };
      }
      case "create_product": {
        const name = String(args.name ?? "").trim();
        const categoryName = String(args.category ?? "").trim();
        const price = Number(args.price) || 0;
        const qty = Math.max(0, Math.trunc(Number(args.qty) || 0));
        if (!name || !categoryName || !(price > 0)) return { ok: false, message: "I need a name, category and a price above 0." };
        const sb = supabaseServer();
        let { data: cat } = await sb.from("categories").select("id,name").ilike("name", categoryName).maybeSingle();
        if (!cat) cat = await createCategoryJsonAction(categoryName) as any;
        if (!cat) return { ok: false, message: `Couldn't find or create the "${categoryName}" category.` };
        const res = await createProductAction({ categoryId: (cat as any).id, name, basePriceRupees: price, qty, type: "simple", colors: [] });
        if (!res.ok) return { ok: false, message: res.error ?? "Couldn't create the product." };
        revalidatePath("/admin/catalogue"); revalidatePath("/shop");
        return { ok: true, message: `Created ${name} (${res.sku}) in ${(cat as any).name} — wholesale ₹${price}, ${qty} pcs. It's saved as a draft; add a photo to publish.` };
      }
      case "set_price": {
        const sku = String(args.sku ?? "").trim().toUpperCase();
        const price = Number(args.price) || 0;
        const tier = String(args.tier ?? "base").toLowerCase();
        if (!sku || !(price > 0)) return { ok: false, message: "I need a SKU and a price above 0." };
        const sb = supabaseServer();
        const { data: p } = await sb.from("products").select("id,name").eq("sku", sku).maybeSingle();
        if (!p) return { ok: false, message: `No product with SKU ${sku}.` };
        const paise = Math.round(price * 100);
        // Explicit tier → pin that exact price as an override (Phase 4).
        if (tier === "retail" || tier === "mrp" || tier === "wholesale") {
          const col = tier === "retail" ? "retail_override" : tier === "mrp" ? "mrp_override" : "wholesale_override";
          const { error } = await sb.from("products").update({ [col]: paise }).eq("id", (p as any).id);
          if (error) return { ok: false, message: `${error.message} (the price-override columns need migration 0003 applied).` };
          revalidatePath("/admin/catalogue"); revalidatePath(`/admin/catalogue/${sku}`); revalidatePath("/shop"); revalidatePath("/wholesale");
          return { ok: true, message: `Set ${(p as any).name} (${sku}) ${tier} price to ${formatPaise(paise)}.` };
        }
        // No tier → set the base wholesale cost and re-derive retail/MRP from the formula.
        const formula = await getPricingFormula();
        const prices = computePrices(paise, formula);
        if (!isValidPriceSet(prices)) return { ok: false, message: "That base price produces an invalid price set." };
        await sb.from("products").update({ base_wholesale: paise }).eq("id", (p as any).id);
        revalidatePath("/admin/catalogue"); revalidatePath(`/admin/catalogue/${sku}`); revalidatePath("/shop"); revalidatePath("/wholesale");
        return { ok: true, message: `Set ${(p as any).name} (${sku}) base/wholesale to ${formatPaise(paise)}. Retail ${formatPaise(prices.retailPrice)} · MRP ${formatPaise(prices.mrp)}.` };
      }
      case "rename_sku": {
        const sku = String(args.sku ?? "").trim().toUpperCase();
        const newSku = String(args.newSku ?? "").trim().toUpperCase().replace(/\s+/g, "");
        if (!sku || !newSku) return { ok: false, message: "I need the current SKU and the new SKU." };
        if (sku === newSku) return { ok: false, message: "Those SKUs are the same." };
        const sb = supabaseServer();
        const { data: dup } = await sb.from("products").select("id").eq("sku", newSku).maybeSingle();
        if (dup) return { ok: false, message: `SKU ${newSku} already exists — pick another.` };
        const { data: p } = await sb.from("products").select("id,name").eq("sku", sku).maybeSingle();
        if (!p) return { ok: false, message: `No product with SKU ${sku}.` };
        const { error } = await sb.from("products").update({ sku: newSku }).eq("id", (p as any).id);
        if (error) return { ok: false, message: error.message };
        revalidatePath("/admin/catalogue"); revalidatePath("/shop");
        return { ok: true, message: `Renamed ${sku} → ${newSku} for ${(p as any).name}.` };
      }
      case "create_customer":
      case "set_customer_type": {
        const name = String(args.name ?? "").trim();
        if (!name) return { ok: false, message: "Which customer?" };
        const type = String(args.type ?? "retail") === "wholesale" ? "wholesale" : "retail";
        const sb = supabaseServer();
        const { data: existing } = await sb.from("customers").select("id,name,type").ilike("name", name).maybeSingle();
        if (existing) {
          await sb.from("customers").update({ type }).eq("id", (existing as any).id);
          revalidatePath("/admin/customers");
          return { ok: true, message: `${(existing as any).name} is now a ${type} customer${type === "wholesale" ? " — they'll see wholesale prices." : "."}` };
        }
        const phone = String(args.phone ?? "").trim() || null;
        const { error } = await sb.from("customers").insert({ name, type, phone });
        if (error) return { ok: false, message: error.message };
        revalidatePath("/admin/customers");
        return { ok: true, message: `Added ${name} as a ${type} customer.` };
      }
      case "create_category": {
        const name = String(args.name ?? "").trim();
        if (!name) return { ok: false, message: "What should the category be called?" };
        const cat = await createCategoryJsonAction(name);
        if (!cat) return { ok: false, message: `Couldn't create "${name}" (it may already exist).` };
        return { ok: true, message: `Created the "${cat.name}" category.` };
      }
      case "create_subcategory": {
        const name = String(args.name ?? "").trim();
        if (!name) return { ok: false, message: "What should the subcategory be called?" };
        const parent = String(args.parent ?? "").trim();
        const sb = supabaseServer();
        let parentId: string | null = null;
        if (parent) {
          const { data: pc } = await sb.from("categories").select("id").ilike("name", parent).maybeSingle();
          parentId = (pc as any)?.id ?? null;
        }
        const slug = slugify(name);
        const { error } = await sb.from("subcategories").insert({ name, slug, category_id: parentId });
        if (error) return { ok: false, message: `Couldn't create the subcategory (${error.message}). The subcategory table may need migration 0002 applied.` };
        revalidatePath("/admin/categories");
        return { ok: true, message: `Created subcategory "${name}"${parent ? ` under ${parent}` : ""}.` };
      }
      case "share_catalog": {
        const facet = String(args.facet ?? "").trim();
        const sb = supabaseServer();
        const siteBase = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
        let path = "/catalog";
        let scope = "the full catalogue";
        if (facet) {
          const slug = slugify(facet);
          // Try a parent category first, then a subcategory, then a keyword search.
          const { data: cat } = await sb.from("categories").select("slug,name").or(`slug.eq.${slug},name.ilike.%${facet}%`).maybeSingle();
          if (cat) {
            path = `/catalog?category=${(cat as any).slug}`;
            scope = `the ${(cat as any).name} catalogue`;
          } else {
            const { data: sub } = await sb.from("subcategories").select("slug,name,category:categories(slug)").or(`slug.eq.${slug},name.ilike.%${facet}%`).maybeSingle();
            if (sub) {
              path = `/catalog?category=${(sub as any).category?.slug ?? "all"}&subcategory=${(sub as any).slug}`;
              scope = `the ${(sub as any).name} catalogue`;
            } else {
              path = `/catalog?q=${encodeURIComponent(facet)}`;
              scope = `"${facet}"`;
            }
          }
        }
        const link = `${siteBase}${path}`;
        const wa = Number(args.whatsapp) ? ` Send on WhatsApp: https://wa.me/?text=${encodeURIComponent(`Check out ${scope} from Blythe Diva: ${link}`)}` : "";
        return { ok: true, data: { link }, message: `Here's a shareable link for ${scope}: ${link}${wa}` };
      }
      case "convert_invoice": {
        const invoice = String(args.invoice ?? "").trim();
        if (!invoice) return { ok: true, message: "Open billing and pick the cash memo you want to upgrade to GST.", navigate: PAGE_MAP["billing"] };
        const sb = supabaseServer();
        const { data: o } = await sb.from("orders").select("id,invoice_no,bill_type,customer_phone").eq("invoice_no", invoice).maybeSingle();
        if (!o) return { ok: false, message: `I couldn't find invoice ${invoice}.` };
        if ((o as any).bill_type === "gst") return { ok: true, message: `Invoice ${invoice} is already a GST invoice.` };
        // Validation: a GST invoice should carry the buyer's GSTIN.
        let warn = "";
        const phone = (o as any).customer_phone;
        if (phone) {
          const { data: cust } = await sb.from("customers").select("gstin").eq("phone", phone).maybeSingle();
          if (!cust || !(cust as any).gstin) warn = " Note: this customer has no GSTIN on file — add one for a compliant tax invoice.";
        }
        const { error } = await sb.from("orders").update({ bill_type: "gst" }).eq("id", (o as any).id);
        if (error) return { ok: false, message: error.message };
        revalidatePath("/admin/sales"); revalidatePath(`/admin/invoice/${(o as any).id}`);
        return { ok: true, message: `Converted cash memo ${invoice} into a GST invoice.${warn}` };
      }

      default:
        return { ok: false, message: "That action isn't wired yet." };
    }
  } catch (e) {
    return { ok: false, message: `Something went wrong: ${e instanceof Error ? e.message : "unknown error"}.` };
  }
}

/** Best-effort: match a product by SKU embedded in the text, else by name/keyword search. */
async function resolveProductByName(query: string): Promise<{ id: string; sku: string; name: string; qty: number; base_wholesale: number } | null> {
  const q = (query ?? "").trim();
  if (!q) return null;
  const { rows } = await getProductsPage({ q, pageSize: 5 });
  if (!rows.length) return null;
  // Prefer an exact-ish name match, else the first result.
  const lower = q.toLowerCase();
  const best = rows.find((r: any) => String(r.name).toLowerCase() === lower)
    || rows.find((r: any) => String(r.name).toLowerCase().includes(lower))
    || rows[0];
  return { id: best.id, sku: best.sku, name: best.name, qty: best.qty, base_wholesale: best.base_wholesale };
}
