import { NextResponse } from "next/server";
import { getSubscription, requireUser } from "@/lib/auth";
import { createPairingCode, listDevices } from "@/lib/devices";
import { limitsFor } from "@/lib/plans";

export const runtime = "nodejs";

/** A short code to type into the desktop app, within the plan's computer limit. */
export async function POST() {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  if (guard.user.role !== "owner") {
    const allowed = limitsFor(getSubscription(guard.user).plan).computers;
    if (listDevices(guard.user.id).length >= allowed) {
      return NextResponse.json({ error: `Your plan links up to ${allowed} computer${allowed === 1 ? "" : "s"}. Unlink one, or upgrade for more.` }, { status: 403 });
    }
  }
  return NextResponse.json(createPairingCode(guard.user.id));
}
