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
    CREATE TABLE IF NOT EXISTS work_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS work_sessions_user ON work_sessions (user_id, updated_at);
  `);
  // Each turn belongs to the task (work session) it was about.
  if (!(d.prepare("PRAGMA table_info(chat_log)").all() as { name: string }[]).some(c => c.name === "session_id")) {
    d.exec("ALTER TABLE chat_log ADD COLUMN session_id TEXT");
  }
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
  d.prepare("INSERT INTO chat_log (id, user_id, role, content, created_at, session_id) VALUES (?, ?, ?, ?, ?, ?)").run(randomUUID(), userId, role, text.slice(0, 8000), new Date().toISOString(), currentSession(userId)?.id ?? null);
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

// ---------- Work sessions: one per task ----------
//
// Every task the user starts (fix the website, a D-Med literature design, a
// trading question) gets its own session: a title, a running summary, and
// the conversation turns that belong to it. Sarah's context is the current
// session's conversation, so an unrelated new job doesn't drag the last one
// along; earlier tasks stay listed and can be picked up again. Sessions are
// decided after each exchange, in the same background pass that learns
// facts, so they add no wait before Sarah answers.

export type WorkSession = { id: string; title: string; summary: string; createdAt: string; updatedAt: string };
type SessionRow = { id: string; title: string; summary: string; created_at: string; updated_at: string };
const toSession = (r: SessionRow): WorkSession => ({ id: r.id, title: r.title, summary: r.summary, createdAt: r.created_at, updatedAt: r.updated_at });
const KEEP_SESSIONS = 60;

/** The task being worked on now: the most recently active session. */
export function currentSession(userId: string): WorkSession | null {
  const r = db().prepare("SELECT id, title, summary, created_at, updated_at FROM work_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1").get(userId) as SessionRow | undefined;
  return r ? toSession(r) : null;
}

export function listSessions(userId: string, limit = 12): WorkSession[] {
  return (db().prepare("SELECT id, title, summary, created_at, updated_at FROM work_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?").all(userId, limit) as SessionRow[]).map(toSession);
}

function startSession(userId: string, title: string, summary: string, turnIds: string[]): WorkSession {
  const d = db(), now = new Date().toISOString(), id = randomUUID();
  d.prepare("INSERT INTO work_sessions (id, user_id, title, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, userId, title.slice(0, 120), summary.slice(0, 1200), now, now);
  for (const t of turnIds) d.prepare("UPDATE chat_log SET session_id = ? WHERE id = ? AND user_id = ?").run(id, t, userId);
  const old = d.prepare("SELECT id FROM work_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT -1 OFFSET ?").all(userId, KEEP_SESSIONS) as { id: string }[];
  for (const o of old) d.prepare("DELETE FROM work_sessions WHERE id = ?").run(o.id);
  return { id, title, summary, createdAt: now, updatedAt: now };
}

function touchSession(userId: string, id: string, title: string | undefined, summary: string | undefined, turnIds: string[]) {
  const d = db(), now = new Date().toISOString();
  d.prepare("UPDATE work_sessions SET title = COALESCE(?, title), summary = COALESCE(?, summary), updated_at = ? WHERE id = ? AND user_id = ?")
    .run(title?.trim() ? title.slice(0, 120) : null, summary?.trim() ? summary.slice(0, 1200) : null, now, id, userId);
  for (const t of turnIds) d.prepare("UPDATE chat_log SET session_id = ? WHERE id = ? AND user_id = ?").run(id, t, userId);
}

/** The last exchange's turn ids (user and assistant), newest last. */
function lastExchange(userId: string): string[] {
  return (db().prepare("SELECT id FROM chat_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 2").all(userId) as { id: string }[]).map(r => r.id);
}

/**
 * How many of the latest chat messages belong to the current task, for
 * trimming the context; at least a few so a reply to a short question
 * still has what it answers.
 */
export function sessionTurnCount(userId: string): number {
  const cur = currentSession(userId);
  if (!cur) return 30;
  const rows = db().prepare("SELECT session_id FROM chat_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 60").all(userId) as { session_id: string | null }[];
  let n = 0;
  for (const r of rows) { if (r.session_id !== cur.id) break; n++; }
  return Math.max(n, 4);
}

function sessionBrief(userId: string): string {
  const [cur, ...others] = listSessions(userId, 8);
  if (!cur) return "";
  const day = (iso: string) => iso.slice(0, 10);
  const lines = [`\n\nCURRENT TASK (what this conversation is about now): ${cur.title}${cur.summary ? ` — ${cur.summary}` : ""} (started ${day(cur.createdAt)})`];
  if (others.length) lines.push(`OTHER RECENT TASKS — separate work; don't mix their details into the current task unless the user refers back to one (then use its summary, or recall for more):\n${others.map(o => `- ${o.title}${o.summary ? `: ${o.summary}` : ""} (last ${day(o.updatedAt)})`).join("\n")}`);
  return lines.join("\n");
}

