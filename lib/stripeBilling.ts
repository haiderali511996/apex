import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Card payments through Stripe Checkout: Stripe hosts the card form, so card
 * numbers never touch this server. A paid checkout adds the same 30 days a
 * UNC payment does. These are the product's own Stripe keys — separate from
 * the read-only key a user connects for revenue briefings.
 */

export const billingKey = () => process.env.STRIPE_BILLING_SECRET_KEY?.trim() || "";
export const webhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET?.trim() || "";
export const cardPaymentsEnabled = () => !!billingKey() && !!webhookSecret();

/** Calls the Stripe API with form-encoded parameters. */
export async function stripe<T>(method: "GET" | "POST", path: string, params: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${billingKey()}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "POST" ? new URLSearchParams(params).toString() : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message || `Stripe error ${res.status}`);
  return body;
}

/**
 * Checks a webhook really came from Stripe: an HMAC of "timestamp.payload"
 * with the endpoint's signing secret, no older than five minutes.
 */
export function verifyStripeSignature(payload: string, header: string | null, secret = webhookSecret()): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map(p => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest();
  return header.split(",").filter(p => p.startsWith("v1=")).some(p => {
    const given = Buffer.from(p.slice(3), "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
