import { promises as fs, existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { getProjectNames, saveProjectName } from "./store";

/**
 * Sarah's Developer: the Claude Code installed on this Mac, driven through the
 * Claude Agent SDK. Sarah hands it questions about the user's projects; it
 * reads and searches the code and reports back.
 *
 * Questions are read-only by construction — the session is only given Read,
 * Glob and Grep. Tasks that run commands or change files (git pull, tests, a
 * fix) only run after Haider approves them in the UI, and then get Claude
 * Code's full tools in that one project. It only works inside
 * folders Claude Code has already been used in, or in Claude Code's own saved
 * chats (~/.claude/projects), to answer questions about past conversations.
 *
 * It runs on the Claude Code login (subscription), never on API credits: the
 * API key in .env.local is withheld from the subprocess.
 */

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const READ_ONLY_TOOLS = ["Read", "Glob", "Grep"];
/** For approved tasks: the terminal and file editing, but no sub-agents. */
const TASK_TOOLS = ["Bash", "Read", "Edit", "Write", "Glob", "Grep", "NotebookEdit", "WebFetch", "WebSearch", "TodoWrite"];
const MAX_REPLY_CHARS = 6000;
const QUESTION_TIMEOUT_MS = 4 * 60 * 1000;
const TASK_TIMEOUT_MS = 10 * 60 * 1000;

/** `source` says how a project was found: Claude Code has worked in it, or it was found on the Mac. */
export type Project = { name: string; path: string; lastActive: string; source: "claude-code" | "mac" };

const HOME = os.homedir();
/** Where code projects usually live; searched two levels deep. */
const SEARCH_ROOTS = ["", "Desktop", "Documents", "Downloads", "Projects", "projects", "Developer", "code", "Code", "dev", "src", "repos", "GitHub", "workspace"];
/** Folders never worth searching. */
const SKIP = new Set(["Library", "Applications", "Movies", "Music", "Pictures", "Public", "node_modules", "dist", "build", "vendor", "Pods"]);
/** Any of these makes a folder a code project. */
const MARKERS = [".git", "package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod", "pubspec.yaml", "Gemfile", "composer.json", "pom.xml", "build.gradle", "CLAUDE.md"];

let scanned: { at: number; projects: Project[] } | null = null;

/**
 * Every code project on this Mac, most recently active first: the ones Claude
 * Code has worked in, plus project folders found in the usual places.
 */
export async function listProjects(): Promise<Project[]> {
  if (scanned && Date.now() - scanned.at < 60_000) return scanned.projects;
  const merged = new Map<string, Project>();
  for (const project of await scanMac()) merged.set(project.path, project);
  // Claude Code's own record wins: it knows when the project was last worked on.
  for (const project of await claudeCodeProjects()) merged.set(project.path, project);
  const projects = [...merged.values()].sort((a, b) => b.lastActive.localeCompare(a.lastActive));
  scanned = { at: Date.now(), projects };
  return projects;
}

/**
 * Projects Claude Code has worked in. Each folder under ~/.claude/projects
 * holds that project's session logs, which record the real working directory
 * (the folder name itself is a lossy encoding of it).
 */
async function claudeCodeProjects(): Promise<Project[]> {
  let dirs: string[];
  try {
    dirs = await fs.readdir(PROJECTS_DIR);
  } catch {
    return [];
  }
  const found = new Map<string, Project>();
  for (const dir of dirs) {
    const full = path.join(PROJECTS_DIR, dir);
    let sessions: { file: string; mtime: number }[];
    try {
      const files = (await fs.readdir(full)).filter((f) => f.endsWith(".jsonl"));
      sessions = await Promise.all(files.map(async (f) => ({ file: path.join(full, f), mtime: (await fs.stat(path.join(full, f))).mtimeMs })));
    } catch {
      continue;
    }
    sessions.sort((a, b) => b.mtime - a.mtime);
    for (const session of sessions.slice(0, 3)) {
      const cwd = await readCwd(session.file);
      // Claude Code's own folders are not projects (Sarah's chat search ran there).
      if (!cwd || !existsSync(cwd) || cwd.startsWith(path.join(HOME, ".claude"))) continue;
      const lastActive = new Date(session.mtime).toISOString();
      const prior = found.get(cwd);
      if (!prior || prior.lastActive < lastActive) found.set(cwd, { name: path.basename(cwd), path: cwd, lastActive, source: "claude-code" });
      break;
    }
  }
  return [...found.values()];
}

/** Project folders in the usual places, two levels deep, not descending into a project once found. */
async function scanMac(): Promise<Project[]> {
  const found: Project[] = [];
  const seen = new Set<string>();
  const visit = async (dir: string, depth: number) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (seen.has(full)) continue;
      seen.add(full);
      const project = await asProject(full);
      if (project) found.push(project);
      else if (depth > 1) await visit(full, depth - 1);
    }
  };
  for (const root of SEARCH_ROOTS) {
    const dir = path.join(HOME, root);
    if (existsSync(dir)) await visit(dir, root ? 2 : 1);
  }
  return found;
}

