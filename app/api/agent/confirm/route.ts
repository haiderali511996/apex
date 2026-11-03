import { requireUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { getPendingAction, listPendingActions, resolvePendingAction } from "@/lib/agent/store";
import { runPendingAction } from "@/lib/agent/execute";
import { enterUser } from "@/lib/credentials";

export const runtime = "nodejs";

export async function GET() {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  // This request runs on this account's own keys from here on.
  enterUser(guard.user.id, guard.user.role === "owner");
  const pending = (await listPendingActions()).filter((a) => a.status === "pending");
  return NextResponse.json({ pendingActions: pending });
}

export async function POST(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  // This request runs on this account's own keys from here on.
  enterUser(guard.user.id, guard.user.role === "owner");
  const { id, approve } = (await req.json()) as { id: string; approve: boolean };
  if (!id || typeof approve !== "boolean") {
    return NextResponse.json({ error: "id and approve are required" }, { status: 400 });
  }

  const action = await getPendingAction(id);
  if (!action) return NextResponse.json({ error: "Pending action not found" }, { status: 404 });
  if (action.status !== "pending") {
    return NextResponse.json({ error: `Action already ${action.status}` }, { status: 409 });
  }

  if (!approve) {
    const updated = await resolvePendingAction(id, "rejected");
    return NextResponse.json({ action: updated });
  }

  await resolvePendingAction(id, "approved");
  try {
    const result = await runPendingAction(action);
    const updated = await resolvePendingAction(id, "executed", result);
    return NextResponse.json({ action: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const updated = await resolvePendingAction(id, "failed", message);
    return NextResponse.json({ action: updated, error: message }, { status: 502 });
  }
}
