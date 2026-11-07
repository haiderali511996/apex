import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { database } from "./db";

/**
 * Computers linked through the desktop app (desktop/sarah-desktop.mjs). The
 * app pairs once with a short code, then polls for commands with its own
 * token — the server never needs to reach into anyone's network. Commands are
 * a fixed set of actions the app knows; risky ones only arrive after the user
 * approved them in the UI.
 */

export type Device = { id: string; userId: string; name: string; os: string; createdAt: string; lastSeen: string | null };
export type Command = { id: string; action: string; args: Record<string, unknown> };

const PAIR_MINUTES = 10;
/** A computer that polled within this window is online. */
export const ONLINE_MS = 60_000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function db() {
  const d = database();
  d.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      os TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_seen TEXT
    );
    CREATE TABLE IF NOT EXISTS pairing_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS device_commands (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      args TEXT NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  // Live progress of long jobs (Claude Code steps and to-dos), added later.
  if (!progressColumn) {
    try { d.exec("ALTER TABLE device_commands ADD COLUMN progress TEXT"); } catch { /* already there */ }
    progressColumn = true;
  }
  return d;
}
let progressColumn = false;

type DeviceRow = { id: string; user_id: string; name: string; os: string; created_at: string; last_seen: string | null };
const toDevice = (r: DeviceRow): Device => ({ id: r.id, userId: r.user_id, name: r.name, os: r.os, createdAt: r.created_at, lastSeen: r.last_seen });

export function listDevices(userId: string): Device[] {
  return (db().prepare("SELECT id, user_id, name, os, created_at, last_seen FROM devices WHERE user_id = ? ORDER BY last_seen DESC").all(userId) as DeviceRow[]).map(toDevice);
}

export const isOnline = (d: Device) => !!d.lastSeen && Date.now() - Date.parse(d.lastSeen) < ONLINE_MS;

/** A one-time code the desktop app trades for its token. Easy to type: no 0/O or 1/I. */
export function createPairingCode(userId: string): { code: string; expiresAt: string } {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("");
  const expiresAt = new Date(Date.now() + PAIR_MINUTES * 60_000).toISOString();
  db().prepare("DELETE FROM pairing_codes WHERE user_id = ? OR expires_at < ?").run(userId, new Date().toISOString());
  db().prepare("INSERT INTO pairing_codes (code, user_id, expires_at) VALUES (?, ?, ?)").run(code, userId, expiresAt);
  return { code, expiresAt };
}

/** Trades a pairing code for a device and its secret token (shown to the app once). */
export function registerDevice(code: string, name: string, os: string): { token: string; device: Device } | null {
  const d = db();
  const row = d.prepare("SELECT user_id, expires_at FROM pairing_codes WHERE code = ?").get(code.trim().toUpperCase()) as { user_id: string; expires_at: string } | undefined;
  if (!row || row.expires_at < new Date().toISOString()) return null;
  d.prepare("DELETE FROM pairing_codes WHERE code = ?").run(code.trim().toUpperCase());
  const token = randomBytes(32).toString("base64url"), id = randomUUID(), now = new Date().toISOString();
  d.prepare("INSERT INTO devices (id, user_id, name, os, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, row.user_id, name.slice(0, 60) || "Computer", os.slice(0, 20), sha256(token), now, now);
  return { token, device: { id, userId: row.user_id, name, os, createdAt: now, lastSeen: now } };
}

/**
 * Links a computer straight to an account (the desktop app's email + password
 * sign-in). Signing in again from the same computer replaces its old link.
 */
export function createDevice(userId: string, name: string, os: string): { token: string; device: Device } {
  const d = db(), token = randomBytes(32).toString("base64url"), id = randomUUID(), now = new Date().toISOString();
  const cleanName = name.slice(0, 60) || "Computer", cleanOs = os.slice(0, 20);
  for (const old of d.prepare("SELECT id FROM devices WHERE user_id = ? AND name = ? AND os = ?").all(userId, cleanName, cleanOs) as { id: string }[]) unlinkDevice(userId, old.id);
  d.prepare("INSERT INTO devices (id, user_id, name, os, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, userId, cleanName, cleanOs, sha256(token), now, now);
  return { token, device: { id, userId, name: cleanName, os: cleanOs, createdAt: now, lastSeen: now } };
}

/** The device a bearer token belongs to; also marks it as just seen. */
export function deviceForToken(header: string | null): Device | null {
  const token = header?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const d = db();
  const row = d.prepare("SELECT id, user_id, name, os, created_at, last_seen FROM devices WHERE token_hash = ?").get(sha256(token)) as DeviceRow | undefined;
  if (!row) return null;
  d.prepare("UPDATE devices SET last_seen = ? WHERE id = ?").run(new Date().toISOString(), row.id);
  return toDevice(row);
}

export function unlinkDevice(userId: string, deviceId: string): boolean {
  const d = db();
  const res = d.prepare("DELETE FROM devices WHERE id = ? AND user_id = ?").run(deviceId, userId);
  d.prepare("DELETE FROM device_commands WHERE device_id = ?").run(deviceId);
  return Number(res.changes) > 0;
}

/** Queued commands for this device, marked as sent. */
export function takeCommands(deviceId: string): Command[] {
  const d = db();
  const rows = d.prepare("SELECT id, action, args FROM device_commands WHERE device_id = ? AND status = 'queued' ORDER BY created_at").all(deviceId) as { id: string; action: string; args: string }[];
  for (const r of rows) d.prepare("UPDATE device_commands SET status = 'sent', updated_at = ? WHERE id = ?").run(new Date().toISOString(), r.id);
  return rows.map(r => ({ id: r.id, action: r.action, args: JSON.parse(r.args) }));
}

export function saveResult(deviceId: string, commandId: string, ok: boolean, output: string) {
  db().prepare("UPDATE device_commands SET status = ?, result = ?, updated_at = ? WHERE id = ? AND device_id = ?")
    .run(ok ? "done" : "failed", output.slice(0, 8000), new Date().toISOString(), commandId, deviceId);
}

/**
 * Picks the computer to act on: the one named (loosely), or the most recently
 * active one. Errors explain what's linked, for the assistant to say.
 */
export function pickDevice(userId: string, name?: string): Device {
  const devices = listDevices(userId);
  if (!devices.length) throw new Error("No computer is linked yet. Link one on the Account page with the desktop app.");
  const wanted = name?.trim().toLowerCase();
  const chosen = wanted ? devices.find(d => d.name.toLowerCase().includes(wanted) || d.os.toLowerCase() === wanted) : devices[0];
  if (!chosen) throw new Error(`No linked computer matches "${name}". Linked: ${devices.map(d => d.name).join(", ")}.`);
  if (!isOnline(chosen)) throw new Error(`${chosen.name} is offline — start the desktop app on it (node sarah-desktop.mjs).`);
  return chosen;
}

/** Sends a command and waits for the computer's answer. */
export async function runOnDevice(userId: string, deviceId: string, action: string, args: Record<string, unknown>, timeoutMs = 30_000): Promise<string> {
  const d = db(), id = randomUUID(), now = new Date().toISOString();
  d.prepare("INSERT INTO device_commands (id, device_id, user_id, action, args, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)")
    .run(id, deviceId, userId, action, JSON.stringify(args), now, now);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, 400));
    const row = d.prepare("SELECT status, result FROM device_commands WHERE id = ?").get(id) as { status: string; result: string | null } | undefined;
    if (row?.status === "done") return row.result || "Done.";
    if (row?.status === "failed") throw new Error(row.result || "The computer couldn't do that.");
  }
  d.prepare("UPDATE device_commands SET status = 'failed', result = 'timed out' WHERE id = ? AND status IN ('queued', 'sent')").run(id);
  throw new Error("The computer didn't answer in time. Is the desktop app still running?");
}

