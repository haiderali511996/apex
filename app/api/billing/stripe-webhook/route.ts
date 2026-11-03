import { NextRequest, NextResponse } from "next/server";
import { extendSubscription } from "@/lib/auth";
import { database } from "@/lib/db";
import { findPlan } from "@/lib/plans";
import { verifyStripeSignature } from "@/lib/stripeBilling";

export const runtime = "nodejs";

/**
 * Stripe calls this when a checkout completes. Only a correctly signed event
 * counts, and each checkout session adds its 30 days once (the payments table
 * is keyed by the session id).
 */
export async function POST(req: NextRequest) {
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"))) return NextResponse.json({ error: "Bad signature." }, { status: 400 });
  const event = JSON.parse(payload) as { type: string; data: { object: { id: string; payment_status?: string; amount_total?: number; customer_details?: { email?: string }; metadata?: { user_id?: string; plan?: string } } } };
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return NextResponse.json({ ok: true });
  const session = event.data.object, userId = session.metadata?.user_id, plan = findPlan(session.metadata?.plan);
  if (session.payment_status !== "paid" || !userId || !plan) return NextResponse.json({ ok: true });
  const db = database();
  if (db.prepare("SELECT 1 FROM payments WHERE tx_hash = ?").get(session.id)) return NextResponse.json({ ok: true });
  if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId)) return NextResponse.json({ ok: true });
  db.prepare("INSERT INTO payments (tx_hash, user_id, plan, amount, payer, chain_id, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)")
    .run(session.id, userId, plan.id, String(session.amount_total ?? 0), session.customer_details?.email ?? "card", new Date().toISOString());
  extendSubscription(userId, plan.id);
  return NextResponse.json({ ok: true });
}
