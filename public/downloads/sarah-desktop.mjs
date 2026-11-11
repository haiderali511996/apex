#!/usr/bin/env node
/**
 * Sarah Desktop — links this computer to your assistant account.
 *
 *   node sarah-desktop.mjs pair <CODE> --server https://your-sarah-site
 *   node sarah-desktop.mjs            (keep it running; it waits for commands)
 *   node sarah-desktop.mjs unpair
 *
 * Runs on macOS, Windows and Linux with Node.js 18 or newer, no installs.
 * It connects out to your account and asks for work, so no ports are opened.
 * It only performs the fixed actions below; quitting apps, restarting and
 * scripts are only ever sent after you approve them in the app.
 */

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile, rm, readdir, stat, mkdir, open as openFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const CONFIG = path.join(os.homedir(), ".sarah-desktop.json");
const PLATFORM = process.platform; // darwin | win32 | linux
export const OS_NAME = { darwin: "macOS", win32: "Windows", linux: "Linux" }[PLATFORM] || PLATFORM;

const sh = async (file, args = [], timeout = 20_000) => (await run(file, args, { timeout, windowsHide: true, maxBuffer: 4_000_000 })).stdout.trim();
const osascript = (script, args = []) => sh("osascript", ["-e", script, ...args]);
const powershell = (script) => sh("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
/** Quotes a value for a PowerShell single-quoted string. */
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ── Chrome profiles ──

function chromeDir() {
  if (PLATFORM === "darwin") return path.join(os.homedir(), "Library/Application Support/Google/Chrome");
  if (PLATFORM === "win32") return path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/User Data");
  return path.join(os.homedir(), ".config/google-chrome");
}

async function chromeProfiles() {
  const state = JSON.parse(await readFile(path.join(chromeDir(), "Local State"), "utf8"));
  return Object.entries(state.profile?.info_cache ?? {}).map(([dir, p]) => ({ dir, name: p.name || dir, email: p.user_name || "" }));
}

async function resolveProfile(spoken) {
  const q = spoken.trim().toLowerCase(), all = await chromeProfiles();
  const exact = all.filter(p => [p.dir, p.name, p.email].some(v => v.toLowerCase() === q));
  const hits = exact.length ? exact : all.filter(p => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q));
  if (hits.length === 1) return hits[0];
  const list = (hits.length ? hits : all).map(p => `${p.name}${p.email ? ` (${p.email})` : ""}`).join("; ");
  throw new Error(hits.length ? `More than one Chrome profile matches "${spoken}": ${list}.` : `No Chrome profile matches "${spoken}". Profiles: ${list}.`);
}

function chromeBinary() {
  if (PLATFORM === "win32") {
    for (const base of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]) {
      const p = base && path.join(base, "Google/Chrome/Application/chrome.exe");
      if (p && existsSync(p)) return p;
    }
    return "chrome.exe";
  }
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    for (const dir of (process.env.PATH || "").split(":")) if (existsSync(path.join(dir, name))) return name;
  }
  return "google-chrome";
}

// ── Actions ──

// ── Developer: Claude Code on this computer ──
// Sarah's Developer agent is the Claude Code installed here. Questions are
// read-only (Read, Glob, Grep). Tasks that change files or run commands only
// arrive after the user approved them in the app. It runs on the user's own
// Claude Code login; any API key in the environment is withheld.

const HOME = os.homedir();
const CLAUDE_PROJECTS = path.join(HOME, ".claude", "projects");
const SEARCH_ROOTS = ["", "Desktop", "Documents", "Downloads", "Projects", "projects", "Developer", "code", "Code", "dev", "src", "repos", "GitHub", "workspace", "source/repos"];
const SKIP = new Set(["Library", "Applications", "Movies", "Music", "Pictures", "Public", "node_modules", "dist", "build", "vendor", "Pods", "AppData"]);
const MARKERS = [".git", "package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod", "pubspec.yaml", "Gemfile", "composer.json", "pom.xml", "build.gradle", "CLAUDE.md"];
const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The PATH a terminal gets. Apps opened from the Dock or Start menu get a
 * bare one, so without this Claude Code couldn't find docker, node, npm,
 * python or brew and couldn't run or check the user's project.
 */
let terminalPath = null;
async function fullPath() {
  if (terminalPath) return terminalPath;
  const parts = [];
  if (PLATFORM !== "win32") {
    // An interactive login shell reads .zprofile and .zshrc, where nvm, pyenv and friends set PATH.
    const out = await sh(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf "__PATH__%s__PATH__" "$PATH"'], 15_000).catch(() => "");
    const m = /__PATH__(.*?)__PATH__/s.exec(out);
    if (m) parts.push(...m[1].split(":"));
    parts.push("/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", path.join(HOME, ".docker", "bin"), "/Applications/Docker.app/Contents/Resources/bin", path.join(HOME, ".local", "bin"));
  }
  parts.push(...(process.env.PATH || "").split(PLATFORM === "win32" ? ";" : ":"));
  terminalPath = [...new Set(parts.filter(Boolean))].join(PLATFORM === "win32" ? ";" : ":");
  return terminalPath;
}

/**
 * Developer tasks continue the same Claude Code conversation per project,
 * so "it's still broken" builds on what was already tried. A task marked
 * fresh (new, unrelated work) starts a new one.
 */
const SESSIONS = path.join(HOME, ".sarah-desktop-sessions.json");
const SESSION_HOURS = 12;
async function loadSessions() { try { return JSON.parse(await readFile(SESSIONS, "utf8")); } catch { return {}; } }
async function lastSession(dir) {
  const s = (await loadSessions())[dir];
  return s && Date.now() - s.at < SESSION_HOURS * 3_600_000 ? s.id : null;
}
async function keepSession(dir, id) {
  const all = await loadSessions();
  all[dir] = { id, at: Date.now() };
  await writeFile(SESSIONS, JSON.stringify(all, null, 2), { mode: 0o600 }).catch(() => {});
}

/** The Claude Code program: on the PATH, a standard install, or the one inside the VS Code / Cursor extension. */
async function claudeBinary() {
  const exe = PLATFORM === "win32" ? "claude.exe" : "claude";
  const found = [];
  if (process.env.CLAUDE_PATH) found.push(process.env.CLAUDE_PATH);
  // Apps opened from the Dock or Start menu don't get the terminal's PATH, so ask a login shell.
  if (PLATFORM === "win32") found.push(...(await sh("where.exe", ["claude"]).then(t => t.split(/\r?\n/), () => [])));
  else found.push(await sh(process.env.SHELL || "/bin/zsh", ["-lc", "command -v claude"]).catch(() => ""));
  found.push(path.join(HOME, ".local", "bin", exe), path.join(HOME, ".claude", "local", exe), "/opt/homebrew/bin/claude", "/usr/local/bin/claude");
  if (PLATFORM === "win32") found.push(path.join(process.env.APPDATA || "", "npm", "claude.cmd"));
  for (const dir of [".vscode", ".vscode-insiders", ".cursor", ".windsurf"]) {
    const ext = path.join(HOME, dir, "extensions");
    const installs = await readdir(ext).then(d => d.filter(n => n.startsWith("anthropic.claude-code-")).sort().reverse(), () => []);
    for (const i of installs) found.push(path.join(ext, i, "resources", "native-binary", exe));
  }
  return found.map(f => f && f.trim()).find(f => f && existsSync(f)) || null;
}

/** The working folder recorded near the top of a Claude Code session log. */
async function sessionCwd(file) {
  const handle = await openFile(file, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const m = buffer.toString("utf8", 0, bytesRead).match(/"cwd":"((?:[^"\\]|\\.)*)"/);
    return m ? JSON.parse(`"${m[1]}"`) : null;
  } finally { await handle.close(); }
}

