"use client";

import { INFO, ROSTER, STATUS_LINE, type NodeSel } from "./agents";

const GROUPS: { title: string; keys: string[] }[] = [
  { title: "Core", keys: ["chief_of_staff", "memory", "strategist", "researcher", "finance", "trading", "editor"] },
  { title: "Specialists", keys: ["sales", "marketing", "ops", "social_media", "engineering", "design", "developer"] },
  { title: "Integrations", keys: ["analytics", "crm", "calendar", "email", "drive"] },
];

export default function AgentsPanel({ onOpen, active }: { onOpen: (n: NodeSel) => void; active: boolean }) {
  const online = ROSTER.filter((a) => INFO[a.key]?.status === "online").length;
  return (
    <section className="sarah-panel sarah-agents" aria-label="Sarah agents">
      <header className="sarah-panel-head">
        <span className="sarah-label">Agents</span>
        <span className="sarah-chip-mini"><i className="sarah-dot" style={{ background: STATUS_LINE.online.color }} />{online} online</span>
      </header>
      <div className="sarah-agents-scroll">
        {GROUPS.map((g) => {
          const members = ROSTER.filter((a) => g.keys.includes(a.key));
          return (
            <div key={g.title} className="sarah-agent-group">
              <div className="sarah-agent-group-title">{g.title}</div>
              <ul>
                {members.map((a) => {
                  const info = INFO[a.key];
                  return (
                    <li key={a.key}>
                      <button type="button" className="sarah-agent" onClick={() => onOpen(a)} style={{ "--agent": a.color } as React.CSSProperties}>
                        <span className={`sarah-agent-glyph${active && info?.status === "online" ? " is-live" : ""}`} aria-hidden="true" />
                        <span className="sarah-agent-text">
                          <span className="sarah-agent-name">{a.name}</span>
                          <span className="sarah-agent-role">{info?.role ?? "Specialist"}</span>
                        </span>
                        <i className="sarah-dot" style={{ background: STATUS_LINE[info?.status ?? "online"].color }} aria-label={info?.status} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
