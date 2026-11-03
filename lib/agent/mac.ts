import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

/**
 * Sarah's hands on this Mac. The server runs on the MacBook itself, so it can
 * open apps, Chrome profiles and sites directly. Everything here is passed to
 * `open` or `osascript` as arguments — never through a shell — and only the
 * harmless operations run without approval (see tools.ts).
 */

const run = promisify(execFile);

function onMac() {
  if (process.platform !== "darwin") throw new Error("Mac control only works when Sarah's server runs on macOS.");
}

async function osascript(script: string, args: string[] = [], timeout = 15_000) {
  onMac();
  const { stdout } = await run("osascript", ["-e", script, ...args], { timeout });
  return stdout.trim();
}

/** Apps with a window or Dock icon, frontmost first. */
export async function listRunningApps() {
  const names = await osascript(`tell application "System Events"
    set frontApp to name of first application process whose frontmost is true
    set openApps to name of every application process whose background only is false
  end tell
  set AppleScript's text item delimiters to linefeed
  return frontApp & linefeed & (openApps as text)`);
  const [front, ...rest] = names.split("\n").filter(Boolean);
  return { frontmost: front, running: [...new Set(rest)].sort() };
}

export async function openApp(name: string) {
  onMac();
  try {
    await run("open", ["-a", name], { timeout: 15_000 });
  } catch {
    throw new Error(`No app called "${name}" was found on this Mac.`);
  }
  return `Opened ${name}.`;
}

type ChromeProfile = { dir: string; name: string; email: string };

export async function listChromeProfiles(): Promise<ChromeProfile[]> {
  const file = path.join(os.homedir(), "Library/Application Support/Google/Chrome/Local State");
  const state = JSON.parse(await readFile(file, "utf8")) as { profile?: { info_cache?: Record<string, { name?: string; user_name?: string }> } };
  return Object.entries(state.profile?.info_cache ?? {}).map(([dir, p]) => ({ dir, name: p.name ?? dir, email: p.user_name ?? "" }));
}

/**
 * Finds a profile by what Haider calls it: its name, its email, or the start
 * of either. Several profiles share names, so an ambiguous match is an error
 * listing the candidates rather than a guess.
 */
export async function resolveChromeProfile(spoken: string): Promise<ChromeProfile> {
  const profiles = await listChromeProfiles();
  const q = spoken.trim().toLowerCase();
  const exact = profiles.filter(p => p.dir.toLowerCase() === q || p.email.toLowerCase() === q || p.name.toLowerCase() === q);
  const loose = exact.length ? exact : profiles.filter(p => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q));
  if (loose.length === 1) return loose[0];
  const list = (loose.length ? loose : profiles).map(p => `${p.name}${p.email ? ` (${p.email})` : ""}`).join("; ");
  throw new Error(loose.length
    ? `More than one Chrome profile matches "${spoken}": ${list}. Ask Haider which one.`
    : `No Chrome profile matches "${spoken}". The profiles are: ${list}.`);
}