async function asProject(dir) {
  if (!MARKERS.some(m => existsSync(path.join(dir, m)))) return null;
  const times = await Promise.all([dir, path.join(dir, ".git", "index"), path.join(dir, ".git", "HEAD")].map(f => stat(f).then(s => s.mtimeMs, () => 0)));
  return { name: path.basename(dir), path: dir, lastActive: Math.max(...times), claude: false };
}

/** Code projects here, most recently active first: the ones Claude Code worked in, plus project folders in the usual places. */
async function codeProjects() {
  const found = new Map();
  const visit = async (dir, depth) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const project = await asProject(full);
      if (project) found.set(full, project);
      else if (depth > 1) await visit(full, depth - 1);
    }
  };
  for (const root of SEARCH_ROOTS) {
    const dir = path.join(HOME, root);
    if (existsSync(dir)) await visit(dir, root ? 2 : 1);
  }
  for (const d of await readdir(CLAUDE_PROJECTS).catch(() => [])) {
    const full = path.join(CLAUDE_PROJECTS, d);
    const sessions = await readdir(full).then(f => f.filter(n => n.endsWith(".jsonl")), () => []);
    const dated = await Promise.all(sessions.map(async f => ({ file: path.join(full, f), t: await stat(path.join(full, f)).then(s => s.mtimeMs, () => 0) })));
    dated.sort((a, b) => b.t - a.t);
    for (const s of dated.slice(0, 3)) {
      const cwd = await sessionCwd(s.file).catch(() => null);
      if (!cwd || !existsSync(cwd) || cwd.startsWith(path.join(HOME, ".claude"))) continue;
      const prior = found.get(cwd);
      found.set(cwd, { name: path.basename(cwd), path: cwd, lastActive: Math.max(s.t, prior?.lastActive ?? 0), claude: true });
      break;
    }
  }
  return [...found.values()].sort((a, b) => b.lastActive - a.lastActive);
}

const tilde = (p) => p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p;

/** A project by folder path or (part of) its name; the error lists what exists. */
async function findProject(wanted) {
  const asked = String(wanted || "").trim().replace(/^~(?=[\\/]|$)/, HOME);
  if (!asked) throw new Error("Which project?");
  if (path.isAbsolute(asked)) {
    const full = path.resolve(asked);
    const inside = path.relative(HOME, full);
    if (inside.startsWith("..") || inside.split(path.sep).some(part => part.startsWith("."))) throw new Error("Only project folders inside the home folder can be opened.");
    if (!existsSync(full)) throw new Error(`There's no folder at ${tilde(full)}.`);
    return { name: path.basename(full), path: full };
  }
  const projects = await codeProjects();
  const key = squash(asked);
  const words = asked.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  const exact = projects.filter(p => squash(p.name) === key);
  const partial = projects.filter(p => { const n = squash(p.name); return n.length > 2 && (n.includes(key) || key.includes(n)); });
  const sharing = projects.filter(p => words.some(w => squash(p.name).includes(w)));
  const matches = exact.length ? exact : partial.length ? partial : sharing;
  if (!matches.length) throw new Error(`No project called "${wanted}" on ${os.hostname()}. Found: ${projects.slice(0, 15).map(p => p.name).join(", ") || "none"}. Give the folder path if it's elsewhere.`);
  if (new Set(matches.map(p => squash(p.name))).size > 1) throw new Error(`"${wanted}" could be ${matches.slice(0, 8).map(p => `${p.name} (${tilde(p.path)})`).join(", ")}. Which one?`);
  return matches[0];
}

/** A tool call as one line of progress, like Claude Code shows it. */
function stepLabel(name, input = {}, cwd = "") {
  const rel = (f) => { const r = path.relative(cwd, String(f || "")); return r && !r.startsWith("..") ? r : tilde(String(f || "")); };
  const cut = (t, n = 90) => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  switch (name) {
    case "Bash": return input.description ? cut(input.description) : `Running ${cut(input.command, 80)}`;
    case "Read": return `Reading ${rel(input.file_path)}`;
    case "Edit": case "MultiEdit": return `Editing ${rel(input.file_path)}`;
    case "Write": return `Writing ${rel(input.file_path)}`;
    case "NotebookEdit": return `Editing ${rel(input.notebook_path)}`;
    case "Glob": return `Finding files ${cut(input.pattern, 60)}`;
    case "Grep": return `Searching for "${cut(input.pattern, 60)}"`;
    case "WebSearch": return `Searching the web: ${cut(input.query, 70)}`;
    case "WebFetch": { try { return `Reading ${new URL(input.url).host}`; } catch { return "Reading a web page"; } }
    default: return name;
  }
}

/**
 * Runs Claude Code in a folder with a prompt on stdin (no shell quoting
 * involved) and returns its answer. Its live events are turned into progress
 * — the to-do list and each step, running, done or failed — and passed to
 * onProgress, which the app forwards so the user watches the work happen.
 */
