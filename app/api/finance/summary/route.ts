import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { enterUser } from "@/lib/credentials";
import { getFinanceSummary, isConfigured } from "@/lib/agent/connectors/stripe";

export const runtime = "nodejs";

/** Last month vs this month, balance and payouts, for the Finance card. Read-only. */
export async function GET() {
  const guard = await requireUser({ plan: true });
  if ("response" in guard) return guard.response;
  enterUser(guard.user.id, guard.user.role === "owner");
  if (!isConfigured()) return NextResponse.json({ connected: false, message: "Connect Stripe on the Connections page to see your monthly figures here." });
  try {
    return NextResponse.json({ connected: true, summary: await getFinanceSummary() }, { headers: { "cache-control": "private, max-age=60" } });
  } catch (err) {
    return NextResponse.json({ connected: true, error: err instanceof Error ? err.message : "Couldn't read Stripe." }, { status: 502 });
  }
}
