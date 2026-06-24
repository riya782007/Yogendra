/**
 * lib/diva/nlu.ts — DIVA's multilingual Natural-Language Understanding engine.
 *
 * This is a PURE, dependency-free, deterministic intent engine. It runs with NO network
 * and NO model call, so DIVA works even when the LLM/Groq/OpenAI keys are absent or
 * unreachable. The server planner (app/actions/diva.ts) uses this as the primary engine
 * and only escalates to an LLM for low-confidence input.
 *
 * It understands English, Hindi (Devanagari), Hinglish (romanised Hindi) and mixed input,
 * e.g.:
 *   "20 oxidised necklace ka stock add kar do"
 *   "Blue kundan necklace ka inventory kitna hai?"
 *   "Ye product wholesale me kitne ka hai?"
 *   "SKU BD1001 ka photo dikhao"
 *   "Oxidised necklace ka catalog whatsapp pe bhejo"
 *   "New product create karo"
 *   "Customer Ravi ko wholesale bana do"
 *   "Pending orders dikhao"
 *   "GST invoice bana do"
 *   "Is bill ko cash memo se GST invoice me convert karo"
 *
 * Pipeline (Part 7 of the spec): language → intent → entities → (slot-fill) → plan.
 * Permission checks + execution happen server-side in divaRun.
 */

export type NluLang = "hi" | "en" | "hinglish";

export type NluStep = { tool: string; args: Record<string, any>; label: string };

/** Conversational memory carried between turns (serialised to/from the client). */
export type DivaContext = {
  /** A half-finished task waiting on more info (e.g. create_product needing a price). */
  pending?: { intent: string; slots: Record<string, any>; need: string[] };
  /** Last product DIVA talked about — resolves "ye/is product". */
  lastSku?: string;
  lastSubject?: string;
  /** Last customer DIVA talked about — resolves "is customer". */
  lastCustomer?: string;
};

export type NluPlan = {
  language: NluLang;
  reply: string;
  steps: NluStep[];
  /** When set, DIVA needs an answer before it can act (multi-turn slot fill). */
  ask?: { slot: string; prompt: string };
  /** Updated memory to send back on the next turn. */
  context: DivaContext;
  /** 0..1 — how sure the deterministic engine is. The server escalates < 0.45 to the LLM. */
  confidence: number;
};

// --------------------------------------------------------------------------- language

const DEVANAGARI = /[\u0900-\u097F]/;
// Unambiguous romanised-Hindi marker tokens (Hinglish detector). Deliberately EXCLUDES
// words that are also common English ("me", "do", "he", "add", "no", "par") so plain
// English commands aren't misread as Hinglish.
const HINGLISH_MARKERS = new Set([
  "ka", "ki", "ke", "ko", "kar", "karo", "kardo", "kr", "kro", "dikhao", "dikha", "batao",
  "bata", "bhejo", "bhej", "banao", "bana", "banado", "kitna", "kitne", "kitni", "mein",
  "hai", "hain", "kya", "kyu", "kaise", "nahi", "wala", "wali", "naya", "nayi", "thok",
  "daam", "keemat", "grahak", "maal", "hata", "hatao", "ghata", "ghatao", "badhao", "badha",
  "nikaal", "nikal", "chahiye", "chaiye", "lao", "wapas", "jodo", "daal", "daalo", "aaj",
  "hafta", "hafte", "dedo", "kardo",
]);

const NUM_WORDS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, paanch: 5, panch: 5, paach: 5,
  chhe: 6, chha: 6, che: 6, saat: 7, sat: 7, aath: 8, ath: 8, nau: 9, no: 9,
  das: 10, dus: 10, gyarah: 11, barah: 12, baarah: 12, terah: 13, chaudah: 14,
  pandrah: 15, solah: 16, satrah: 17, atharah: 18, unnis: 19, bees: 20, bis: 20,
  pachees: 25, pacchis: 25, tees: 30, tis: 30, chalis: 40, chaalis: 40,
  pachas: 50, pachaas: 50, pachhaas: 50, saath: 60, sattar: 70, assi: 80,
  nabbe: 90, sau: 100, hazar: 1000, hazaar: 1000, hajar: 1000,
  // English words too, for safety
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, dozen: 12,
};

/** Convert Devanagari digits (०१२…) to ASCII so number parsing is uniform. */
function asciiDigits(s: string): string {
  return s.replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - 0x0966));
}

export function detectLanguage(textRaw: string): NluLang {
  const text = textRaw ?? "";
  const hasDev = DEVANAGARI.test(text);
  const latin = (text.match(/[a-zA-Z]/g) ?? []).length;
  if (hasDev && latin === 0) return "hi";
  if (hasDev && latin > 0) return "hinglish";
  const tokens = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const markers = tokens.filter((t) => HINGLISH_MARKERS.has(t)).length;
  if (markers >= 1 && tokens.length >= 2) return "hinglish";
  return "en";
}

