/**
 * UNC Assistant desktop app: sign in with your assistant account, and this
 * computer is linked. It lives in the menu bar / system tray, connects out to
 * the server and asks for work (no ports are opened), and only ever runs the
 * fixed actions in actions.mjs — the same list as the website's command-line
 * version. Quitting apps, restarting and scripts only arrive after you
 * approved them in the assistant.
 */

import { app, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, shell, Tray } from "electron";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACTIONS, OS_NAME } from "./actions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SERVER = "https://assistant.unctech.co";
const LINK_FILE = () => path.join(app.getPath("userData"), "link.json");
const COMPUTER = os.hostname().replace(/\.local$/, "");

let tray = null, loginWindow = null, link = null, loopId = 0;
// A newer version on the website (downloads/app/latest.json), shown in the menu.
let update = null;
let state = { text: "Not signed in", last: "" };

// ── The saved link (token encrypted with the OS keychain when available) ──

async function loadLink() {
  try {
    const saved = JSON.parse(await readFile(LINK_FILE(), "utf8"));
    const token = saved.encrypted ? safeStorage.decryptString(Buffer.from(saved.token, "base64")) : saved.token;
    return { server: saved.server, email: saved.email, token };
  } catch { return null; }
}

async function saveLink(value) {
  const encrypted = safeStorage.isEncryptionAvailable();
  const token = encrypted ? safeStorage.encryptString(value.token).toString("base64") : value.token;
  await mkdir(path.dirname(LINK_FILE()), { recursive: true });
  await writeFile(LINK_FILE(), JSON.stringify({ server: value.server, email: value.email, token, encrypted }, null, 2), { mode: 0o600 });
}

// ── Optional tools on this computer ──
// The app itself needs nothing installed. Node.js is for Claude Code (the
// Developer agent) and Python for the optional helper scripts; when missing,
// the menu offers the official download page, which picks this OS's installer.

const TOOLS = [
  { name: "Node.js", why: "for Claude Code", commands: ["node"], args: ["-v"], download: "https://nodejs.org/en/download" },
  { name: "Python", why: "for helper scripts", commands: process.platform === "win32" ? ["py", "python"] : ["python3"], args: ["--version"], download: "https://www.python.org/downloads/" },
];
// Apps opened from Finder/Explorer get a short PATH, so look where installers put these too.
const EXTRA_PATH = process.platform === "win32"
  ? [path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs"), path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Launcher")]
  : ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", path.join(os.homedir(), ".nvm", "current", "bin")];
let toolVersions = {};

function versionOf(tool) {
  const env = { ...process.env, PATH: [process.env.PATH, ...EXTRA_PATH].filter(Boolean).join(path.delimiter) };
  return new Promise(resolve => {
    const next = i => {
      if (i >= tool.commands.length) return resolve(null);
      execFile(tool.commands[i], tool.args, { env, timeout: 5000, windowsHide: true }, (err, stdout, stderr) => {
        const text = `${stdout || ""}${stderr || ""}`.trim();
        if (err || !/\d+\.\d+/.test(text)) return next(i + 1);
        resolve(text.match(/\d+(\.\d+)+/)[0]);
      });
    };
    next(0);
  });
}

async function checkTools() {
  toolVersions = Object.fromEntries(await Promise.all(TOOLS.map(async t => [t.name, await versionOf(t)])));
  await refreshTray();
}

const toolItems = () => TOOLS.map(t => toolVersions[t.name]
  ? { label: `✓ ${t.name} ${toolVersions[t.name]}`, enabled: false }
  : { label: `Download ${t.name} (${t.why})…`, click: () => shell.openExternal(t.download) });

// ── Updates ──

const newer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

async function checkForUpdate() {
  try {
    const res = await fetch(new URL("/downloads/app/latest.json", link?.server || DEFAULT_SERVER), { signal: AbortSignal.timeout(10_000) });
    const latest = res.ok ? await res.json() : null;
    update = latest?.version && newer(latest.version, app.getVersion()) ? latest : null;
  } catch { /* offline: check again later */ }
  await refreshTray();
}

// ── Start at login ──

const linuxAutostart = () => path.join(os.homedir(), ".config", "autostart", "unc-assistant.desktop");

async function setStartAtLogin(on) {
  if (process.platform === "linux") {
    if (!on) return rm(linuxAutostart(), { force: true });
    await mkdir(path.dirname(linuxAutostart()), { recursive: true });
    const exec = process.env.APPIMAGE || process.execPath;
    await writeFile(linuxAutostart(), `[Desktop Entry]\nType=Application\nName=UNC Assistant\nExec="${exec}"\nX-GNOME-Autostart-enabled=true\n`);
  } else {
    app.setLoginItemSettings({ openAtLogin: on, openAsHidden: true });
  }
}

async function startsAtLogin() {
  if (process.platform === "linux") return readFile(linuxAutostart()).then(() => true, () => false);
  return app.getLoginItemSettings().openAtLogin;
}

// ── Tray ──

