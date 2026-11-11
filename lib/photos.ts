import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { database } from "./db";
import { SITE_URL } from "./seo";

/**
 * Photos and screenshots the user shows Sarah: taken with the camera, or
 * attached, pasted or dropped on the deck. Sarah looks at them, and hands
 * them to an agent: the Developer (Claude Code downloads them into the
 * project and views them), or a specialist.
 *
 * The Developer runs on the user's own computer, so it fetches each photo
 * from a link: /media/shot/<36 random hex>.jpg, unguessable, never listed, not
 * indexed, and dead after a week. Files live in the account's own folder, so
 * deleting the account removes them.
 */

export type Photo = { id: string; note: string; createdAt: string; url: string };

const KEEP = 40;
const LINK_DAYS = 7;
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

function db() {
  const d = database();
  d.exec(`
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS photos_user ON photos (user_id, created_at);
  `);
  return d;
}

const clean = (s: string) => s.replace(/[^a-zA-Z0-9-]/g, "");
const photoFile = (userId: string, id: string) => path.join(process.cwd(), "data", "users", clean(userId), "photos", `${clean(id)}.jpg`);
export const photoUrl = (id: string) => `${SITE_URL}/media/shot/${id}.jpg`;

type Row = { id: string; note: string; created_at: string };
const toPhoto = (r: Row): Photo => ({ id: r.id, note: r.note, createdAt: r.created_at, url: photoUrl(r.id) });

/** Saves a photo (any common image format) as a JPEG up to 1600 px, so text on a screen stays readable. */
export async function savePhoto(userId: string, bytes: Uint8Array, note = ""): Promise<Photo> {
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error("That picture is too big (12 MB at most).");
  let jpeg: Buffer;
  try {
    jpeg = await sharp(bytes).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer();
  } catch { throw new Error("That file isn't a picture (use PNG, JPG, WebP or HEIC)."); }
  const id = randomBytes(18).toString("hex");
  await mkdir(path.dirname(photoFile(userId, id)), { recursive: true });
  await writeFile(photoFile(userId, id), jpeg);
  const createdAt = new Date().toISOString();
  const d = db();
  d.prepare("INSERT INTO photos (id, user_id, note, created_at) VALUES (?, ?, ?, ?)").run(id, userId, note.slice(0, 300), createdAt);
  // Only the latest are kept.
  const old = d.prepare("SELECT id FROM photos WHERE user_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?").all(userId, KEEP) as { id: string }[];
  for (const o of old) {
    await rm(photoFile(userId, o.id), { force: true });
    d.prepare("DELETE FROM photos WHERE id = ?").run(o.id);
  }
  return { id, note, createdAt, url: photoUrl(id) };
}

/** This account's photo by id, or its newest for "latest" ("latest:2" is handled by the caller). */
export function findPhoto(userId: string, id: string): Photo | null {
  const r = (id === "latest" || !id
    ? db().prepare("SELECT id, note, created_at FROM photos WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(userId)
    : db().prepare("SELECT id, note, created_at FROM photos WHERE id = ? AND user_id = ?").get(clean(id), userId)) as Row | undefined;
  return r ? toPhoto(r) : null;
}

export function latestPhotos(userId: string, n: number): Photo[] {
  return (db().prepare("SELECT id, note, created_at FROM photos WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, n) as Row[]).map(toPhoto);
}

/** Resolves ids ("latest", "latest:3" or ids) to this account's photos. Unknown ids are an error. */
export function pickPhotos(userId: string, ids: unknown): Photo[] {
  const wanted = Array.isArray(ids) ? ids.map(String).map(s => s.trim()).filter(Boolean) : typeof ids === "string" && ids.trim() ? [ids.trim()] : [];
  const out: Photo[] = [];
  for (const id of wanted) {
    const many = /^latest:(\d+)$/.exec(id);
    if (many) { out.push(...latestPhotos(userId, Math.min(Number(many[1]), 6))); continue; }
    const p = findPhoto(userId, id);
    if (!p) throw new Error(id === "latest" ? "No photo has been shown yet. Ask the user to attach one, or take one with show_photo." : `Photo ${id} wasn't found.`);
    out.push(p);
  }
  return [...new Map(out.map(p => [p.id, p])).values()].slice(0, 6);
}

export async function readPhoto(userId: string, id: string) {
  return readFile(photoFile(userId, id)).catch(() => null);
}

/** For the link the Developer downloads from: the file behind an id, while it's under a week old. */
export async function publicPhoto(id: string) {
  const r = db().prepare("SELECT user_id, created_at FROM photos WHERE id = ?").get(clean(id)) as { user_id: string; created_at: string } | undefined;
  if (!r || Date.now() - Date.parse(r.created_at) > LINK_DAYS * 86_400_000) return null;
  return readPhoto(r.user_id, id);
}