async function runClaude(cwd, prompt, tools, act, timeoutMs, onProgress, opts = {}) {
  const bin = await claudeBinary();
  if (!bin) throw new Error(`Claude Code isn't installed on ${os.hostname()}. Install it from https://claude.com/claude-code, sign in once by running "claude" in a terminal, then ask again.`);
  const env = { ...process.env, PATH: await fullPath() };
  delete env.ANTHROPIC_API_KEY;
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--allowedTools", tools.join(","), ...(act ? ["--permission-mode", "acceptEdits"] : []), ...(opts.resume ? ["--resume", opts.resume] : [])];
  const progress = { steps: [], todos: [], note: "" };
  const byId = new Map();
  const report = () => { try { onProgress?.(progress); } catch { /* progress is best effort */ } };
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, windowsHide: true, shell: /\.cmd$/i.test(bin) });
    let buffer = "", err = "", final = null, failed = false, plain = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Claude Code took longer than ${Math.round(timeoutMs / 60000)} minutes and was stopped.`)); }, timeoutMs);
    const onEvent = (e) => {
      if (e.type === "assistant") {
        for (const block of e.message?.content ?? []) {
          if (block.type === "text" && block.text?.trim()) progress.note = block.text.trim().slice(0, 300);
          if (block.type !== "tool_use" || block.name === "ToolSearch") continue;
          if (block.name === "TodoWrite") { progress.todos = (block.input?.todos ?? []).map(t => ({ content: t.content, activeForm: t.activeForm, status: t.status })); continue; }
          const step = { label: stepLabel(block.name, block.input, cwd), status: "running" };
          progress.steps.push(step); byId.set(block.id, step);
          if (progress.steps.length > 60) progress.steps.splice(0, progress.steps.length - 60);
        }
        report();
      } else if (e.type === "user") {
        for (const block of e.message?.content ?? []) {
          const step = block?.type === "tool_result" ? byId.get(block.tool_use_id) : null;
          if (step) step.status = block.is_error ? "failed" : "done";
        }
        report();
      } else if (e.type === "result") {
        if (e.session_id) opts.onSession?.(e.session_id);
        final = typeof e.result === "string" ? e.result : "";
        failed = !!e.is_error;
        // The answer is in. Servers Claude Code started in the background
        // (npm run dev…) keep its output open, so waiting for that to close
        // could take forever: finish now if it hasn't exited in a few seconds.
        setTimeout(() => settle(0), 5000);
      }
    };
    child.stdout.on("data", d => {
      buffer += d;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try { onEvent(JSON.parse(line)); } catch { plain += `${line}\n`; }
      }
    });
    child.stderr.on("data", d => { err += d; });
    child.on("error", e => { if (done) return; done = true; clearTimeout(timer); reject(e); });
    let done = false;
    const settle = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // Stop listening; anything still holding the output open is left running.
      child.stdout.removeAllListeners("data"); child.stderr.removeAllListeners("data");
      child.stdout.destroy(); child.stderr.destroy();
      const text = (final ?? "").trim();
      if (code === 0 && text && !failed) return resolve(text.length > 7000 ? `${text.slice(0, 7000)}\n…(cut short)` : text);
      const why = (err || text || plain).trim();
      reject(new Error(/login|log in|authenticate|api key/i.test(why) ? `Claude Code on ${os.hostname()} isn't signed in. Run "claude" in a terminal once and sign in.` : `Claude Code stopped: ${why.slice(0, 600) || `exit code ${code}`}`));
    };
    // "exit" fires when Claude Code itself ends, even if its output is still held open.
    child.on("exit", code => setTimeout(() => settle(code ?? 0), 300));
    child.on("close", code => settle(code ?? 0));
    child.stdin.end(prompt);
  });
}

const DEV_BRIEF = "You are the Developer agent inside the user's voice assistant, which relays your answer, often aloud. Answer directly and concisely, naming files as path:line.";
const ASK_BRIEF = `${DEV_BRIEF} You can read and search this project but not change it; if asked to change something, explain exactly what you would change and where. Read CLAUDE.md or README first when it helps.`;
const CHATS_BRIEF = `${DEV_BRIEF} This folder is Claude Code's chat history: each subfolder is a project (its path with / turned into -), each .jsonl file one chat, each line a JSON event with a timestamp ("type":"user" lines are the user's messages). Files can be large: Grep first, then Read only what's relevant. Say which project and date each finding is from. Never repeat keys, tokens or passwords.`;
const VERIFY_BRIEF = `How to work, so the fix is real:
1. Find out how this project runs before changing anything: read CLAUDE.md / README, package.json scripts, docker-compose files and .env.example. If it runs in Docker, check it with docker compose ps and docker compose logs --tail=200 <service>; otherwise find the dev servers and their ports (lsof -iTCP -sTCP:LISTEN -n -P).
2. Reproduce the problem first on the user's running local setup (curl the localhost URL or API, read the container or server logs, run the failing test or build), so you know the real error, not a guess.
3. Fix the root cause, not the symptom. Keep the change as small as it can be.
4. Apply it where it runs: restart or rebuild only the affected service (docker compose up -d --build <service>, or restart its dev server); run database migrations the project defines if the fix needs them. Never run docker compose down -v, delete volumes, drop or reset databases, or kill processes you didn't start.
5. Verify on localhost the same way you reproduced it, and run the project's lint, type check and tests that cover the change. If it still fails, keep going: read the new error and fix again.
6. Databases and content in Docker: the database usually lives inside a container, so a command run on the host can't reach it (or reaches an empty local one). Read the compose file and .env to see which service holds the database and which connection URL the app uses; run migrations, seeds, scripts and SQL inside the right container (docker compose exec <app-service> npm run …, or docker compose exec <db-service> psql/mysql …). "Table/schema doesn't exist" means migrations haven't run there: run the project's own migration command (prisma migrate deploy / db push, drizzle, typeorm, knex, sequelize, django migrate, artisan migrate…), never a reset. To add content (blog posts, products, pages), use the app's own way: its API, admin endpoints, ORM or seed script, filling every required field (slug, author, status/published, dates, images) the way existing rows do; then open the page on localhost and confirm each item shows. For many items, make and check them one by one, and report how many exist at the end.
7. Report honestly: say "verified" only for what you actually checked and saw working, with the command and its result; if you couldn't verify or finish, say exactly what is left and why.`;

