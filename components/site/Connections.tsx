"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Group } from "@/lib/credentials";

type FieldState = { set: boolean; source: "account" | "server" | null; display: string };
type Data = { groups: Group[]; fields: Record<string, FieldState>; googleSignedIn: boolean; owner: boolean };

/** Every key the assistant runs on, entered once per account and stored encrypted. */
export default function Connections() {
  const [data, setData] = useState<Data | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [params, setParams] = useState<URLSearchParams | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/credentials");
    if (res.ok) setData(await res.json());
  }, []);
  useEffect(() => { setParams(new URLSearchParams(window.location.search)); void load(); }, [load]);

  const note = (id: string, ok: boolean, text: string) => setNotes(n => ({ ...n, [id]: { ok, text } }));

  const save = async (group: Group) => {
    const values: Record<string, string> = {};
    for (const f of group.fields) if (drafts[f.key] !== undefined) values[f.key] = drafts[f.key];
    if (!Object.keys(values).length) return note(group.id, false, "Type a value first.");
    setBusy(group.id);
    const res = await fetch("/api/credentials", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
    setBusy(null);
    if (!res.ok) return note(group.id, false, "Couldn't save. Try again.");
    setDrafts(d => { const next = { ...d }; for (const k of Object.keys(values)) delete next[k]; return next; });
    await load();
    if (group.id === "gemini" || group.id === "fish" || group.id === "email") await test(group.id);
    else note(group.id, true, "Saved.");
  };

  const test = async (id: string) => {
    setBusy(id);
    const res = await fetch("/api/credentials/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ group: id }) });
    const body = (await res.json().catch(() => ({ ok: false, message: "Test failed." }))) as { ok: boolean; message: string };
    setBusy(null);
    note(id, body.ok, body.message);
  };

  const disconnectGoogle = async () => {
    await fetch("/api/credentials", { method: "DELETE" });
    await load();
  };

  if (!data) return <div className="auth"><p style={{ color: "var(--muted)" }}>Loading your connections…</p></div>;

  const geminiReady = data.fields.GEMINI_API_KEY?.set;
  const google = params?.get("google");
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div style={{ padding: "16px 0 72px" }}>
      <p className="eyebrow">Connections</p>
      <h1 style={{ margin: "0 0 8px", fontSize: 34 }}>Connect your keys and accounts</h1>
      <p style={{ color: "var(--muted)", margin: "0 0 20px", maxWidth: "52em", lineHeight: 1.6 }}>
        Your assistant runs on your own keys, so you only pay providers for what you use. Everything here is encrypted and only used for your requests.
        Need help? Read the <Link href="/docs" style={{ color: "var(--accent)" }}>setup guide</Link>.
      </p>

      {params?.get("welcome") && (
        <div className="card" style={{ borderColor: "var(--accent)", marginBottom: 20 }}>
          <h3>Welcome! One step before you start</h3>
          <p>Add your free Gemini API key below — it&apos;s the only thing required. Fish Audio adds the natural voice; Google and your socials can come later.</p>
        </div>
      )}
      {google === "connected" && <p className="form-ok">Google is connected.</p>}
      {google === "error" && <p className="form-error">Google didn&apos;t connect: {params?.get("detail")}</p>}
      {google === "missing-client" && <p className="form-error">Save your Google OAuth client ID and secret first, then sign in.</p>}

      <div style={{ display: "grid", gap: 16 }}>
        {data.groups.map(group => (
          <section className="card" key={group.id} style={{ padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
              <h3 style={{ fontSize: 18 }}>{group.title} {group.required && <span className="plan-badge" style={{ marginLeft: 8, verticalAlign: "middle" }}>Required</span>}</h3>
              {group.link && <a href={group.link.href} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontSize: 14 }}>{group.link.text} ↗</a>}
            </div>
            <p style={{ margin: "6px 0 16px" }}>{group.why}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "4px 16px" }}>
              {group.fields.map(f => {
                const state = data.fields[f.key];
                return (
                  <label className="field" key={f.key}>
                    <span>{f.label}{f.optional ? <span style={{ color: "var(--muted)" }}> (optional)</span> : null}</span>
                    <input type={f.secret ? "password" : "text"} autoComplete="off" spellCheck={false}
                      placeholder={state?.set ? `${state.display}${state.source === "server" ? " — from the server's .env" : " — saved"}` : f.placeholder ?? ""}
                      value={drafts[f.key] ?? ""} onChange={e => setDrafts(d => ({ ...d, [f.key]: e.target.value }))} />
                    {f.help && <small>{f.help}</small>}
                  </label>
                );
              })}
            </div>
            {group.id === "google" && (
              <p style={{ fontSize: 13 }}>In your OAuth client, add this authorized redirect URI: <code style={{ color: "var(--text)" }}>{origin}/api/google/callback</code></p>
            )}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
              <button type="button" className="btn btn-primary btn-small" disabled={busy === group.id} onClick={() => save(group)}>{busy === group.id ? "Saving…" : "Save"}</button>
              {(group.id === "gemini" || group.id === "fish" || group.id === "email") && <button type="button" className="btn btn-ghost btn-small" disabled={busy === group.id} onClick={() => test(group.id)}>Test</button>}
              {group.id === "google" && (data.googleSignedIn
                ? <><span className="form-ok" style={{ margin: 0 }}>Signed in with Google</span><button type="button" className="btn btn-ghost btn-small" onClick={disconnectGoogle}>Disconnect</button></>
                : <a className="btn btn-ghost btn-small" href="/api/google/connect">Sign in with Google</a>)}
              {notes[group.id] && <span className={notes[group.id].ok ? "form-ok" : "form-error"} style={{ margin: 0 }}>{notes[group.id].text}</span>}
            </div>
          </section>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 28, flexWrap: "wrap" }}>
        <Link href="/" className={`btn ${geminiReady ? "btn-primary" : "btn-ghost"}`} aria-disabled={!geminiReady}>{geminiReady ? "Start talking →" : "Add your Gemini key to start"}</Link>
        <Link href="/account" className="btn btn-ghost">Assistant & plan</Link>
      </div>
    </div>
  );
}
