import { database } from "./db";
import { SPECIALISTS } from "./agent/roles";

/**
 * Which AI each agent thinks with, chosen per account ("use Claude for my
 * research from now on"). Specialists run on Gemini by default; "claude-code"
 * runs them on the Claude Code installed on the user's own computer, through
 * the desktop app, on their Claude subscription. Some agents are fixed:
 * Sarah's own voice conversation stays on Gemini (speed), the Developer is
 * always Claude Code, and Design makes pictures with Gemini's image model.
 */

export type Engine = "gemini" | "claude-code";
export const ENGINES: Record<Engine, string> = { gemini: "Gemini", "claude-code": "Claude (Claude Code on your computer)" };

/** The agents whose engine can be chosen, with their names. */
export const CHOOSABLE: Record<string, string> = Object.fromEntries(Object.entries(SPECIALISTS).map(([k, v]) => [k, v.name]));

export const FIXED: { agent: string; engine: string }[] = [
  { agent: "Conversation (your assistant itself)", engine: "Gemini — fastest for live voice" },
  { agent: "Developer", engine: "Claude Code on your computer" },
  { agent: "Design (pictures)", engine: "Gemini image model" },
  { agent: "Memory", engine: "Saved on the server, with a full backup on your computer" },
];

function db() {
  const d = database();
  d.exec(`CREATE TABLE IF NOT EXISTS agent_engines (user_id TEXT NOT NULL, agent TEXT NOT NULL, engine TEXT NOT NULL, PRIMARY KEY (user_id, agent))`);
  return d;
}

export function agentEngines(userId: string): Record<string, Engine> {
  const rows = db().prepare("SELECT agent, engine FROM agent_engines WHERE user_id = ?").all(userId) as { agent: string; engine: string }[];
  const out: Record<string, Engine> = Object.fromEntries(Object.keys(CHOOSABLE).map(k => [k, "gemini" as Engine]));
  for (const r of rows) if (r.agent in out && (r.engine === "gemini" || r.engine === "claude-code")) out[r.agent] = r.engine;
  return out;
}

export function engineFor(userId: string, agent: string): Engine {
  return agentEngines(userId)[agent] ?? "gemini";
}

/** "all" sets every choosable agent at once. */
export function setAgentEngine(userId: string, agent: string, engine: Engine) {
  const targets = agent === "all" ? Object.keys(CHOOSABLE) : [agent];
  for (const a of targets) {
    if (!(a in CHOOSABLE)) throw new Error(`Unknown agent "${agent}". Choose from: ${Object.keys(CHOOSABLE).join(", ")}, or all.`);
    db().prepare("INSERT INTO agent_engines (user_id, agent, engine) VALUES (?, ?, ?) ON CONFLICT(user_id, agent) DO UPDATE SET engine = excluded.engine").run(userId, a, engine);
  }
}

/** One paragraph for the prompt, so Sarah knows (and can say) who thinks with what. */
export function enginesBrief(userId: string): string {
  const engines = agentEngines(userId);
  const chosen = Object.entries(engines).map(([k, e]) => `${CHOOSABLE[k]}: ${e === "claude-code" ? "Claude (Claude Code on their computer)" : "Gemini"}`).join("; ");
  return `\n\nWHICH AI EACH AGENT USES (the user chooses): ${chosen}. Fixed: your own conversation is Gemini, Developer is Claude Code on their computer, Design pictures are Gemini's image model. When they say e.g. "use Claude for research from now on" or "switch marketing back to Gemini", call set_agent_engine — it is saved for every future conversation. Claude runs through the desktop app on their computer; if that computer is offline the agent answers with Gemini and says so.`;
}