const TASK_BRIEF = `${DEV_BRIEF} The user approved this exact task; do it now in this project with the terminal and file tools. Do only what it asks. Don't push, force-push, delete branches, deploy, or remove files beyond the task unless it says so. If something could lose work (uncommitted changes in the way, conflicts, a failing migration), stop and report instead of forcing it. Git rule: before any git push, first run git pull on that branch (fetch and integrate the remote changes the way the project does, merge or rebase) and make sure it still builds; if the pull brings conflicts, stop and report them instead of pushing or forcing. Finish with a short report: first sentence says what happened, then the commands you ran.`;

// ── Music helpers ──

/** The first YouTube video for a search, from the public results page. */
async function youtubeFirst(query) {
  const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en`, { headers: { "accept-language": "en", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" }, signal: AbortSignal.timeout(15_000) });
  const html = await res.text();
  return /"videoRenderer":\{"videoId":"([\w-]{11})"/.exec(html)?.[1] ?? /"videoId":"([\w-]{11})"/.exec(html)?.[1] ?? null;
}

/** Presses a media key on Windows (0xB3 play/pause, 0xB0 next, 0xB1 previous); Chrome answers it while it plays. */
async function mediaKeyWindows(vk) {
  await powershell(`$s='[DllImport("user32.dll")] public static extern void keybd_event(byte b,byte s,uint f,UIntPtr e);'; $k=Add-Type -MemberDefinition $s -Name K -Namespace W -PassThru; $k::keybd_event(${vk},0,0,[UIntPtr]::Zero); $k::keybd_event(${vk},0,2,[UIntPtr]::Zero)`);
}

const MUSIC_TABS = "youtube.com|music.youtube.com|spotify.com|soundcloud.com|deezer.com|music.apple.com|gaana.com|jiosaavn.com|wynk.in|tidal.com|pandora.com";
const JS_OFF = "Chrome blocks this until a one-time setting is on: in Chrome's menu bar choose View → Developer → Allow JavaScript from Apple Events. Then ask again.";

/** Runs JavaScript in every Chrome tab with music; returns how many tabs answered "yes". */
async function inMusicTabs(js) {
  const out = await osascript(`on run argv
    set pat to item 1 of argv
    set js to item 2 of argv
    set n to 0
    if application "Google Chrome" is not running then return "0"
    tell application "Google Chrome"
      repeat with w in windows
        repeat with t in tabs of w
          set u to URL of t
          set hit to false
          set AppleScript's text item delimiters to "|"
          repeat with p in text items of pat
            if u contains (p as text) then set hit to true
          end repeat
          if hit then
            set r to execute t javascript js
            if r is "yes" then set n to n + 1
          end if
        end repeat
      end repeat
    end tell
    return n as text
  end run`, [MUSIC_TABS, js]);
  return Number(out) || 0;
}

async function chromeMac(js, done, none) {
  try {
    return (await inMusicTabs(js)) ? done : none;
  } catch (err) {
    if (/JavaScript through AppleScript is turned off|Allow JavaScript from Apple Events/i.test(String(err?.message))) throw new Error(JS_OFF);
    throw err;
  }
}

async function chromeMusicPause(stop = false) {
  const js = `(()=>{let n=0;document.querySelectorAll('video,audio').forEach(m=>{if(!m.paused){m.pause();n++}});return n?'yes':'no'})()`;
  if (PLATFORM === "darwin") {
    const said = await chromeMac(js, stop ? "Stopped the music in Chrome." : "Paused the music in Chrome.", "Nothing is playing in Chrome.");
    return said;
  }
  if (PLATFORM === "win32") { await mediaKeyWindows(0xB3); return "Paused Chrome (pressed play/pause)."; }
  await sh("playerctl", ["-p", "chromium,chrome", "pause"]);
  return "Paused the music in Chrome.";
}

async function chromeMusicResume() {
  const js = `(()=>{const m=[...document.querySelectorAll('video,audio')].find(m=>m.paused&&m.currentTime>0);if(!m)return 'no';m.play();return 'yes'})()`;
  if (PLATFORM === "darwin") return chromeMac(js, "Playing again in Chrome.", "Nothing paused in Chrome to resume — say what to play.");
  if (PLATFORM === "win32") { await mediaKeyWindows(0xB3); return "Resumed Chrome (pressed play/pause)."; }
  await sh("playerctl", ["-p", "chromium,chrome", "play"]);
  return "Playing again in Chrome.";
}

async function chromeMusicNext() {
  const js = `(()=>{const b=document.querySelector('.ytp-next-button, ytmusic-player-bar .next-button, [data-testid=control-button-skip-forward]');if(!b)return 'no';b.click();return 'yes'})()`;
  if (PLATFORM === "darwin") return chromeMac(js, "Next song in Chrome.", "There's no next song in Chrome.");
  if (PLATFORM === "win32") { await mediaKeyWindows(0xB0); return "Next song."; }
  await sh("playerctl", ["-p", "chromium,chrome", "next"]);
  return "Next song.";
}

/** Apps the user has open (not the desktop app itself or the system's own), for shutting down. */
async function userAppPids() {
  if (PLATFORM !== "darwin") return [];
  const out = await osascript(`tell application "System Events" to get unix id of every application process whose background only is false`).catch(() => "");
  const keep = new Set([process.pid, process.ppid]);
  return out.split(/,\s*/).map(Number).filter(n => n > 1 && !keep.has(n));
}

export const ACTIONS = {
  async open_app({ name }) {
    if (!name) throw new Error("Which app?");
    if (PLATFORM === "darwin") await sh("open", ["-a", name]);
    else if (PLATFORM === "win32") await powershell(`Start-Process ${psq(name)}`);
    else await sh("gtk-launch", [name]).catch(() => run(name, [], { detached: true }));
    return `Opened ${name}.`;
  },

  async open_url({ url, chrome_profile }) {
    const target = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    if (!/^https?:\/\//i.test(target)) throw new Error("Only web addresses can be opened.");
    if (chrome_profile) {
      const profile = await resolveProfile(chrome_profile);
      const flag = `--profile-directory=${profile.dir}`;
      if (PLATFORM === "darwin") await sh("open", ["-na", "Google Chrome", "--args", flag, target]);
      else if (PLATFORM === "win32") await powershell(`Start-Process ${psq(chromeBinary())} -ArgumentList ${psq(flag)},${psq(target)}`);
      else run(chromeBinary(), [flag, target], { detached: true }).catch(() => {});
      return `Opened ${target} in Chrome as ${profile.name}.`;
    }
    if (PLATFORM === "darwin") await sh("open", [target]);
    else if (PLATFORM === "win32") await powershell(`Start-Process ${psq(target)}`);
    else await sh("xdg-open", [target]);
    return `Opened ${target}.`;
  },

  async list_chrome_profiles() {
    return (await chromeProfiles()).map(p => `${p.name}${p.email ? ` — ${p.email}` : ""}`).join("\n") || "No Chrome profiles found.";
  },

  async list_apps() {
    if (PLATFORM === "darwin") {
      return osascript(`tell application "System Events" to set openApps to name of every application process whose background only is false
        set AppleScript's text item delimiters to ", "
        return openApps as text`);
    }
    if (PLATFORM === "win32") return powershell("(Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -ExpandProperty ProcessName -Unique | Sort-Object) -join ', '");
    try { return (await sh("wmctrl", ["-l"])).split("\n").map(l => l.split(/\s+/).slice(3).join(" ")).filter(Boolean).join(", "); }
    catch { return "Install wmctrl to list open windows (sudo apt install wmctrl)."; }
  },

  async set_volume({ level }) {
    const v = String(level).toLowerCase();
    if (PLATFORM === "darwin") {
      if (v === "mute" || v === "unmute") await osascript(`set volume output muted ${v === "mute"}`);
      else await osascript(`on run argv
        set volume output muted false
        set volume output volume ((item 1 of argv) as integer)
      end run`, [String(Math.max(0, Math.min(100, Number(v))))]);
    } else if (PLATFORM === "win32") {
      // Windows has no built-in volume command: press the volume keys.
      if (v === "mute" || v === "unmute") await powershell("(New-Object -ComObject WScript.Shell).SendKeys([char]173)");
      else {
        const steps = Math.round(Math.max(0, Math.min(100, Number(v))) / 2);
        await powershell(`$s = New-Object -ComObject WScript.Shell; 1..50 | % { $s.SendKeys([char]174) }; 1..${Math.max(1, steps)} | % { $s.SendKeys([char]175) }`);
      }
    } else {
      if (v === "mute" || v === "unmute") await sh("pactl", ["set-sink-mute", "@DEFAULT_SINK@", v === "mute" ? "1" : "0"]);
      else await sh("pactl", ["set-sink-volume", "@DEFAULT_SINK@", `${Math.max(0, Math.min(100, Number(v)))}%`]);
    }
    return v === "mute" || v === "unmute" ? `${v[0].toUpperCase()}${v.slice(1)}d.` : `Volume set to ${v}%.`;
  },

  // The computer's own music apps (Apple Music, Spotify; on Windows and Linux
  // the system's play/pause). Chrome is chrome_music.
  async media({ action, query }) {
    if (!["play", "pause", "next", "previous"].includes(action)) throw new Error("media action must be play, pause, next or previous.");
    if (PLATFORM === "darwin") {
      const running = async (app) => (await osascript(`application "${app}" is running`).catch(() => "false")) === "true";
      const verb = { play: "play", pause: "pause", next: "next track", previous: "previous track" }[action];
      if (action === "play" && query) {
        // A song, artist or album from the Music library.
        const out = await osascript(`on run argv
          set q to item 1 of argv
          tell application "Music"
            set hits to (every track of library playlist 1 whose name contains q or artist contains q or album contains q)
            if hits is {} then return "none"
            play item 1 of hits
            return (name of item 1 of hits) & " by " & (artist of item 1 of hits)
          end tell
        end run`, [query]).catch(() => "none");
        if (out !== "none") return `Playing ${out} in Music.`;
        if (await running("Spotify")) { await osascript(`tell application "Spotify" to play`); return `"${query}" isn't in the Music library, so I resumed Spotify.`; }
        return `"${query}" isn't in the Music library on this computer. Say "play ${query}" (without "from my laptop") and I'll play it in Chrome.`;
      }
      const apps = [];
      for (const app of ["Spotify", "Music"]) if (await running(app)) apps.push(app);
      if (!apps.length && action === "play") { await osascript(`tell application "Music" to play`); return "Playing your Music library."; }
      for (const app of apps) await osascript(`tell application "${app}" to ${verb}`);
      return apps.length ? `${{ play: "Playing", pause: "Paused", next: "Skipped to the next track in", previous: "Back a track in" }[action]} ${apps.join(" and ")}.` : "No music app is playing on this computer.";
    }
    const key = { play: 0xB3, pause: 0xB3, next: 0xB0, previous: 0xB1 }[action];
    if (PLATFORM === "win32") { await mediaKeyWindows(key); return action === "play" || action === "pause" ? "Pressed play/pause." : "Skipped."; }
    await sh("playerctl", [action === "previous" ? "previous" : action]);
    return action === "play" ? "Playing." : action === "pause" ? "Paused." : "Skipped.";
  },

  /**
   * YouTube in Chrome, only when asked for: play opens a new tab with the
   * title in YouTube's search bar and plays the top video; pause, resume,
   * next and stop control what Chrome is playing.
   */
  async chrome_music({ action, query }) {
    if (action === "play") {
      const q = String(query || "").trim();
      if (!q) throw new Error("Which video? Say its title.");
      // A new tab with the title in YouTube's search bar, then the top video plays.
      const search = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
      const id = await youtubeFirst(q).catch(() => null);
      await chromeMusicPause().catch(() => {}); // one thing at a time
      if (PLATFORM === "darwin") {
        await osascript(`on run argv
          tell application "Google Chrome"
            activate
            if (count of windows) is 0 then make new window
            tell front window to make new tab with properties {URL:item 1 of argv}
          end tell
        end run`, [search]);
        if (id) {
          await new Promise(r => setTimeout(r, 3500));
          // Clicking the result keeps the title in the search bar; without
          // Chrome's JavaScript setting the tab goes straight to the video.
          const js = `(()=>{const a=document.querySelector('ytd-video-renderer a#video-title, ytd-video-renderer a#thumbnail');if(!a)return 'no';a.click();return 'yes'})()`;
          const clicked = await osascript(`on run argv
            tell application "Google Chrome" to tell active tab of front window to return execute javascript (item 1 of argv)
          end run`, [js]).catch(() => "no");
          if (clicked !== "yes") await osascript(`on run argv
            tell application "Google Chrome" to set URL of active tab of front window to item 1 of argv
          end run`, [`https://www.youtube.com/watch?v=${id}`]).catch(() => {});
        }
      } else {
        const url = id ? `https://www.youtube.com/watch?v=${id}` : search;
        if (PLATFORM === "win32") await powershell(`Start-Process ${psq(chromeBinary())} -ArgumentList ${psq(url)}`);
        else run(chromeBinary(), [url], { detached: true }).catch(() => {});
      }
      return id ? `Opened "${q}" on YouTube in a new Chrome tab, playing.` : `Searched YouTube for "${q}" in a new Chrome tab.`;
    }
    if (action === "pause" || action === "stop") return chromeMusicPause(action === "stop");
    if (action === "resume") return chromeMusicResume();
    if (action === "next") return chromeMusicNext();
    throw new Error("chrome_music action must be play, pause, resume, next or stop.");
  },

  // Read-only: what this computer is — model, processor, graphics, memory, storage and system.
  async system_info() {
    const gb = (bytes) => `${Math.round(Number(bytes) / 1024 ** 3)} GB`;
    const disk = async () => {
      if (PLATFORM === "win32") return "";
      const [, total, , avail] = (await sh("df", ["-k", "/"])).split("\n").pop().trim().split(/\s+/);
      return `Storage: ${gb(total * 1024)} (${gb(avail * 1024)} free)`;
    };
    if (PLATFORM === "darwin") {
      const data = JSON.parse(await sh("system_profiler", ["SPHardwareDataType", "SPDisplaysDataType", "SPPowerDataType", "-json"], 30_000));
      const hw = data.SPHardwareDataType?.[0] ?? {};
      const cpu = hw.chip_type || (await sh("sysctl", ["-n", "machdep.cpu.brand_string"]).catch(() => hw.cpu_type || ""));
      const gpus = (data.SPDisplaysDataType ?? []).map(g => `${g.sppci_model}${g.sppci_cores ? ` (${g.sppci_cores}-core)` : ""}${g.spdisplays_vram ? `, ${g.spdisplays_vram}` : ""}`);
      const name = await sh("sw_vers", ["-productName"]), version = await sh("sw_vers", ["-productVersion"]);
      return [`Model: ${hw.machine_name ?? "Mac"}${hw.machine_model ? ` (${hw.machine_model})` : ""}`, `Processor: ${cpu}${hw.number_processors ? ` — ${String(hw.number_processors).replace(/^proc /, "")} cores` : ""}`,
        `Graphics: ${gpus.join("; ") || "unknown"}`, `Memory: ${hw.physical_memory ?? gb(os.totalmem())}`, await disk(), `System: ${name} ${version}`, await macBattery(data.SPPowerDataType)].join("\n");
    }
    if (PLATFORM === "win32") {
      return powershell(`$cs = Get-CimInstance Win32_ComputerSystem; $p = Get-CimInstance Win32_Processor | Select-Object -First 1; $os = Get-CimInstance Win32_OperatingSystem; $d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
"Model: $($cs.Manufacturer) $($cs.Model)"
"Processor: $($p.Name.Trim()) — $($p.NumberOfCores) cores"
"Graphics: " + ((Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }) -join '; ')
"Memory: $([math]::Round($cs.TotalPhysicalMemory / 1GB)) GB"
"Storage: $([math]::Round($d.Size / 1GB)) GB ($([math]::Round($d.FreeSpace / 1GB)) GB free)"
"System: $($os.Caption) $($os.Version)"
$b = Get-CimInstance Win32_Battery | Select-Object -First 1
if (-not $b) { "Battery: none (desktop computer)" } else {
  $state = if ($b.BatteryStatus -eq 2) { "plugged in" } else { "on battery" }
  $left = if ($b.EstimatedRunTime -and $b.EstimatedRunTime -lt 71582788) { ", about $([math]::Floor($b.EstimatedRunTime / 60))h $($b.EstimatedRunTime % 60)m left" } else { "" }
  $cycles = (Get-CimInstance -Namespace root\wmi -ClassName BatteryCycleCount -ErrorAction SilentlyContinue | Select-Object -First 1).CycleCount
  $full = (Get-CimInstance -Namespace root\wmi -ClassName BatteryFullChargedCapacity -ErrorAction SilentlyContinue | Select-Object -First 1).FullChargedCapacity
  $design = (Get-CimInstance -Namespace root\wmi -ClassName BatteryStaticData -ErrorAction SilentlyContinue | Select-Object -First 1).DesignedCapacity
  $health = if ($full -and $design) { " · health $([math]::Round(100 * $full / $design))% of original capacity" } else { "" }
  "Battery: $($b.EstimatedChargeRemaining)%, $state$left" + $(if ($cycles) { " · $cycles cycles" } else { "" }) + $health
}`);
    }
    const read = (f) => readFile(f, "utf8").then(t => t.trim(), () => "");
    const release = (await read("/etc/os-release")).match(/^PRETTY_NAME="?([^"\n]+)/m)?.[1] ?? "Linux";
    const cpu = (await read("/proc/cpuinfo")).match(/^model name\s*:\s*(.+)$/m)?.[1] ?? os.cpus()[0]?.model ?? "unknown";
    const gpus = await sh("lspci", []).then(t => t.split("\n").filter(l => /vga|3d|display/i.test(l)).map(l => l.replace(/^\S+\s+[^:]+:\s*/, "")), () => []);
    const model = `${await read("/sys/devices/virtual/dmi/id/sys_vendor")} ${await read("/sys/devices/virtual/dmi/id/product_name")}`.trim();
    return [`Model: ${model || "unknown"}`, `Processor: ${cpu} — ${os.cpus().length} threads`, `Graphics: ${gpus.join("; ") || "unknown (install pciutils for lspci)"}`,
      `Memory: ${gb(os.totalmem())}`, await disk(), `System: ${release} (kernel ${os.release()})`, await linuxBattery(read)].join("\n");
  },

  // Asks the app to quit; with force, closes it even if it would ask to save.
  async quit_app({ name, force }) {
    if (PLATFORM === "darwin") {
      await osascript(`on run argv
        tell application (item 1 of argv) to quit
      end run`, [name]).catch(() => {});
      if (force) { await new Promise(r => setTimeout(r, 3000)); await sh("pkill", ["-9", "-x", name]).catch(() => {}); }
    }
    else if (PLATFORM === "win32") await powershell(force ? `Stop-Process -Name ${psq(name.replace(/\.exe$/i, ""))} -Force -ErrorAction Stop` : `Get-Process -Name ${psq(name.replace(/\.exe$/i, ""))} -ErrorAction Stop | ForEach-Object { $_.CloseMainWindow() | Out-Null }`);
    else await sh("pkill", [...(force ? ["-9"] : []), "-x", name]);
    return force ? `Closed ${name}.` : `Asked ${name} to quit.`;
  },

  // Restart and shut down close every open app first, without waiting for
  // "save changes?" dialogs (asked to quit, then forced after a few seconds).
  async power({ action }) {
    const what = { restart: 0, "shut down": 1, sleep: 2 }[action];
    if (what === undefined) throw new Error("power action must be restart, shut down or sleep.");
    // Answer first, so the user hears it before the computer goes.
    setTimeout(() => { void (async () => {
      if (PLATFORM === "darwin") {
        if (what !== 2) {
          const pids = await userAppPids();
          for (const pid of pids) { try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ } }
          await new Promise(r => setTimeout(r, 4000));
          for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch { /* closed */ } }
        }
        await osascript(`tell application "System Events" to ${action}`).catch(() => {});
      }
      else if (PLATFORM === "win32") await (what === 2 ? sh("rundll32.exe", ["powrprof.dll,SetSuspendState", "0,1,0"]) : sh("shutdown", [what === 0 ? "/r" : "/s", "/f", "/t", "3"]));
      else await sh("systemctl", [what === 0 ? "reboot" : what === 1 ? "poweroff" : "suspend", "-i"]);
    })().catch(() => {}); }, 1500);
    return action === "sleep" ? "Going to sleep." : `Closing all apps and going to ${action}.`;
  },

  // Everyday scripts run directly; risky ones only after the user approved them.
  async run_script({ script, language }) {
    if (!script) throw new Error("Empty script.");
    // language says what the script is: terminal commands, AppleScript or PowerShell.
    const out = PLATFORM === "win32" ? await powershell(script)
      : PLATFORM === "darwin" && language !== "shell" ? await osascript(script)
      : await sh(PLATFORM === "darwin" ? "/bin/zsh" : "bash", ["-c", script], 60_000);
    return out ? `Done. Output: ${out.slice(0, 2000)}` : "Done.";
  },

  // ── Developer (Claude Code) ──
  async dev_projects() {
    const projects = await codeProjects();
    const bin = await claudeBinary();
    const head = bin ? `Claude Code is installed (${tilde(bin)}).` : "Claude Code isn't installed here yet (https://claude.com/claude-code).";
    if (!projects.length) return `${head}\nNo code projects found in the usual folders.`;
    return `${head}\n${projects.slice(0, 40).map(p => `${p.name} — ${tilde(p.path)}${p.claude ? " (worked on in Claude Code)" : ""}, last active ${new Date(p.lastActive).toISOString().slice(0, 10)}`).join("\n")}`;
  },

  async dev_ask({ project, task }, ctx = {}) {
    const p = await findProject(project);
    return `${p.name} (${tilde(p.path)}):\n${await runClaude(p.path, `${ASK_BRIEF}\n\nQuestion: ${task}`, ["Read", "Glob", "Grep", "TodoWrite"], false, 4 * 60_000, ctx.progress)}`;
  },

  async dev_chats({ task }, ctx = {}) {
    if (!existsSync(CLAUDE_PROJECTS)) return "There are no saved Claude Code chats on this computer yet.";
    return runClaude(CLAUDE_PROJECTS, `${CHATS_BRIEF}\n\nQuestion: ${task}`, ["Read", "Glob", "Grep", "TodoWrite"], false, 4 * 60_000, ctx.progress);
  },

  // An agent the user set to Claude (research, strategy…): Claude Code answers,
  // with web search when the agent needs current facts. Nothing is changed on
  // this computer: it works in its own empty folder with no file or terminal tools.
  async claude_ask({ prompt, web }, ctx = {}) {
    if (!prompt) throw new Error("Empty request.");
    const dir = path.join(HOME, "Documents", "UNC Assistant", "claude-work");
    await mkdir(dir, { recursive: true });
    return runClaude(dir, String(prompt), web ? ["WebSearch", "WebFetch", "TodoWrite"] : ["WebSearch", "TodoWrite"], false, 5 * 60_000, ctx.progress);
  },

  // Sent only after the user approved this exact task in the app.
  async dev_task({ project, task, fresh }, ctx = {}) {
    const p = await findProject(project);
    const tools = ["Bash", "Read", "Edit", "Write", "Glob", "Grep", "WebFetch", "WebSearch", "TodoWrite"];
    const prompt = `${TASK_BRIEF} For anything with more than two steps, keep a to-do list with TodoWrite so the user can follow along.\n\n${VERIFY_BRIEF}\n\nTask: ${task}`;
    const onSession = (id) => { void keepSession(p.path, id); };
    // A follow-up continues the last conversation in this project, so it knows what was tried.
    const resume = fresh ? null : await lastSession(p.path);
    let answer;
    try {
      answer = await runClaude(p.path, resume ? `Follow-up from the user on the same work.\n\n${prompt}` : prompt, tools, true, 30 * 60_000, ctx.progress, { resume, onSession });
    } catch (err) {
      // The old conversation is gone (cleared, or another computer): start a new one.
      if (!resume || !/no conversation|session|not found/i.test(String(err?.message))) throw err;
      answer = await runClaude(p.path, prompt, tools, true, 30 * 60_000, ctx.progress, { onSession });
    }
    return `${p.name} (${tilde(p.path)}):\n${answer}`;
  },
};