// ---------- The brief Gemini starts every chat with ----------

export async function memoryBrief(userId: string, name: string): Promise<string> {
  const facts = (await listMemories(userId)).slice(0, BRIEF_FACTS);
  if (!facts.length) return sessionBrief(userId);
  const groups = CATEGORIES.map(c => {
    const items = facts.filter(f => f.category === c);
    return items.length ? `${CATEGORY_TITLES[c]}:\n${items.map(f => `- ${f.fact} (${f.updatedAt.slice(0, 10)})`).join("\n")}` : "";
  }).filter(Boolean);
  return `\n\nYOUR MEMORY — what you already know about ${name || "them"} from earlier conversations (newest first; dates are when last confirmed). Use it without being asked, never ask them for something listed here, follow every rule they gave you, and if they correct something, believe them:\n${groups.join("\n\n")}${sessionBrief(userId)}`;
}

// ---------- Learning from each exchange ----------

const LEARN = `You maintain the long-term memory of a personal voice assistant. You get the memory as it is and the latest exchange.
Decide what from the exchange is worth remembering for future conversations: facts about the user and their business, projects and what they are, accounts/services/computers connected or not, decisions, rules and preferences they state ("always use my logo", "reply in English"), designs, logos and files (and where they are, e.g. a Google Drive folder), people and companies, open tasks, and a one-line note of meaningful work done (e.g. "Made an Instagram post design for UNC Exchange KYC, 7 Nov").
Skip small talk, greetings, questions that were simply answered, the weather, and anything temporary. Never store passwords, API keys, tokens or card numbers.
If a new fact replaces or corrects an existing one, update that one instead of adding a duplicate. Remove facts the user says are wrong or no longer true.
Write each fact as one short, self-contained sentence in English, naming things specifically.
Categories: ${CATEGORIES.join(", ")}.
Reply with JSON only: {"add":[{"category":"...","fact":"..."}],"update":[{"id":"...","fact":"..."}],"remove":["id"],"task":{...}}. Use empty lists when nothing is worth keeping — that is the usual case.

You also keep track of which TASK the conversation is about. You get the current task and other recent ones. Set "task" to one of:
- {"action":"same","summary":"..."} — the exchange continues the current task, or is small talk / a quick question. Give an updated summary only when something meaningful changed (what the task is, what was decided or done, what is left), in at most 3 sentences; otherwise omit summary.
- {"action":"new","title":"...","summary":"..."} — the user started work unrelated to the current task (a different project, product, problem or goal). Title: 2–6 words naming it specifically ("D-Med box literature design", "Fix login bug on localhost"). Follow-ups, corrections, "still not working", "make it bigger" are NOT new.
- {"action":"resume","id":"...","summary":"..."} — the user went back to one of the other recent tasks (use its id).
With no current task yet, use "new" for anything that is real work, "same" for small talk.`;

/** Runs after each exchange, in the background; a failure only means nothing new was learned. */
export async function learnFromTurn(userId: string, userText: string, reply: string) {
  if (userText.trim().length < 6) return;
  try {
    const existing = (await listMemories(userId)).slice(0, 150);
    const memory = existing.map(m => `${m.id} [${m.category}] ${m.fact}`).join("\n") || "(empty)";
    const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const [cur, ...others] = listSessions(userId, 8);
    const tasks = `CURRENT TASK: ${cur ? `${cur.id} — ${cur.title}: ${cur.summary || "(no summary yet)"}` : "(none yet)"}\nOTHER RECENT TASKS:\n${others.map(o => `${o.id} — ${o.title}: ${o.summary}`).join("\n") || "(none)"}`;
    const content = await generateGemini(LEARN, [{ role: "user", parts: [{ text: `Today: ${today}\n\nMEMORY:\n${memory}\n\n${tasks}\n\nLATEST EXCHANGE:\nUser: ${userText.slice(0, 4000)}\nAssistant: ${reply.slice(0, 4000)}` }] }], undefined, { json: true });
    const out = JSON.parse(geminiText(content) || "{}") as { add?: { category?: string; fact?: string }[]; update?: { id?: string; fact?: string }[]; remove?: string[]; task?: { action?: string; id?: string; title?: string; summary?: string } };
    const task = out.task, turns = lastExchange(userId);
    if (task?.action === "new" && task.title?.trim()) startSession(userId, task.title.trim(), task.summary?.trim() ?? "", turns);
    else if (task?.action === "resume" && task.id && others.some(o => o.id === task.id)) touchSession(userId, task.id, undefined, task.summary, turns);
    else if (cur) touchSession(userId, cur.id, undefined, task?.summary, []);
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
