/**
 * DIVA tool catalogue — the operations DIVA can perform in the console.
 * Shared by the planner (server) and the widget (client). No server-only imports.
 *
 * kind: "read" = fetch/analyse data · "navigate" = move the console · "mutate" = change data.
 * permission: granular key from lib/permissions (owner has all). confirm: ask before running.
 */
export type DivaKind = "read" | "navigate" | "mutate";
export type DivaParam = { name: string; type: "string" | "number"; required?: boolean; desc: string };
export type DivaTool = { name: string; kind: DivaKind; permission?: string; confirm?: boolean; desc: string; params: DivaParam[] };

/** Friendly page names → admin routes (used by open_page). */
// EVERY admin page DIVA can open, with English + Hinglish aliases. The open_page executor also does a
// partial (substring) match, so near-misses still resolve — but exact keys are fastest and safest.
export const PAGE_MAP: Record<string, string> = {
  // Overview
  dashboard: "/admin/dashboard", home: "/admin/dashboard", overview: "/admin/dashboard",
  analytics: "/admin/analytics", reports: "/admin/analytics", report: "/admin/analytics",

  // Catalogue & inventory
  catalogue: "/admin/catalogue", catalog: "/admin/catalogue", products: "/admin/catalogue",
  inventory: "/admin/inventory", stock: "/admin/inventory",
  "stock movements": "/admin/stock-movements", "stock movement": "/admin/stock-movements",
  "stock history": "/admin/stock-movements", "stock ledger": "/admin/stock-movements", movements: "/admin/stock-movements",
  "add inventory": "/admin/upload", upload: "/admin/upload", "bulk upload": "/admin/upload", import: "/admin/upload",
  media: "/admin/media", "product photos": "/admin/media", photos: "/admin/media", images: "/admin/media", gallery: "/admin/media",
  categories: "/admin/categories", category: "/admin/categories", subcategories: "/admin/categories",
  pricing: "/admin/pricing", "price settings": "/admin/pricing", "pricing formula": "/admin/pricing", "price formula": "/admin/pricing",
  colours: "/admin/colours", colors: "/admin/colours", "colour master": "/admin/colours",
  barcodes: "/admin/barcodes", barcode: "/admin/barcodes", labels: "/admin/barcodes",
  reorder: "/admin/reorder", "ai reorder": "/admin/reorder", restock: "/admin/reorder",

  // Selling & bills
  billing: "/admin/billing", pos: "/admin/billing", counter: "/admin/billing", "new bill": "/admin/billing",
  sales: "/admin/sales", "sales records": "/admin/sales", bikri: "/admin/sales", "sale records": "/admin/sales",
  orders: "/admin/orders", "all orders": "/admin/orders",
  estimates: "/admin/estimates", estimate: "/admin/estimates", quotation: "/admin/estimates", quotations: "/admin/estimates",
  quotes: "/admin/quotes", "design quotes": "/admin/quotes",
  cod: "/admin/cod", "cod orders": "/admin/cod", "cash on delivery": "/admin/cod", "cod hold": "/admin/cod",
  backorders: "/admin/backorders", backorder: "/admin/backorders",
  returns: "/admin/returns", "return": "/admin/returns", wapsi: "/admin/returns",

  // Money
  "wholesale payments": "/admin/wholesale-payments", "wholesale payment": "/admin/wholesale-payments",
  "dealer payments": "/admin/wholesale-payments", "payment verify": "/admin/wholesale-payments", "thok payment": "/admin/wholesale-payments",
  creditors: "/admin/creditors", udhaar: "/admin/creditors", credit: "/admin/creditors", "who owes": "/admin/creditors",
  cashbook: "/admin/cashbook", "cash book": "/admin/cashbook", rokad: "/admin/cashbook", "bank and cash": "/admin/cashbook",
  vouchers: "/admin/vouchers", voucher: "/admin/vouchers", coupons: "/admin/vouchers", "discount codes": "/admin/vouchers",
  promotions: "/admin/promotions", promotion: "/admin/promotions", offers: "/admin/promotions", campaigns: "/admin/promotions", promo: "/admin/promotions",

  // Purchases & suppliers
  purchases: "/admin/purchases", purchase: "/admin/purchases", kharid: "/admin/purchases", buying: "/admin/purchases",
  suppliers: "/admin/suppliers", supplier: "/admin/suppliers", vendors: "/admin/suppliers",

  // People & storefront
  customers: "/admin/customers", customer: "/admin/customers", grahak: "/admin/customers", parties: "/admin/customers", dealers: "/admin/customers",
  reviews: "/admin/reviews", ratings: "/admin/reviews",
  reels: "/admin/reels", videos: "/admin/reels",
  "abandoned carts": "/admin/abandoned", abandoned: "/admin/abandoned", "left carts": "/admin/abandoned",
  visitors: "/admin/visitors", "trade visitors": "/admin/visitors", leads: "/admin/visitors",
  enquiries: "/admin/enquiries", enquiry: "/admin/enquiries", "design enquiries": "/admin/enquiries",
  submissions: "/admin/submissions", "product submissions": "/admin/submissions", "sell with us": "/admin/submissions",
  approvals: "/admin/approvals", approval: "/admin/approvals",
  feedback: "/admin/feedback", complaints: "/admin/feedback",

  // Admin / staff
  notifications: "/admin/inbox", inbox: "/admin/inbox", alerts: "/admin/inbox",
  notify: "/admin/notify", broadcast: "/admin/notify", "send notification": "/admin/notify",
  employees: "/admin/employees", staff: "/admin/employees", workers: "/admin/employees",
  roles: "/admin/roles", role: "/admin/roles", permissions: "/admin/roles",
};

