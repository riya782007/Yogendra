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
export const PAGE_MAP: Record<string, string> = {
  dashboard: "/admin/dashboard",
  analytics: "/admin/analytics",
  catalogue: "/admin/catalogue",
  products: "/admin/catalogue",
  "add inventory": "/admin/upload",
  upload: "/admin/upload",
  "product photos": "/admin/media",
  media: "/admin/media",
  categories: "/admin/categories",
  inventory: "/admin/inventory",
  barcodes: "/admin/barcodes",
  "ai reorder": "/admin/reorder",
  reorder: "/admin/reorder",
  billing: "/admin/billing",
  pos: "/admin/billing",
  sales: "/admin/sales",
  "sales records": "/admin/sales",
  estimates: "/admin/estimates",
  returns: "/admin/returns",
  purchases: "/admin/purchases",
  customers: "/admin/customers",
  suppliers: "/admin/suppliers",
  vendors: "/admin/suppliers",
  reviews: "/admin/reviews",
  reels: "/admin/reels",
  "abandoned carts": "/admin/abandoned",
  approvals: "/admin/approvals",
  notifications: "/admin/inbox",
  roles: "/admin/roles",
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
  { name: "add_stock", kind: "mutate", permission: "inventory.add", confirm: true, desc: "Increase a product's stock by a quantity, with a source tag.", params: [{ name: "sku", type: "string", required: true, desc: "product SKU" }, { name: "qty", type: "number", required: true, desc: "units to add" }, { name: "source", type: "string", desc: "reason/source" }] },
  { name: "remove_stock", kind: "mutate", permission: "inventory.remove", confirm: true, desc: "Decrease a product's stock by a quantity, with a source tag.", params: [{ name: "sku", type: "string", required: true, desc: "product SKU" }, { name: "qty", type: "number", required: true, desc: "units to remove" }, { name: "source", type: "string", desc: "reason/source" }] },
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
  { name: "create_customer", kind: "mutate", permission: "customers.manage", confirm: true, desc: "Create a customer (retail or wholesale).", params: [{ name: "name", type: "string", required: true, desc: "customer name" }, { name: "type", type: "string", desc: "retail | wholesale" }, { name: "phone", type: "string", desc: "phone" }] },
  { name: "set_customer_type", kind: "mutate", permission: "customers.manage", confirm: true, desc: "Set an existing customer to wholesale or retail (creates them if new).", params: [{ name: "name", type: "string", required: true, desc: "customer name" }, { name: "type", type: "string", required: true, desc: "retail | wholesale" }] },
  { name: "create_category", kind: "mutate", permission: "catalog.edit", confirm: true, desc: "Create a parent category.", params: [{ name: "name", type: "string", required: true, desc: "category name" }] },
  { name: "create_subcategory", kind: "mutate", permission: "catalog.edit", confirm: true, desc: "Create a subcategory under a parent category.", params: [{ name: "name", type: "string", required: true, desc: "subcategory name" }, { name: "parent", type: "string", desc: "parent category name" }] },
  { name: "share_catalog", kind: "read", permission: "catalog.view", desc: "Build a shareable catalogue link, optionally filtered to a category/subcategory, ready for WhatsApp.", params: [{ name: "facet", type: "string", desc: "category/subcategory/keywords" }, { name: "whatsapp", type: "number", desc: "1 to format for WhatsApp" }] },
  { name: "convert_invoice", kind: "mutate", permission: "billing.gst", confirm: true, desc: "Convert a cash memo into a GST invoice (or open billing if no invoice given).", params: [{ name: "invoice", type: "string", desc: "invoice number" }, { name: "to", type: "string", desc: "target bill type (gst)" }] },
];

export function toolByName(name: string): DivaTool | undefined {
  return DIVA_TOOLS.find((t) => t.name === name);
}