// --------------------------------------------------------------------------- entities

const SKU_RE = /\b(?:sku\s*)?(bd)\s*-?\s*(\d{3,6})\b/i;

export function extractSku(text: string): string | undefined {
  const m = SKU_RE.exec(text);
  return m ? `${m[1].toUpperCase()}${m[2]}` : undefined;
}

/** First sensible integer quantity in the text — digits or number-words. */
export function extractQuantity(textRaw: string): number | undefined {
  const text = asciiDigits(textRaw).toLowerCase();
  // Prefer a number that sits next to a stock/qty word, else the first standalone integer.
  const near = /(\d{1,6})\s*(?:pcs|pc|piece|pieces|units?|nos?|qty|stock|maal|adad|pieces?)/.exec(text)
    || /(?:add|badhao|badha|jodo|daal|stock|qty|quantity|set|kar do)\D{0,12}?(\d{1,6})/.exec(text);
  if (near) return parseInt(near[1], 10);
  const digit = /(?<![\d.])(\d{1,6})(?![\d.])/.exec(text);
  if (digit) return parseInt(digit[1], 10);
  for (const tok of text.split(/[^a-z]+/)) if (tok in NUM_WORDS) return NUM_WORDS[tok];
  return undefined;
}

/** A money amount near a price cue. Returns rupees. */
export function extractPriceRupees(textRaw: string): number | undefined {
  const text = asciiDigits(textRaw).toLowerCase();
  const m =
    /(?:₹|rs\.?|inr|rupees?)\s*(\d{2,7})/.exec(text) ||
    /(\d{2,7})\s*(?:₹|rs\.?|rupees?|rupaye|rupiya|\/-)/.exec(text) ||
    /(\d{2,7})\s*(?:ka|ki|me|mein|par)\b/.exec(text) ||
    /(?:price|rate|daam|keemat|mrp|wholesale|retail|cost)\D{0,8}?(\d{2,7})/.exec(text);
  return m ? parseInt(m[1], 10) : undefined;
}

const COLORS: Record<string, string> = {
  red: "red", laal: "red", lal: "red", blue: "blue", neela: "blue", nila: "blue",
  green: "green", hara: "green", hari: "green", golden: "golden", gold: "golden", sona: "golden", sunehri: "golden",
  silver: "silver", chandi: "silver", silvery: "silver", black: "black", kala: "black", kaala: "black",
  white: "white", safed: "white", pink: "pink", gulabi: "pink", maroon: "maroon", rani: "maroon",
  purple: "purple", baingani: "purple",
};

export function extractColor(textRaw: string): string | undefined {
  const text = textRaw.toLowerCase();
  for (const k of Object.keys(COLORS)) {
    if (new RegExp(`\\b${k}\\b`).test(text)) return COLORS[k];
  }
  return undefined;
}

/** Jewellery taxonomy keywords used to recognise a product subject / catalogue facet. */
export const TAXONOMY_KEYWORDS = [
  "oxidised", "oxidized", "kundan", "polki", "temple", "american diamond", "ad ",
  "choker", "long necklace", "necklace", "earring", "jhumka", "jhumki", "stud", "studs",
  "bracelet", "kada", "kade", "bangle", "bangles", "anklet", "payal", "ring", "rings",
  "maang tikka", "mangtika", "mang tikka", "nose pin", "nath", "pendant", "set", "chain",
  "mala", "haar", "bali", "balian", "earrings",
];

// Words to strip when isolating a product "subject" from a command.
const COMMAND_STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "to", "and", "please", "kindly", "show", "me", "tell",
  "add", "remove", "create", "make", "new", "set", "update", "change", "delete", "hide",
  "publish", "open", "go", "into", "in", "on", "at", "this", "that", "ye", "yeh", "is",
  "wo", "woh", "us", "stock", "inventory", "qty", "quantity", "maal", "ka", "ki", "ke",
  "ko", "kar", "karo", "kardo", "kr", "do", "de", "dedo", "hai", "hain", "he", "kitna",
  "kitne", "kitni", "dikhao", "dikha", "batao", "bata", "bhejo", "bhej", "bana", "banao",
  "banado", "mein", "me", "pe", "par", "se", "naya", "nayi", "kya", "lao", "chahiye",
  "pieces", "piece", "pcs", "units", "unit", "nos", "rupees", "rs", "inr", "price", "rate",
  "daam", "wholesale", "retail", "mrp", "photo", "image", "pic", "catalog", "catalogue",
  "whatsapp", "wala", "wali", "badhao", "ghata", "hata", "hatao", "nikaal", "product",
]);

