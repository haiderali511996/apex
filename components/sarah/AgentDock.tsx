"use client";

import { useEffect, useRef, useState } from "react";
import FinancePanel from "./FinancePanel";
import TradingPanel from "./TradingPanel";
import { useDraggable } from "./useDraggable";

/**
 * Agents at work, live. The Developer at work: Claude Code's to-do list and each step it
 * takes (reading, searching, running, editing), as it happens on the user's
 * computer. Opens by itself when a job starts and shows the outcome when it
 * ends. Data comes from /api/agent/developer, which the desktop app feeds.
 */

type Step = { label: string; status: "running" | "done" | "failed" };
type Todo = { content: string; activeForm?: string; status: "pending" | "in_progress" | "completed" };
type Job = {
  id: string; action: string; title: string; computer: string; task: string; status: string;
  progress: { steps?: Step[]; todos?: Todo[]; note?: string } | null;
  result: string | null; startedAt: string; updatedAt: string;
};

const AMBER = "#f5a623";
const VERBS: Record<string, string> = { dev_task: "Working on", dev_ask: "Looking into", dev_chats: "Searching past chats", claude_ask: "Thinking about" };

function elapsed(from: string, to = Date.now()) {
  const s = Math.max(0, Math.round((to - Date.parse(from)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** A Claude Code job (the Developer, or an agent set to Claude): to-dos and live steps. */
function JobCard({ job, onClose }: { job: Job; onClose: () => void }) {
  const running = job.status === "queued" || job.status === "sent";
  const steps = job.progress?.steps ?? [];
  const todos = job.progress?.todos ?? [];
  const shown = steps.slice(-8);
  const hidden = steps.length - shown.length;
  const failed = job.status === "failed";
  const waitingLong = running && !steps.length && !todos.length && Date.now() - Date.parse(job.startedAt) > 12_000;
  const drag = useDraggable(`job:${job.title}`);

  return (
    <div ref={drag.ref} onPointerDownCapture={drag.onPointerDownCapture} role="status" aria-live="polite" aria-label={`${job.title} progress`} className="agent-dock-card" style={{
      ...drag.style,
      width: "min(360px, calc(100vw - 32px))", maxHeight: "calc(100vh - 160px)", overflowY: "auto",
      background: "rgba(4,3,12,0.92)", backdropFilter: "blur(24px)",
      border: `1px solid ${AMBER}44`, borderRadius: 16,
      boxShadow: `0 0 40px ${AMBER}18, 0 8px 32px rgba(0,0,0,0.6)`,
      color: "#e8eef5", font: "14px/1.45 system-ui, -apple-system, sans-serif",
    }}>
      <div onPointerDown={drag.handle.onPointerDown} title={drag.handle.title} style={{ ...drag.handle.style, display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${AMBER}22`, background: `linear-gradient(135deg, ${AMBER}0d 0%, transparent 100%)` }}>
        <span aria-hidden style={{ width: 10, height: 10, borderRadius: "50%", background: failed ? "#ff6b6b" : running ? AMBER : "#34d399", animation: running ? "dl-pulse 1.2s ease-in-out infinite" : undefined, flex: "none" }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ letterSpacing: "0.18em", fontSize: 13, fontWeight: 700, color: AMBER }}>{job.title.toUpperCase()}</div>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", color: "#8aa0b4" }}>CLAUDE CODE · {job.computer.toUpperCase()} · {running ? elapsed(job.startedAt) : failed ? "STOPPED" : `DONE IN ${elapsed(job.startedAt, Date.parse(job.updatedAt))}`}</div>
        </div>
        <button type="button" onClick={onClose} aria-label={`Hide the ${job.title} card`} style={{ background: "transparent", border: "1px solid #ffffff22", color: "#c8d3de", borderRadius: 8, width: 30, height: 30, cursor: "pointer", flex: "none" }}>×</button>
      </div>

      <div style={{ padding: "12px 16px 14px", display: "grid", gap: 12 }}>
        {job.task && <div style={{ color: "#c8d3de", fontSize: 13 }}><span style={{ color: "#8aa0b4" }}>{VERBS[job.action] ?? "Working on"}: </span>{job.task.length > 220 ? `${job.task.slice(0, 219)}…` : job.task}</div>}

        {todos.length > 0 && (
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.16em", color: AMBER, marginBottom: 6 }}>TO DO</div>
            <div style={{ display: "grid", gap: 4 }}>
              {todos.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", color: t.status === "completed" ? "#7b8a99" : "#e8eef5" }}>
                  <span aria-hidden style={{ width: 14, flex: "none", color: t.status === "completed" ? "#34d399" : t.status === "in_progress" ? AMBER : "#5d6b78" }}>{t.status === "completed" ? "✓" : t.status === "in_progress" ? "◐" : "○"}</span>
                  <span style={{ textDecoration: t.status === "completed" ? "line-through" : undefined, fontWeight: t.status === "in_progress" ? 600 : 400 }}>{t.status === "in_progress" ? t.activeForm || t.content : t.content}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {shown.length > 0 && (
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.16em", color: AMBER, marginBottom: 6 }}>STEPS</div>
            {hidden > 0 && <div style={{ color: "#5d6b78", fontSize: 12, marginBottom: 4 }}>+ {hidden} earlier step{hidden === 1 ? "" : "s"}</div>}
            <div style={{ display: "grid", gap: 4, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5 }}>
              {shown.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", color: s.status === "running" ? "#e8eef5" : s.status === "failed" ? "#ff8a80" : "#9fb0bf" }}>
                  {s.status === "running" && running
                    ? <span aria-label="running" style={{ width: 10, height: 10, flex: "none", border: `2px solid ${AMBER}`, borderRightColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "dl-spin .8s linear infinite", transform: "translateY(1px)" }} />
                    : <span aria-hidden style={{ width: 10, flex: "none", color: s.status === "failed" ? "#ff6b6b" : "#34d399" }}>{s.status === "failed" ? "✗" : "✓"}</span>}
                  <span style={{ overflowWrap: "anywhere" }}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {running && !steps.length && !todos.length && (
          <div style={{ color: "#8aa0b4", fontSize: 13 }}>
            {job.status === "queued" ? `Waiting for ${job.computer} to pick it up…` : waitingLong ? "Working… Update the desktop app to see each step live." : "Starting Claude Code…"}
          </div>
        )}

        {running && job.progress?.note && <div style={{ color: "#8aa0b4", fontSize: 13, fontStyle: "italic", borderLeft: `2px solid ${AMBER}55`, paddingLeft: 10 }}>{job.progress.note.length > 240 ? `${job.progress.note.slice(0, 239)}…` : job.progress.note}</div>}

        {!running && job.result && (
          <div style={{ color: failed ? "#ff8a80" : "#c8d3de", fontSize: 13, whiteSpace: "pre-wrap", borderTop: "1px solid #ffffff14", paddingTop: 10 }}>
            {job.result.length > 700 ? `${job.result.slice(0, 699)}…` : job.result}
          </div>
        )}
      </div>
    </div>
  );
}

type Activity = { agent: string; key: string; color: string; steps: { label: string; status: "running" | "done" | "failed"; detail?: string }[]; startedAt: number; updatedAt: number };

/** Any other agent at work: its steps as they run, and what each found. */
function AgentCard({ a, now, onClose }: { a: Activity; now: number; onClose: () => void }) {
  const running = a.steps.some(s => s.status === "running");
  const failed = !running && a.steps.at(-1)?.status === "failed";
  const last = a.steps.at(-1);
  const drag = useDraggable(`agent:${a.key}`);
  return (
    <div ref={drag.ref} onPointerDownCapture={drag.onPointerDownCapture} role="status" aria-live="polite" aria-label={`${a.agent} progress`} className="agent-dock-card" style={{
      ...drag.style,
      width: a.key === "finance" || a.key === "trading" ? "min(420px, calc(100vw - 32px))" : "min(300px, calc(100vw - 32px))",
      maxHeight: "calc(100vh - 160px)", overflowY: "auto",
      background: "rgba(4,3,12,0.92)", backdropFilter: "blur(24px)",
      border: `1px solid ${a.color}44`, borderRadius: 16,
      boxShadow: `0 0 32px ${a.color}14, 0 8px 32px rgba(0,0,0,0.55)`,
      color: "#e8eef5", font: "14px/1.45 system-ui, -apple-system, sans-serif",
    }}>
      <div onPointerDown={drag.handle.onPointerDown} title={drag.handle.title} style={{ ...drag.handle.style, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${a.color}22`, background: `linear-gradient(135deg, ${a.color}0d 0%, transparent 100%)` }}>
        <span aria-hidden style={{ width: 9, height: 9, borderRadius: "50%", background: failed ? "#ff6b6b" : running ? a.color : "#34d399", animation: running ? "dl-pulse 1.2s ease-in-out infinite" : undefined, flex: "none" }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ letterSpacing: "0.18em", fontSize: 12.5, fontWeight: 700, color: a.color }}>{a.agent.toUpperCase()}</div>
          <div style={{ fontSize: 10.5, letterSpacing: "0.12em", color: "#8aa0b4" }}>{running ? `WORKING · ${elapsed(new Date(a.startedAt).toISOString(), now)}` : failed ? "STOPPED" : "DONE"}</div>
        </div>
        <button type="button" onClick={onClose} aria-label={`Hide the ${a.agent} card`} style={{ background: "transparent", border: "1px solid #ffffff22", color: "#c8d3de", borderRadius: 8, width: 28, height: 28, cursor: "pointer", flex: "none" }}>×</button>
      </div>
      <div style={{ padding: "10px 14px 12px", display: "grid", gap: 5, fontSize: 13 }}>
        {a.steps.slice(-6).map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", color: s.status === "running" ? "#e8eef5" : s.status === "failed" ? "#ff8a80" : "#9fb0bf" }}>
            {s.status === "running"
              ? <span aria-label="running" style={{ width: 10, height: 10, flex: "none", border: `2px solid ${a.color}`, borderRightColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "dl-spin .8s linear infinite", transform: "translateY(1px)" }} />
              : <span aria-hidden style={{ width: 10, flex: "none", color: s.status === "failed" ? "#ff6b6b" : "#34d399" }}>{s.status === "failed" ? "✗" : "✓"}</span>}
            <span style={{ overflowWrap: "anywhere" }}>{s.label}</span>
          </div>
        ))}
        {!running && last?.detail && a.key !== "finance" && a.key !== "trading" && <div style={{ color: failed ? "#ff8a80" : "#8aa0b4", fontSize: 12.5, borderTop: "1px solid #ffffff14", paddingTop: 8, marginTop: 2, overflowWrap: "anywhere" }}>{last.detail}</div>}
        {a.key === "finance" && <div style={{ borderTop: "1px solid #ffffff14", paddingTop: 10, marginTop: 4 }}><FinancePanel color={a.color} /></div>}
        {a.key === "trading" && <div style={{ borderTop: "1px solid #ffffff14", paddingTop: 10, marginTop: 4 }}><TradingPanel color={a.color} /></div>}
      </div>
    </div>
  );
}

/**
 * Every agent at work, each in its own card, side by side: the Developer and
 * agents set to Claude (live to-dos and steps from the computer), and every
 * other agent Sarah hands work to (Email, Finance, Researcher, Design…).
 * Cards open by themselves and fade out a little after the work ends.
 */
export default function AgentDock() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [agents, setAgents] = useState<Activity[]>([]);
  const [skew, setSkew] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [, tick] = useState(0);
  const busy = jobs.some(j => j.status === "queued" || j.status === "sent") || agents.some(a => a.steps.some(s => s.status === "running"));
  const busyRef = useRef(false);
  busyRef.current = busy;

  // Poll quickly while anything runs, slowly otherwise (to notice new work).
  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (document.visibilityState === "visible") {
        const body = await fetch("/api/agent/activity", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null) as { jobs?: Job[]; agents?: Activity[]; now?: number } | null;
        if (live && body) { setJobs(body.jobs ?? []); setAgents(body.agents ?? []); if (body.now) setSkew(body.now - Date.now()); }
      }
      if (live) timer = setTimeout(load, busyRef.current ? 1200 : 3000);
    };
    void load();
    return () => { live = false; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const now = Date.now() + skew;
  const hide = (id: string) => setHidden(h => new Set(h).add(id));
  const shownJobs = jobs.filter(j => !hidden.has(j.id));
  // A finished agent card stays 25 s so its result can be read.
  const shownAgents = agents.filter(a => !hidden.has(`${a.key}:${a.startedAt}`) && (a.steps.some(s => s.status === "running") || now - a.updatedAt < (a.key === "finance" || a.key === "trading" ? 120_000 : 25_000)));
  if (!shownJobs.length && !shownAgents.length) return null;

  return (
    <div className="agent-dock" aria-label="Agents at work">
      <style>{`@keyframes dl-spin{to{transform:rotate(360deg)}}@keyframes dl-pulse{50%{opacity:.35}}
        .agent-dock{position:fixed;left:16px;top:96px;z-index:58;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;max-width:calc(100vw - 32px);max-height:calc(100vh - 120px);overflow:auto;pointer-events:none}
        .agent-dock>.agent-dock-card{pointer-events:auto}
        @media (min-width:1100px){.agent-dock{max-width:calc(100vw - 660px)}}`}</style>
      {shownJobs.map(j => <JobCard key={j.id} job={j} onClose={() => hide(j.id)} />)}
      {shownAgents.map(a => <AgentCard key={`${a.key}:${a.startedAt}`} a={a} now={now} onClose={() => hide(`${a.key}:${a.startedAt}`)} />)}
    </div>
  );
}
