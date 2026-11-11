/**
 * What each agent is doing right now, per account, for the deck's row of live
 * agent cards. Every tool call Sarah makes is recorded as a step of the agent
 * that does that work (Email, Finance, Researcher…), running then done or
 * failed. Kept in memory for a few minutes: it's a live view, not a log.
 * (Claude Code jobs come from the device queue instead; see lib/devices.ts.)
 */

import { SPECIALISTS } from "./agent/roles";

export type ActivityStep = { label: string; status: "running" | "done" | "failed"; detail?: string };
export type AgentActivity = { agent: string; key: string; color: string; steps: ActivityStep[]; startedAt: number; updatedAt: number };

const CYAN = "#00e5ff", AMBER = "#f5a623", SLATE = "#7f9bb3";
const KEEP_MS = 150_000;

type Agent = { key: string; name: string; color: string };
const A = (key: string, name: string, color: string): Agent => ({ key, name, color });

/** Which agent does the work behind each tool. */
function agentFor(tool: string, input: Record<string, unknown>): Agent | null {
  if (tool === "ask_specialist") {
    const role = String(input.role ?? "");
    const blue = ["chief_of_staff", "strategist", "researcher", "editor"].includes(role);
    return A(role, SPECIALISTS[role]?.name ?? "Specialist", blue ? CYAN : AMBER);
  }
  if (/^(get_inbox|search_email|read_email|propose_email)$/.test(tool)) return A("email", "Email", SLATE);
  if (/calendar/.test(tool)) return A("calendar", "Calendar", SLATE);
  if (tool === "search_drive" || tool === "drive_photos") return A("drive", "Drive", SLATE);
  if (/crm/.test(tool)) return A("crm", "CRM", SLATE);
  if (/^(get_revenue|get_paypal_report|get_bank_report|get_open_invoices)$/.test(tool)) return A("finance", "Finance", CYAN);
  if (/^(get_seo_report|get_traffic|get_youtube_report)$/.test(tool)) return A("analytics", "Analytics", SLATE);
  if (/facebook|instagram|tweet|_x_report|tiktok/.test(tool) || tool === "list_designs") return A("social_media", "Social", AMBER);
  if (tool === "web_search") return A("researcher", "Researcher", CYAN);
  if (tool === "design_picture") return A("design", "Design", AMBER);
  if (tool === "show_photo") return A("camera", "Camera", SLATE);
  if (/^(analyze_market|trading_status|set_trading|close_trade|trading_scan_now|trading_autopilot)$/.test(tool)) return A("trading", "Trading", CYAN);
  if (/^(remember|recall|forget)$/.test(tool)) return A("memory", "Memory", CYAN);
  if (/^(computer_|propose_computer_|mac_|propose_mac_)/.test(tool)) return A("computer", "Computer", SLATE);
  // Developer tools show their own live card from the computer's progress.
  return null;
}

