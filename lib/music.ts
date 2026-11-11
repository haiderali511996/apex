import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { database } from "./db";

/**
 * Each account's own background music. Files live in that account's folder
 * (data/users/<id>/music), so deleting the account removes them too, and they
 * are only ever served to the account that uploaded them.
 */

export type Track = { id: string; name: string; size: number; createdAt: string };

export const MAX_TRACK_BYTES = 15 * 1024 * 1024;
export const MAX_TRACKS = 30;
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

function db() {
  const d = database();
  d.exec(`
    CREATE TABLE IF NOT EXISTS music_tracks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS music_tracks_user ON music_tracks (user_id);
  `);
  return d;
}

const musicDir = (userId: string) => path.join(process.cwd(), "data", "users", userId.replace(/[^a-zA-Z0-9-]/g, ""), "music");
export const trackFile = (userId: string, id: string) => path.join(musicDir(userId), `${id.replace(/[^a-zA-Z0-9-]/g, "")}.mp3`);

type Row = { id: string; name: string; size: number; created_at: string };

export function listTracks(userId: string): Track[] {
  return (db().prepare("SELECT id, name, size, created_at FROM music_tracks WHERE user_id = ? ORDER BY created_at").all(userId) as Row[])
    .map(r => ({ id: r.id, name: r.name, size: r.size, createdAt: r.created_at }));
}

/** The track if it belongs to this account. */
export function getTrack(userId: string, id: string): Track | null {
  const r = db().prepare("SELECT id, name, size, created_at FROM music_tracks WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  return r ? { id: r.id, name: r.name, size: r.size, createdAt: r.created_at } : null;
}

/** MP3s start with an ID3 tag or an MPEG audio frame header. */
export function looksLikeMp3(bytes: Uint8Array) {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true; // "ID3"
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

/** Saves one upload; the error says why it was refused. */
export async function addTrack(userId: string, fileName: string, bytes: Uint8Array): Promise<Track> {
  if (bytes.length > MAX_TRACK_BYTES) throw new Error(`${fileName} is over ${MAX_TRACK_BYTES / 1024 / 1024} MB.`);
  if (!looksLikeMp3(bytes)) throw new Error(`${fileName} isn't an MP3 file.`);
  const existing = listTracks(userId);
  if (existing.length >= MAX_TRACKS) throw new Error(`You can keep up to ${MAX_TRACKS} tracks — delete one first.`);
  if (existing.reduce((sum, t) => sum + t.size, 0) + bytes.length > MAX_TOTAL_BYTES) throw new Error(`Your music is limited to ${MAX_TOTAL_BYTES / 1024 / 1024} MB in total.`);
  const id = randomUUID(), now = new Date().toISOString();
  const name = fileName.replace(/\.mp3$/i, "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80) || "Track";
  await mkdir(musicDir(userId), { recursive: true });
  await writeFile(trackFile(userId, id), bytes);
  db().prepare("INSERT INTO music_tracks (id, user_id, name, size, created_at) VALUES (?, ?, ?, ?, ?)").run(id, userId, name, bytes.length, now);
  return { id, name, size: bytes.length, createdAt: now };
}

export async function deleteTrack(userId: string, id: string): Promise<boolean> {
  const res = db().prepare("DELETE FROM music_tracks WHERE id = ? AND user_id = ?").run(id, userId);
  if (!Number(res.changes)) return false;
  await rm(trackFile(userId, id), { force: true });
  return true;
}

export async function trackSize(userId: string, id: string) {
  return (await stat(trackFile(userId, id))).size;
}