/** The folder as a project if it has a project marker; last active from git or the folder itself. */
async function asProject(dir: string): Promise<Project | null> {
  if (!MARKERS.some((m) => existsSync(path.join(dir, m)))) return null;
  const times = await Promise.all([dir, path.join(dir, ".git", "index"), path.join(dir, ".git", "HEAD")].map((f) => fs.stat(f).then((st) => st.mtimeMs, () => 0)));
  return { name: path.basename(dir), path: dir, lastActive: new Date(Math.max(...times)).toISOString(), source: "mac" };
}

/** The working directory recorded near the top of a session log. */
async function readCwd(file: string): Promise<string | null> {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const match = buffer.toString("utf8", 0, bytesRead).match(/"cwd":"((?:[^"\\]|\\.)*)"/);
    return match ? JSON.parse(`"${match[1]}"`) : null;
  } finally {
    await handle.close();
  }
}

/** Spoken names drift ("UNC chatrix", "chat rix"): compare letters and digits only. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Finds a project by path, folder name, or a partial name. Where several
 * folders share a name, the most recently active wins and the others are
 * named. A path inside the home folder works even if it wasn't found.
 */
export async function resolveProject(nameOrPath: string): Promise<(Project & { alsoAt?: string[] }) | { error: string }> {
  const wanted = nameOrPath.trim().replace(/^~(?=\/|$)/, HOME);
  if (path.isAbsolute(wanted)) {
    const full = path.resolve(wanted);
    const inside = path.relative(HOME, full);
    // Inside home, not in a hidden folder such as ~/.ssh.
    if (inside.startsWith("..") || inside.split(path.sep).some((part) => part.startsWith("."))) return { error: "I can only open project folders inside your home folder, not hidden or system ones." };
    if (!existsSync(full)) return { error: `There's no folder at ${full}.` };
    return (await asProject(full)) ?? { name: path.basename(full), path: full, lastActive: new Date().toISOString(), source: "mac" };
  }
  const key = squash(wanted);
  // A name Haider has taught Sarah wins over any guess.
  const saved = (await getProjectNames())[key];
  if (saved && existsSync(saved.path)) return (await asProject(saved.path)) ?? { name: saved.name, path: saved.path, lastActive: new Date().toISOString(), source: "mac" };

  const projects = await listProjects();
  if (!projects.length) return { error: "I couldn't find any code projects on this Mac." };
  const named = projects.filter((p) => squash(p.name) === key);
  const contained = projects.filter((p) => { const n = squash(p.name); return n.length > 2 && (n.includes(key) || key.includes(n)); });
  // Last resort: any shared word ("Lifemed Live" → every lifemed folder).
  const words = wanted.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const sharing = projects.filter((p) => words.some((w) => squash(p.name).includes(w)));
  const matches = named.length ? named : contained.length ? contained : sharing;
  if (!matches.length) return { error: `No project called "${nameOrPath}" on this Mac. Found: ${projects.slice(0, 15).map((p) => p.name).join(", ")}. If it's somewhere else, ask Haider for its folder path.` };
  const distinct = new Set(matches.map((p) => squash(p.name)));
  if (distinct.size > 1) {
    return { error: `"${nameOrPath}" could be ${matches.slice(0, 8).map((p) => `${p.name} (${p.path.replace(HOME, "~")})`).join(", ")}. Ask Haider which one, then save his answer with name_project.` };
  }
  // Already sorted most recent first.
  const [best, ...rest] = matches;
  return rest.length ? { ...best, alsoAt: rest.map((p) => p.path) } : best;
}

/** Teaches Sarah what Haider calls a project, so the name resolves straight to its folder next time. */
export async function nameProject(name: string, target: string): Promise<string> {
  const project = await resolveProject(target);
  if ("error" in project) return project.error;
  await saveProjectName(squash(name), name, project.path);
  return `Saved: "${name}" is ${project.path.replace(HOME, "~")}.`;
}

/**
 * The Claude Code executable to drive. The copy bundled with the SDK can fail
 * macOS's signature check and be killed, so prefer a signed install: an
 * explicit path, then the VS Code extension's, then `claude` on the PATH.
 */
function claudeExecutable(): string | undefined {
  const configured = process.env.IMEX_CLAUDE_CODE_PATH?.trim();
  if (configured) return configured;
  const extensions = path.join(os.homedir(), ".vscode", "extensions");
  try {
    const installs = readdirSync(extensions).filter((d) => d.startsWith("anthropic.claude-code-")).sort().reverse();
    for (const install of installs) {
      const binary = path.join(extensions, install, "resources", "native-binary", "claude");
      if (existsSync(binary)) return binary;
    }
  } catch {
    // no VS Code extensions folder
  }
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const binary = path.join(dir, "claude");
    if (dir && existsSync(binary)) return binary;
  }
  return undefined;
}

const PROJECT_BRIEF =
  "You are the Developer agent inside Sarah, Haider's personal assistant. Sarah relays your answer, often read aloud. " +
  "You can read and search this project but not change it — if asked to change something, explain exactly what you would change and where. " +
  "Read CLAUDE.md or README first when it helps. Answer directly and concisely, naming files as path:line.";

