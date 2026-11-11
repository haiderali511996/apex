import { randomInt, randomUUID } from "node:crypto";
import { database } from "./db";
import { findPlan, priceUnc, type PlanId } from "./plans";
import { toUnits, type UncConfig } from "./unc";

/**
 * A UNC order: one plan, one exact amount. The amount is the plan's price plus
 * a random fraction, unique among open orders, so the payment that matches it
 * can only be this user's — whether it comes from their wallet or an exchange.
 */

export const ORDER_MINUTES = 120;
/** A payment made within the order window may still be claimed for this long. */
const CLAIM_HOURS = 24;

export type Order = { id: string; userId: string; plan: PlanId; amountUnits: bigint; createdAt: string; expiresAt: string; status: "open" | "paid" };

function table() {
  const db = database();
  db.exec(`CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    amount_units TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    tx_hash TEXT UNIQUE
  )`);
  return db;
}

type Row = { id: string; user_id: string; plan: PlanId; amount_units: string; created_at: string; expires_at: string; status: Order["status"] };
const toOrder = (r: Row): Order => ({ id: r.id, userId: r.user_id, plan: r.plan, amountUnits: BigInt(r.amount_units), createdAt: r.created_at, expiresAt: r.expires_at, status: r.status });

export function createOrder(userId: string, planId: PlanId, config: UncConfig): Order {
  const plan = findPlan(planId);
  if (!plan) throw new Error("Unknown plan.");
  const db = table(), now = Date.now();
  const base = toUnits(priceUnc(plan), config.decimals);
  // 1–999,999 millionths of a token on top: tiny, and unique among live orders.
  const step = BigInt(10) ** BigInt(Math.max(0, config.decimals - 6));
  for (let tries = 0; tries < 20; tries++) {
    const amount = base + BigInt(randomInt(1, 1_000_000)) * step;
    const clash = db.prepare("SELECT 1 FROM orders WHERE amount_units = ? AND status = 'open' AND expires_at > ?").get(amount.toString(), new Date(now - CLAIM_HOURS * 3_600_000).toISOString());
    if (clash) continue;
    const order = { id: randomUUID(), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + ORDER_MINUTES * 60_000).toISOString() };
    db.prepare("INSERT INTO orders (id, user_id, plan, amount_units, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(order.id, userId, plan.id, amount.toString(), order.createdAt, order.expiresAt);
    return { ...order, userId, plan: plan.id, amountUnits: amount, status: "open" };
  }
  throw new Error("Couldn't create a unique order amount. Try again.");
}

/** This user's order, if it can still be paid or claimed. */
export function claimableOrder(userId: string, orderId: string): Order | { error: string } {
  const row = table().prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").get(orderId, userId) as Row | undefined;
  if (!row) return { error: "That order wasn't found on your account." };
  if (row.status === "paid") return { error: "That order has already been paid." };
  if (Date.parse(row.expires_at) + CLAIM_HOURS * 3_600_000 < Date.now()) return { error: "That order has expired. Start a new one." };
  return toOrder(row);
}

/** Marks the order paid; the tx hash is unique, so a transaction pays one order at most. */
export function markPaid(orderId: string, txHash: string) {
  table().prepare("UPDATE orders SET status = 'paid', tx_hash = ? WHERE id = ? AND status = 'open'").run(txHash, orderId);
}
