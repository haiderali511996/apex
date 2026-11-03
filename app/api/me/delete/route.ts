import { NextRequest, NextResponse } from "next/server";
import { deleteAccount, endSession, requireUser, verifyLogin } from "@/lib/auth";

export const runtime = "nodejs";

/** Deletes the signed-in account, after the password is typed again. */
export async function POST(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  if (guard.user.role === "owner") return NextResponse.json({ error: "The owner account can't be deleted from the app, so the server is never left without its owner." }, { status: 403 });
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (typeof password !== "string" || !verifyLogin(guard.user.email, password)) return NextResponse.json({ error: "That password isn't right." }, { status: 401 });
  await deleteAccount(guard.user.id);
  const res = NextResponse.json({ ok: true });
  await endSession(res);
  return res;
}
