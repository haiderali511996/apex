import { NextRequest, NextResponse } from "next/server";
import { deviceForToken, unlinkDevice } from "@/lib/devices";

export const runtime = "nodejs";

/** The desktop app's own link: who it's signed in as. */
export async function GET(req: NextRequest) {
  const device = deviceForToken(req.headers.get("authorization"));
  if (!device) return NextResponse.json({ error: "Not linked." }, { status: 401 });
  return NextResponse.json({ id: device.id, name: device.name, os: device.os });
}

/** Signing out of the desktop app unlinks the computer from the account. */
export async function DELETE(req: NextRequest) {
  const device = deviceForToken(req.headers.get("authorization"));
  if (!device) return NextResponse.json({ ok: true });
  unlinkDevice(device.userId, device.id);
  return NextResponse.json({ ok: true });
}
