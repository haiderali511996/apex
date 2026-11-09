import { google } from "googleapis";
import type { ConnectorStatus, Report } from "../types";
import { cred } from "@/lib/credentials";

const REQUIRED_ENV = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"] as const;

function missingEnv(): string[] {
  return REQUIRED_ENV.filter((key) => !cred(key));
}

export function isConfigured(): boolean {
  return missingEnv().length === 0;
}

export function status(): ConnectorStatus[] {
  const missing = missingEnv();
  const configured = missing.length === 0;
  return [
    { platform: "email", label: "Gmail", configured, missingEnv: missing, capabilities: ["read", "write"] },
    { platform: "calendar", label: "Google Calendar", configured, missingEnv: missing, capabilities: ["read", "write"] },
    { platform: "drive", label: "Google Drive", configured, missingEnv: missing, capabilities: ["read"] },
  ];
}

export function auth() {
  const client = new google.auth.OAuth2(cred("GOOGLE_CLIENT_ID"), cred("GOOGLE_CLIENT_SECRET"));
  client.setCredentials({ refresh_token: cred("GOOGLE_REFRESH_TOKEN") });
  return client;
}

/**
 * Google's raw errors ("invalid_grant", "Insufficient Permission") in words
 * the user can act on. Anything unrecognised passes through unchanged.
 */
export function explainGoogleError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const api = /(Gmail|Calendar|Drive|Sheets|YouTube|Search Console|Analytics)[^.]*API has not been used|(\w+)\.googleapis\.com.*(disabled|not been used)/i.exec(raw);
  if (/invalid_grant|token has been expired or revoked|Token has been expired/i.test(raw))
    return "Google sign-in has expired or was removed. Open the Connections page and press Reconnect Google.";
  if (/invalid_client|unauthorized_client/i.test(raw))
    return "Google rejected the OAuth client ID or secret. Check them on the Connections page, then press Reconnect Google.";
  if (/insufficient (permission|authentication scopes)|insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(raw))
    return "Google was connected before this permission existed. Open the Connections page and press Reconnect Google, then allow access.";
  if (api) return `The ${api[1] ?? api[2]} API is turned off in the user's Google Cloud project. Enable it in Google Cloud Console (APIs & Services → Library), wait a minute, and try again.`;
  if (/Google is not configured/i.test(raw)) return raw.replace(/ See SETUP\.md\./, " Connect Google on the Connections page.");
  return raw;
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new Error(`Google is not configured. Missing: ${missingEnv().join(", ")}. See SETUP.md.`);
  }
}

/* ── Gmail ── */

export async function getInboxSummary(maxResults = 10): Promise<Report> {
  assertConfigured();
  const gmail = google.gmail({ version: "v1", auth: auth() });
  const list = await gmail.users.messages.list({ userId: "me", maxResults, q: "in:inbox is:unread" });
  const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);

  const summaries: string[] = [];
  for (const id of ids) {
    const msg = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });
    const headers = msg.data.payload?.headers ?? [];
    const get = (name: string) => headers.find((h) => h.name === name)?.value ?? "";
    summaries.push(`From ${get("From")} — "${get("Subject")}" (${get("Date")}): ${msg.data.snippet ?? ""}`);
  }

  return {
    platform: "email",
    title: "Gmail — unread inbox",
    rangeLabel: `${summaries.length} unread`,
    metrics: [{ label: "Unread shown", value: summaries.length }],
    notes: summaries.length ? summaries : ["Inbox is clear — nothing unread."],
    fetchedAt: new Date().toISOString(),
  };
}

export async function searchEmail(query: string, maxResults = 10): Promise<Report> {
  assertConfigured();
  const gmail = google.gmail({ version: "v1", auth: auth() });
  const list = await gmail.users.messages.list({ userId: "me", maxResults, q: query });
  const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);

  const summaries: string[] = [];
  for (const id of ids) {
    const msg = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });
    const headers = msg.data.payload?.headers ?? [];
    const get = (name: string) => headers.find((h) => h.name === name)?.value ?? "";
    summaries.push(`From ${get("From")} — "${get("Subject")}" (${get("Date")}): ${msg.data.snippet ?? ""}`);
  }

  return {
    platform: "email",
    title: `Gmail — search: ${query}`,
    rangeLabel: `${summaries.length} results`,
    metrics: [{ label: "Matches", value: summaries.length }],
    notes: summaries.length ? summaries : ["No messages matched that search."],
    fetchedAt: new Date().toISOString(),
  };
}

