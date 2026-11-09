import { google } from "googleapis";
import { cred } from "@/lib/credentials";

/**
 * Everything Sarah's Google connectors use, granted in one pass so one refresh
 * token covers them all: Gmail, Calendar and Drive, plus Search Console,
 * YouTube, the CRM sheet and Analytics for later.
 */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar",
  // Read-only, but able to open files: Sarah can look at pictures and
  // documents the user points her to, not just their names.
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
];

/**
 * The address the browser actually used. Behind nginx the app itself sees
 * http://127.0.0.1:3400 or http://<host>, but Google refuses a non-HTTPS
 * redirect for a published app ("doesn't comply with Google's OAuth 2.0
 * policy", invalid_request). So on any real domain it is https on the
 * forwarded host; only localhost keeps its own origin.
 */
export function publicOrigin(req: { headers: Headers; nextUrl: { origin: string } }): string {
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim();
  if (!host || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host)) return req.nextUrl.origin;
  return `https://${host}`;
}

/** Google must be told this exact URL in the OAuth client's "Authorized redirect URIs". */
export function redirectUri(origin: string) {
  return `${origin}/api/google/callback`;
}

export function oauthClient(origin: string) {
  return new google.auth.OAuth2(cred("GOOGLE_CLIENT_ID"), cred("GOOGLE_CLIENT_SECRET"), redirectUri(origin));
}
