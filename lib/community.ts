import { randomUUID } from "node:crypto";
import { database } from "./db";

/**
 * Community posts: anyone can read them, signed-in users write them. Bodies
 * are plain text (paragraphs split on blank lines) and rendered as text, so a
 * post can never inject markup or scripts into the page.
 */

export type Post = { id: string; slug: string; title: string; body: string; author: string; authorId: string; authorIsAdmin: boolean; createdAt: string };

// Web addresses: with a scheme, starting www., or a bare domain on a common
// ending. File names like Node.js or page.tsx aren't caught (js/ts aren't listed).
const LINK = /\b(?:https?:\/\/|ftp:\/\/|www\.)\S+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|ai|app|dev|xyz|info|biz|me|tv|gg|ly|link|site|online|store|shop|tech|pro|live|blog|news|us|uk|pk|in|ae|sa|ca|au|de|fr|ru|cn|top|click|club|vip|win|bet|cc|ws|to|su)\b(?:\/\S*)?/gi;

/** The links in a post, for refusing them from anyone but the admin. */
export function findLinks(text: string): string[] {
  return [...new Set(text.match(LINK) ?? [])].slice(0, 5);
}

function table() {
  const db = database();
  db.exec(`CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  return db;
}

type Row = { id: string; slug: string; title: string; body: string; author: string; author_role: string; user_id: string; created_at: string };
const toPost = (r: Row): Post => ({ id: r.id, slug: r.slug, title: r.title, body: r.body, author: r.author, authorId: r.user_id, authorIsAdmin: r.author_role === "owner", createdAt: r.created_at });
const SELECT = "SELECT p.id, p.slug, p.title, p.body, p.user_id, p.created_at, u.display_name AS author, u.role AS author_role FROM posts p JOIN users u ON u.id = p.user_id";

export function listPosts(limit = 50): Post[] {
  return (table().prepare(`${SELECT} ORDER BY p.created_at DESC LIMIT ?`).all(limit) as Row[]).map(toPost);
}

export function getPost(slug: string): Post | null {
  const row = table().prepare(`${SELECT} WHERE p.slug = ?`).get(slug) as Row | undefined;
  return row ? toPost(row) : null;
}

export function createPost(userId: string, title: string, body: string): Post {
  const base = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "post";
  const slug = `${base}-${randomUUID().slice(0, 6)}`;
  const id = randomUUID(), now = new Date().toISOString();
  table().prepare("INSERT INTO posts (id, user_id, slug, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, userId, slug, title, body, now);
  return getPost(slug)!;
}

/** Authors can delete their own posts; the owner can remove any. */
export function deletePost(id: string, userId: string, isOwner: boolean): boolean {
  const db = table();
  const row = db.prepare("SELECT user_id FROM posts WHERE id = ?").get(id) as { user_id: string } | undefined;
  if (!row || (row.user_id !== userId && !isOwner)) return false;
  db.prepare("DELETE FROM posts WHERE id = ?").run(id);
  return true;
}