/** Pull the product/category subject phrase out of a command (best-effort). */
export function extractSubject(textRaw: string): string | undefined {
  let text = asciiDigits(textRaw)
    .replace(SKU_RE, " ")
    .replace(/[₹/]/g, " ")
    .replace(/\d+/g, " ")
    .toLowerCase();
  // Prefer a multi-word taxonomy phrase if present.
  for (const kw of TAXONOMY_KEYWORDS) {
    const phrase = kw.trim();
    if (phrase.includes(" ") && text.includes(phrase)) {
      // expand to include a leading colour/material adjective if present
      const m = new RegExp(`([a-z]+\\s+)?${phrase}`).exec(text);
      return (m?.[0] ?? phrase).trim();
    }
  }
  const tokens = text.split(/[^a-z]+/).filter((t) => t && !COMMAND_STOPWORDS.has(t));
  if (tokens.length === 0) return undefined;
  // Keep at most the last 4 meaningful tokens (the noun phrase tends to trail).
  const phrase = tokens.slice(-4).join(" ").trim();
  return phrase || undefined;
}

function hasAny(text: string, words: string[]): boolean {
  return words.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, "i").test(text));
}

// --------------------------------------------------------------------------- intents

const ADD_WORDS = ["add", "badhao", "badha", "jodo", "daal", "daalo", "increase", "plus"];
const REMOVE_WORDS = ["remove", "hata", "hatao", "ghata", "ghatao", "nikaal", "nikal", "kam", "minus", "reduce", "deduct"];
const SHOW_WORDS = ["dikhao", "dikha", "batao", "bata", "show", "list", "open", "kholo", "kitna", "kitne", "how"];
const CREATE_WORDS = ["create", "banao", "bana", "banado", "naya", "nayi", "new", "add product", "register"];
const SEND_WORDS = ["bhejo", "bhej", "send", "share", "forward"];
const DELETE_WORDS = ["delete", "remove product", "mita", "mitao", "hatado"];
const HIDE_WORDS = ["hide", "chhupao", "chupa", "unpublish", "take off", "off karo"];
const PUBLISH_WORDS = ["publish", "show on store", "live karo", "dikhana shuru", "put back", "wapas dikhao"];

/** Friendly localised acknowledgements. */
function ack(lang: NluLang, en: string, hin: string): string {
  return lang === "hi" || lang === "hinglish" ? hin : en;
}

/**
 * Interpret one user turn. `ctx` carries memory from prior turns (slot-filling, "ye product").
 */
