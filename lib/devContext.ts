import { database } from "./db";

/**
 * Which code project (and subfolder) the user is working in, per account, so
 * "add these images to the blog" goes to the same place as the last task
 * without naming it again. Also the last project list read from their
 * computer, to turn a spoken name ("unc web-next") into an exact folder.
 */

export type ProjectRef = { name: string; path: string };

function db() {
  const d = database();
  d.exec(`CREATE TABLE IF NOT EXISTS dev_context (user_id TEXT PRIMARY KEY, current_path TEXT, projects TEXT, projects_at TEXT, updated_at TEXT)`);
  return d;
}

type Row = { current_path: string | null; projects: string | null; projects_at: string | null };
const row = (userId: string) => db().prepare("SELECT current_path, projects, projects_at FROM dev_context WHERE user_id = ?").get(userId) as Row | undefined;

export function currentProject(userId: string): string | null {
  return row(userId)?.current_path ?? null;
}

export function setCurrentProject(userId: string, path: string) {
  db().prepare("INSERT INTO dev_context (user_id, current_path, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET current_path = excluded.current_path, updated_at = excluded.updated_at").run(userId, path, new Date().toISOString());
}

/** Remembers the list the desktop app reported ("name — ~/path …" lines). */
export function rememberProjectList(userId: string, listing: string) {
  const projects: ProjectRef[] = [];
  for (const line of listing.split("\n")) {
    const m = /^(.+?) — ((?:~|\/|[A-Za-z]:\\)[^,(]*?)(?: \(|,|$)/.exec(line.trim());
    if (m) projects.push({ name: m[1].trim(), path: m[2].trim() });
  }
  if (!projects.length) return;
  db().prepare("INSERT INTO dev_context (user_id, projects, projects_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET projects = excluded.projects, projects_at = excluded.projects_at, updated_at = excluded.updated_at")
    .run(userId, JSON.stringify(projects), new Date().toISOString(), new Date().toISOString());
}

export function knownProjects(userId: string): { projects: ProjectRef[]; fresh: boolean } {
  const r = row(userId);
  let projects: ProjectRef[] = [];
  try { projects = JSON.parse(r?.projects || "[]"); } catch { projects = []; }
  return { projects, fresh: !!r?.projects_at && Date.now() - Date.parse(r.projects_at) < 30 * 60_000 };
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const join = (base: string, rest: string) => `${base.replace(/[\\/]+$/, "")}/${rest.replace(/^[\\/]+/, "")}`;

/**
 * A spoken project reference as an exact folder for the computer:
 *  - empty → the current project;
 *  - a path → as is;
 *  - a known project's name → its folder;
 *  - "unc/web-next", "unc web-next" → that project plus the subfolder;
 *  - otherwise, with a current project, a subfolder of it ("web-next");
 *  - else the words go to the computer to match.
 */
export function resolveProjectRef(userId: string, said: string | undefined, saved: Record<string, { path: string }>): string {
  const raw = (said ?? "").trim();
  const current = currentProject(userId);
  if (!raw) {
    if (current) return current;
    throw new Error("Which project? No current project is set yet; name one (list_projects shows them).");
  }
  if (/^(~|\/|[A-Za-z]:\\)/.test(raw)) return raw;
  if (saved[squash(raw)]) return saved[squash(raw)].path;
  const { projects } = knownProjects(userId);
  const byName = (n: string) => projects.find(p => squash(p.name) === squash(n));
  const exact = byName(raw);
  if (exact) return exact.path;
  const parts = raw.split(/[\\/\s]+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 1; i--) {
    const base = byName(parts.slice(0, i).join(" ")) ?? byName(parts.slice(0, i).join("-")) ?? (saved[squash(parts.slice(0, i).join(""))] ? { path: saved[squash(parts.slice(0, i).join(""))].path } : undefined);
    if (base) return join(base.path, parts.slice(i).join("/"));
  }
  if (current) {
    const currentName = current.split(/[\\/]/).filter(Boolean).pop() ?? "";
    if (squash(currentName) === squash(raw)) return current;
    // A plain folder name while working in a project is a subfolder of it.
    if (/^[\w.-]+$/.test(raw) && !projects.some(p => squash(p.name).includes(squash(raw)))) return join(current, raw);
  }
  // Part of a project's name ("lifemed") is matched on the computer; anything else would be a wrong guess.
  if (!projects.length || projects.some(p => squash(p.name).includes(squash(raw)) || squash(raw).includes(squash(p.name)))) return raw;
  throw new Error(`"${raw}" isn't one of the projects on the computer. If it's a folder inside a project, say which one, e.g. "unc/${raw}". Projects: ${projects.slice(0, 15).map(p => p.name).join(", ")}.`);
}

/** For the prompt: the project the user is working in, so the Developer goes there without asking. */
export function devBrief(userId: string): string {
  const current = currentProject(userId);
  return current ? `\n\nCURRENT PROJECT: ${current}. Developer requests (questions, tasks, putting designs into the site) go here unless the user names another project; omit project to use it. If they name a subfolder ("web-next"), it's inside this project.` : "";
}
