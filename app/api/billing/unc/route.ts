import { NextRequest, NextResponse } from "next/server";
import { extendSubscription, requireUser } from "@/lib/auth";
import { database } from "@/lib/db";
import { claimableOrder, createOrder, markPaid } from "@/lib/orders";
import { findPlan } from "@/lib/plans";
import { fromUnits, uncConfig, verifyUncPayment } from "@/lib/unc";

export const runtime = "nodejs";

/** What the checkout needs to build the payment in the buyer's wallet. */
export async function GET() {
  const config = uncConfig();
  if ("missing" in config) return NextResponse.json({ configured: false, missing: config.missing });
  const { rpcUrl: _rpc, ...pub } = config;
  return NextResponse.json({ configured: true, ...pub });
}

/**
 * { plan } starts an order with its own exact amount.
 * { orderId, txHash } claims it once the chain confirms that exact payment.
 */
export async function POST(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  const config = uncConfig();
  if ("missing" in config) return NextResponse.json({ error: `UNC payments aren't set up on this server yet (missing ${config.missing.join(", ")}).` }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { plan?: string; orderId?: string; txHash?: string };

  if (!body.orderId) {
    const plan = findPlan(body.plan);
    if (!plan) return NextResponse.json({ error: "Choose a plan." }, { status: 400 });
    const order = createOrder(guard.user.id, plan.id, config);
    return NextResponse.json({
      orderId: order.id, plan: plan.id, expiresAt: order.expiresAt,
      amount: fromUnits(order.amountUnits, config.decimals), amountUnits: order.amountUnits.toString(),
      receiver: config.receiver, token: config.token, symbol: config.symbol, chainName: config.chainName,
    });
  }

  const order = claimableOrder(guard.user.id, body.orderId);
  if ("error" in order) return NextResponse.json({ error: order.error }, { status: 400 });
  if (typeof body.txHash !== "string") return NextResponse.json({ error: "Missing transaction hash." }, { status: 400 });
  const hash = body.txHash.trim().toLowerCase();
  const db = database();
  if (db.prepare("SELECT 1 FROM payments WHERE tx_hash = ?").get(hash)) return NextResponse.json({ error: "That transaction has already been used for a purchase." }, { status: 409 });
  try {
    const result = await verifyUncPayment(config, hash, order.amountUnits, new Date(order.createdAt));
    if (result === "pending") return NextResponse.json({ status: "pending" }, { status: 202 });
    // The primary key makes a second claim of the same transaction fail here.
    db.prepare("INSERT INTO payments (tx_hash, user_id, plan, amount, payer, chain_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(hash, guard.user.id, order.plan, result.amount.toString(), result.payer, config.chainId, new Date().toISOString());
    markPaid(order.id, hash);
    const periodEnd = extendSubscription(guard.user.id, order.plan);
    return NextResponse.json({ status: "paid", plan: order.plan, periodEnd });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't verify the payment." }, { status: 400 });
  }
}