export function interpret(commandRaw: string, ctx: DivaContext = {}): NluPlan {
  const command = (commandRaw ?? "").trim();
  const lang = detectLanguage(command);
  const lower = command.toLowerCase();
  const base: Omit<NluPlan, "steps" | "reply" | "confidence"> = { language: lang, context: { ...ctx } };

  if (!command) {
    return { ...base, steps: [], confidence: 0, reply: ack(lang, "Tell me what you'd like done.", "Boliye, main kya karun?") };
  }

  // ---- 0) Continue a pending multi-step task (slot filling) --------------------
  if (ctx.pending) {
    const cont = continuePending(command, lang, ctx);
    if (cont) return cont;
  }

  const sku = extractSku(command) || (/(\bye\b|\byeh\b|\bis\b|\bthis\b)\s*(product|item)?/.test(lower) ? ctx.lastSku : undefined);
  const subject = extractSubject(command);
  const qty = extractQuantity(command);
  const price = extractPriceRupees(command);
  const color = extractColor(command);

  const remember = (over: Partial<DivaContext>): DivaContext => ({ ...ctx, pending: undefined, ...over });

  // ---- 1) Invoice conversion: "cash memo se GST invoice me convert karo" -------
  if (hasAny(lower, ["convert", "badal"]) && /gst/.test(lower) && /(cash memo|cash|memo|bill)/.test(lower)) {
    return mk(base, [step("convert_invoice", { to: "gst", invoice: extractInvoiceNo(command) }, "Convert cash memo → GST invoice")],
      ack(lang, "I'll convert that cash memo into a GST invoice.", "Theek hai, is cash memo ko GST invoice me badal deti hun."), 0.8, remember({}));
  }

  // ---- 2) Create invoice / estimate -------------------------------------------
  if (hasAny(lower, CREATE_WORDS) && /(invoice|bill|gst|estimate|quotation|cash memo)/.test(lower)) {
    const wantGst = /gst/.test(lower);
    const isEstimate = /(estimate|quotation)/.test(lower);
    const page = isEstimate ? "estimates" : "billing";
    return mk(base, [step("open_page", { page }, `Open ${isEstimate ? "estimates" : "billing"}`)],
      ack(lang,
        `Opening ${isEstimate ? "estimates" : "billing"} so you can raise ${wantGst ? "a GST invoice" : "the bill"}. Add items and I'll total it.`,
        `${isEstimate ? "Estimates" : "Billing"} khol rahi hun — items add kijiye, ${wantGst ? "GST invoice" : "bill"} ready ho jayega.`),
      0.7, remember({}));
  }

  // ---- 3) Pending orders ------------------------------------------------------
  if (/(pending|due|unfulfilled|baaki|adhura)/.test(lower) && /order/.test(lower)) {
    return mk(base, [step("pending_orders", {}, "List pending orders")],
      ack(lang, "Here are the orders still pending.", "Ye rahe abhi tak ke pending orders."), 0.85, remember({}));
  }

  // ---- 4) Customer: make wholesale / retail / create --------------------------
  const custName = extractCustomerName(command);
  if (/(customer|grahak|party|client)/.test(lower) || custName) {
    if (hasAny(lower, ["wholesale", "thok"]) && hasAny(lower, ["bana", "banao", "make", "set", "convert", "kar"])) {
      const name = custName || ctx.lastCustomer;
      if (!name) return askFor(base, "customer_name", "create_customer", {}, ack(lang, "Which customer should I set to wholesale?", "Kis customer ko wholesale banana hai?"), ctx);
      return mk(base, [step("set_customer_type", { name, type: "wholesale" }, `Set ${name} → wholesale`)],
        ack(lang, `I'll switch ${name} to wholesale pricing.`, `${name} ko wholesale rate par set kar deti hun.`), 0.85, remember({ lastCustomer: name }));
    }
    if (hasAny(lower, ["retail"]) && hasAny(lower, ["bana", "banao", "make", "set", "kar"])) {
      const name = custName || ctx.lastCustomer;
      if (name) return mk(base, [step("set_customer_type", { name, type: "retail" }, `Set ${name} → retail`)],
        ack(lang, `I'll switch ${name} to retail pricing.`, `${name} ko retail par set kar deti hun.`), 0.85, remember({ lastCustomer: name }));
    }
    if (hasAny(lower, CREATE_WORDS) && custName) {
      return mk(base, [step("create_customer", { name: custName, type: /(wholesale|thok)/.test(lower) ? "wholesale" : "retail" }, `Create customer ${custName}`)],
        ack(lang, `Creating customer ${custName}.`, `${custName} ko customer bana rahi hun.`), 0.75, remember({ lastCustomer: custName }));
    }
    if (custName) {
      return mk(base, [step("find_customer", { query: custName }, `Find ${custName}`)],
        ack(lang, `Looking up ${custName}.`, `${custName} ko dhoondh rahi hun.`), 0.7, remember({ lastCustomer: custName }));
    }
  }

  // ---- 5) Catalogue share: "oxidised necklace ka catalog whatsapp pe bhejo" ----
  if (/(catalog|catalogue)/.test(lower) || (hasAny(lower, SEND_WORDS) && subject)) {
    const facet = subject;
    const viaWhatsapp = /whatsapp|wa\b/.test(lower);
    return mk(base, [step("share_catalog", { facet: facet ?? "", whatsapp: viaWhatsapp }, facet ? `Share "${facet}" catalogue` : "Share catalogue")],
      ack(lang,
        facet ? `I'll prepare the ${facet} catalogue${viaWhatsapp ? " ready to send on WhatsApp" : ""}.` : "I'll prepare a catalogue to share.",
        facet ? `${facet} ka catalogue ${viaWhatsapp ? "WhatsApp par bhejne ke liye " : ""}taiyaar kar rahi hun.` : "Catalogue taiyaar kar rahi hun."),
      0.7, remember({ lastSubject: facet }));
  }

  // ---- 6) Photo: "SKU BD1001 ka photo dikhao" ---------------------------------
  if (/(photo|image|pic|tasveer|tasvir)/.test(lower)) {
    if (sku) return mk(base, [step("product_details", { sku }, `Show ${sku}`), step("open_page", { page: "media" }, "Open product photos")],
      ack(lang, `Showing photos for ${sku}.`, `${sku} ke photos dikha rahi hun.`), 0.8, remember({ lastSku: sku }));
    if (subject) return mk(base, [step("find_product", { query: subject }, `Find "${subject}"`)],
      ack(lang, `Let me find "${subject}" first.`, `Pehle "${subject}" dhoondhti hun.`), 0.6, remember({ lastSubject: subject }));
  }

  // ---- 7) Set price: "BD1004 ka retail price 1500 kar do" --------------------
  if (sku && price && hasAny(lower, ["set", "kardo", "karo", "update", "change", "badlo", "badal", "lagao", "rakho", "kar"]) &&
      hasAny(lower, ["price", "rate", "daam", "keemat", "mrp", "wholesale", "retail", "thok"])) {
    const tier = /(wholesale|thok)/.test(lower) ? "wholesale" : /retail/.test(lower) ? "retail" : /mrp/.test(lower) ? "mrp" : "base";
    return mk(base, [step("set_price", { sku, price, tier }, `Set ${sku} ${tier} ₹${price}`)],
      ack(lang, `I'll set ${sku}'s ${tier === "base" ? "base/wholesale" : tier} price to ₹${price}.`,
        `${sku} ka ${tier === "base" ? "base" : tier} price ₹${price} kar deti hun.`), 0.82, remember({ lastSku: sku }));
  }

  // ---- 7b) Price query: "ye product wholesale me kitne ka hai?" ----------------
  if (hasAny(lower, ["price", "rate", "daam", "keemat", "mrp", "cost"]) || (/(kitne|kitna|how much)/.test(lower) && /(ka|ki|me|mein)/.test(lower) && !/(stock|inventory|maal)/.test(lower))) {
    const tier = /(wholesale|thok)/.test(lower) ? "wholesale" : /retail/.test(lower) ? "retail" : /mrp/.test(lower) ? "mrp" : "all";
    if (sku) return mk(base, [step("get_price", { sku, tier }, `${sku} ${tier} price`)],
      ack(lang, `Checking the ${tier === "all" ? "" : tier + " "}price for ${sku}.`, `${sku} ka ${tier === "all" ? "" : tier + " "}price dekh rahi hun.`), 0.8, remember({ lastSku: sku }));
    if (subject) return mk(base, [step("get_price", { query: subject, tier }, `Price of "${subject}"`)],
      ack(lang, `Checking the ${tier === "all" ? "" : tier + " "}price for "${subject}".`, `"${subject}" ka price dekh rahi hun.`), 0.65, remember({ lastSubject: subject }));
  }

  // ---- 7c) Damage: "BD1004 ka 2 piece damage ho gaya" ------------------------
  if (hasAny(lower, ["damage", "damaged", "kharab", "toot", "tut", "tutt", "broken", "defective", "fut"]) && (sku || subject || qty)) {
    if (!qty) return askFor(base, "qty", "record_damage", { sku, subject }, ack(lang, "How many pieces are damaged?", "Kitne pieces damage hue?"), ctx);
    if (sku) return mk(base, [step("record_damage", { sku, qty }, `Damage ${qty} → ${sku}`)],
      ack(lang, `Logging ${qty} damaged for ${sku}.`, `${sku} ke ${qty} piece damaged mark kar rahi hun.`), 0.82, remember({ lastSku: sku }));
    if (subject) return mk(base, [step("record_damage", { query: subject, qty }, `Damage ${qty} → "${subject}"`)],
      ack(lang, `Logging ${qty} damaged for "${subject}".`, `"${subject}" ke ${qty} damaged mark kar rahi hun.`), 0.6, remember({ lastSubject: subject }));
  }

  // ---- 8) Stock add / remove --------------------------------------------------
  if (hasAny(lower, ADD_WORDS) && (/(stock|inventory|maal|qty|quantity|pieces|piece|pcs|units?)/.test(lower) || qty)) {
    return stockPlan(base, ctx, lang, "add_stock", sku, subject, qty);
  }
  if (hasAny(lower, REMOVE_WORDS) && (/(stock|inventory|maal|qty|quantity|pieces|piece|pcs|units?)/.test(lower) || qty)) {
    return stockPlan(base, ctx, lang, "remove_stock", sku, subject, qty);
  }

  // ---- 9) Inventory / stock query: "blue kundan necklace ka inventory kitna hai" -
  if (/(stock|inventory|maal)/.test(lower) && /(kitna|kitne|how many|how much|level|check|dikhao|batao|status)/.test(lower)) {
    const q = (subject ?? color ?? "").trim();
    if (sku) return mk(base, [step("product_details", { sku }, `Stock of ${sku}`)],
      ack(lang, `Checking stock for ${sku}.`, `${sku} ka stock dekh rahi hun.`), 0.8, remember({ lastSku: sku }));
    if (q) return mk(base, [step("inventory_of", { query: q }, `Stock of "${q}"`)],
      ack(lang, `Checking stock for "${q}".`, `"${q}" ka stock dekh rahi hun.`), 0.7, remember({ lastSubject: q }));
    return mk(base, [step("inventory_status", {}, "Inventory health")],
      ack(lang, "Here's your inventory health.", "Ye rahi inventory ki halat."), 0.6, remember({}));
  }

  // ---- 10) Create product (multi-turn) ----------------------------------------
  if (hasAny(lower, CREATE_WORDS) && (/(product|item)/.test(lower) || subject)) {
    const slots: Record<string, any> = {};
    if (subject) slots.name = subject;
    if (price) slots.price = price;
    if (qty) slots.qty = qty;
    return advanceCreateProduct(base, lang, slots, ctx);
  }

  // ---- 11) Hide / publish / delete a product ----------------------------------
  if (hasAny(lower, DELETE_WORDS) && sku) {
    return mk(base, [step("delete_product", { sku }, `Delete ${sku}`)],
      ack(lang, `I'll delete ${sku} (kept as hidden if it has past orders).`, `${sku} ko delete kar rahi hun.`), 0.8, remember({ lastSku: sku }));
  }
  if (hasAny(lower, HIDE_WORDS) && sku) {
    return mk(base, [step("hide_product", { sku }, `Hide ${sku}`)],
      ack(lang, `Hiding ${sku} from the store.`, `${sku} ko store se hata rahi hun.`), 0.8, remember({ lastSku: sku }));
  }
  if (hasAny(lower, PUBLISH_WORDS) && sku) {
    return mk(base, [step("show_product", { sku }, `Publish ${sku}`)],
      ack(lang, `Publishing ${sku}.`, `${sku} ko store par live kar rahi hun.`), 0.8, remember({ lastSku: sku }));
  }

  // ---- 12) SKU rename: "BD1001 ka sku BD2001 kar do" --------------------------
  if (sku && /\bsku\b/.test(lower)) {
    const skus = command.match(/\bbd\s*-?\s*\d{3,6}\b/gi)?.map((s) => s.replace(/\s|-/g, "").toUpperCase());
    if (skus && skus.length >= 2 && skus[0] !== skus[1]) {
      return mk(base, [step("rename_sku", { sku: skus[0], newSku: skus[1] }, `Rename ${skus[0]} → ${skus[1]}`)],
        ack(lang, `I'll rename ${skus[0]} to ${skus[1]}.`, `${skus[0]} ka SKU ${skus[1]} kar deti hun.`), 0.8, remember({ lastSku: skus[1] }));
    }
  }

  // ---- 13) Categories / subcategories -----------------------------------------
  if (hasAny(lower, CREATE_WORDS) && /(sub-?category|subcategory)/.test(lower)) {
    return mk(base, [step("create_subcategory", { name: subject ?? "" }, "Create subcategory")],
      ack(lang, "I'll add that subcategory.", "Subcategory add kar rahi hun."), 0.6, remember({}));
  }
  if (hasAny(lower, CREATE_WORDS) && /categor/.test(lower)) {
    return mk(base, [step("create_category", { name: subject ?? "" }, "Create category")],
      ack(lang, "I'll add that category.", "Category add kar rahi hun."), 0.6, remember({}));
  }

  // ---- 14) Navigation: "open inventory", "billing kholo" ----------------------
  const pageHit = matchPage(lower);
  if (pageHit) {
    return mk(base, [step("open_page", { page: pageHit }, `Open ${pageHit}`)],
      ack(lang, `Opening ${pageHit}.`, `${pageHit} khol rahi hun.`), 0.75, remember({}));
  }

  // ---- 15) Sales / revenue / business summary ---------------------------------
  if (/(sales|revenue|sold|kamaai|bikri|earn|turnover)/.test(lower)) {
    const days = /week|hafta|hafte/.test(lower) ? 7 : /today|aaj/.test(lower) ? 1 : 30;
    return mk(base, [step("analyze_sales", { days }, "Analyse sales")],
      ack(lang, `Pulling sales for the last ${days} day${days > 1 ? "s" : ""}.`, `Pichle ${days} din ki sale nikaal rahi hun.`), 0.7, remember({}));
  }
  if (/(summary|overview|brief|pulse|kaisa chal|business)/.test(lower)) {
    return mk(base, [step("business_summary", { days: 30 }, "Business summary")],
      ack(lang, "Here's a quick business summary.", "Ye rahi business ki summary."), 0.65, remember({}));
  }

  // ---- 16) Bare subject → look it up ------------------------------------------
  if (sku) return mk(base, [step("product_details", { sku }, `Details of ${sku}`)],
    ack(lang, `Here's ${sku}.`, `Ye raha ${sku}.`), 0.55, remember({ lastSku: sku }));
  if (subject && TAXONOMY_KEYWORDS.some((k) => subject.includes(k.trim())))
    return mk(base, [step("find_product", { query: subject }, `Find "${subject}"`)],
      ack(lang, `Searching for "${subject}".`, `"${subject}" dhoondh rahi hun.`), 0.5, remember({ lastSubject: subject }));

  // ---- fallback: low confidence → server may try the LLM ----------------------
  return { ...base, steps: [], confidence: 0.2, context: remember({}),
    reply: ack(lang, "I didn't quite catch that — try e.g. \"add 20 to BD1004\", \"BD1004 ka wholesale price\", or \"open inventory\".",
      "Samajh nahi paayi — jaise boliye: \"BD1004 me 20 add karo\", \"BD1004 ka wholesale price\", ya \"inventory kholo\".") };
}