const CHATS_BRIEF =
  "You are the Developer agent inside Sarah, Haider's personal assistant, answering questions about his past Claude Code chats. " +
  "This folder is Claude Code's chat history. Each subfolder is one project, named after its path with / turned into - . " +
  "Each .jsonl file is one chat; every line is a JSON event with a timestamp — \"type\":\"user\" lines are Haider's messages and \"type\":\"assistant\" lines are the replies. " +
  "Files can be very large: use Grep to find what's relevant, then Read only those parts. " +
  "Say which project and date each finding comes from. Never repeat API keys, tokens or passwords that appear in a chat. " +
  "Answer directly and concisely; Sarah relays it, often aloud.";

const TASK_BRIEF =
  "You are the Developer agent inside Sarah, Haider's personal assistant. Haider approved this exact task through Sarah; do it now, in this project, with the terminal and file tools. " +
  "Do only what the task asks. Don't push, force-push, delete branches, deploy, or remove files beyond the task unless it explicitly says to. " +
  "If something could lose work — uncommitted changes in the way, merge conflicts, a failing migration — stop and report it instead of forcing it through. " +
  "Git rule: before any git push, first run git pull on that branch (fetch and integrate the remote changes the way the project does, merge or rebase) and make sure it still builds; if the pull brings conflicts, stop and report them instead of pushing or forcing. " +
  "Finish with a short report Sarah can read aloud: the first sentence says what happened, then the commands you ran and anything Haider should know.";

/** Hands one question about a project to Claude Code and returns its answer. */
export function askDeveloper(project: Project, task: string): Promise<string> {
  return runClaudeCode(project.path, task, PROJECT_BRIEF, false);
}

/** Searches or summarizes Haider's saved Claude Code chats, across every project. */
export function askAboutChats(task: string): Promise<string> {
  if (!existsSync(PROJECTS_DIR)) return Promise.resolve("There are no saved Claude Code chats on this Mac yet.");
  return runClaudeCode(PROJECTS_DIR, task, CHATS_BRIEF, false);
}

/**
 * Runs a task that may use the terminal or change files. Only call this for a
 * task Haider has approved; it is reached through an approved pending action.
 */
export function runDeveloperTask(folder: string, task: string): Promise<string> {
  if (!existsSync(folder)) return Promise.reject(new Error(`The project folder ${folder} no longer exists.`));
  return runClaudeCode(folder, task, TASK_BRIEF, true);
}

async function runClaudeCode(cwd: string, task: string, brief: string, act: boolean): Promise<string> {
  // Withhold the API key so the run uses the Claude Code login, not API credits.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  const abortController = new AbortController();
  const timeout = act ? TASK_TIMEOUT_MS : QUESTION_TIMEOUT_MS;
  const timer = setTimeout(() => abortController.abort(), timeout);
  try {
    const run = query({
      prompt: task,
      options: {
        cwd,
        env,
        abortController,
        pathToClaudeCodeExecutable: claudeExecutable(),
        // A question gets only read tools, so nothing can change; an approved task gets the terminal too.
        tools: act ? TASK_TOOLS : READ_ONLY_TOOLS,
        allowedTools: act ? TASK_TOOLS : READ_ONLY_TOOLS,
        // Don't load the project's settings or hooks; it can still read its CLAUDE.md.
        settingSources: [],
        // Sarah's lookups stay out of Claude Code's chat history.
        persistSession: false,
        systemPrompt: { type: "preset", preset: "claude_code", append: brief },
        model: process.env.IMEX_DEVELOPER_MODEL?.trim() || "sonnet",
        maxTurns: act ? 60 : 30,
      },
    });
    let reply = "";
    for await (const message of run) {
      if (message.type !== "result") continue;
      if (message.subtype !== "success") throw new Error(`Claude Code stopped: ${message.subtype}`);
      reply = message.result;
    }
    reply = reply.trim() || "(Claude Code returned no answer.)";
    return reply.length > MAX_REPLY_CHARS ? `${reply.slice(0, MAX_REPLY_CHARS)}\n…(cut short)` : reply;
  } catch (err) {
    if (abortController.signal.aborted) throw new Error(`Claude Code took longer than ${timeout / 60000} minutes, so I stopped it. ${act ? "Check the project before retrying — it may have done part of the task." : "Try a narrower question."}`);
    throw new Error(describeDeveloperError(err));
  } finally {
    clearTimeout(timer);
  }
}

function describeDeveloperError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/SIGKILL/.test(raw)) return "macOS stopped Claude Code from running. Set IMEX_CLAUDE_CODE_PATH in .env.local to a signed Claude Code install.";
  if (/ENOENT|spawn/i.test(raw)) return "Couldn't start Claude Code on this Mac. Install the Claude Code extension or CLI, or set IMEX_CLAUDE_CODE_PATH.";
  if (/login|auth|unauthor|credential/i.test(raw)) return "Claude Code isn't signed in. Open Claude Code once and sign in, then try again.";
  return `Claude Code error: ${raw}`;
}
