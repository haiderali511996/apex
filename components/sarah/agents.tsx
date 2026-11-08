"use client";
import FinancePanel from "./FinancePanel";
import TradingPanel from "./TradingPanel";
import { useDraggable } from "./useDraggable";

/**
 * Sarah's specialists: the roster shown on the deck, what each one handles,
 * and the overview card that opens when one is picked.
 */

import { useEffect } from "react";

export type NodeSel = { name: string; key: string; color: string };

export type AgentInfo = {
  role: string;
  caps: string[];
  asks?: string[];
  status: "online" | "standby" | "integration";
};

export const ROSTER: { key: string; name: string; color: string }[] = [
  { key: "chief_of_staff", name: "Chief of staff", color: "#00e5ff" },
  { key: "memory",         name: "Memory",         color: "#00e5ff" },
  { key: "strategist",     name: "Strategist",     color: "#00e5ff" },
  { key: "researcher",     name: "Researcher",     color: "#00e5ff" },
  { key: "finance",        name: "Finance",        color: "#00e5ff" },
  { key: "trading",        name: "Trading",        color: "#00e5ff" },
  { key: "editor",         name: "Editor",         color: "#00e5ff" },
  { key: "sales",          name: "Sales",          color: "#f5a623" },
  { key: "marketing",      name: "Marketing",      color: "#f5a623" },
  { key: "ops",            name: "Ops",            color: "#f5a623" },
  { key: "social_media",   name: "Social",         color: "#f5a623" },
  { key: "engineering",    name: "Engineering",    color: "#f5a623" },
  { key: "design",         name: "Design",         color: "#f5a623" },
  { key: "developer",      name: "Developer",      color: "#f5a623" },
  { key: "analytics",      name: "Analytics",      color: "#7f9bb3" },
  { key: "crm",            name: "CRM",            color: "#7f9bb3" },
  { key: "calendar",       name: "Calendar",       color: "#7f9bb3" },
  { key: "email",          name: "Email",          color: "#7f9bb3" },
  { key: "drive",          name: "Drive",          color: "#7f9bb3" },
];

/* What each agent handles, keyed by roster id. */
export const INFO: Record<string, AgentInfo> = {
  chief_of_staff: { role: "Right hand - runs the day", status: "online",
    caps: ["Prioritizes the day and keeps loose ends closed", "Routes every request to the right specialist", "Escalates only what truly needs a human"],
    asks: ["What needs attention today?", "Chase the open quotes"] },
  memory: { role: "Long-term memory", status: "online",
    caps: ["Remembers every client, project and decision", "Feeds context into every task automatically", "Learns preferences over time"],
    asks: ["What did we decide about X?", "History with this client"] },
  strategist: { role: "Big-picture thinking", status: "online",
    caps: ["Weekly strategy reviews", "Goal and milestone tracking", "Spots opportunities and risks early"],
    asks: ["Where should we double down?"] },
  researcher: { role: "Deep research", status: "online",
    caps: ["Searches the web live, with sources", "Market and competitor research", "Technical deep-dives"],
    asks: ["Research this market", "Compare these suppliers"] },
  finance: { role: "Money watch", status: "online",
    caps: ["Stripe, PayPal and bank (Wise) balances and cash flow", "Revenue, fees and open invoices", "Monthly money recaps"],
    asks: ["How was this month?", "Is this quote priced right?"] },
  trading: { role: "Trading desk: crypto, forex, stocks", status: "online",
    caps: ["Analyses any market: daily, 4-hour and 1-hour charts plus news from trusted sources", "Buy / sell / wait with entry, stop-loss, target and an honest confidence", "Autopilot on paper or with real money (Alpaca, OANDA) within your risk limits", "Keeps a real track record: win rate, profit, drawdown"],
    asks: ["Analyse Bitcoin", "How is the trading bot doing?", "Stop trading"] },
  editor: { role: "Quality gate", status: "online",
    caps: ["Rewrites and tightens every draft", "Keeps the brand voice consistent", "Final pass before anything ships"],
    asks: ["Polish this post", "Tighten this email"] },
  sales: { role: "Deal closer", status: "online",
    caps: ["Follow-ups for every lead", "Warm-outreach drafts", "Pipeline nudges so nothing goes cold"],
    asks: ["Draft a follow-up", "Who went quiet?"] },
  marketing: { role: "Growth engine", status: "online",
    caps: ["Campaign generation", "Pricing analysis", "Brand positioning and content calendar"],
    asks: ["Generate campaign", "Competitor research"] },
  ops: { role: "Business operator", status: "online",
    caps: ["Client quotes and proposals", "Project scoping and timelines", "Supplier sourcing"],
    asks: ["Draft client quote", "Build project scope"] },
  social_media: { role: "Voice of the brand", status: "online",
    caps: ["Writes posts and captions", "Creates reel scripts", "Posts to Facebook, Instagram, X and TikTok after you approve"],
    asks: ["Write post caption", "Plan content week"] },
  engineering: { role: "Engineering brain", status: "online",
    caps: ["3D-print settings and materials", "Tolerances and fit", "Laser power and speed guidance"],
    asks: ["Review STL file", "Calculate tolerances"] },
  design: { role: "Image studio · Gemini", status: "online",
    caps: ["Edits your camera photo from an instruction", "Makes new pictures, logos and posters from words", "Keeps refining: “make it darker”, “add a hat”", "Download every result"],
    asks: ["Take a picture and make it a painting", "Designer, make a logo for Chatrix", "Now change the background"] },
  developer: { role: "Claude Code, on this Mac", status: "online",
    caps: ["Reads and explains any project on your Mac", "Searches your past Claude Code chats", "Runs terminal tasks — git pull, tests, fixes — after you approve", "Questions are read-only; changes always wait for your OK"],
    asks: ["What projects do I have?", "Pull the latest Chatrix code", "Run the tests in UNC"] },
  analytics: { role: "Numbers feed", status: "integration",
    caps: ["Performance metrics across every channel", "Feeds the weekly reviews"] },
  crm: { role: "Client memory bank", status: "integration",
    caps: ["Every lead and client in one pipeline", "Stage tracking from first contact to paid"] },
  calendar: { role: "Schedule sense", status: "integration",
    caps: ["Knows the calendar", "Reminders and follow-up timing"] },
  email: { role: "Inbox hands", status: "integration",
    caps: ["Inbox triage and reply drafts", "Connected and in use"] },
  drive: { role: "File access", status: "integration",
    caps: ["Reads and files documents", "Connected and in use"] },
};

