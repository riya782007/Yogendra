/**
 * lib/ga4.ts — GA4 Measurement Protocol (server-side conversions). Requirement 16.2.
 * No-op unless NEXT_PUBLIC_GA4_ID + GA4_API_SECRET are set, so it never blocks orders.
 */
import "server-only";

const MID = () => process.env.NEXT_PUBLIC_GA4_ID;
const SECRET = () => process.env.GA4_API_SECRET;
export function ga4Configured() { return !!(MID() && SECRET()); }

export async function sendPurchase(args: { orderId: string; valuePaise: number; channel: string; items: { sku?: string; name?: string; qty: number; price?: number }[]; clientId?: string }) {
  if (!ga4Configured()) return;
  try {
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${MID()}&api_secret=${SECRET()}`;
    await fetch(url, {
      method: "POST",
      body: JSON.stringify({
        client_id: args.clientId ?? `srv.${args.orderId.slice(0, 8)}`,
        events: [{
          name: "purchase",
          params: {
            transaction_id: args.orderId, currency: "INR", value: args.valuePaise / 100, channel: args.channel,
            items: args.items.map((i) => ({ item_id: i.sku, item_name: i.name, quantity: i.qty, price: (i.price ?? 0) / 100 })),
          },
        }],
      }),
    });
  } catch { /* analytics must never break checkout */ }
}
