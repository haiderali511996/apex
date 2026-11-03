import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { database } from "./db";
import { DEFAULT_PERSONA, type Face, type Persona, type VoiceGender } from "./persona";
import { PERIOD_DAYS, TRIAL_DAYS, type PlanId } from "./plans";
import { cardPaymentsEnabled } from "./stripeBilling";

/**
 * Accounts and sessions. Passwords are scrypt-hashed; a session is a random
 * token in an httpOnly cookie, stored only as its hash.
 *
 * Roles: the owner is the person whose own accounts and computer the server
 * is wired to (.env.local connectors, Mac control, Claude Code). Only the
 * address in OWNER_EMAIL becomes the owner — a stranger who signs up first on
 * a public server must not inherit those connections.
 */

export const SESSION_COOKIE = "sid";
const SESSION_DAYS = 30;

export type User = { id: string; email: string; displayName: string; role: "owner" | "user" };
/** "pending": signed up, but the trial waits for a verified card (see lib/trialCard.ts). */
export type Subscription = { plan: PlanId | "trial"; status: "active" | "expired" | "pending"; periodEnd: string };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function checkPassword(password: string, stored: string) {
  const [, salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64), expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

export function createUser(email: string, password: string, displayName: string): User {
  const db = database();
  const normalized = email.trim().toLowerCase();
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(normalized)) throw new Error("An account with that email already exists. Log in instead.");
  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const role = owner && owner === normalized ? "owner" : "user";
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, normalized, hashPassword(password), displayName.trim(), role, new Date().toISOString());
  db.prepare("INSERT INTO settings (user_id, assistant_name, face, voice) VALUES (?, ?, ?, ?)")
    .run(id, DEFAULT_PERSONA.name, DEFAULT_PERSONA.face, DEFAULT_PERSONA.voice);
  // With card payments on, a customer's trial starts once their card passes the $1 check.
  if (role !== "owner" && cardPaymentsEnabled()) db.prepare("INSERT INTO subscriptions (user_id, plan, status, period_end) VALUES (?, 'trial', 'pending_card', ?)").run(id, new Date().toISOString());
  else db.prepare("INSERT INTO subscriptions (user_id, plan, status, period_end) VALUES (?, 'trial', 'active', ?)").run(id, daysFromNow(TRIAL_DAYS));
  return { id, email: normalized, displayName: displayName.trim(), role };
}