export const STATUS_LINE: Record<AgentInfo["status"], { color: string; text: string }> = {
  online: { color: "#34d399", text: "Online - Sarah routes work to it automatically" },
  standby: { color: "#c9a84c", text: "Standby - in active development" },
  integration: { color: "#7f9bb3", text: "Integration - wired into the core" },
};

/* ── Agent overview window ── */
export function AgentOverview({ sel, onClose }: { sel: NodeSel; onClose: () => void }) {
  // Dragged anywhere by its header; reopens where it was left.
  const drag = useDraggable(`overview:${sel.key}`, () => ({ x: Math.max(8, window.innerWidth / 2 - 170), y: Math.max(90, window.innerHeight * 0.16) }));
  const pos = drag.pos;
  const opened = !!pos;
  const info = INFO[sel.key] ?? { role: "Specialist", status: "online" as const, caps: ["Part of the Sarah core"] };
  const c = sel.color;
  const status = STATUS_LINE[info.status];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus into the window when it opens and hand it back on close, so the
  // keyboard does not stay stranded on the agent list behind it.
  const panelRef = drag.ref;
  useEffect(() => {
    if (!opened) return;
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => { if (opener && document.contains(opener)) opener.focus(); };
  }, [opened, panelRef]);

  if (!pos) return null;
  return (
    <div ref={panelRef} className="sarah-agent-overview" role="dialog" aria-modal="true" aria-label={`${sel.name} overview`} onPointerDownCapture={drag.onPointerDownCapture} style={{
      width: sel.key === "finance" || sel.key === "trading" ? "min(460px, 92vw)" : "min(340px, 92vw)", zIndex: 60,
      maxHeight: "calc(100vh - 40px)", overflowY: "auto",
      background: "rgba(4,3,12,0.92)",
      backdropFilter: "blur(24px)",
      border: `1px solid ${c}44`,
      borderRadius: 16,
      boxShadow: `0 0 40px ${c}18, 0 8px 32px rgba(0,0,0,0.6)`,
      overflow: "hidden",
      ...drag.style,
    }}>
      {/* header - drag handle */}
      <div onPointerDown={drag.handle.onPointerDown} title="Drag to move" style={{ touchAction: "none",
        display: "flex", alignItems: "center", gap: 10, padding: "14px 16px",
        borderBottom: `1px solid ${c}22`, cursor: "grab", userSelect: "none",
        background: `linear-gradient(135deg, ${c}0a 0%, transparent 100%)`,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: "50%", background: `${c}14`,
          border: `1px solid ${c}44`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: c, boxShadow: `0 0 10px ${c}` }} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.08em", color: c }}>{sel.name.toUpperCase()}</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{info.role}</div>
        </div>
        <button onClick={onClose} aria-label="Close"
          style={{ marginLeft: "auto", background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "6px 8px", transition: "color 0.2s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.75)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
        >×</button>
      </div>

      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
        {sel.key === "finance" && <FinancePanel color={c} />}
        {sel.key === "trading" && <TradingPanel color={c} />}
        <div>
          <div style={{ fontSize: 9, letterSpacing: "0.14em", color: `${c}99`, marginBottom: 8, fontFamily: "var(--font-mono)" }}>WHAT IT HANDLES</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {info.caps.map((cap) => (
              <div key={cap} style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
                <div style={{ width: 3, height: 3, borderRadius: "50%", background: `${c}99`, marginTop: 6, flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.55 }}>{cap}</span>
              </div>
            ))}
          </div>
        </div>

        {info.asks && info.asks.length > 0 && (
          <div>
            <div style={{ fontSize: 9, letterSpacing: "0.14em", color: `${c}99`, marginBottom: 8, fontFamily: "var(--font-mono)" }}>EXAMPLE REQUESTS</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {info.asks.map((task) => (
                <span key={task} style={{
                  padding: "4px 10px", background: `${c}0d`, border: `1px solid ${c}2a`,
                  borderRadius: 20, fontSize: 10.5, color: `${c}cc`,
                }}>{task}</span>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 7, borderTop: `1px solid ${c}1a`, paddingTop: 12 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: status.color, boxShadow: `0 0 8px ${status.color}` }} />
          <span style={{ fontSize: 9.5, letterSpacing: "0.1em", color: "rgba(255,255,255,0.45)", textTransform: "uppercase" }}>{status.text}</span>
        </div>
      </div>
    </div>
  );
}