// --------------------------------------------------------------------------- helpers

function step(tool: string, args: Record<string, any>, label: string): NluStep {
  return { tool, args, label };
}

function mk(base: Omit<NluPlan, "steps" | "reply" | "confidence">, steps: NluStep[], reply: string, confidence: number, context: DivaContext): NluPlan {
  return { ...base, steps, reply, confidence, context };
}

function askFor(base: Omit<NluPlan, "steps" | "reply" | "confidence">, slot: string, intent: string, slots: Record<string, any>, prompt: string, ctx: DivaContext): NluPlan {
  return { ...base, steps: [], reply: prompt, confidence: 0.6, ask: { slot, prompt },
    context: { ...ctx, pending: { intent, slots, need: [slot] } } };
}

function stockPlan(base: Omit<NluPlan, "steps" | "reply" | "confidence">, ctx: DivaContext, lang: NluLang, tool: "add_stock" | "remove_stock", sku?: string, subject?: string, qty?: number): NluPlan {
  const verb = tool === "add_stock" ? "add" : "remove";
  const verbHin = tool === "add_stock" ? "add" : "kam";
  if (!sku && !subject) {
    return askFor(base, "sku", tool, { qty }, ack(lang, `Which product? Give me a SKU like BD1004.`, `Kis product me? SKU bataiye jaise BD1004.`), ctx);
  }
  if (!qty) {
    return askFor(base, "qty", tool, { sku, subject }, ack(lang, `How many units to ${verb}?`, `Kitne units ${verbHin} karne hain?`), ctx);
  }
  if (sku) {
    return mk(base, [step(tool, { sku, qty, source: "DIVA command" }, `${verb} ${qty} → ${sku}`)],
      ack(lang, `I'll ${verb} ${qty} unit${qty > 1 ? "s" : ""} ${tool === "add_stock" ? "to" : "from"} ${sku}.`,
        `${sku} me ${qty} unit ${tool === "add_stock" ? "add" : "kam"} kar rahi hun.`), 0.85, { ...ctx, pending: undefined, lastSku: sku });
  }
  // We have a subject but no SKU → resolve first, then the executor applies the delta by name.
  return mk(base, [step(tool === "add_stock" ? "add_stock_by_name" : "remove_stock_by_name", { query: subject, qty, source: "DIVA command" }, `${verb} ${qty} → "${subject}"`)],
    ack(lang, `I'll ${verb} ${qty} to "${subject}" — I'll match it to a product first.`,
      `"${subject}" me ${qty} ${tool === "add_stock" ? "add" : "kam"} kar rahi hun.`), 0.6, { ...ctx, pending: undefined, lastSubject: subject });
}

