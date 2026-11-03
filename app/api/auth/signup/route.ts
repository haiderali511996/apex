import { NextRequest, NextResponse } from "next/server";
import { createUser, startSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { email, password, name } = (await req.json().catch(() => ({}))) as { email?: string; password?: string; name?: string };
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  if (typeof password !== "string" || password.length < 8) return NextResponse.json({ error: "Use a password of at least 8 characters." }, { status: 400 });
  if (typeof name !== "string" || !name.trim() || name.trim().length > 60) return NextResponse.json({ error: "Enter your name." }, { status: 400 });
  try {
    const user = createUser(email, password, name);
    const res = NextResponse.json({ ok: true, user: { email: user.email, role: user.role } });
    startSession(res, user.id);
    return res;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Sign-up failed." }, { status: 409 });
  }
}