const q = (v: unknown, n = 70) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** One step in plain words. */
function describe(tool: string, i: Record<string, unknown>): string {
  switch (tool) {
    case "ask_specialist": return q(i.request, 120);
    case "get_inbox": return i.account ? `Checking ${i.account}` : "Checking every inbox";
    case "search_email": return `Searching email for "${q(i.query, 60)}"`;
    case "read_email": return `Reading message ${i.id}${i.account ? ` in ${i.account}` : ""}`;
    case "propose_email": return `Drafting an email to ${q(i.to, 50)} for your approval`;
    case "get_calendar": return "Reading the calendar";
    case "propose_calendar_event": return `Drafting "${q(i.summary, 50)}" for your approval`;
    case "search_drive": return i.query ? `Searching Drive for "${q(i.query, 50)}"` : "Listing the newest Drive files";
    case "drive_photos": return "Opening pictures from Drive";
    case "get_crm_pipeline": return "Reading the pipeline";
    case "add_crm_lead": return `Adding ${q(i.name, 40)}`;
    case "update_crm_stage": return `Moving ${q(i.name, 40)} to ${q(i.stage, 30)}`;
    case "get_revenue": return "Reading Stripe sales";
    case "get_open_invoices": return "Checking unpaid invoices";
    case "get_paypal_report": return "Reading PayPal";
    case "get_bank_report": return "Reading the bank account";
    case "get_seo_report": return "Reading Search Console";
    case "get_traffic": return "Reading visitor numbers";
    case "get_youtube_report": return "Reading YouTube stats";
    case "get_facebook_report": return "Reading Facebook stats";
    case "get_instagram_report": return "Reading Instagram stats";
    case "get_x_report": return "Reading X stats";
    case "get_tiktok_report": return "Reading TikTok stats";
    case "list_designs": return "Finding the latest designs";
    case "propose_facebook_post": return "Drafting a Facebook post for your approval";
    case "propose_instagram_post": return "Drafting an Instagram post for your approval";
    case "propose_tweet": return "Drafting a post on X for your approval";
    case "propose_tiktok_post": return "Drafting a TikTok post for your approval";
    case "web_search": return `Searching the web: ${q(i.query, 60)}`;
    case "design_picture": return i.use_camera ? "Taking a photo to work on" : `Designing: ${q(i.instruction, 80)}`;
    case "analyze_market": return `Analysing ${q(i.symbol, 30)}: charts and news${i.trade ? ", then trading if it qualifies" : ""}`;
    case "trading_status": return "Reading positions and the track record";
    case "set_trading": return i.mode === "off" ? "Stopping the autopilot" : "Updating the trading rules";
    case "close_trade": return `Closing ${q(i.which, 30)}`;
    case "trading_scan_now": case "trading_autopilot": return `Scanning the watchlist${i.mode ? ` (${i.mode})` : ""}`;
    case "show_photo": return `Taking a photo: ${q(i.request, 70)}`;
    case "remember": return `Noting: ${q(i.fact, 70)}`;
    case "recall": return i.query ? `Recalling "${q(i.query, 50)}"` : "Recalling recent notes";
    case "forget": return `Forgetting "${q(i.query, 50)}"`;
    case "computer_system_info": case "mac_system_info": return "Reading the computer's specs and battery";
    case "computer_open_app": case "mac_open_app": return `Opening ${q(i.name, 40)}`;
    case "computer_open_url": case "mac_open_url": return `Opening ${q(i.url, 50)}`;
    default: return tool.startsWith("propose_") ? "Preparing an action for your approval" : tool.replace(/_/g, " ");
  }
}

const live = new Map<string, Map<string, AgentActivity>>();

function prune(userId: string) {
  const agents = live.get(userId);
  if (!agents) return;
  for (const [k, a] of agents) if (Date.now() - a.updatedAt > KEEP_MS && !a.steps.some(s => s.status === "running")) agents.delete(k);
}

/** Records a tool call as the start of a step; returns the function that ends it. */
export function startStep(userId: string | undefined, tool: string, input: Record<string, unknown>): (ok: boolean, detail?: string) => void {
  const agent = userId ? agentFor(tool, input) : null;
  if (!userId || !agent) return () => {};
  prune(userId);
  const agents = live.get(userId) ?? new Map<string, AgentActivity>();
  live.set(userId, agents);
  const now = Date.now();
  let card = agents.get(agent.key);
  // A card that has gone quiet starts fresh for new work.
  if (!card || (now - card.updatedAt > 30_000 && !card.steps.some(s => s.status === "running"))) {
    card = { agent: agent.name, key: agent.key, color: agent.color, steps: [], startedAt: now, updatedAt: now };
    agents.set(agent.key, card);
  }
  const step: ActivityStep = { label: describe(tool, input), status: "running" };
  card.steps.push(step);
  if (card.steps.length > 12) card.steps.splice(0, card.steps.length - 12);
  card.updatedAt = now;
  const c = card;
  return (ok, detail) => {
    step.status = ok ? "done" : "failed";
    if (detail) step.detail = detail.replace(/\s+/g, " ").trim().slice(0, 220);
    c.updatedAt = Date.now();
  };
}

export function activity(userId: string): AgentActivity[] {
  prune(userId);
  return [...(live.get(userId)?.values() ?? [])].sort((a, b) => a.startedAt - b.startedAt);
}
