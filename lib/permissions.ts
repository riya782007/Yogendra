/**
 * Granular, Discord-style permissions grouped by domain. Each is a single capability
 * so a role can, e.g., add stock but NOT remove it, or create products but not delete them.
 * Stored on roles.permissions as a text[] of these keys.
 */
export type Perm = { key: string; label: string; desc?: string };
export type PermGroup = { key: string; label: string; perms: Perm[] };

export const PERMISSION_GROUPS: PermGroup[] = [
  { key: "catalog", label: "Catalogue", perms: [
    { key: "catalog.view", label: "View catalogue" },
    { key: "catalog.create", label: "Create products" },
    { key: "catalog.edit", label: "Edit product details" },
    { key: "catalog.price_edit", label: "Edit prices", desc: "change base price / pricing" },
    { key: "catalog.price_retail", label: "Edit retail pricing" },
    { key: "catalog.price_wholesale", label: "Edit wholesale pricing" },
    { key: "catalog.inventory_edit", label: "Edit inventory fields" },
    { key: "catalog.variants", label: "Manage variants" },
    { key: "catalog.publish", label: "Publish / unpublish" },
    { key: "catalog.delete", label: "Delete products" },
    { key: "catalog.ai", label: "Run AI content / photos" },
  ]},
  { key: "inventory", label: "Inventory", perms: [
    { key: "inventory.view", label: "View inventory" },
    { key: "inventory.add", label: "Add / increase stock" },
    { key: "inventory.remove", label: "Remove / decrease stock", desc: "the sensitive one" },
    { key: "inventory.barcode", label: "Print barcodes" },
  ]},
  { key: "billing", label: "Billing & POS", perms: [
    { key: "billing.sell", label: "Ring up POS sales" },
    { key: "billing.gst", label: "Issue GST invoices" },
    { key: "billing.cash", label: "Issue cash memos" },
    { key: "billing.refund", label: "Process returns / refunds" },
    { key: "billing.gst_only", label: "GST-officer view (GST bills only)", desc: "restricts Sales & invoices to GST tax invoices — for compliance inspections" },
  ]},
  { key: "estimates", label: "Estimates", perms: [
    { key: "estimates.create", label: "Create estimates" },
    { key: "estimates.bill", label: "Bill / convert estimates" },
    { key: "estimates.deny", label: "Deny estimates" },
  ]},
  { key: "purchases", label: "Purchases & Suppliers", perms: [
    { key: "purchases.view", label: "View purchases" },
    { key: "purchases.create", label: "Record purchase bills" },
    { key: "suppliers.manage", label: "Manage suppliers / vendors" },
  ]},
  { key: "sales", label: "Sales & Customers", perms: [
    { key: "sales.view", label: "View sales records" },
    { key: "sales.export", label: "Export sales data" },
    { key: "customers.view", label: "View customers (CRM)" },
    { key: "customers.manage", label: "Add / edit customers" },
  ]},
  { key: "growth", label: "Growth", perms: [
    { key: "analytics.view", label: "View analytics & SEO" },
    { key: "reviews.respond", label: "Respond to reviews" },
    { key: "reels.manage", label: "Manage reels" },
    { key: "marketing.manage", label: "Run marketing / abandoned carts" },
  ]},
  { key: "payments", label: "Payments & Accounts", perms: [
    { key: "payments.view", label: "View payment methods" },
    { key: "payments.balances", label: "View account balances" },
    { key: "payments.create", label: "Create payment method" },
    { key: "payments.edit", label: "Edit payment method" },
    { key: "payments.delete", label: "Delete payment method" },
    { key: "payments.opening", label: "Edit opening balance", desc: "the sensitive one" },
    { key: "payments.transfer", label: "Transfer funds between accounts" },
  ]},
  { key: "control", label: "Control (sensitive)", perms: [
    { key: "approvals.approve", label: "Approve via OTP" },
    { key: "roles.manage", label: "Manage roles & staff" },
    { key: "settings.manage", label: "Manage business settings" },
  ]},
];

export const ALL_PERMISSIONS: string[] = PERMISSION_GROUPS.flatMap((g) => g.perms.map((p) => p.key));
const LABELS: Record<string, string> = Object.fromEntries(PERMISSION_GROUPS.flatMap((g) => g.perms.map((p) => [p.key, p.label])));
export function permLabel(key: string): string { return LABELS[key] ?? key.replace(/[._]/g, " "); }

/** Future enforcement hook: true if the role's permission list grants `key`. */
export function hasPermission(perms: string[] | null | undefined, key: string): boolean {
  return !!perms && perms.includes(key);
}

// Backwards-compat: legacy coarse permissions some old roles may still carry.
export const PERMISSIONS = ["product_editing", "inventory", "billing", "purchases", "analytics", "user_management", "approvals"] as const;
