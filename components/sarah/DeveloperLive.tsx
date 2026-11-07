"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The Developer at work, live: Claude Code's to-do list and each step it
 * takes (reading, searching, running, editing), as it happens on the user's
 * computer. Opens by itself when a job starts and shows the outcome when it
 * ends. Data comes from /api/agent/developer, which the desktop app feeds.
 */

type Step = { label: string; status: "running" | "done" | "failed" };
type Todo = { content: string; activeForm?: string; status: "pending" | "in_progress" | "completed" };
type Job = {
  id: string; action: string; computer: string; task: string; status: string;
  progress: { steps?: Step[]; todos?: Todo[]; note?: string } | null;
  result: string | null; startedAt: string; updatedAt: string;
};

const AMBER = "#f5a623";
const TITLES: Record<string, string> = { dev_task: "Developer", dev_ask: "Developer", dev_chats: "Developer", claude_ask: "Claude" };
const VERBS: Record<string, string> = { dev_task: "Working on", dev_ask: "Looking into", dev_chats: "Searching past chats", claude_ask: "Thinking about" };

function elapsed(from: string, to = Date.now()) {
  const s = Math.max(0, Math.round((to - Date.parse(from)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export default function DeveloperLive() {
  const [job, setJob] = useState<Job | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [, tick] = useState(0);
  const running = !!job && (job.status === "queued" || job.status === "sent");
  const runningRef = useRef(false);
  runningRef.current = running;

  // Poll quickly while a job runs, slowly otherwise (to notice a new one).
  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (document.visibilityState === "visible") {
        const body = await fetch("/api/agent/developer", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null) as { jobs?: Job[] } | null;
        if (live && body) setJob(body.jobs?.[0] ?? null);
      }
      if (live) timer = setTimeout(load, runningRef.current ? 1500 : 4000);
    };
    void load();
    return () => { live = false; clearTimeout(timer); };
  }, []);

  // The clock keeps moving between polls.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  if (!job || dismissed === job.id) return null;
  const steps = job.progress?.steps ?? [];
  const todos = job.progress?.todos ?? [];
  const shown = steps.slice(-8);
  const hidden = steps.length - shown.length;
  const failed = job.status === "failed";
  const waitingLong = running && !steps.length && !todos.length && Date.now() - Date.parse(job.startedAt) > 12_000;

  return (
    <div role="status" aria-live="polite" aria-label="Developer progress" style={{
      position: "fixed", left: "max(16px, 2vw)", top: 96, zIndex: 58,
      width: "min(380px, calc(100vw - 32px))", maxHeight: "calc(100vh - 140px)", overflowY: "auto",
      background: "rgba(4,3,12,0.92)", backdropFilter: "blur(24px)",
      border: `1px solid ${AMBER}44`, borderRadius: 16,
      boxShadow: `0 0 40px ${AMBER}18, 0 8px 32px rgba(0,0,0,0.6)`,
      color: "#e8eef5", font: "14px/1.45 system-ui, -apple-system, sans-serif",
    }}>
      <style>{`@keyframes dl-spin{to{transform:rotate(360deg)}}@keyframes dl-pulse{50%{opacity:.35}}`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${AMBER}22`, background: `linear-gradient(135deg, ${AMBER}0d 0%, transparent 100%)` }}>
        <span aria-hidden style={{ width: 10, height: 10, borderRadius: "50%", background: failed ? "#ff6b6b" : running ? AMBER : "#34d399", animation: running ? "dl-pulse 1.2s ease-in-out infinite" : undefined, flex: "none" }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ letterSpacing: "0.18em", fontSize: 13, fontWeight: 700, color: AMBER }}>{(TITLES[job.action] ?? "Developer").toUpperCase()}</div>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", color: "#8aa0b4" }}>CLAUDE CODE · {job.computer.toUpperCase()} · {running ? elapsed(job.startedAt) : failed ? "STOPPED" : `DONE IN ${elapsed(job.startedAt, Date.parse(job.updatedAt))}`}</div>
        </div>
        <button type="button" onClick={() => setDismissed(job.id)} aria-label="Hide the Developer panel" style={{ background: "transparent", border: "1px solid #ffffff22", color: "#c8d3de", borderRadius: 8, width: 30, height: 30, cursor: "pointer", flex: "none" }}>×</button>
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
