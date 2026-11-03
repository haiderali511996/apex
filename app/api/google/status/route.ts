import { requireUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { auth, isConfigured } from "@/lib/agent/connectors/google";
import { redirectUri } from "@/lib/agent/googleOAuth";
import { enterUser, cred } from "@/lib/credentials";

export const runtime = "nodejs";

/** Proves the connection works: whose Gmail it is, and what Calendar and Drive can see. */
export async function GET(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  // This request runs on this account's own keys from here on.
  enterUser(guard.user.id, guard.user.role === "owner");
  const hasClient = !!cred("GOOGLE_CLIENT_ID") && !!cred("GOOGLE_CLIENT_SECRET");
  // The exact URL the connect flow sends Google, to register on the OAuth client.
  const redirect = redirectUri(req.nextUrl.origin);
  if (!isConfigured()) return NextResponse.json({ connected: false, hasClient, redirect });
  const client = auth();
  const check = async <T,>(fn: () => Promise<T>) => fn().then((value) => ({ ok: true as const, value }), (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }));
  const [gmail, calendar, drive] = await Promise.all([
    check(async () => (await google.gmail({ version: "v1", auth: client }).users.getProfile({ userId: "me" })).data.emailAddress ?? ""),
    check(async () => (await google.calendar({ version: "v3", auth: client }).calendarList.list({ maxResults: 50 })).data.items?.length ?? 0),
    check(async () => (await google.drive({ version: "v3", auth: client }).files.list({ pageSize: 1, fields: "files(id)" })).data.files?.length ?? 0),
  ]);
  return NextResponse.json({ connected: true, hasClient, redirect, gmail, calendar, drive });
}
