import { NextRequest, NextResponse } from "next/server";
import { deviceForToken } from "@/lib/devices";
import { enterUser } from "@/lib/credentials";
import { getPersona, getUserById, type User } from "@/lib/auth";
import { listMemories, memoryMarkdown, restoreMemory, turnCount, turnsSince, type ChatTurn, type Memory } from "@/lib/memory";

export const runtime = "nodejs";

/** The account behind a linked computer's token. */
function owner(req: NextRequest): User | null {
  const device = deviceForToken(req.headers.get("authorization"));
  const user = device ? getUserById(device.userId) : null;
  if (user) enterUser(user.id, user.role === "owner");
  return user;
}

/**
 * The desktop app's copy of the account's memory. ?format=json&since=<time>
 * gives the facts plus every turn after that time, for the complete backup it
 * keeps on the computer; without it, a readable Markdown summary.
 */
export async function GET(req: NextRequest) {
  const user = owner(req);
  if (!user) return NextResponse.json({ error: "Not linked." }, { status: 401 });
  if (req.nextUrl.searchParams.get("format") === "json") {
    return NextResponse.json({
      facts: await listMemories(user.id),
      turns: turnsSince(user.id, req.nextUrl.searchParams.get("since") || ""),
      totalTurns: turnCount(user.id),
    }, { headers: { "cache-control": "no-store" } });
  }
  return new Response(await memoryMarkdown(user.id, getPersona(user).name), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } });
}

/** Restores from the computer's backup — accepted only when the server has no memory for the account. */
export async function POST(req: NextRequest) {
  const user = owner(req);
  if (!user) return NextResponse.json({ error: "Not linked." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { facts?: Partial<Memory>[]; turns?: ChatTurn[] };
  const restored = await restoreMemory(user.id, Array.isArray(body.facts) ? body.facts : [], Array.isArray(body.turns) ? body.turns : []);
  return NextResponse.json(restored ? { restored } : { restored: null, reason: "The server already has memory for this account." });
}
