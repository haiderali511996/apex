import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { clearConversation, recentTurns } from "@/lib/memory";

export const runtime = "nodejs";

/** The saved conversation, so a reload or another device picks up where it left off. */
export async function GET() {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  return NextResponse.json({ messages: recentTurns(guard.user.id, 40).map(t => ({ role: t.role, content: t.content })) });
}

/** Clears the saved conversation; remembered facts stay. */
export async function DELETE() {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  clearConversation(guard.user.id);
  return NextResponse.json({ ok: true });
}
