import { randomUUID } from "node:crypto";
import { database } from "./db";
import { generateGemini, geminiText } from "./agent/gemini";
import { recallFacts } from "./agent/store";

/**
 * Sarah's memory, per account. Three parts:
 *
 * 1. The conversation itself, saved turn by turn, so a reload, another device
 *    or the next day continues where it left off.
 * 2. Facts: after every exchange a short Gemini pass picks out what is worth
 *    keeping (projects, connections, decisions, designs and logos, people,
 *    preferences, work done) and adds, updates or retires facts.
 * 3. The brief: every request to Gemini starts with those facts, so it knows
 *    them without being told again.
 *
 * Secrets never go in: the extractor is told to skip keys, tokens and
 * passwords, and anything that looks like one is dropped.
 */

export const CATEGORIES = ["profile", "preference", "project", "connection", "decision", "asset", "person", "task", "work"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Memory = { id: string; category: Category; fact: string; source: "auto" | "user"; createdAt: string; updatedAt: string };
export type ChatTurn = { id?: string; role: "user" | "assistant"; content: string; at: string };

const CATEGORY_TITLES: Record<Category, string> = {
  profile: "About them",
  preference: "Preferences and rules they gave you",
  project: "Projects",
  connection: "Accounts, services and computers connected",
  decision: "Decisions made",
  asset: "Designs, logos, files and where they are",
  person: "People and companies",
  task: "Open tasks and follow-ups",
  work: "Work done together recently",
};

const MAX_FACTS = 300;
const BRIEF_FACTS = 120;
const KEEP_TURNS = 400;

function db() {
  const d = database();
  d.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      fact TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'auto',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memories_user ON memories (user_id, updated_at);
    CREATE TABLE IF NOT EXISTS chat_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chat_log_user ON chat_log (user_id, created_at);
    CREATE TABLE IF NOT EXISTS memory_migrated (user_id TEXT PRIMARY KEY);
  `);
  return d;
}

/** Keys, tokens and passwords never go into memory. */
const SECRET = /\b(sk|pk|rk)_(live|test)_|\bAIza[0-9A-Za-z_-]{20,}|\bya29\.|\bEAA[A-Za-z0-9]{20,}|\bghp_[A-Za-z0-9]{20,}|\bxox[abp]-|-----BEGIN|\bpassword\s*[:=]|\b[A-Za-z0-9_-]{40,}\b/i;

type Row = { id: string; category: string; fact: string; source: string; created_at: string; updated_at: string };
const toMemory = (r: Row): Memory => ({ id: r.id, category: (CATEGORIES as readonly string[]).includes(r.category) ? r.category as Category : "work", fact: r.fact, source: r.source === "user" ? "user" : "auto", createdAt: r.created_at, updatedAt: r.updated_at });

/** Facts saved by the old remember tool move across once. */
async function migrate(userId: string) {
  const d = db();
  if (d.prepare("SELECT 1 FROM memory_migrated WHERE user_id = ?").get(userId)) return;
  d.prepare("INSERT OR IGNORE INTO memory_migrated (user_id) VALUES (?)").run(userId);
  const old = await recallFacts(undefined, 500).catch(() => []);
  for (const f of old.reverse()) addMemory(userId, "work", `${f.topic}: ${f.fact}`, "user", f.at);
}

export async function listMemories(userId: string): Promise<Memory[]> {
  await migrate(userId);
  return (db().prepare("SELECT * FROM memories WHERE user_id = ? ORDER BY updated_at DESC").all(userId) as Row[]).map(toMemory);
}

export function addMemory(userId: string, category: Category, fact: string, source: "auto" | "user" = "user", at = new Date().toISOString()): Memory | null {
  const text = fact.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!text || SECRET.test(text)) return null;
  const d = db();
  const same = d.prepare("SELECT * FROM memories WHERE user_id = ? AND lower(fact) = lower(?)").get(userId, text) as Row | undefined;
  if (same) {
    d.prepare("UPDATE memories SET updated_at = ? WHERE id = ?").run(at, same.id);
    return toMemory({ ...same, updated_at: at });
  }
  const id = randomUUID();
  d.prepare("INSERT INTO memories (id, user_id, category, fact, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, userId, category, text, source, at, at);
  // The oldest automatic facts make room; facts the user added are kept.
  const extra = (d.prepare("SELECT count(*) AS n FROM memories WHERE user_id = ?").get(userId) as { n: number }).n - MAX_FACTS;
  if (extra > 0) d.prepare("DELETE FROM memories WHERE id IN (SELECT id FROM memories WHERE user_id = ? AND source = 'auto' ORDER BY updated_at LIMIT ?)").run(userId, extra);
  return { id, category, fact: text, source, createdAt: at, updatedAt: at };
}

export function updateMemory(userId: string, id: string, fact: string) {
  const text = fact.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!text || SECRET.test(text)) return;
  db().prepare("UPDATE memories SET fact = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(text, new Date().toISOString(), id, userId);
}

export function deleteMemory(userId: string, id: string) {
  return db().prepare("DELETE FROM memories WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

/** Facts matching a word or phrase, for the recall tool. */
export async function searchMemories(userId: string, query?: string): Promise<Memory[]> {
  const all = await listMemories(userId);
  if (!query?.trim()) return all.slice(0, 40);
  const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  return all.filter(m => words.some(w => m.fact.toLowerCase().includes(w))).slice(0, 40);
}

// ---------- Conversation ----------

export function logTurn(userId: string, role: "user" | "assistant", content: string) {
  const text = content.trim();
  if (!text) return;
  const d = db();
  d.prepare("INSERT INTO chat_log (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), userId, role, text.slice(0, 8000), new Date().toISOString());
  d.prepare("DELETE FROM chat_log WHERE user_id = ? AND id NOT IN (SELECT id FROM chat_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)").run(userId, userId, KEEP_TURNS);
}

export function recentTurns(userId: string, limit = 40): ChatTurn[] {
  return (db().prepare("SELECT role, content, created_at FROM chat_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit) as { role: string; content: string; created_at: string }[])
    .reverse().map(r => ({ role: r.role === "assistant" ? "assistant" : "user", content: r.content, at: r.created_at }));
}

/** Every saved turn from a time on (inclusive, so none sharing that instant is missed; the app drops ones it has), oldest first, for the desktop app's complete local backup. */
export function turnsSince(userId: string, since: string): ChatTurn[] {
  return (db().prepare("SELECT id, role, content, created_at FROM chat_log WHERE user_id = ? AND created_at >= ? ORDER BY created_at").all(userId, since || "") as { id: string; role: string; content: string; created_at: string }[])
    .map(r => ({ id: r.id, role: r.role === "assistant" ? "assistant" : "user", content: r.content, at: r.created_at }));
}

export function turnCount(userId: string): number {
  return (db().prepare("SELECT count(*) AS n FROM chat_log WHERE user_id = ?").get(userId) as { n: number }).n;
}

/**
 * Puts memory back from the desktop app's backup — only when the server has
 * none for this account (a lost database), so it can never overwrite or
 * duplicate what's there.
 */
export async function restoreMemory(userId: string, facts: Partial<Memory>[], turns: ChatTurn[]): Promise<{ facts: number; turns: number } | null> {
  if ((await listMemories(userId)).length || turnCount(userId)) return null;
  let f = 0, t = 0;
  for (const m of facts.slice(-MAX_FACTS)) {
    const category = (CATEGORIES as readonly string[]).includes(m.category ?? "") ? m.category as Category : "work";
    if (typeof m.fact === "string" && addMemory(userId, category, m.fact, m.source === "auto" ? "auto" : "user", typeof m.updatedAt === "string" ? m.updatedAt : undefined)) f++;
  }
  const d = db();
  for (const turn of turns.slice(-KEEP_TURNS)) {
    if (typeof turn.content !== "string" || !turn.content.trim()) continue;
    t += Number(d.prepare("INSERT OR IGNORE INTO chat_log (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(typeof turn.id === "string" ? turn.id : randomUUID(), userId, turn.role === "assistant" ? "assistant" : "user", turn.content.slice(0, 8000), typeof turn.at === "string" ? turn.at : new Date().toISOString()).changes);
  }
  return { facts: f, turns: t };
}

export function clearConversation(userId: string) {
  db().prepare("DELETE FROM chat_log WHERE user_id = ?").run(userId);
}

// ---------- The brief Gemini starts every chat with ----------

export async function memoryBrief(userId: string, name: string): Promise<string> {
  const facts = (await listMemories(userId)).slice(0, BRIEF_FACTS);
  if (!facts.length) return "";
  const groups = CATEGORIES.map(c => {
    const items = facts.filter(f => f.category === c);
    return items.length ? `${CATEGORY_TITLES[c]}:\n${items.map(f => `- ${f.fact} (${f.updatedAt.slice(0, 10)})`).join("\n")}` : "";
  }).filter(Boolean);
  return `\n\nYOUR MEMORY — what you already know about ${name || "them"} from earlier conversations (newest first; dates are when last confirmed). Use it without being asked, never ask them for something listed here, follow every rule they gave you, and if they correct something, believe them:\n${groups.join("\n\n")}`;
}

// ---------- Learning from each exchange ----------

const LEARN = `You maintain the long-term memory of a personal voice assistant. You get the memory as it is and the latest exchange.
Decide what from the exchange is worth remembering for future conversations: facts about the user and their business, projects and what they are, accounts/services/computers connected or not, decisions, rules and preferences they state ("always use my logo", "reply in English"), designs, logos and files (and where they are, e.g. a Google Drive folder), people and companies, open tasks, and a one-line note of meaningful work done (e.g. "Made an Instagram post design for UNC Exchange KYC, 7 Nov").
Skip small talk, greetings, questions that were simply answered, the weather, and anything temporary. Never store passwords, API keys, tokens or card numbers.
If a new fact replaces or corrects an existing one, update that one instead of adding a duplicate. Remove facts the user says are wrong or no longer true.
Write each fact as one short, self-contained sentence in English, naming things specifically.
Categories: ${CATEGORIES.join(", ")}.
Reply with JSON only: {"add":[{"category":"...","fact":"..."}],"update":[{"id":"...","fact":"..."}],"remove":["id"]}. Use empty lists when nothing is worth keeping — that is the usual case.`;

/** Runs after each exchange, in the background; a failure only means nothing new was learned. */
export async function learnFromTurn(userId: string, userText: string, reply: string) {
  if (userText.trim().length < 6) return;
  try {
    const existing = (await listMemories(userId)).slice(0, 150);
    const memory = existing.map(m => `${m.id} [${m.category}] ${m.fact}`).join("\n") || "(empty)";
    const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const content = await generateGemini(LEARN, [{ role: "user", parts: [{ text: `Today: ${today}\n\nMEMORY:\n${memory}\n\nLATEST EXCHANGE:\nUser: ${userText.slice(0, 4000)}\nAssistant: ${reply.slice(0, 4000)}` }] }], undefined, { json: true });
    const out = JSON.parse(geminiText(content) || "{}") as { add?: { category?: string; fact?: string }[]; update?: { id?: string; fact?: string }[]; remove?: string[] };
    const known = new Set(existing.map(m => m.id));
    for (const a of out.add ?? []) {
      const category = (CATEGORIES as readonly string[]).includes(a.category ?? "") ? a.category as Category : "work";
      if (a.fact) addMemory(userId, category, a.fact, "auto");
    }
    for (const u of out.update ?? []) if (u.id && u.fact && known.has(u.id)) updateMemory(userId, u.id, u.fact);
    // Only automatic facts are removed this way; the user's own stay until they delete them.
    for (const id of out.remove ?? []) if (known.has(id)) db().prepare("DELETE FROM memories WHERE id = ? AND user_id = ? AND source = 'auto'").run(id, userId);
  } catch (err) {
    console.warn("[memory] learn failed:", err instanceof Error ? err.message : err);
  }
}

/** The memory as a readable Markdown file, for the copy kept on the user's computer. */
export async function memoryMarkdown(userId: string, name: string): Promise<string> {
  const facts = await listMemories(userId);
  const lines = [`# ${name || "Assistant"} — memory`, "", `Updated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. This is a copy; edit memory on the Account page.`, ""];
  for (const c of CATEGORIES) {
    const items = facts.filter(f => f.category === c);
    if (!items.length) continue;
    lines.push(`## ${CATEGORY_TITLES[c]}`, "", ...items.map(f => `- ${f.fact} _(${f.updatedAt.slice(0, 10)})_`), "");
  }
  const turns = recentTurns(userId, 30);
  if (turns.length) {
    lines.push("## Recent conversation", "");
    for (const t of turns) lines.push(`**${t.role === "user" ? "You" : name || "Assistant"}** (${t.at.slice(0, 16).replace("T", " ")}): ${t.content.replace(/\n+/g, " ")}`, "");
  }
  return lines.join("\n");
}
