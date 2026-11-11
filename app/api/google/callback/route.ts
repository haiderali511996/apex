import { requireUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { isLocalRequest, setEnvValues } from "@/lib/envFile";
import { oauthClient, publicOrigin } from "@/lib/agent/googleOAuth";
import { enterUser, saveCredentials } from "@/lib/credentials";

export const runtime = "nodejs";

/** Google returns here after consent: swap the code for a refresh token and keep it. */
export async function GET(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  // This request runs on this account's own keys from here on.
  enterUser(guard.user.id, guard.user.role === "owner");
  // Only the owner on their own machine keeps keys in .env.local.
  const local = guard.user.role === "owner" && isLocalRequest(req.headers.get("host"));
  const back = (state: string, detail?: string) =>
    NextResponse.redirect(new URL(`${local ? "/connect" : "/connections"}?google=${state}${detail ? `&detail=${encodeURIComponent(detail)}` : ""}`, publicOrigin(req)));
  const error = req.nextUrl.searchParams.get("error");
  if (error) return back("error", error === "access_denied" ? "Access wasn't granted on Google's screen." : error);
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return back("error", "Google didn't return a code.");
  try {
    const { tokens } = await oauthClient(publicOrigin(req)).getToken(code);
    if (!tokens.refresh_token) return back("error", "Google didn't return a refresh token. Remove Sarah's access at myaccount.google.com/permissions and connect again.");
    // A local sign-in lives in .env.local, so drop any earlier sign-out on the account.
    if (local) { await setEnvValues({ GOOGLE_REFRESH_TOKEN: tokens.refresh_token }); saveCredentials(guard.user.id, { GOOGLE_REFRESH_TOKEN: "" }); }
    else saveCredentials(guard.user.id, { GOOGLE_REFRESH_TOKEN: tokens.refresh_token });
    return back("connected");
  } catch (err) {
    return back("error", err instanceof Error ? err.message : String(err));
  }
}
