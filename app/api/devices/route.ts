import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isOnline, listDevices, unlinkDevice } from "@/lib/devices";

export const runtime = "nodejs";

/** This account's linked computers. */
export async function GET() {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  return NextResponse.json({ devices: listDevices(guard.user.id).map(d => ({ id: d.id, name: d.name, os: d.os, lastSeen: d.lastSeen, online: isOnline(d) })) });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  if (!unlinkDevice(guard.user.id, req.nextUrl.searchParams.get("id") || "")) return NextResponse.json({ error: "That computer isn't linked to your account." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
