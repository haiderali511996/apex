import { requireUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { isLocalRequest, setEnvValues } from "@/lib/envFile";
import { GOOGLE_SCOPES, oauthClient } from "@/lib/agent/googleOAuth";
import { enterUser, cred, saveCredentials } from "@/lib/credentials";

export const runtime = "nodejs";

/** Saves the OAuth client's ID and secret from the Connect page. */
export async function POST(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  // This request runs on this account's own keys from here on.
  enterUser(guard.user.id, guard.user.role === "owner");
  // Only the owner on their own machine keeps keys in .env.local; on a hosted
  // server the owner's are saved to their account like everyone else's.
  const local = guard.user.role === "owner" && isLocalRequest(req.headers.get("host"));
  const { clientId, clientSecret } = (await req.json()) as { clientId?: string; clientSecret?: string };
  if (!clientId?.trim().endsWith(".apps.googleusercontent.com")) return NextResponse.json({ error: "That doesn't look like a Google OAuth Client ID — it ends in .apps.googleusercontent.com." }, { status: 400 });
  if (!clientSecret?.trim()) return NextResponse.json({ error: "Paste the client secret too." }, { status: 400 });
  if (local) await setEnvValues({ GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret });
  else saveCredentials(guard.user.id, { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret });
  return NextResponse.json({ ok: true });
}

/** Sends Haider to Google's consent screen. */
export async function GET(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  // This request runs on this account's own keys from here on.
  enterUser(guard.user.id, guard.user.role === "owner");
  const local = guard.user.role === "owner" && isLocalRequest(req.headers.get("host"));
  if (!cred("GOOGLE_CLIENT_ID") || !cred("GOOGLE_CLIENT_SECRET")) {
    return NextResponse.redirect(new URL(`${local ? "/connect" : "/connections"}?google=missing-client`, req.nextUrl.origin));
  }
  const url = oauthClient(req.nextUrl.origin).generateAuthUrl({
    access_type: "offline",
    // Always ask, so Google always returns a refresh token.
    prompt: "consent",
    scope: GOOGLE_SCOPES,
  });
  return NextResponse.redirect(url);
}
