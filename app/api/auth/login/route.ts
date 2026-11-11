import { NextRequest, NextResponse } from "next/server";
import { startSession, verifyLogin } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { email, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  if (typeof email !== "string" || typeof password !== "string") return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  const user = verifyLogin(email, password);
  if (!user) return NextResponse.json({ error: "That email and password don't match." }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  startSession(res, user.id);
  return res;
}
