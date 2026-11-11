"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Inbox = { address: string; imap: string; smtp: string };

/** Any number of inboxes from any providers, each tested before it's saved. */
export default function EmailAccounts() {
  const [inboxes, setInboxes] = useState<Inbox[] | null>(null);
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [imap, setImap] = useState("");
  const [smtp, setSmtp] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { void fetch("/api/email-accounts").then(r => r.ok ? r.json() : null).then(b => b && setInboxes(b.accounts)); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setNote({ ok: true, text: "Testing the connection…" });
    const res = await fetch("/api/email-accounts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, password, imap, smtp }) }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (res?.ok) {
      setInboxes(body.accounts); setNote({ ok: true, text: body.message });
      setAddress(""); setPassword(""); setImap(""); setSmtp(""); setAdvanced(false);
    } else {
      setNote({ ok: false, text: body.error || "Couldn't reach the server. Check your connection." });
      if (/server|reach/i.test(body.error ?? "")) setAdvanced(true);
    }
  };

  const remove = async (addr: string) => {
    if (!confirm(`Disconnect ${addr}? Your assistant will stop reading and sending from it.`)) return;
    const res = await fetch(`/api/email-accounts?address=${encodeURIComponent(addr)}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (body.accounts) setInboxes(body.accounts);
    setNote(null);
  };

  return (
    <section className="card" style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <h3 style={{ fontSize: 18 }}>Email inboxes (any provider)</h3>
        <Link href="/docs#email" style={{ color: "var(--accent)", fontSize: 14 }}>How to get an app password ↗</Link>
      </div>
      <p style={{ margin: "6px 0 16px" }}>
        Connect as many inboxes as you use, from any provider: Gmail, Outlook, Yahoo, iCloud, Zoho, AWS WorkMail, your web host or your company&apos;s server.
        Your assistant reads and searches them all, and replies from the right address. Nothing is sent until you approve the draft.
        Use an app password where your provider offers one, and make sure IMAP is on. Servers are found automatically.
      </p>

      {inboxes && inboxes.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          {inboxes.map(i => (
            <div key={i.address} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", flexWrap: "wrap" }}>
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>✉ <b style={{ color: "var(--text)" }}>{i.address}</b> <span style={{ color: "var(--muted)", fontSize: 13 }}>· {i.imap}</span></span>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => remove(i.address)}>Disconnect</button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={add}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "4px 16px" }}>
          <label className="field"><span>Email address</span>
            <input type="email" autoComplete="off" spellCheck={false} placeholder="you@yourcompany.com" value={address} onChange={e => setAddress(e.target.value)} required />
          </label>
          <label className="field"><span>Password or app password</span>
            <input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required />
          </label>
          {advanced && <>
            <label className="field"><span>Incoming (IMAP) server <span style={{ color: "var(--muted)" }}>(optional)</span></span>
              <input type="text" spellCheck={false} placeholder="imap.example.com:993" value={imap} onChange={e => setImap(e.target.value)} />
            </label>
            <label className="field"><span>Outgoing (SMTP) server <span style={{ color: "var(--muted)" }}>(optional)</span></span>
              <input type="text" spellCheck={false} placeholder="smtp.example.com:465" value={smtp} onChange={e => setSmtp(e.target.value)} />
            </label>
          </>}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <button type="submit" className="btn btn-primary btn-small" disabled={busy}>{busy ? "Testing…" : inboxes?.length ? "Add another inbox" : "Connect inbox"}</button>
          {!advanced && <button type="button" className="btn btn-ghost btn-small" onClick={() => setAdvanced(true)}>Enter servers manually</button>}
          {note && <span className={note.ok ? "form-ok" : "form-error"} style={{ margin: 0 }}>{note.text}</span>}
        </div>
      </form>
    </section>
  );
}
