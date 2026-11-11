"use client";

import { useState } from "react";

/** The editor: a title and plain-text paragraphs (leave a blank line between them). */
export default function WritePost() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await fetch("/api/community", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, body }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { setError(out.error || "Couldn't publish."); setBusy(false); return; }
    window.location.href = `/community/${out.slug}`;
  };

  return (
    <form onSubmit={publish} style={{ display: "grid", gap: 4, maxWidth: 900, padding: "16px 0 72px" }}>
      <p className="eyebrow">Community</p>
      <h1 style={{ margin: "0 0 18px", fontSize: 32 }}>Write a post</h1>
      <label className="field">Title<input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="How I run my mornings with my assistant" required /></label>
      <label className="field">Your post
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={16} maxLength={20000} required
          placeholder="Share your setup, a workflow, a tip or a question. Leave a blank line between paragraphs. Links and web addresses aren't allowed."
          style={{ background: "#020d18", border: "1px solid var(--line)", color: "var(--text)", borderRadius: 10, padding: 12, fontSize: 16, lineHeight: 1.6, fontFamily: "inherit", resize: "vertical" }} />
        <small>{body.length.toLocaleString()} / 20,000 · Posts are public. Don&apos;t include keys, passwords or private details.</small>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn-primary" style={{ justifySelf: "start" }} disabled={busy}>{busy ? "Publishing…" : "Publish"}</button>
    </form>
  );
}