// ── Battery (part of system_info) ──

const hm = (hours) => `${Math.floor(hours)}h ${String(Math.round((hours % 1) * 60)).padStart(2, "0")}m`;

async function macBattery(power = []) {
  const batt = await sh("pmset", ["-g", "batt"]).catch(() => "");
  const line = batt.split("\n").find(l => /InternalBattery/.test(l));
  if (!line) return "Battery: none (desktop Mac)";
  const pct = line.match(/(\d+)%/)?.[1], state = line.match(/%;\s*([^;]+);/)?.[1] ?? "";
  const time = line.match(/(\d+:\d+) remaining/)?.[1];
  const timeText = time ? (/charging/.test(state) && !/discharging/.test(state) ? `, ${time} until full` : `, about ${time} left`) : "";
  const reg = await sh("ioreg", ["-rn", "AppleSmartBattery"]).catch(() => "");
  const num = (key) => Number(reg.match(new RegExp(`"${key}" = (\\d+)`))?.[1]) || 0;
  const cycles = num("CycleCount"), rated = num("DesignCycleCount9C"), max = num("AppleRawMaxCapacity") || num("MaxCapacity"), design = num("DesignCapacity");
  const condition = power.find(p => p.sppower_battery_health_info)?.sppower_battery_health_info?.sppower_battery_health;
  return `Battery: ${pct}%, ${state}${timeText}` + (cycles ? ` · ${cycles} cycles${rated ? ` (rated for about ${rated})` : ""}` : "")
    + (max && design && max <= design * 1.2 ? ` · health ${Math.round((100 * max) / design)}% of original capacity` : "") + (condition ? ` · condition ${condition}` : "");
}

