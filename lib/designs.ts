import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { database } from "./db";
import { SITE_URL } from "./seo";

/**
 * Pictures the Design agent made, kept so they can be posted. Instagram and
 * Facebook fetch a post's picture from a public link, so each design gets one:
 * /media/<long random id>.jpg, unguessable and never listed anywhere. Files
 * live in the account's own folder, so deleting the account removes them.
 *
 * An account may also upload its brand logo. It is stamped onto post designs
 * as uploaded, because an image model asked to draw a logo redraws it.
 */

export type Design = { id: string; prompt: string; createdAt: string; url: string; branded: boolean };

const KEEP = 60;
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

function db() {
  const d = database();
  d.exec(`
    CREATE TABLE IF NOT EXISTS designs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      branded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS designs_user ON designs (user_id, created_at);
  `);
  return d;
}

const clean = (s: string) => s.replace(/[^a-zA-Z0-9-]/g, "");
const userDir = (userId: string) => path.join(process.cwd(), "data", "users", clean(userId));
const designFile = (userId: string, id: string) => path.join(userDir(userId), "designs", `${clean(id)}.jpg`);
const logoFile = (userId: string) => path.join(userDir(userId), "brand-logo.png");

export const designUrl = (id: string) => `${SITE_URL}/media/${id}.jpg`;

type Row = { id: string; prompt: string; branded: number; created_at: string };
const toDesign = (r: Row): Design => ({ id: r.id, prompt: r.prompt, branded: !!r.branded, createdAt: r.created_at, url: designUrl(r.id) });

// ---------- Brand logo ----------

export async function hasLogo(userId: string) {
  return stat(logoFile(userId)).then(() => true, () => false);
}

/** Saves the logo as a PNG, keeping its transparency. */
export async function saveLogo(userId: string, bytes: Uint8Array) {
  if (bytes.length > MAX_LOGO_BYTES) throw new Error("The logo must be under 5 MB.");
  let png: Buffer;
  try {
    png = await sharp(bytes).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch { throw new Error("That file isn't a picture (use PNG, JPG, WebP or SVG)."); }
  await mkdir(userDir(userId), { recursive: true });
  await writeFile(logoFile(userId), png);
}

export async function removeLogo(userId: string) {
  await rm(logoFile(userId), { force: true });
}

export async function readLogo(userId: string) {
  return readFile(logoFile(userId)).catch(() => null);
}

/** Post-style requests get the brand logo; asking for a new logo, or editing a photo, does not. */
export function wantsBrandLogo(instruction: string, fromPhoto: boolean) {
  if (fromPhoto) return false;
  if (/\b(no|without)\s+(the\s+|my\s+|our\s+)?logo\b/i.test(instruction)) return false;
  if (/\b(make|create|design|draw|generate)\s+(me\s+)?(a|an|the|new)?\s*(new\s+)?logo\b/i.test(instruction)) return false;
  return /\b(post|poster|banner|flyer|ad|ads|advert|advertisement|creative|story|stories|reel|thumbnail|campaign|social|instagram|facebook|twitter|linkedin|tiktok|youtube|brand|branded|logo|unc|announcement|promo)\b/i.test(instruction);
}

/** What the image model is told so the real logo can go on afterwards. */
export const LOGO_SPACE_NOTE = " Do not draw any logo, emblem or brand mark anywhere in the picture, and keep the bottom-right corner plain so a logo can be placed there afterwards.";

/** The logo, exactly as uploaded, in the bottom-right corner at 18% of the picture's width. */
async function stampLogo(image: Buffer, logo: Buffer) {
  const base = sharp(image);
  const { width = 1024, height = 1024 } = await base.metadata();
  const size = Math.round(Math.min(width, height) * 0.18);
  const margin = Math.round(size * 0.22);
  const mark = await sharp(logo).resize(size, size, { fit: "inside" }).png().toBuffer();
  const m = await sharp(mark).metadata();
  return base.composite([{ input: mark, left: width - (m.width ?? size) - margin, top: height - (m.height ?? size) - margin }])
    .jpeg({ quality: 90 }).toBuffer();
}

// ---------- Designs ----------

/**
 * Saves a finished picture (a data URL from the image model), stamping the
 * brand logo when asked. Returns the saved design and the final image.
 */
export async function saveDesign(userId: string, prompt: string, dataUrl: string, withLogo: boolean): Promise<{ design: Design; image: string }> {
  const m = /^data:image\/[a-z+]+;base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("The picture came back in an unexpected format.");
  let bytes: Buffer = Buffer.from(m[1], "base64");
  const logo = withLogo ? await readLogo(userId) : null;
  bytes = logo ? await stampLogo(bytes, logo) : await sharp(bytes).jpeg({ quality: 90 }).toBuffer();

  const id = randomBytes(18).toString("hex");
  await mkdir(path.dirname(designFile(userId, id)), { recursive: true });
  await writeFile(designFile(userId, id), bytes);
  const createdAt = new Date().toISOString();
  const d = db();
  d.prepare("INSERT INTO designs (id, user_id, prompt, branded, created_at) VALUES (?, ?, ?, ?, ?)").run(id, userId, prompt.slice(0, 500), logo ? 1 : 0, createdAt);

  // Only the latest designs are kept.
  const old = d.prepare("SELECT id FROM designs WHERE user_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?").all(userId, KEEP) as { id: string }[];
  for (const o of old) {
    await rm(designFile(userId, o.id), { force: true });
    d.prepare("DELETE FROM designs WHERE id = ?").run(o.id);
  }
  return { design: { id, prompt, branded: !!logo, createdAt, url: designUrl(id) }, image: `data:image/jpeg;base64,${bytes.toString("base64")}` };
}

export function listDesigns(userId: string, limit = 10): Design[] {
  return (db().prepare("SELECT id, prompt, branded, created_at FROM designs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit) as Row[]).map(toDesign);
}

/** This account's design by id, or its latest one for "latest". */
export function findDesign(userId: string, id: string): Design | null {
  const r = (id === "latest" || !id
    ? db().prepare("SELECT id, prompt, branded, created_at FROM designs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(userId)
    : db().prepare("SELECT id, prompt, branded, created_at FROM designs WHERE id = ? AND user_id = ?").get(clean(id), userId)) as Row | undefined;
  return r ? toDesign(r) : null;
}

export async function readDesignFile(userId: string, id: string) {
  return readFile(designFile(userId, id)).catch(() => null);
}

/** For the public link: the file behind an id, whoever owns it. */
export async function publicDesign(id: string) {
  const r = db().prepare("SELECT user_id FROM designs WHERE id = ?").get(clean(id)) as { user_id: string } | undefined;
  return r ? readDesignFile(r.user_id, id) : null;
}