function trayIcon() {
  const size = process.platform === "darwin" ? 18 : process.platform === "win32" ? 16 : 22;
  return nativeImage.createFromPath(path.join(HERE, "..", "icons", "icon.png")).resize({ width: size, height: size });
}

async function refreshTray() {
  if (!tray) return;
  const autostart = await startsAtLogin();
  tray.setToolTip(`UNC Assistant ${app.getVersion()} — ${state.text}${update ? ` · update ${update.version} available` : ""}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `UNC Assistant — ${state.text}`, enabled: false },
    ...(update ? [{ label: `⬆ Update to version ${update.version}…`, click: () => shell.openExternal(new URL("/download", link?.server || DEFAULT_SERVER).href) }] : []),
    ...(state.last ? [{ label: `Last: ${state.last}`, enabled: false }] : []),
    { type: "separator" },
    link
      ? { label: "Open my assistant", click: () => shell.openExternal(link.server) }
      : { label: "Sign in…", click: showLogin },
    ...(link ? [{ label: "Open memory folder", click: async () => { await syncMemory(); await shell.openPath(MEMORY_DIR()); } }] : []),
    { type: "separator" },
    { label: "Optional tools", enabled: false },
    ...toolItems(),
    { label: "Check again", click: () => void checkTools() },
    { type: "separator" },
    { label: "Start when I log in", type: "checkbox", checked: autostart, click: item => setStartAtLogin(item.checked).then(refreshTray) },
    ...(link ? [{ label: `Sign out (${link.email})`, click: signOut }] : []),
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]));
}

function setState(text, last) {
  state = { text, last: last ?? state.last };
  void refreshTray();
}

// ── Sign in / out ──

function showLogin() {
  if (loginWindow) { loginWindow.show(); loginWindow.focus(); return; }
  loginWindow = new BrowserWindow({
    width: 420, height: 600, resizable: false, maximizable: false, fullscreenable: false,
    title: "UNC Assistant", backgroundColor: "#050d14", autoHideMenuBar: true,
    icon: path.join(HERE, "..", "icons", "icon.png"),
    webPreferences: { preload: path.join(HERE, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  loginWindow.loadFile(path.join(HERE, "login.html"));
  // Links in the window open in the real browser, never inside the app.
  loginWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: "deny" }; });
  loginWindow.webContents.on("will-navigate", e => e.preventDefault());
  loginWindow.on("closed", () => { loginWindow = null; });
}

ipcMain.handle("sign-in", async (_e, { server, email, password }) => {
  let base;
  try { base = new URL(server || DEFAULT_SERVER); } catch { return { error: "That server address isn't valid." }; }
  if (base.protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(base.hostname)) return { error: "The server must use https://." };
  try {
    const res = await fetch(new URL("/api/devices/login", base), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, name: COMPUTER, os: OS_NAME }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body.error || `Sign-in failed (HTTP ${res.status}).` };
    link = { server: base.origin, email: body.email, token: body.token };
    await saveLink(link);
    await setStartAtLogin(true);
    startLoop();
    startMemorySync();
    setTimeout(() => loginWindow?.close(), 1200);
    return { ok: true, message: `Linked ${COMPUTER} to ${body.email}.` };
  } catch {
    return { error: "Couldn't reach the server. Check the internet connection." };
  }
});

ipcMain.handle("defaults", () => ({ server: DEFAULT_SERVER, computer: COMPUTER, os: OS_NAME }));
ipcMain.handle("tools", async () => { await checkTools(); return TOOLS.map(t => ({ name: t.name, why: t.why, version: toolVersions[t.name], download: t.download })); });
ipcMain.handle("open-external", (_e, url) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); });

async function signOut() {
  const old = link;
  link = null; loopId++;
  await rm(LINK_FILE(), { force: true });
  if (memoryTimer) { clearInterval(memoryTimer); memoryTimer = null; }
  if (old) await fetch(new URL("/api/devices/self", old.server), { method: "DELETE", headers: { authorization: `Bearer ${old.token}` }, signal: AbortSignal.timeout(10_000) }).catch(() => {});
  setState("Not signed in", "");
  showLogin();
}

// ── Memory copy ──
// A readable copy of what the assistant remembers, kept in Documents. The
// account's memory itself lives on the server, so every device shares it.

const MEMORY_DIR = () => path.join(app.getPath("documents"), "UNC Assistant");
const MEMORY_FILE = () => path.join(MEMORY_DIR(), "memory.md");
const BACKUP_FILE = () => path.join(MEMORY_DIR(), "memory-backup.json");
const HISTORY_FILE = () => path.join(MEMORY_DIR(), "conversation-history.md");
let memoryTimer = null;

async function readBackup() {
  try { return JSON.parse(await readFile(BACKUP_FILE(), "utf8")); } catch { return { account: "", facts: [], turns: [] }; }
}

/**
 * Keeps the complete memory on this computer: every fact, and every turn of
 * the conversation ever (the server keeps the latest 400). If the server ever
 * has none for this account (a lost database), it is restored from here.
 */
async function syncMemory() {
  if (!link) return;
  const headers = { authorization: `Bearer ${link.token}`, "content-type": "application/json" };
  const url = (q = "") => new URL(`/api/devices/memory${q}`, link.server);
  try {
    let backup = await readBackup();
    if (backup.account && backup.account !== link.email) backup = { account: link.email, facts: [], turns: [] };
    backup.account = link.email;
    const since = backup.turns.at(-1)?.at ?? "";
    const res = await fetch(url(`?format=json&since=${encodeURIComponent(since)}`), { headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return;
    const server = await res.json();
    if (!server.facts.length && !server.totalTurns && (backup.facts.length || backup.turns.length)) {
      await fetch(url(), { method: "POST", headers, body: JSON.stringify({ facts: backup.facts, turns: backup.turns }), signal: AbortSignal.timeout(60_000) }).catch(() => {});
      return;
    }
    // Facts follow the server (where they're edited); turns only ever accumulate here.
    backup.facts = server.facts;
    const seen = new Set(backup.turns.map(t => t.id));
    backup.turns.push(...server.turns.filter(t => !seen.has(t.id)));
    backup.updatedAt = new Date().toISOString();
    await mkdir(MEMORY_DIR(), { recursive: true });
    await writeFile(BACKUP_FILE(), JSON.stringify(backup, null, 1), { mode: 0o600 });
    const history = ["# Conversation history", "", `Every conversation with your assistant, oldest first (${backup.turns.length} messages).`, ""];
    for (const t of backup.turns) history.push(`**${t.role === "user" ? "You" : "Assistant"}** · ${String(t.at).slice(0, 16).replace("T", " ")}`, "", String(t.content), "");
    await writeFile(HISTORY_FILE(), history.join("\n"), { mode: 0o600 });
    const md = await fetch(url(), { headers, signal: AbortSignal.timeout(30_000) });
    if (md.ok) await writeFile(MEMORY_FILE(), await md.text(), { mode: 0o600 });
  } catch { /* offline: the last copy stays */ }
}

function startMemorySync() {
  if (memoryTimer) clearInterval(memoryTimer);
  void syncMemory();
  memoryTimer = setInterval(() => void syncMemory(), 5 * 60_000);
}

// ── The work loop ──

/** Sends a job's live progress to the server, at most about once a second (the last state always goes). */
function progressSender(server, headers, id) {
  let timer = null, latest = null, last = 0;
  const flush = () => { timer = null; last = Date.now(); void fetch(new URL("/api/devices/progress", server), { method: "POST", headers, body: JSON.stringify({ id, progress: latest }) }).catch(() => {}); };
  return (p) => { latest = JSON.parse(JSON.stringify(p)); if (!timer) timer = setTimeout(flush, Math.max(0, 900 - (Date.now() - last))); };
}

function startLoop() {
  const id = ++loopId;
  void (async () => {
    setState("Connecting…");
    for (let backoff = 1000; id === loopId && link;) {
      const headers = { authorization: `Bearer ${link.token}`, "content-type": "application/json" };
      try {
        const res = await fetch(new URL("/api/devices/poll", link.server), { headers, signal: AbortSignal.timeout(35_000) });
        if (res.status === 401) {
          // Unlinked from the Account page: sign in again.
          link = null; await rm(LINK_FILE(), { force: true });
          setState("Unlinked — sign in again", "");
          showLogin();
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { commands = [] } = await res.json();
        setState(`Connected as ${link.email}`);
        backoff = 1000;
        // Each command runs on its own, so a long Claude Code task doesn't stop the polling
        // (the account would otherwise see this computer as offline).
        for (const cmd of commands) void (async () => {
          let ok = true, output;
          try {
            const action = ACTIONS[cmd.action];
            if (!action) throw new Error(`Unknown action ${cmd.action}.`);
            if (cmd.action.startsWith("dev_")) setState(state.text, "Claude Code is working…");
            output = String(await action(cmd.args || {}, { progress: progressSender(link.server, headers, cmd.id) }));
          } catch (err) { ok = false; output = err instanceof Error ? err.message : String(err); }
          setState(state.text, `${ok ? "✓" : "✗"} ${String(output).split("\n")[0].slice(0, 60)}`);
          await fetch(new URL("/api/devices/result", link.server), { method: "POST", headers, body: JSON.stringify({ id: cmd.id, ok, output }) }).catch(() => {});
        })();
      } catch {
        if (id !== loopId) return;
        // Offline or the server restarted: wait and try again, up to a minute apart.
        setState("Offline — retrying");
        await new Promise(r => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  })();
}

// ── App lifecycle ──

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (!link) showLogin(); else void refreshTray(); });
  // A tray app: closing the sign-in window doesn't quit it.
  app.on("window-all-closed", () => {});
  app.whenReady().then(async () => {
    if (process.platform === "darwin") app.dock?.hide();
    tray = new Tray(trayIcon());
    link = await loadLink();
    await refreshTray();
    void checkTools();
    void checkForUpdate();
    setInterval(() => void checkForUpdate(), 6 * 3600_000);
    if (link) { startLoop(); startMemorySync(); } else showLogin();
  });
}