async function linuxBattery(read) {
  const dir = await sh("sh", ["-c", "ls -d /sys/class/power_supply/BAT* 2>/dev/null | head -1"]).catch(() => "");
  if (!dir) return "Battery: none";
  const v = async (f) => read(`${dir}/${f}`);
  const pct = await v("capacity"), status = (await v("status")).toLowerCase(), cycles = Number(await v("cycle_count")) || 0;
  const full = Number(await v("energy_full") || await v("charge_full")), design = Number(await v("energy_full_design") || await v("charge_full_design"));
  const now = Number(await v("energy_now") || await v("charge_now")), rate = Number(await v("power_now") || await v("current_now"));
  const left = rate > 0 ? (status === "discharging" ? `, about ${hm(now / rate)} left` : status === "charging" ? `, ${hm((full - now) / rate)} until full` : "") : "";
  return `Battery: ${pct}%, ${status}${left}` + (cycles ? ` · ${cycles} cycles` : "") + (full && design ? ` · health ${Math.round((100 * full) / design)}% of original capacity` : "");
}

// ── Linking and the work loop ──

async function loadConfig() {
  try { return JSON.parse(await readFile(CONFIG, "utf8")); } catch { return null; }
}

async function pair(code, server) {
  if (!code || !server) throw new Error("Usage: node sarah-desktop.mjs pair <CODE> --server https://your-sarah-site");
  const res = await fetch(new URL("/api/devices/register", server), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name: os.hostname().replace(/\.local$/, ""), os: OS_NAME }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Pairing failed (HTTP ${res.status}).`);
  await writeFile(CONFIG, JSON.stringify({ server, token: body.token }, null, 2), { mode: 0o600 });
  console.log(`Linked ${os.hostname()} (${OS_NAME}). Now run: node sarah-desktop.mjs`);
}

/** Sends a job's live progress to the server, at most about once a second (the last state always goes). */
function progressSender(server, headers, id) {
  let timer = null, latest = null, last = 0;
  const flush = () => { timer = null; last = Date.now(); void fetch(new URL("/api/devices/progress", server), { method: "POST", headers, body: JSON.stringify({ id, progress: latest }) }).catch(() => {}); };
  return (p) => { latest = JSON.parse(JSON.stringify(p)); if (!timer) timer = setTimeout(flush, Math.max(0, 900 - (Date.now() - last))); };
}

async function work() {
  const config = await loadConfig();
  if (!config) throw new Error("This computer isn't linked yet. Get a code on your Account page, then run: node sarah-desktop.mjs pair <CODE> --server <your site>");
  const headers = { authorization: `Bearer ${config.token}`, "content-type": "application/json" };
  console.log(`Sarah Desktop is running on ${os.hostname()} (${OS_NAME}). Leave this window open. Ctrl+C to stop.`);
  for (let backoff = 1000; ;) {
    try {
      const res = await fetch(new URL("/api/devices/poll", config.server), { headers, signal: AbortSignal.timeout(35_000) });
      if (res.status === 401) throw Object.assign(new Error("This computer was unlinked from the account. Pair it again."), { fatal: true });
      const { commands = [] } = await res.json();
      backoff = 1000;
      // Each command runs on its own, so a long Claude Code task doesn't stop the polling.
      for (const cmd of commands) void (async () => {
        let ok = true, output;
        try {
          const action = ACTIONS[cmd.action];
          if (!action) throw new Error(`Unknown action ${cmd.action}.`);
          output = String(await action(cmd.args || {}, { progress: progressSender(config.server, headers, cmd.id) }));
        } catch (err) { ok = false; output = err instanceof Error ? err.message : String(err); }
        console.log(`${new Date().toLocaleTimeString()}  ${ok ? "✓" : "✗"} ${cmd.action}: ${output.split("\n")[0].slice(0, 120)}`);
        await sendResult(new URL("/api/devices/result", config.server), headers, { id: cmd.id, ok, output });
      })();
    } catch (err) {
      if (err.fatal) throw err;
      // Offline or the server restarted: wait and try again, up to a minute apart.
      await new Promise(r => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
}

// Run as a command only when started directly (the desktop app imports ACTIONS instead).
const direct = !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
const [command, ...rest] = direct ? process.argv.slice(2) : [];
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
if (direct) try {
  if (Number(process.versions.node.split(".")[0]) < 18) throw new Error("Node.js 18 or newer is needed: https://nodejs.org");
  if (command === "pair") await pair(rest[0], flag("--server"));
  else if (command === "unpair") { await rm(CONFIG, { force: true }); console.log("Unlinked. Remove it from your Account page too."); }
  else await work();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

/**
 * Hands a finished command's answer back, retrying for up to 15 minutes: if
 * the server is restarting at that moment, one failed attempt used to lose
 * the answer and leave the job showing as running.
 */
async function sendResult(url, headers, body) {
  for (let wait = 2000, until = Date.now() + 15 * 60_000; ; wait = Math.min(wait * 2, 60_000)) {
    try {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)) return;
    } catch { /* offline or restarting */ }
    if (Date.now() > until) return;
    await new Promise(r => setTimeout(r, wait));
  }
}
