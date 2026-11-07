import { AsyncLocalStorage } from "node:async_hooks";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { database } from "./db";

/**
 * Every account brings its own keys — its own Gemini, Fish Audio, Google and
 * social accounts — entered on the Connections page and stored encrypted.
 *
 * Code that used to read process.env.GEMINI_API_KEY now calls
 * cred("GEMINI_API_KEY"): inside a request it returns the signed-in user's
 * own value. Only the owner falls back to .env.local, so one customer can
 * never run on another's keys or reach their accounts.
 */

export type Field = { key: string; label: string; secret?: boolean; placeholder?: string; help?: string; optional?: boolean };
export type Group = { id: string; title: string; why: string; required?: boolean; link?: { href: string; text: string }; fields: Field[] };

export const GROUPS: Group[] = [
  {
    id: "gemini", title: "Gemini (AI brain)", required: true,
    why: "Understands you, answers, transcribes your voice in any language and powers the tools. Required.",
    link: { href: "https://aistudio.google.com/apikey", text: "Get a free key in Google AI Studio" },
    fields: [{ key: "GEMINI_API_KEY", label: "Gemini API key", secret: true, placeholder: "AIza…" }],
  },
  {
    id: "fish", title: "Fish Audio (natural voice)",
    why: "Gives your assistant a natural female or male voice in English and Urdu. Without it, your computer's voice is used.",
    link: { href: "https://fish.audio/app/api-keys", text: "Create a Fish Audio API key" },
    fields: [{ key: "FISH_AUDIO_API_KEY", label: "Fish Audio API key", secret: true, placeholder: "sk-fish-…" }],
  },
  {
    id: "google", title: "Google (Gmail, Calendar, Drive, Search Console, YouTube, Analytics)",
    why: "Your own Google Cloud OAuth client. After saving it, press “Sign in with Google” to grant access.",
    link: { href: "https://console.cloud.google.com/apis/credentials", text: "Create an OAuth client in Google Cloud" },
    fields: [
      { key: "GOOGLE_CLIENT_ID", label: "OAuth client ID", placeholder: "…apps.googleusercontent.com" },
      { key: "GOOGLE_CLIENT_SECRET", label: "OAuth client secret", secret: true },
      { key: "GSC_SITE_URL", label: "Search Console property", optional: true, placeholder: "https://example.com/ or sc-domain:example.com", help: "A bare domain like example.com also works." },
      { key: "GA4_PROPERTY_ID", label: "Google Analytics 4 property ID", optional: true, placeholder: "123456789" },
      { key: "YOUTUBE_CHANNEL_ID", label: "YouTube channel ID", optional: true, placeholder: "UC…" },
      { key: "CRM_SHEET_ID", label: "CRM Google Sheet ID", optional: true },
    ],
  },
  {
    id: "meta", title: "Facebook & Instagram",
    why: "Page and Instagram stats, and posts you approve.",
    link: { href: "https://developers.facebook.com/tools/explorer/", text: "Get a Page access token" },
    fields: [
      { key: "META_PAGE_ACCESS_TOKEN", label: "Page access token", secret: true },
      { key: "META_PAGE_ID", label: "Facebook Page ID" },
      { key: "META_IG_USER_ID", label: "Instagram business account ID", optional: true },
    ],
  },
  {
    id: "x", title: "X (Twitter)",
    why: "Your X stats, and tweets you approve.",
    link: { href: "https://developer.x.com/en/portal/dashboard", text: "Open the X developer portal" },
    fields: [
      { key: "X_BEARER_TOKEN", label: "Bearer token", secret: true },
      { key: "X_USERNAME", label: "Username", placeholder: "without the @" },
      { key: "X_ACCESS_TOKEN", label: "User access token (to post)", secret: true, optional: true },
    ],
  },
  {
    id: "tiktok", title: "TikTok",
    why: "Your TikTok stats, and videos you approve.",
    link: { href: "https://developers.tiktok.com/apps", text: "Open TikTok for Developers" },
    fields: [
      { key: "TIKTOK_CLIENT_KEY", label: "Client key" },
      { key: "TIKTOK_CLIENT_SECRET", label: "Client secret", secret: true },
      { key: "TIKTOK_REFRESH_TOKEN", label: "Refresh token", secret: true },
    ],
  },
  {
    id: "stripe", title: "Stripe (Finance agent)",
    why: "Lets the Finance agent report your Stripe sales, refunds and open invoices. Read-only: a restricted key with read access is enough. (This is your own business's Stripe — paying for your plan is separate.)",
    link: { href: "/docs#finance", text: "How to create the Stripe key" },
    fields: [{ key: "STRIPE_SECRET_KEY", label: "Restricted key", secret: true, placeholder: "rk_live_…" }],
  },
  {
    id: "email", title: "Email (any provider)",
    why: "Lets your assistant read, search and draft replies in your inbox: any provider in the world: Gmail, Outlook, Yahoo, iCloud, Zoho, AWS WorkMail, your web host, or your company's mail server. It never sends anything until you approve the draft. Use an app password where your provider offers one (Gmail, Yahoo, iCloud, Outlook and WorkMail with two-step sign-in require it), and make sure IMAP is switched on in your mailbox settings. The servers are found automatically; fill them in only if the test says so.",
    link: { href: "/docs#email", text: "How to get an app password" },
    fields: [
      { key: "EMAIL_ADDRESS", label: "Email address", secret: false, placeholder: "you@yourcompany.com" },
      { key: "EMAIL_PASSWORD", label: "Password or app password", secret: true },
      { key: "EMAIL_IMAP_HOST", label: "Incoming (IMAP) server", secret: false, optional: true, placeholder: "found automatically, e.g. imap.example.com:993" },
      { key: "EMAIL_SMTP_HOST", label: "Outgoing (SMTP) server", secret: false, optional: true, placeholder: "found automatically, e.g. smtp.example.com:465" },
    ],
  },
  {
    id: "paypal", title: "PayPal (Finance agent)",
    why: "Lets the Finance agent read your PayPal balance, money in and out, and fees. Read-only — it can't send money. Create a REST app, switch on \"Transaction search\", and copy its Live client ID and secret.",
    link: { href: "https://developer.paypal.com/dashboard/applications/live", text: "Open PayPal apps" },
    fields: [
      { key: "PAYPAL_CLIENT_ID", label: "Client ID", secret: false },
      { key: "PAYPAL_CLIENT_SECRET", label: "Secret", secret: true },
      { key: "PAYPAL_MODE", label: "Mode", secret: false, optional: true, placeholder: "live — or sandbox for testing" },
    ],
  },
  {
    id: "bank", title: "Bank account via Wise (Finance agent)",
    why: "Lets the Finance agent read your bank balances and statement in every currency through Wise (business or personal). Use a token set to \"Read only\" — it can't move money.",
    link: { href: "https://wise.com/settings/api-tokens", text: "Create a read-only Wise token" },
    fields: [{ key: "WISE_API_TOKEN", label: "Read-only API token", secret: true }],
  },
];