function advanceCreateProduct(base: Omit<NluPlan, "steps" | "reply" | "confidence">, lang: NluLang, slots: Record<string, any>, ctx: DivaContext): NluPlan {
  const need: string[] = [];
  if (!slots.name) need.push("name");
  else if (!slots.category) need.push("category");
  else if (!slots.price) need.push("price");
  else if (slots.qty == null) need.push("qty");

  if (need.length > 0) {
    const slot = need[0];
    const prompts: Record<string, [string, string]> = {
      name: ["What's the product name?", "Product ka naam kya hai?"],
      category: ["Which category? (e.g. Necklaces, Earrings)", "Kaunsi category? (jaise Necklace, Earring)"],
      price: ["What's the wholesale/base price in ₹?", "Wholesale/base price kitna (₹)?"],
      qty: ["How many pieces in stock?", "Kitne pieces stock me?"],
    };
    return { ...base, steps: [], confidence: 0.6, ask: { slot, prompt: ack(lang, prompts[slot][0], prompts[slot][1]) },
      reply: ack(lang, prompts[slot][0], prompts[slot][1]),
      context: { ...ctx, pending: { intent: "create_product", slots, need: [slot] } } };
  }
  return mk(base, [step("create_product", { name: slots.name, category: slots.category, price: slots.price, qty: slots.qty ?? 0 }, `Create ${slots.name}`)],
    ack(lang, `Creating "${slots.name}" in ${slots.category} at ₹${slots.price}, ${slots.qty ?? 0} pcs.`,
      `"${slots.name}" bana rahi hun — ${slots.category}, ₹${slots.price}, ${slots.qty ?? 0} pcs.`),
    0.8, { ...ctx, pending: undefined, lastSubject: slots.name });
}

