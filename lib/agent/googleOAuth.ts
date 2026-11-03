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
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
];

/** Google must be told this exact URL in the OAuth client's "Authorized redirect URIs". */
export function redirectUri(origin: string) {
  return `${origin}/api/google/callback`;
}

export function oauthClient(origin: string) {
  return new google.auth.OAuth2(cred("GOOGLE_CLIENT_ID"), cred("GOOGLE_CLIENT_SECRET"), redirectUri(origin));
}
