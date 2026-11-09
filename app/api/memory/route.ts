import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { enterUser } from "@/lib/credentials";
import { addMemory, CATEGORIES, deleteMemory, listMemories, listSessions, type Category } from "@/lib/memory";

export const runtime = "nodejs";

/** What the assistant remembers about this account: list, add and delete. */
export async function GET() {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  enterUser(guard.user.id, guard.user.role === "owner");
  return NextResponse.json({ memories: await listMemories(guard.user.id), sessions: listSessions(guard.user.id, 20) });
}

export async function POST(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  enterUser(guard.user.id, guard.user.role === "owner");
  const { fact, category } = (await req.json().catch(() => ({}))) as { fact?: string; category?: string };
  if (!fact?.trim()) return NextResponse.json({ error: "Write what to remember." }, { status: 400 });
  const cat = (CATEGORIES as readonly string[]).includes(category ?? "") ? category as Category : "preference";
  if (!addMemory(guard.user.id, cat, fact, "user")) return NextResponse.json({ error: "Passwords and keys are never kept in memory." }, { status: 400 });
  return NextResponse.json({ memories: await listMemories(guard.user.id) });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  enterUser(guard.user.id, guard.user.role === "owner");
  const id = req.nextUrl.searchParams.get("id");
  if (id) deleteMemory(guard.user.id, id);
  return NextResponse.json({ memories: await listMemories(guard.user.id) });
}
