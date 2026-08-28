import { google } from "googleapis";
import type { ConnectorStatus, Report } from "../types";

const REQUIRED_ENV = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"] as const;

function missingEnv(): string[] {
  return REQUIRED_ENV.filter((key) => !process.env[key]);
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
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return client;
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

export async function searchDrive(query: string, maxResults = 10): Promise<Report> {
  assertConfigured();
  const drive = google.drive({ version: "v3", auth: auth() });
  // Escape single quotes so a quote in the query can't break out of the Drive query string.
  const safe = query.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `name contains '${safe}' and trashed = false`,
    pageSize: maxResults,
    fields: "files(id, name, mimeType, modifiedTime, webViewLink)",
  });
  const files = (res.data.files ?? []).map(
    (f) => `${f.name} (${f.mimeType?.split(".").pop()}) — modified ${f.modifiedTime} — ${f.webViewLink}`
  );
  return {
    platform: "drive",
    title: `Drive — search: ${query}`,
    rangeLabel: `${files.length} files`,
    metrics: [{ label: "Files found", value: files.length }],
    notes: files.length ? files : ["No files matched that search."],
    fetchedAt: new Date().toISOString(),
  };
}
