import { NextRequest, NextResponse } from "next/server";
import { getSubscription, verifyLogin } from "@/lib/auth";
import { createDevice, listDevices } from "@/lib/devices";
import { limitsFor } from "@/lib/plans";

export const runtime = "nodejs";

// Slows down password guessing: a few tries per email and per address, then a pause.
const WINDOW_MS = 15 * 60_000, MAX_TRIES = 8;
const tries = new Map<string, { count: number; until: number }>();
function tooMany(key: string) {
  const now = Date.now(), t = tries.get(key);
  if (!t || t.until < now) { tries.set(key, { count: 1, until: now + WINDOW_MS }); return false; }
  t.count++;
  return t.count > MAX_TRIES;
}

/** Called by the desktop app: signs in with email + password and links this computer. */
export async function POST(req: NextRequest) {
  const { email, password, name, os } = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown; name?: unknown; os?: unknown };
  if (typeof email !== "string" || typeof password !== "string" || typeof name !== "string" || typeof os !== "string") {
    return NextResponse.json({ error: "Email, password, computer name and OS are required." }, { status: 400 });
  }
  const ip = req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (tooMany(`ip:${ip}`) || tooMany(`email:${email.trim().toLowerCase()}`)) {
    return NextResponse.json({ error: "Too many sign-in attempts. Wait 15 minutes and try again." }, { status: 429 });
  }
  const user = verifyLogin(email, password);
  if (!user) return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
  tries.delete(`email:${email.trim().toLowerCase()}`);
  if (user.role !== "owner") {
    const allowed = limitsFor(getSubscription(user).plan).computers;
    const others = listDevices(user.id).filter(d => !(d.name === name.slice(0, 60) && d.os === os.slice(0, 20)));
    if (others.length >= allowed) {
      return NextResponse.json({ error: `Your plan links up to ${allowed} computer${allowed === 1 ? "" : "s"}. Unlink one on the Account page, or upgrade for more.` }, { status: 403 });
    }
  }
  const { token, device } = createDevice(user.id, name, os);
  return NextResponse.json({ token, deviceId: device.id, email: user.email, name: user.displayName });
}