export function verifyLogin(email: string, password: string): User | null {
  const row = database().prepare("SELECT id, email, password_hash, display_name, role FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as { id: string; email: string; password_hash: string; display_name: string; role: User["role"] } | undefined;
  if (!row || !checkPassword(password, row.password_hash)) return null;
  return { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
}

/** Starts a session and sets its cookie on the response. */
export function startSession(res: NextResponse, userId: string) {
  const token = randomBytes(32).toString("base64url");
  database().prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(sha256(token), userId, daysFromNow(SESSION_DAYS));
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86_400,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function endSession(res: NextResponse) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) database().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

/** The signed-in user for this request, or null. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = database().prepare(`SELECT u.id, u.email, u.display_name, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`)
    .get(sha256(token)) as { id: string; email: string; display_name: string; role: User["role"]; expires_at: string } | undefined;
  if (!row || row.expires_at < new Date().toISOString()) return null;
  return { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
}

export function getPersona(user: User): Persona {
  const row = database().prepare("SELECT assistant_name, face, voice FROM settings WHERE user_id = ?").get(user.id) as
    { assistant_name: string; face: Face; voice: VoiceGender } | undefined;
  const first = user.displayName.split(" ")[0] || user.displayName;
  return row ? { name: row.assistant_name, face: row.face, voice: row.voice, userName: first } : { ...DEFAULT_PERSONA, userName: first };
}

export function savePersona(userId: string, persona: Pick<Persona, "name" | "face" | "voice">) {
  database().prepare("INSERT INTO settings (user_id, assistant_name, face, voice) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET assistant_name = excluded.assistant_name, face = excluded.face, voice = excluded.voice")
    .run(userId, persona.name, persona.face, persona.voice);
}

export function getSubscription(user: User): Subscription {
  const row = database().prepare("SELECT plan, status, period_end FROM subscriptions WHERE user_id = ?").get(user.id) as { plan: Subscription["plan"]; status: string; period_end: string } | undefined;
  if (!row) return { plan: "trial", status: "expired", periodEnd: new Date(0).toISOString() };
  if (row.status === "pending_card") return { plan: "trial", status: "pending", periodEnd: row.period_end };
  return { plan: row.plan, status: row.period_end > new Date().toISOString() ? "active" : "expired", periodEnd: row.period_end };
}

/** Starts the free trial once the card check passed; only from the waiting state, so it can't restart a trial or cut a paid plan short. */
export function startTrial(userId: string): boolean {
  const res = database().prepare("UPDATE subscriptions SET status = 'active', period_end = ? WHERE user_id = ? AND status = 'pending_card'").run(daysFromNow(TRIAL_DAYS), userId);
  return Number(res.changes) > 0;
}

/** Adds a paid period, from today or from the end of the current one. */
export function extendSubscription(userId: string, plan: PlanId) {
  const db = database();
  const row = db.prepare("SELECT plan, period_end FROM subscriptions WHERE user_id = ?").get(userId) as { plan: string; period_end: string } | undefined;
  const now = new Date().toISOString();
  // Stacking only applies to the same paid plan; a trial or a switch starts fresh.
  const from = row && row.plan === plan && row.period_end > now ? new Date(row.period_end).getTime() : Date.now();
  const end = new Date(from + PERIOD_DAYS * 86_400_000).toISOString();
  db.prepare("INSERT INTO subscriptions (user_id, plan, status, period_end) VALUES (?, ?, 'active', ?) ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, status = 'active', period_end = excluded.period_end")
    .run(userId, plan, end);
  return end;
}

type Guard = { user: User; persona: Persona } | { response: NextResponse };

/**
 * For API routes: the signed-in user with a usable plan, or the response to
 * send instead. The owner always passes.
 */
export async function requireUser(opts: { owner?: boolean; plan?: boolean } = {}): Promise<Guard> {
  const user = await currentUser();
  if (!user) return { response: NextResponse.json({ error: "Please log in." }, { status: 401 }) };
  if (opts.owner && user.role !== "owner") return { response: NextResponse.json({ error: "Only the owner of this server can do that." }, { status: 403 }) };
  if (opts.plan && user.role !== "owner" && getSubscription(user).status === "pending") {
    return { response: NextResponse.json({ error: "Add a card on the Billing page to start your free trial — it takes a minute." }, { status: 402 }) };
  }
  if (opts.plan && user.role !== "owner" && getSubscription(user).status !== "active") {
    return { response: NextResponse.json({ error: "Your plan has ended. Choose a plan on the Account page to keep talking." }, { status: 402 }) };
  }
  return { user, persona: getPersona(user) };
}

/**
 * Deletes an account and everything tied to it: sessions, settings, plan,
 * saved keys, community posts and the assistant's memory files. Payment
 * records are kept for accounting (the Privacy Policy says so), detached from
 * the account.
 */
export async function deleteAccount(userId: string) {
  const db = database();
  db.exec("BEGIN");
  try {
    for (const table of ["sessions", "settings", "subscriptions", "credentials", "posts", "devices", "device_commands", "usage", "music_tracks", "billing_cards"]) {
      try { db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId); } catch { /* table not created yet */ }
    }
    db.prepare("UPDATE payments SET user_id = 'deleted' WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  const { rm } = await import("node:fs/promises");
  const path = await import("node:path");
  await rm(path.join(process.cwd(), "data", "users", userId.replace(/[^a-zA-Z0-9-]/g, "")), { recursive: true, force: true });
}
