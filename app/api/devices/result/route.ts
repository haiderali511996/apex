import { NextRequest, NextResponse } from "next/server";
import { deviceForToken, saveResult } from "@/lib/devices";

export const runtime = "nodejs";

/** Called by the desktop app with what happened when it ran a command. */
export async function POST(req: NextRequest) {
  const device = deviceForToken(req.headers.get("authorization"));
  if (!device) return NextResponse.json({ error: "Unknown computer." }, { status: 401 });
  const { id, ok, output } = (await req.json().catch(() => ({}))) as { id?: string; ok?: boolean; output?: string };
  if (typeof id !== "string") return NextResponse.json({ error: "id is required." }, { status: 400 });
  saveResult(device.id, id, !!ok, typeof output === "string" ? output : "");
  return NextResponse.json({ ok: true });
}