/**
 * The computer that runs Claude Code for this account (the Developer, and any
 * agent set to Claude): a named one, else an online Mac, else any online one.
 */
export function claudeComputer(userId: string, name?: string): Device {
  if (name) return pickDevice(userId, name);
  const online = listDevices(userId).filter(isOnline);
  const chosen = online.find(d => d.os === "macOS") ?? online[0];
  if (chosen) return chosen;
  const linked = listDevices(userId);
  throw new Error(linked.length
    ? `Claude Code runs on your computer, and none is online: start the UNC Assistant desktop app on ${linked.map(d => d.name).join(" or ")}.`
    : "Claude Code runs on your computer through the desktop app. Install it from the Download page and sign in, then ask again.");
}

/** The computer reports a running job's progress; only its own commands. */
export function saveProgress(deviceId: string, commandId: string, progress: unknown) {
  const text = JSON.stringify(progress ?? null);
  if (text.length > 60_000) return;
  db().prepare("UPDATE device_commands SET progress = ?, updated_at = ? WHERE id = ? AND device_id = ? AND status IN ('queued', 'sent')").run(text, new Date().toISOString(), commandId, deviceId);
}

export type Job = { id: string; action: string; computer: string; task: string; status: string; progress: unknown; result: string | null; startedAt: string; updatedAt: string };

/** Claude Code jobs that are running, or finished in the last two minutes, for the live Developer panel. */
export function recentJobs(userId: string): Job[] {
  const since = new Date(Date.now() - 2 * 60_000).toISOString();
  const rows = db().prepare(`SELECT c.id, c.action, c.args, c.status, c.progress, c.result, c.created_at, c.updated_at, d.name AS computer
    FROM device_commands c JOIN devices d ON d.id = c.device_id
    WHERE c.user_id = ? AND c.action IN ('dev_task', 'dev_ask', 'dev_chats', 'claude_ask') AND (c.status IN ('queued', 'sent') OR c.updated_at > ?)
    ORDER BY c.created_at DESC LIMIT 3`).all(userId, since) as { id: string; action: string; args: string; status: string; progress: string | null; result: string | null; created_at: string; updated_at: string; computer: string }[];
  return rows.map(r => {
    let args: { task?: string; prompt?: string; project?: string } = {};
    try { args = JSON.parse(r.args); } catch { /* keep empty */ }
    let progress: unknown = null;
    try { progress = r.progress ? JSON.parse(r.progress) : null; } catch { /* keep null */ }
    const task = String(args.task ?? args.prompt ?? "").split("\n\nImages to use")[0].split("\n\nGit rule")[0].replace(/^You are the [\s\S]*?Request: /, "").slice(0, 400);
    return { id: r.id, action: r.action, computer: r.computer, task, status: r.status, progress, result: r.status === "queued" || r.status === "sent" ? null : (r.result ?? "").slice(0, 1500), startedAt: r.created_at, updatedAt: r.updated_at };
  });
}