export const DIVA_TOOLS: DivaTool[] = [
  // READ / ANALYSE
  { name: "business_summary", kind: "read", desc: "Overall snapshot: revenue, orders, dead/low stock, top sellers for a period.", params: [{ name: "days", type: "number", desc: "look-back window in days (default 30)" }] },
  { name: "analyze_sales", kind: "read", permission: "sales.view", desc: "Sales totals and channel breakdown for a period.", params: [{ name: "days", type: "number", desc: "look-back window in days (default 30)" }] },
  { name: "inventory_status", kind: "read", permission: "inventory.view", desc: "Dead / low / healthy stock counts and the worst dead-stock items.", params: [] },
  { name: "low_stock", kind: "read", permission: "inventory.view", desc: "List products that are low or out of stock.", params: [] },
  { name: "find_product", kind: "read", permission: "catalog.view", desc: "Search the catalogue by name or SKU; returns price and stock.", params: [{ name: "query", type: "string", required: true, desc: "name or SKU to search" }] },
  { name: "product_details", kind: "read", permission: "catalog.view", desc: "Full details of one product: price, stock, status, tags, description, photos.", params: [{ name: "sku", type: "string", required: true, desc: "product SKU" }] },
  { name: "product_analytics", kind: "read", permission: "sales.view", desc: "Sales analytics for one product: units sold, revenue, number of orders.", params: [{ name: "sku", type: "string", required: true, desc: "product SKU" }] },

  // NAVIGATE
  { name: "open_page", kind: "navigate", desc: "Open a console page by name (dashboard, catalogue, inventory, billing, sales, estimates, suppliers, roles, barcodes, etc.).", params: [{ name: "page", type: "string", required: true, desc: "page name" }] },

  // MUTATE (permission-gated, confirmed)
  { name: "add_stock", kind: "mutate", permission: "inventory.add", confirm: true, desc: "Increase stock by a quantity. For a product that has colours, pass the colour in `color` to target that colour variant (e.g. 'EE5270 me 5 green add karo' → color=green).", params: [{ name: "sku", type: "string", required: true, desc: "product SKU" }, { name: "qty", type: "number", required: true, desc: "units to add" }, { name: "color", type: "string", desc: "colour/variant to target (for products with colours)" }, { name: "source", type: "string", desc: "reason/source" }] },
  { name: "remove_stock", kind: "mutate", permission: "inventory.remove", confirm: true, desc: "Decrease stock by a quantity. For a product with colours, pass the colour in `color` to target that colour variant.", params: [{ name: "sku", type: "string", required: true, desc: "product SKU" }, { name: "qty", type: "number", required: true, desc: "units to remove" }, { name: "color", type: "string", desc: "colour/variant to target (for products with colours)" }, { name: "source", type: "string", desc: "reason/source" }] },
  { name: "generate_ai_content", kind: "mutate", permission: "catalog.ai", confirm: true, desc: "Generate/refresh the AI product page (title, description, tags, SEO) for a SKU.", params: [{ name: "sku", type: "string", required: true, desc: "product SKU" }] },
  { name: "generate_photo", kind: "mutate", permission: "catalog.ai", confirm: true, desc: "Generate the professional model photo from a product's raw photo.", params: [{ name: "sku", type: "string", required: true, desc: "product SKU" }] },
  { name: "hide_product", kind: "mutate", permission: "catalog.publish", confirm: true, desc: "Hide a product from the storefront (set to draft).", params: [{ name: "sku", type: "string", required: true, desc: "product SKU" }] },
  { name: "show_product", kind: "mutate", permission: "catalog.publish", confirm: true, desc: "Make a product visible on the storefront (publish).", params: [{ name: "sku", type: "string", required: true, desc: "product SKU" }] },
  { name: "delete_product", kind: "mutate", permission: "catalog.delete", confirm: true, desc: "Delete a product permanently (or hide it if it has past orders).", params: [{ name: "sku", type: "string", required: true, desc: "product SKU" }] },
  { name: "delete_role", kind: "mutate", permission: "roles.manage", confirm: true, desc: "Delete a staff role by name.", params: [{ name: "name", type: "string", required: true, desc: "role name" }] },

  // ---- Intelligence-layer tools (multilingual DIVA) ----
  // READ
  { name: "get_price", kind: "read", permission: "catalog.view", desc: "Show a product's MRP / retail / wholesale price.", params: [{ name: "sku", type: "string", desc: "product SKU" }, { name: "query", type: "string", desc: "name to match if no SKU" }, { name: "tier", type: "string", desc: "all | wholesale | retail | mrp" }] },
  { name: "inventory_of", kind: "read", permission: "inventory.view", desc: "Show stock for a product matched by name/keywords.", params: [{ name: "query", type: "string", required: true, desc: "name or keywords" }] },
  { name: "pending_orders", kind: "read", permission: "sales.view", desc: "List orders that are still pending / unfulfilled.", params: [] },
  { name: "find_customer", kind: "read", permission: "customers.view", desc: "Find a customer by name or phone and show their summary.", params: [{ name: "query", type: "string", required: true, desc: "name or phone" }] },

  // MUTATE
  { name: "add_stock_by_name", kind: "mutate", permission: "inventory.add", confirm: true, desc: "Increase stock for the best-matching product by name.", params: [{ name: "query", type: "string", required: true, desc: "name/keywords" }, { name: "qty", type: "number", required: true, desc: "units to add" }, { name: "source", type: "string", desc: "reason/source" }] },
  { name: "remove_stock_by_name", kind: "mutate", permission: "inventory.remove", confirm: true, desc: "Decrease stock for the best-matching product by name.", params: [{ name: "query", type: "string", required: true, desc: "name/keywords" }, { name: "qty", type: "number", required: true, desc: "units to remove" }, { name: "source", type: "string", desc: "reason/source" }] },
  { name: "record_damage", kind: "mutate", permission: "inventory.remove", confirm: true, desc: "Remove damaged/broken pieces from stock (logged as a damage movement).", params: [{ name: "sku", type: "string", desc: "product SKU" }, { name: "query", type: "string", desc: "name if no SKU" }, { name: "qty", type: "number", required: true, desc: "pieces damaged" }, { name: "reason", type: "string", desc: "note" }] },
  { name: "create_product", kind: "mutate", permission: "catalog.create", confirm: true, desc: "Create a new product (resolves/creates the category).", params: [{ name: "name", type: "string", required: true, desc: "product name" }, { name: "category", type: "string", required: true, desc: "category name" }, { name: "price", type: "number", required: true, desc: "wholesale/base price in ₹" }, { name: "qty", type: "number", desc: "opening stock" }] },
  { name: "set_price", kind: "mutate", permission: "catalog.price_edit", confirm: true, desc: "Set a product's price. With a tier (wholesale/retail/mrp) it pins that exact price; without one it sets the base wholesale cost and re-derives the rest.", params: [{ name: "sku", type: "string", required: true, desc: "product SKU" }, { name: "price", type: "number", required: true, desc: "price in ₹" }, { name: "tier", type: "string", desc: "wholesale | retail | mrp | base" }] },
  { name: "rename_sku", kind: "mutate", permission: "catalog.edit", confirm: true, desc: "Change a product's SKU to a new unique value.", params: [{ name: "sku", type: "string", required: true, desc: "current SKU" }, { name: "newSku", type: "string", required: true, desc: "new SKU" }] },
  { name: "rename_product", kind: "mutate", permission: "catalog.edit", confirm: true, desc: "Rename a product (change its display name).", params: [{ name: "sku", type: "string", required: true, desc: "product SKU" }, { name: "name", type: "string", required: true, desc: "new product name" }] },
  { name: "set_category", kind: "mutate", permission: "catalog.edit", confirm: true, desc: "Move a product to a category (creates the category if it doesn't exist).", params: [{ name: "sku", type: "string", required: true, desc: "product SKU" }, { name: "category", type: "string", required: true, desc: "category name" }] },
  { name: "create_customer", kind: "mutate", permission: "customers.manage", confirm: true, desc: "Create a customer (retail or wholesale).", params: [{ name: "name", type: "string", required: true, desc: "customer name" }, { name: "type", type: "string", desc: "retail | wholesale" }, { name: "phone", type: "string", desc: "phone" }] },
  { name: "set_customer_type", kind: "mutate", permission: "customers.manage", confirm: true, desc: "Set an existing customer to wholesale or retail (creates them if new).", params: [{ name: "name", type: "string", required: true, desc: "customer name" }, { name: "type", type: "string", required: true, desc: "retail | wholesale" }] },
  { name: "merge_customers", kind: "mutate", permission: "customers.manage", confirm: true, desc: "Merge duplicate customers that share the same name into one record (keeps the main one, moves all its orders onto it, removes the extras). Great for cleaning marketplace duplicates like Myntra/Meesho.", params: [{ name: "name", type: "string", desc: "a specific name to merge (e.g. Myntra); leave empty to clean ALL duplicate names" }] },
  { name: "create_category", kind: "mutate", permission: "catalog.edit", confirm: true, desc: "Create a parent category.", params: [{ name: "name", type: "string", required: true, desc: "category name" }] },
  { name: "rename_category", kind: "mutate", permission: "catalog.edit", confirm: true, desc: "Rename an EXISTING category, e.g. 'change the category of Bracelet to Bangles & Bracelets' or 'Bracelet category ka naam X kar do'. Use when the user wants to change a CATEGORY's name — do NOT treat such a request as a product search or as moving a product.", params: [{ name: "from", type: "string", required: true, desc: "current category name" }, { name: "to", type: "string", required: true, desc: "new category name" }] },
  { name: "create_subcategory", kind: "mutate", permission: "catalog.edit", confirm: true, desc: "Create a subcategory under a parent category.", params: [{ name: "name", type: "string", required: true, desc: "subcategory name" }, { name: "parent", type: "string", desc: "parent category name" }] },
  { name: "share_catalog", kind: "read", permission: "catalog.view", desc: "Build a shareable catalogue link, optionally filtered to a category/subcategory, ready for WhatsApp.", params: [{ name: "facet", type: "string", desc: "category/subcategory/keywords" }, { name: "whatsapp", type: "number", desc: "1 to format for WhatsApp" }] },
  { name: "convert_invoice", kind: "mutate", permission: "billing.gst", confirm: true, desc: "Convert a cash memo into a GST invoice (or open billing if no invoice given).", params: [{ name: "invoice", type: "string", desc: "invoice number" }, { name: "to", type: "string", desc: "target bill type (gst)" }] },

  // ---- Fuller admin coverage (inventory / variants / catalogue / billing / purchases) ----
  { name: "set_stock", kind: "mutate", permission: "inventory.add", confirm: true, desc: "Set stock to an EXACT number (absolute), not add/subtract. e.g. 'BD1001 ka stock 50 kar do'. For a product with colours, pass the colour in `color` to set that colour variant's count.", params: [{ name: "sku", type: "string", desc: "product SKU" }, { name: "query", type: "string", desc: "name/keywords if no SKU" }, { name: "qty", type: "number", required: true, desc: "the new total stock" }, { name: "color", type: "string", desc: "colour/variant to target (for products with colours)" }] },
  { name: "add_variant", kind: "mutate", permission: "catalog.edit", confirm: true, desc: "Add a colour/size/polish variant (with its own stock) to a product.", params: [{ name: "sku", type: "string", required: true, desc: "parent product SKU" }, { name: "color", type: "string", desc: "colour" }, { name: "size", type: "string", desc: "size" }, { name: "polish", type: "string", desc: "polish / finish" }, { name: "qty", type: "number", desc: "opening stock for this variant" }] },
  { name: "list_variants", kind: "read", permission: "catalog.view", desc: "List a product's variants (colour/size/polish) with their stock.", params: [{ name: "sku", type: "string", required: true, desc: "product SKU" }] },
  { name: "list_categories", kind: "read", permission: "catalog.view", desc: "List all categories with how many products each holds.", params: [] },
  { name: "product_photos", kind: "read", permission: "catalog.view", desc: "Show how many photos a product has and their links.", params: [{ name: "sku", type: "string", desc: "product SKU" }, { name: "query", type: "string", desc: "name if no SKU" }] },
  { name: "recent_sales", kind: "read", permission: "sales.view", desc: "List the most recent bills/invoices (amount, customer, type, date).", params: [{ name: "limit", type: "number", desc: "how many (default 8)" }] },
  { name: "last_purchase", kind: "read", permission: "purchases.view", desc: "Show the most recent purchase cost & date recorded for a product.", params: [{ name: "sku", type: "string", desc: "product SKU" }, { name: "query", type: "string", desc: "name if no SKU" }] },
  { name: "compose", kind: "read", desc: "WRITE text for the owner: an image/photo prompt, a product title or description, a social caption, a personalised WhatsApp message or reply to a customer (using that customer's own history), or business guidance/ideas. Automatically pulls the relevant product/customer/brand context.", params: [
    { name: "kind", type: "string", required: true, desc: "image_prompt | title | description | caption | message | reply | guide | idea" },
    { name: "about", type: "string", desc: "what to write / the topic or instruction" },
    { name: "sku", type: "string", desc: "product SKU to ground the writing on" },
    { name: "customer", type: "string", desc: "customer name or phone to personalise a message/reply" },
    { name: "tone", type: "string", desc: "optional tone e.g. festive, formal, friendly" },
  ] },
];

export function toolByName(name: string): DivaTool | undefined {
  return DIVA_TOOLS.find((t) => t.name === name);
}
