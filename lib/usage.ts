import { database } from "./db";
import { getSubscription, type User } from "./auth";
import { limitsFor } from "./plans";

/**
 * Voice minutes per calendar month (UTC): seconds of speech transcribed plus
 * seconds of speech generated. The owner has no limit.
 */

/** How fast the voices talk, for estimating the length of generated speech. */
const SPOKEN_CHARS_PER_SECOND = 14;

function table() {
  const db = database();
  db.exec(`CREATE TABLE IF NOT EXISTS usage (
    user_id TEXT NOT NULL,
    month TEXT NOT NULL,
    voice_seconds REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, month)
  )`);
  return db;
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

export function voiceUsage(user: User) {
  const row = table().prepare("SELECT voice_seconds FROM usage WHERE user_id = ? AND month = ?").get(user.id, thisMonth()) as { voice_seconds: number } | undefined;
  const usedMinutes = (row?.voice_seconds ?? 0) / 60;
  const limitMinutes = user.role === "owner" ? Infinity : limitsFor(getSubscription(user).plan).voiceMinutes;
  return { usedMinutes, limitMinutes, left: limitMinutes - usedMinutes };
}

/** null when there is time left, otherwise the message to show. */
export function voiceLimitReached(user: User): string | null {
  const { left, limitMinutes } = voiceUsage(user);
  return left > 0 ? null : `You've used all ${limitMinutes} voice minutes on your plan this month. Typing still works — or upgrade on the Account page for more.`;
}

export function addVoiceSeconds(user: User, seconds: number) {
  if (user.role === "owner" || !(seconds > 0)) return;
  table().prepare("INSERT INTO usage (user_id, month, voice_seconds) VALUES (?, ?, ?) ON CONFLICT(user_id, month) DO UPDATE SET voice_seconds = voice_seconds + excluded.voice_seconds")
    .run(user.id, thisMonth(), seconds);
}

export const spokenSeconds = (text: string) => text.length / SPOKEN_CHARS_PER_SECOND;
