import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { enterUser, CREDENTIAL_KEYS, GROUPS, loadCredentials, saveCredentials } from "@/lib/credentials";

export const runtime = "nodejs";

const mask = (v: string) => (v.length <= 8 ? "••••" : `••••${v.slice(-4)}`);

/** Which keys this account has, without ever sending a secret back. */
export async function GET() {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  // This request runs on this account's own keys from here on.
  enterUser(guard.user.id, guard.user.role === "owner");
  const own = loadCredentials(guard.user.id), owner = guard.user.role === "owner";
  const fields: Record<string, { set: boolean; source: "account" | "server" | null; display: string }> = {};
  for (const group of GROUPS) for (const f of group.fields) {
    const value = own[f.key] || (owner ? process.env[f.key] : undefined);
    fields[f.key] = {
      set: !!value,
      source: own[f.key] ? "account" : value ? "server" : null,
      display: value ? (f.secret ? mask(value) : value) : "",
    };
  }
  const googleSignedIn = !!(own.GOOGLE_REFRESH_TOKEN || (owner && process.env.GOOGLE_REFRESH_TOKEN));
  return NextResponse.json({ groups: GROUPS, fields, googleSignedIn, owner });
}

/** Saves typed-in keys; an empty value removes one. */
export async function PUT(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  // This request runs on this account's own keys from here on.
  enterUser(guard.user.id, guard.user.role === "owner");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!CREDENTIAL_KEYS.has(key) || typeof value !== "string" || value.length > 4000) continue;
    values[key] = value;
  }
  // Signing out of Google is a separate action, not a typed field.
  delete values.GOOGLE_REFRESH_TOKEN;
  saveCredentials(guard.user.id, values);
  return NextResponse.json({ ok: true, saved: Object.keys(values) });
}

/** Disconnects Google: forgets this account's sign-in. */
export async function DELETE() {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  // This request runs on this account's own keys from here on.
  enterUser(guard.user.id, guard.user.role === "owner");
  saveCredentials(guard.user.id, { GOOGLE_REFRESH_TOKEN: "" });
  return NextResponse.json({ ok: true });
}
