import { NextRequest, NextResponse } from "next/server";
import { deviceForToken, saveProgress } from "@/lib/devices";

export const runtime = "nodejs";

/** A linked computer reports how a running job is going (Claude Code's steps and to-dos). */
export async function POST(req: NextRequest) {
  const device = deviceForToken(req.headers.get("authorization"));
  if (!device) return NextResponse.json({ error: "Not linked." }, { status: 401 });
  const { id, progress } = (await req.json().catch(() => ({}))) as { id?: string; progress?: unknown };
  if (typeof id === "string") saveProgress(device.id, id, progress);
  return NextResponse.json({ ok: true });
}