/** Resolve an answer to a pending slot-fill question. */
function continuePending(command: string, lang: NluLang, ctx: DivaContext): NluPlan | null {
  const p = ctx.pending!;
  const lower = command.toLowerCase();
  // Allow the user to bail out.
  if (/(cancel|chhodo|rehne do|stop|nahi|forget it)/.test(lower)) {
    return { language: lang, steps: [], confidence: 0.7, context: { ...ctx, pending: undefined },
      reply: ack(lang, "Okay, cancelled.", "Theek hai, cancel kar diya.") };
  }
  const base: Omit<NluPlan, "steps" | "reply" | "confidence"> = { language: lang, context: { ...ctx } };
  const slot = p.need[0];
  const slots = { ...p.slots };

  if (slot === "qty") slots.qty = extractQuantity(command) ?? slots.qty;
  else if (slot === "price") slots.price = extractPriceRupees(command) ?? extractQuantity(command) ?? slots.price;
  else if (slot === "sku") slots.sku = extractSku(command);
  else if (slot === "name") slots.name = extractSubject(command) ?? command.trim();
  else if (slot === "category") slots.category = command.trim();
  else if (slot === "customer_name") slots.name = extractCustomerName(command) ?? command.trim();

  if (p.intent === "create_product") return advanceCreateProduct(base, lang, slots, ctx);

  if (p.intent === "add_stock" || p.intent === "remove_stock") {
    return stockPlan(base, ctx, lang, p.intent as any, slots.sku, slots.subject, slots.qty);
  }
  if (p.intent === "record_damage") {
    if (!slots.qty) return askFor(base, "qty", "record_damage", slots, ack(lang, "How many pieces are damaged?", "Kitne pieces damage hue?"), ctx);
    if (slots.sku) return mk(base, [step("record_damage", { sku: slots.sku, qty: slots.qty }, `Damage ${slots.qty} → ${slots.sku}`)],
      ack(lang, `Logging ${slots.qty} damaged for ${slots.sku}.`, `${slots.sku} ke ${slots.qty} damaged mark kar rahi hun.`), 0.8, { ...ctx, pending: undefined, lastSku: slots.sku });
    if (slots.subject) return mk(base, [step("record_damage", { query: slots.subject, qty: slots.qty }, `Damage ${slots.qty} → "${slots.subject}"`)],
      ack(lang, `Logging ${slots.qty} damaged for "${slots.subject}".`, `"${slots.subject}" ke ${slots.qty} damaged mark kar rahi hun.`), 0.6, { ...ctx, pending: undefined, lastSubject: slots.subject });
  }
  if (p.intent === "create_customer" && slots.name) {
    return mk(base, [step("set_customer_type", { name: slots.name, type: "wholesale" }, `Set ${slots.name} → wholesale`)],
      ack(lang, `I'll set ${slots.name} to wholesale.`, `${slots.name} ko wholesale bana rahi hun.`), 0.8, { ...ctx, pending: undefined, lastCustomer: slots.name });
  }
  return null;
}

