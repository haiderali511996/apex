import { NextRequest, NextResponse } from "next/server";
import { registerDevice } from "@/lib/devices";

export const runtime = "nodejs";

/** Called by the desktop app: trades a pairing code for its token. */
export async function POST(req: NextRequest) {
  const { code, name, os } = (await req.json().catch(() => ({}))) as { code?: string; name?: string; os?: string };
  if (typeof code !== "string" || typeof name !== "string" || typeof os !== "string") return NextResponse.json({ error: "code, name and os are required." }, { status: 400 });
  const result = registerDevice(code, name, os);
  if (!result) return NextResponse.json({ error: "That code is wrong or has expired. Get a new one on the Account page." }, { status: 401 });
  return NextResponse.json({ token: result.token, deviceId: result.device.id });
}
