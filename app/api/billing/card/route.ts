import { publicOrigin } from "@/lib/agent/googleOAuth";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { findPlan, PERIOD_DAYS } from "@/lib/plans";
import { BRAND } from "@/lib/persona";
import { cardPaymentsEnabled, stripe } from "@/lib/stripeBilling";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ enabled: cardPaymentsEnabled() });
}

/** Starts a Stripe Checkout for a plan and returns its page to send the user to. */
export async function POST(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  if (!cardPaymentsEnabled()) return NextResponse.json({ error: "Card payments aren't switched on yet." }, { status: 503 });
  const { plan: planId } = (await req.json().catch(() => ({}))) as { plan?: string };
  const plan = findPlan(planId);
  if (!plan) return NextResponse.json({ error: "Choose a plan." }, { status: 400 });
  const origin = publicOrigin(req);
  try {
    const session = await stripe<{ url: string }>("POST", "/checkout/sessions", {
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(Math.round(plan.priceUsd * 100)),
      "line_items[0][price_data][product_data][name]": `${BRAND} ${plan.name} — ${PERIOD_DAYS} days`,
      customer_email: guard.user.email,
      client_reference_id: guard.user.id,
      "metadata[user_id]": guard.user.id,
      "metadata[plan]": plan.id,
      success_url: `${origin}/account?paid=card`,
      cancel_url: `${origin}/account`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't start the card payment." }, { status: 502 });
  }
}
