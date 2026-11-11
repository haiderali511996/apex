import { requireUser } from "@/lib/auth";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { enterUser } from "@/lib/credentials";

export const runtime = "nodejs";

const run = promisify(execFile);
const ACTIONS = new Set(["pause", "play", "toggle", "status"]);

/**
 * "Pause the music" / "play the music": runs scripts/media-control.sh, which
 * drives Music, Spotify, VLC or QuickTime. Local to this Mac only. The action
 * is checked against a fixed list and passed as an argument, never to a shell.
 */
export async function POST(req: NextRequest) {
  const guard = await requireUser({ owner: true });
  if ("response" in guard) return guard.response;
  // This request runs on this account's own keys from here on.
  enterUser(guard.user.id, guard.user.role === "owner");
  const { action } = await req.json().catch(() => ({}));
  if (typeof action !== "string" || !ACTIONS.has(action)) {
    return NextResponse.json({ error: "action must be pause, play, toggle or status." }, { status: 400 });
  }
  if (process.platform !== "darwin") {
    return NextResponse.json({ error: "Media control only works on macOS." }, { status: 501 });
  }
  try {
    const { stdout } = await run(path.join(process.cwd(), "scripts", "media-control.sh"), [action], { timeout: 10_000 });
    return NextResponse.json({ ok: true, reply: stdout.trim() });
  } catch (e) {
    const err = e as { stdout?: string; message: string };
    return NextResponse.json({ ok: false, reply: err.stdout?.trim() || err.message }, { status: 200 });
  }
}