function extractCustomerName(textRaw: string): string | undefined {
  const text = textRaw.replace(/\s+/g, " ").trim();
  // "customer Ravi", "grahak Ravi", "party Ravi Kumar"
  let m = /(?:customer|grahak|party|client)\s+([a-z][a-z .]{1,30}?)(?:\s+(?:ko|ka|ki|ke|wholesale|retail|bana|banao|set|make|create|register|add|hai|$))/i.exec(text);
  if (m) return clean(m[1]);
  m = /(?:customer|grahak|party|client)\s+([a-z][a-z]{1,20})/i.exec(text);
  if (m) return clean(m[1]);
  // "Ravi ko wholesale bana do"
  m = /\b([A-Z][a-z]{1,20})\s+ko\b/.exec(textRaw);
  if (m) return clean(m[1]);
  return undefined;
}

function clean(s: string): string {
  return s.trim().replace(/\b(ko|ka|ki|ke)\b$/i, "").trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractInvoiceNo(text: string): string | undefined {
  const m = /\b(inv[-\w]*\d+|#?\d{3,})\b/i.exec(text);
  return m ? m[1].replace(/^#/, "") : undefined;
}

const PAGE_ALIASES: Record<string, string> = {
  dashboard: "dashboard", analytics: "analytics", catalogue: "catalogue", catalog: "catalogue",
  products: "catalogue", inventory: "inventory", stock: "inventory", upload: "upload",
  media: "media", "product photos": "media", photos: "media", categories: "categories",
  barcodes: "barcodes", barcode: "barcodes", reorder: "reorder", billing: "billing", pos: "billing",
  sales: "sales", estimates: "estimates", returns: "returns", purchases: "purchases",
  customers: "customers", suppliers: "suppliers", vendors: "suppliers", reviews: "reviews",
  reels: "reels", abandoned: "abandoned carts", approvals: "approvals", notifications: "notifications",
  inbox: "notifications", roles: "roles",
};

function matchPage(lower: string): string | undefined {
  const wantsNav = hasAny(lower, ["open", "go to", "kholo", "show me the", "take me", "le chalo", "jao", "navigate"]);
  for (const alias of Object.keys(PAGE_ALIASES)) {
    if (lower.includes(alias)) {
      // require a navigation verb for ambiguous single words like "sales"/"stock" handled elsewhere
      if (wantsNav || alias.includes(" ")) return PAGE_ALIASES[alias];
    }
  }
  return undefined;
}