/** Keys that also arrive by OAuth rather than being typed in. */
const SYSTEM_KEYS = ["GOOGLE_REFRESH_TOKEN"];
export const CREDENTIAL_KEYS = new Set([...GROUPS.flatMap(g => g.fields.map(f => f.key)), ...SYSTEM_KEYS]);

// ── Encryption at rest ──

function secretKey() {
  const secret = process.env.APP_SECRET?.trim();
  if (!secret) throw new Error("APP_SECRET is not set; it encrypts every account's keys. Add a long random value to .env.local.");
  return createHash("sha256").update(secret).digest();
}

function encrypt(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString("base64")).join(".");
}

function decrypt(stored: string) {
  const [iv, tag, data] = stored.split(".").map(s => Buffer.from(s, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function table() {
  const db = database();
  db.exec(`CREATE TABLE IF NOT EXISTS credentials (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  )`);
  return db;
}

export function loadCredentials(userId: string): Record<string, string> {
  const rows = table().prepare("SELECT key, value FROM credentials WHERE user_id = ?").all(userId) as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const row of rows) {
    try { out[row.key] = decrypt(row.value); } catch { /* unreadable with this APP_SECRET: treat as unset */ }
  }
  return out;
}

/** Saves the given keys; an empty string removes one. */
export function saveCredentials(userId: string, values: Record<string, string>) {
  const db = table(), now = new Date().toISOString();
  for (const [key, raw] of Object.entries(values)) {
    if (!CREDENTIAL_KEYS.has(key)) continue;
    const value = raw.trim();
    if (!value) db.prepare("DELETE FROM credentials WHERE user_id = ? AND key = ?").run(userId, key);
    else db.prepare("INSERT INTO credentials (user_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(userId, key, encrypt(value), now);
    // Keep the live request in step with what was just saved.
    const ctx = context.getStore();
    if (ctx?.userId === userId) { if (value) ctx.values[key] = value; else delete ctx.values[key]; }
  }
}

// ── The current request's keys ──

type Context = { userId: string; owner: boolean; values: Record<string, string> };
const context = new AsyncLocalStorage<Context>();

/**
 * Called by each route handler right after its login check. It must be the
 * handler itself: a context entered inside an awaited helper does not carry
 * back to the caller, and the request would then see no keys at all.
 */
export function enterUser(userId: string, owner: boolean) {
  context.enterWith({ userId, owner, values: loadCredentials(userId) });
}

export function currentUserId(): string | undefined {
  return context.getStore()?.userId;
}

export function isOwnerRequest(): boolean {
  return context.getStore()?.owner ?? false;
}

/**
 * A key for the current request: the account's own, or for the owner the
 * server's .env.local. With no account entered it returns nothing — failing
 * closed, so a missed route can never fall back to the owner's keys.
 */
export function cred(key: string): string | undefined {
  const ctx = context.getStore();
  if (!ctx) return undefined;
  const own = ctx.values[key];
  if (own) return own;
  return ctx.owner ? process.env[key] : undefined;
}
