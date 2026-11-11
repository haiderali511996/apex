import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { enterUser, cred, CREDENTIAL_KEYS, GROUPS, loadCredentials, saveCredentials, SIGNED_OUT } from "@/lib/credentials";

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
    const value = cred(f.key);
    fields[f.key] = {
      set: !!value,
      source: own[f.key] && own[f.key] !== SIGNED_OUT ? "account" : value ? "server" : null,
      display: value ? (f.secret ? mask(value) : value) : "",
    };
  }
  const googleSignedIn = !!cred("GOOGLE_REFRESH_TOKEN");
  // A connection counts as connected when every field it needs is set.
  const connected: Record<string, boolean> = {};
  for (const group of GROUPS) {
    const needed = group.fields.filter(f => !f.optional);
    connected[group.id] = (needed.length ? needed : group.fields).every(f => fields[f.key]?.set) && (group.id !== "google" || googleSignedIn);
  }
  return NextResponse.json({ groups: GROUPS, fields, googleSignedIn, connected, owner });
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
    if (value.trim() === SIGNED_OUT) continue;
    values[key] = value;
  }
  // Signing out of Google is a separate action, not a typed field.
  delete values.GOOGLE_REFRESH_TOKEN;
  saveCredentials(guard.user.id, values);
  return NextResponse.json({ ok: true, saved: Object.keys(values) });
}

/**
 * Disconnects a connection: DELETE ?group=<id> forgets that group's keys
 * (Google: the sign-in, keeping the OAuth client so Reconnect works).
 * Without a group it signs out of Google, as before. Each key is replaced by
 * a sign-out marker, so the owner's account stops falling back to the
 * server's .env as well; saving a new key or signing in again reconnects.
 */
export async function DELETE(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  // This request runs on this account's own keys from here on.
  enterUser(guard.user.id, guard.user.role === "owner");
  const id = req.nextUrl.searchParams.get("group") || "google";
  const group = GROUPS.find(g => g.id === id);
  if (!group) return NextResponse.json({ error: "Unknown connection." }, { status: 400 });
  if (group.id === "google") {
    // Tell Google too, so the old sign-in stops working everywhere. Only this
    // account's own token: the server's .env one may serve other installs.
    const own = loadCredentials(guard.user.id).GOOGLE_REFRESH_TOKEN;
    if (own && own !== SIGNED_OUT) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(own)}`, { method: "POST", signal: AbortSignal.timeout(8000) }).catch(() => null);
    }
    saveCredentials(guard.user.id, { GOOGLE_REFRESH_TOKEN: SIGNED_OUT });
  } else {
    saveCredentials(guard.user.id, Object.fromEntries(group.fields.map(f => [f.key, SIGNED_OUT])));
  }
  return NextResponse.json({ ok: true });
}
