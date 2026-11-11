import { database } from "./db";
import { startTrial } from "./auth";
import { stripe } from "./stripeBilling";

/**
 * The card check that starts a free trial: Stripe Checkout charges $1 and
 * saves the card for later payments. Each card (by Stripe's fingerprint) gets
 * one trial, so new accounts can't keep restarting it with the same card.
 */

export const CARD_CHECK_CENTS = 100;

export type SavedCard = { brand: string; last4: string; trialGranted: boolean; createdAt: string };

function db() {
  const d = database();
  d.exec(`
    CREATE TABLE IF NOT EXISTS billing_cards (
      user_id TEXT PRIMARY KEY,
      customer_id TEXT,
      fingerprint TEXT,
      brand TEXT,
      last4 TEXT,
      trial_granted INTEGER NOT NULL DEFAULT 0,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS billing_cards_fingerprint ON billing_cards (fingerprint);
  `);
  return d;
}

export function savedCard(userId: string): SavedCard | null {
  const r = db().prepare("SELECT brand, last4, trial_granted, created_at FROM billing_cards WHERE user_id = ?").get(userId) as { brand: string; last4: string; trial_granted: number; created_at: string } | undefined;
  return r ? { brand: r.brand, last4: r.last4, trialGranted: !!r.trial_granted, createdAt: r.created_at } : null;
}

type Session = { id: string; customer?: string | null; payment_intent?: { payment_method?: { card?: { fingerprint?: string; brand?: string; last4?: string } } } | null };

/**
 * Called from the Stripe webhook once the $1 check is paid: records the card
 * and starts the trial, unless that card already gave another account one.
 */
export async function completeCardCheck(userId: string, sessionId: string): Promise<"started" | "duplicate" | "ignored"> {
  const d = db();
  if (d.prepare("SELECT 1 FROM billing_cards WHERE session_id = ?").get(sessionId)) return "ignored";
  const session = await stripe<Session>("GET", `/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent.payment_method`);
  const card = session.payment_intent?.payment_method?.card ?? {};
  const fingerprint = card.fingerprint ?? null;
  const usedElsewhere = !!fingerprint && !!d.prepare("SELECT 1 FROM billing_cards WHERE fingerprint = ? AND user_id != ? AND trial_granted = 1").get(fingerprint, userId);
  const granted = !usedElsewhere && startTrial(userId);
  d.prepare(`INSERT INTO billing_cards (user_id, customer_id, fingerprint, brand, last4, trial_granted, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET customer_id = excluded.customer_id, fingerprint = excluded.fingerprint, brand = excluded.brand, last4 = excluded.last4,
      trial_granted = MAX(billing_cards.trial_granted, excluded.trial_granted), session_id = excluded.session_id, created_at = excluded.created_at`)
    .run(userId, session.customer ?? null, fingerprint, card.brand ?? "card", card.last4 ?? "", granted ? 1 : 0, sessionId, new Date().toISOString());
  return usedElsewhere ? "duplicate" : granted ? "started" : "ignored";
}
