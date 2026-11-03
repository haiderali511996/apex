"use client";

/**
 * Connects Gmail, Calendar and Drive: walks through the Google Cloud steps,
 * saves the OAuth client, runs Google's consent, and shows what Sarah can see.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import AssistantLogo from "@/components/AssistantLogo";
import { Check, Copy, LayoutGrid, MessageSquare, Plug } from "lucide-react";
import "./sarah.css";

type Check<T> = { ok: true; value: T } | { ok: false; error: string };
type Status = { connected: boolean; hasClient: boolean; redirect?: string; gmail?: Check<string>; calendar?: Check<number>; drive?: Check<number> };

export default function ConnectGoogle() {
  const [status, setStatus] = useState<Status | null>(null);
  const [origin, setOrigin] = useState("");
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () => fetch("/api/google/status").then((r) => r.json()).then(setStatus).catch(() => setStatus(null));
  useEffect(() => {
    setOrigin(window.location.origin);
    const q = new URLSearchParams(window.location.search);
    const state = q.get("google");
    if (state === "connected") setBanner({ ok: true, text: "Google is connected. Sarah can use Gmail, Calendar and Drive now." });
    else if (state === "missing-client") setBanner({ ok: false, text: "Save your Client ID and secret first (step 5)." });
    else if (state === "error") setBanner({ ok: false, text: q.get("detail") || "Google connection failed." });
    void load();
  }, []);

  const redirect = status?.redirect ?? `${origin}/api/google/callback`;
  const save = async () => {
    setSaving(true);
    const res = await fetch("/api/google/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, clientSecret }) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setBanner({ ok: false, text: data.error || "Couldn't save those." }); return; }
    setBanner({ ok: true, text: "Saved. Now press Connect Google." });
    setClientId(""); setClientSecret("");
    void load();
  };

  const row = (label: string, check?: Check<string | number>, ok?: (v: string | number) => string) => (
    <li className="sarah-connect-row">
      <i className="sarah-dot" style={{ background: check?.ok ? "var(--ok)" : check ? "var(--danger)" : "var(--dim)" }} />
      <span className="sarah-connect-name">{label}</span>
      <span className="sarah-muted">{!check ? "Not connected" : check.ok ? ok?.(check.value) : check.error}</span>
    </li>
  );

  return (
    <div className="sarah-deck is-chat">
      <div className="sarah-bg" aria-hidden="true" />
      <nav className="sarah-rail" aria-label="Main">
        <Link href="/" className="sarah-mark" aria-label="Sarah home"><AssistantLogo /></Link>
        <Link href="/" className="sarah-rail-btn" title="Deck"><LayoutGrid size={18} /><span>Deck</span></Link>
        <Link href="/agent" className="sarah-rail-btn" title="Chat"><MessageSquare size={18} /><span>Chat</span></Link>
        <Link href="/connect" className="sarah-rail-btn is-active" aria-current="page" title="Connect"><Plug size={18} /><span>Connect</span></Link>
      </nav>
      <header className="sarah-top">
        <div className="sarah-brand">
          <span className="sarah-brand-name">SARAH</span>
          <span className="sarah-brand-sub">Connect Google</span>
        </div>
      </header>
      <main className="sarah-chat-main">
        <section className="sarah-panel sarah-connect">
          {banner && <p className={banner.ok ? "sarah-connect-banner" : "sarah-error"} role="status">{banner.text}</p>}

          <header className="sarah-panel-head"><span className="sarah-label">Gmail · Calendar · Drive</span></header>
          <ul className="sarah-connect-status">
            {row("Gmail", status?.gmail, (v) => `Connected as ${v}`)}
            {row("Calendar", status?.calendar, (v) => `${v} calendar${v === 1 ? "" : "s"} visible`)}
            {row("Drive", status?.drive, () => "Files visible")}
          </ul>

          <header className="sarah-panel-head"><span className="sarah-label">One-time setup in Google Cloud</span></header>
          <ol className="sarah-connect-steps">
            <li>Open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud Console</a> and create a project (any name, e.g. “Sarah”).</li>
            <li>Turn on the APIs: <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noreferrer">Gmail</a>, <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noreferrer">Calendar</a>, <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">Drive</a> — press <b>Enable</b> on each.</li>
            <li>Set up the <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">OAuth consent screen</a>: User type <b>External</b>, app name “Sarah”, your email. Then under <b>Audience</b>, press <b>Publish app</b> — in Testing mode Google expires the connection every 7 days.</li>
            <li>
              Create an <a href="https://console.cloud.google.com/auth/clients/create" target="_blank" rel="noreferrer">OAuth client</a>: type <b>Web application</b>, and under <b>Authorized redirect URIs</b> add exactly:
              <span className="sarah-connect-copy">
                <code>{redirect}</code>
                <button type="button" className="sarah-icon-btn" aria-label="Copy the redirect URL" onClick={() => { void navigator.clipboard.writeText(redirect); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </span>
              <span className="sarah-muted">Google only accepts this exact URL. Open Sarah at {redirect.replace("/api/google/callback", "")} when you connect.</span>
            </li>
            <li>
              Paste the client’s ID and secret here:
              <span className="sarah-connect-form">
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={status?.hasClient ? "Saved — paste a new one to replace it" : "Client ID (…apps.googleusercontent.com)"} aria-label="Client ID" />
                <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="Client secret" type="password" aria-label="Client secret" />
                <button type="button" className="sarah-btn is-primary" onClick={save} disabled={saving || !clientId || !clientSecret}>{saving ? "Saving…" : "Save"}</button>
              </span>
            </li>
            <li>
              <a className={`sarah-btn is-primary${status?.hasClient ? "" : " is-disabled"}`} href="/api/google/connect">Connect Google</a>
              <span className="sarah-muted"> Sign in, and on “Google hasn’t verified this app” choose <b>Advanced → Go to Sarah</b>, then allow access.</span>
            </li>
          </ol>
        </section>
      </main>
    </div>
  );
}
