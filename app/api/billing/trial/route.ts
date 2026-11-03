import { NextRequest, NextResponse } from "next/server";
import { getSubscription, requireUser } from "@/lib/auth";
import { BRAND } from "@/lib/persona";
import { TRIAL_DAYS } from "@/lib/plans";
import { cardPaymentsEnabled, stripe } from "@/lib/stripeBilling";
import { CARD_CHECK_CENTS, savedCard } from "@/lib/trialCard";

export const runtime = "nodejs";

/** Where this account stands: waiting for a card, on its trial, or on a plan. */
export async function GET() {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  const card = savedCard(guard.user.id);
  return NextResponse.json({
    subscription: getSubscription(guard.user),
    card: card && { brand: card.brand, last4: card.last4 },
    // The card was checked but had already given another account a trial.
    trialRefused: !!card && !card.trialGranted && getSubscription(guard.user).status === "pending",
    cardPayments: cardPaymentsEnabled(),
  });
}

/** Opens Stripe Checkout for the $1 card check that starts the free trial; the card is saved for later payments. */
export async function POST(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  if (getSubscription(guard.user).status !== "pending") return NextResponse.json({ error: "Your trial or plan is already active." }, { status: 400 });
  if (!cardPaymentsEnabled()) return NextResponse.json({ error: "Card payments aren't switched on yet." }, { status: 503 });
  const origin = req.nextUrl.origin;
  try {
    const session = await stripe<{ url: string }>("POST", "/checkout/sessions", {
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(CARD_CHECK_CENTS),
      "line_items[0][price_data][product_data][name]": `${BRAND} — card check for your ${TRIAL_DAYS}-day free trial`,
      "line_items[0][price_data][product_data][description]": "A one-time $1 charge to confirm your card works. Nothing else is charged automatically.",
      customer_creation: "always",
      customer_email: guard.user.email,
      client_reference_id: guard.user.id,
      "payment_intent_data[setup_future_usage]": "off_session",
      "payment_intent_data[description]": `Card check — ${guard.user.email}`,
      "payment_intent_data[metadata][user_id]": guard.user.id,
      "metadata[user_id]": guard.user.id,
      "metadata[purpose]": "trial_card",
      success_url: `${origin}/billing?card=done`,
      cancel_url: `${origin}/billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't open the card check." }, { status: 502 });
  }
}