/** Executes an already-approved email send. Never call directly from a tool — always go through a pending action confirmed by the user. */
export async function sendEmail(payload: { to: string; subject: string; body: string }): Promise<string> {
  assertConfigured();
  const gmail = google.gmail({ version: "v1", auth: auth() });
  const raw = Buffer.from(
    [`To: ${payload.to}`, `Subject: ${payload.subject}`, "Content-Type: text/plain; charset=utf-8", "", payload.body].join("\r\n")
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  return `Email sent to ${payload.to} (message id ${res.data.id}).`;
}

/* ── Calendar ── */

export async function getUpcomingEvents(days = 7): Promise<Report> {
  assertConfigured();
  const calendar = google.calendar({ version: "v3", auth: auth() });
  const now = new Date();
  const end = new Date(now.getTime() + days * 86400000);
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 20,
  });
  const events = (res.data.items ?? []).map((e) => {
    const start = e.start?.dateTime ?? e.start?.date ?? "?";
    return `${start} — ${e.summary ?? "(no title)"}${e.location ? ` @ ${e.location}` : ""}`;
  });
  return {
    platform: "calendar",
    title: "Calendar — upcoming",
    rangeLabel: `next ${days} days`,
    metrics: [{ label: "Events", value: events.length }],
    notes: events.length ? events : ["Nothing scheduled in that window."],
    fetchedAt: new Date().toISOString(),
  };
}

/** Executes an already-approved calendar event creation. Never call directly from a tool — always go through a pending action confirmed by the user, since events can email invitations to other people. */
export async function createCalendarEvent(payload: {
  summary: string;
  startIso: string;
  endIso: string;
  description?: string;
  attendees?: string[];
}): Promise<string> {
  assertConfigured();
  const calendar = google.calendar({ version: "v3", auth: auth() });
  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: payload.summary,
      description: payload.description,
      start: { dateTime: payload.startIso },
      end: { dateTime: payload.endIso },
      attendees: payload.attendees?.map((email) => ({ email })),
    },
  });
  return `Event "${payload.summary}" created (${res.data.htmlLink}).`;
}

/* ── Drive ── */

const IMAGE_TYPES = /^image\//;

/** Drive files by name, or the newest when no name is given; `kind` "image" keeps only pictures. */
export async function searchDrive(query: string, maxResults = 10, kind: "any" | "image" = "any"): Promise<Report> {
  assertConfigured();
  const drive = google.drive({ version: "v3", auth: auth() });
  // Escape quotes and backslashes so the query can't break out of the Drive query string.
  const safe = query.trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = ["trashed = false", safe ? `(name contains '${safe}' or fullText contains '${safe}')` : "", kind === "image" ? "mimeType contains 'image/'" : ""].filter(Boolean).join(" and ");
  const res = await drive.files.list({
    q,
    orderBy: "modifiedTime desc",
    pageSize: Math.min(Math.max(maxResults, 1), 30),
    fields: "files(id, name, mimeType, modifiedTime, webViewLink)",
  });
  const files = (res.data.files ?? []).map(
    (f) => `${f.name} (${IMAGE_TYPES.test(f.mimeType ?? "") ? "picture" : f.mimeType?.split(/[./]/).pop()}) — id ${f.id} — modified ${f.modifiedTime} — ${f.webViewLink}`
  );
  return {
    platform: "drive",
    title: safe ? `Drive — search: ${query}` : `Drive — newest ${kind === "image" ? "pictures" : "files"}`,
    rangeLabel: `${files.length} files`,
    metrics: [{ label: "Files found", value: files.length }],
    notes: files.length ? files : ["No files matched that search."],
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Downloads Drive files as pictures: images as they are, anything else
 * (PDF, slides, documents, HEIC…) as Drive's large preview. `ids` are file
 * ids, or "latest" / "latest:N" for the newest pictures.
 */
export async function fetchDriveImages(ids: string[]): Promise<{ name: string; bytes: Uint8Array }[]> {
  assertConfigured();
  const client = auth();
  const drive = google.drive({ version: "v3", auth: client });
  const wanted: string[] = [];
  for (const id of ids.map((s) => s.trim()).filter(Boolean)) {
    const many = /^latest(?::(\d+))?$/.exec(id);
    if (!many) { wanted.push(id); continue; }
    const res = await drive.files.list({ q: "trashed = false and mimeType contains 'image/'", orderBy: "createdTime desc", pageSize: Math.min(Number(many[1] ?? 1), 6), fields: "files(id)" });
    wanted.push(...(res.data.files ?? []).map((f) => f.id!).filter(Boolean));
  }
  if (!wanted.length) throw new Error("No pictures were found in Drive.");
  const out: { name: string; bytes: Uint8Array }[] = [];
  for (const id of [...new Set(wanted)].slice(0, 6)) {
    const meta = await drive.files.get({ fileId: id, fields: "id, name, mimeType, size, thumbnailLink" });
    const { name, mimeType, size, thumbnailLink } = meta.data;
    const direct = /^image\/(jpeg|png|webp|gif)$/.test(mimeType ?? "") && Number(size ?? 0) <= 12 * 1024 * 1024;
    if (direct) {
      const file = await drive.files.get({ fileId: id, alt: "media" }, { responseType: "arraybuffer" });
      out.push({ name: name ?? id, bytes: new Uint8Array(file.data as ArrayBuffer) });
      continue;
    }
    if (!thumbnailLink) throw new Error(`"${name}" can't be shown as a picture.`);
    const { token } = await client.getAccessToken();
    const res = await fetch(thumbnailLink.replace(/=s\d+$/, "=s1600"), { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Drive wouldn't give a preview of "${name}" (HTTP ${res.status}).`);
    out.push({ name: name ?? id, bytes: new Uint8Array(await res.arrayBuffer()) });
  }
  return out;
}