/** Opens a site, in a chosen Chrome profile when one is named. */
export async function openUrl(url: string, opts: { chromeProfile?: string; browser?: string } = {}) {
  onMac();
  const target = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  if (!/^https?:\/\//i.test(target)) throw new Error("Only web addresses (http or https) can be opened.");
  if (opts.chromeProfile) {
    const profile = await resolveChromeProfile(opts.chromeProfile);
    await run("open", ["-na", "Google Chrome", "--args", `--profile-directory=${profile.dir}`, target], { timeout: 15_000 });
    return `Opened ${target} in Chrome as ${profile.name}${profile.email ? ` (${profile.email})` : ""}.`;
  }
  await run("open", opts.browser ? ["-a", opts.browser, target] : [target], { timeout: 15_000 });
  return `Opened ${target}${opts.browser ? ` in ${opts.browser}` : ""}.`;
}

/** Every open Chrome tab, numbered as window:tab so one can be brought forward. */
export async function listChromeTabs() {
  const out = await osascript(`if application "Google Chrome" is not running then return ""
  set rows to {}
  tell application "Google Chrome"
    repeat with w from 1 to count of windows
      repeat with t from 1 to count of tabs of window w
        set end of rows to (w as text) & ":" & (t as text) & tab & (title of tab t of window w) & tab & (URL of tab t of window w)
      end repeat
    end repeat
  end tell
  set AppleScript's text item delimiters to linefeed
  return rows as text`);
  if (!out) return "Chrome isn't open.";
  return out.split("\n").map(line => { const [id, title, url] = line.split("\t"); return `${id} — ${title} — ${url}`; }).join("\n");
}

export async function focusChromeTab(window: number, tabIndex: number) {
  await osascript(`on run argv
    set w to (item 1 of argv) as integer
    set t to (item 2 of argv) as integer
    tell application "Google Chrome"
      set active tab index of window w to t
      set index of window w to 1
      activate
    end tell
  end run`, [String(window), String(tabIndex)]);
  return `Switched to Chrome window ${window}, tab ${tabIndex}.`;
}

export async function setVolume(level: number | "mute" | "unmute") {
  if (level === "mute") { await osascript("set volume output muted true"); return "Muted."; }
  if (level === "unmute") { await osascript("set volume output muted false"); return "Unmuted."; }
  const v = Math.max(0, Math.min(100, Math.round(level)));
  await osascript(`on run argv
    set volume output muted false
    set volume output volume ((item 1 of argv) as integer)
  end run`, [String(v)]);
  return `Volume set to ${v}%.`;
}

/** Approval-only: see executeMacAction. */
export async function quitApp(name: string) {
  await osascript(`on run argv
    tell application (item 1 of argv) to quit
  end run`, [name]);
  return `Quit ${name}.`;
}

/** Approval-only: runs a script Haider has read and approved in the UI. */
export async function runAppleScript(script: string) {
  const out = await osascript(script, [], 60_000);
  return out ? `Done. Output: ${out.slice(0, 2000)}` : "Done.";
}

// Quitting these would take Sarah down mid-task: her page runs in Chrome and
// her server in the editor or terminal. Finder can't be quit.
const KEEP_RUNNING = ["Finder", "Google Chrome", "Code", "Visual Studio Code", "Cursor", "Terminal", "iTerm2", "Claude"];

/** Approval-only: quits every app with a window, except Sarah's own. */
export async function quitAllApps() {
  const { running } = await listRunningApps();
  const targets = running.filter(name => !KEEP_RUNNING.includes(name));
  const failed: string[] = [];
  for (const name of targets) {
    try { await quitApp(name); } catch { failed.push(name); }
  }
  const kept = running.filter(name => KEEP_RUNNING.includes(name));
  return `Quit ${targets.length - failed.length} app${targets.length - failed.length === 1 ? "" : "s"}${failed.length ? `; ${failed.join(", ")} didn't quit (it may be asking to save)` : ""}. Kept open: ${kept.join(", ") || "none"}.`;
}

/** Approval-only. macOS asks each app to quit first, so unsaved work prompts to save. */
export async function power(action: "restart" | "shut down" | "sleep") {
  await osascript(`tell application "System Events" to ${action}`);
  return action === "sleep" ? "Putting the Mac to sleep." : `The Mac is going to ${action}.`;
}

/** Music, Spotify, VLC or QuickTime, through scripts/media-control.sh. */
export async function controlMediaApps(action: "pause" | "play" | "status") {
  onMac();
  try {
    const { stdout } = await run(path.join(process.cwd(), "scripts", "media-control.sh"), [action], { timeout: 15_000 });
    return stdout.trim() || "Done.";
  } catch (e) {
    return (e as { stdout?: string }).stdout?.trim() || "No music app (Music, Spotify, VLC, QuickTime) is running.";
  }
}
