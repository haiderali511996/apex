import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Writes values into .env.local and the running process, so a connection made
 * from the browser works at once and survives a restart. Local use only:
 * callers must check the request came from this machine.
 */
const ENV_FILE = path.join(process.cwd(), ".env.local");

export async function setEnvValues(values: Record<string, string>) {
  let text = "";
  try {
    text = await fs.readFile(ENV_FILE, "utf8");
  } catch {
    // no file yet; it is created below
  }
  for (const [key, raw] of Object.entries(values)) {
    // One line per value: newlines would corrupt the file.
    const value = raw.replace(/[\r\n]/g, "").trim();
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    text = pattern.test(text) ? text.replace(pattern, line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
    process.env[key] = value;
  }
  await fs.writeFile(ENV_FILE, text, "utf8");
}

/** True when the request was made on this machine — the only place .env.local may be changed from. */
export function isLocalRequest(host: string | null) {
  return !!host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}
