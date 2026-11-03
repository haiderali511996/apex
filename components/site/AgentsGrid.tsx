"use client";

import { INFO, ROSTER } from "@/components/sarah/agents";

/** Every agent in the app, from the same roster the deck shows. */
export default function AgentsGrid() {
  return (
    <div className="grid3">
      {ROSTER.map(agent => {
        const info = INFO[agent.key];
        return (
          <div className="card" key={agent.key}>
            <h3><span style={{ color: agent.color, marginRight: 8 }}>●</span>{agent.name}</h3>
            {info?.role && <p style={{ color: "var(--text)", marginBottom: 8 }}>{info.role}</p>}
            {info?.caps?.length ? <p>{info.caps.join(" · ")}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
