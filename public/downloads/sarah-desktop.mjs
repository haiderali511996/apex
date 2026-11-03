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

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile, rm } from "node:fs/promises";
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

  async media({ action }) {
    if (action !== "play" && action !== "pause") throw new Error("media action must be play or pause.");
    if (PLATFORM === "darwin") {
      const done = [];
      for (const app of ["Music", "Spotify"]) {
        if ((await osascript(`application "${app}" is running`)) !== "true") continue;
        await osascript(`tell application "${app}" to ${action}`);
        done.push(app);
      }
      return done.length ? `${action === "play" ? "Playing" : "Paused"} ${done.join(" and ")}.` : "Neither Music nor Spotify is open.";
    }
    if (PLATFORM === "win32") { await powershell("(New-Object -ComObject WScript.Shell).SendKeys([char]179)"); return "Pressed play/pause."; }
    await sh("playerctl", [action]);
    return action === "play" ? "Playing." : "Paused.";
  },

  // Sent only after the user approved it in the app.
  async quit_app({ name }) {
    if (PLATFORM === "darwin") await osascript(`on run argv
      tell application (item 1 of argv) to quit
    end run`, [name]);
    else if (PLATFORM === "win32") await powershell(`Get-Process -Name ${psq(name.replace(/\.exe$/i, ""))} -ErrorAction Stop | ForEach-Object { $_.CloseMainWindow() | Out-Null }`);
    else await sh("pkill", ["-x", name]);
    return `Asked ${name} to quit.`;
  },

  // Sent only after the user approved it in the app.
  async power({ action }) {
    const what = { restart: 0, "shut down": 1, sleep: 2 }[action];
    if (what === undefined) throw new Error("power action must be restart, shut down or sleep.");
    if (PLATFORM === "darwin") await osascript(`tell application "System Events" to ${action}`);
    else if (PLATFORM === "win32") await (what === 2 ? sh("rundll32.exe", ["powrprof.dll,SetSuspendState", "0,1,0"]) : sh("shutdown", [what === 0 ? "/r" : "/s", "/t", "5"]));
    else await sh("systemctl", [what === 0 ? "reboot" : what === 1 ? "poweroff" : "suspend"]);
    return action === "sleep" ? "Going to sleep." : `Going to ${action}.`;
  },

  // Sent only after the user read and approved the script in the app.
  async run_script({ script }) {
    if (!script) throw new Error("Empty script.");
    const out = PLATFORM === "darwin" ? await osascript(script) : PLATFORM === "win32" ? await powershell(script) : await sh("bash", ["-c", script], 60_000);
    return out ? `Done. Output: ${out.slice(0, 2000)}` : "Done.";
  },
};

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
      for (const cmd of commands) {
        let ok = true, output;
        try {
          const action = ACTIONS[cmd.action];
          if (!action) throw new Error(`Unknown action ${cmd.action}.`);
          output = await action(cmd.args || {});
        } catch (err) { ok = false; output = err instanceof Error ? err.message : String(err); }
        console.log(`${new Date().toLocaleTimeString()}  ${ok ? "✓" : "✗"} ${cmd.action}: ${output.split("\n")[0].slice(0, 120)}`);
        await fetch(new URL("/api/devices/result", config.server), { method: "POST", headers, body: JSON.stringify({ id: cmd.id, ok, output }) }).catch(() => {});
      }
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
