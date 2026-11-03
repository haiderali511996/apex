"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePersona } from "@/lib/usePersona";
import { FACES, type Face, type VoiceGender } from "@/lib/persona";
import { PLANS, priceUnc, type PlanId } from "@/lib/plans";

type UncConfig = { configured: false; missing: string[] } | {
  configured: true; chainId: number; chainName: string; token: string; receiver: string;
  decimals: number; symbol: string; explorer: string; confirmations: number;
};

type Eth = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
type Order = { orderId: string; plan: PlanId; amount: string; amountUnits: string; receiver: string; token: string; symbol: string; chainName: string; expiresAt: string };

export default function Account() {
  const { user, persona, subscription, usage, reload } = usePersona();
  const [name, setName] = useState(persona.name);
  const [face, setFace] = useState<Face>(persona.face);
  const [voice, setVoice] = useState<VoiceGender>(persona.voice);
  const [saved, setSaved] = useState<{ ok: boolean; text: string } | null>(null);
  const [unc, setUnc] = useState<UncConfig | null>(null);
  const [plan, setPlan] = useState<PlanId>("pro");
  const [pay, setPay] = useState<{ ok: boolean; text: string } | null>(null);
  const [paying, setPaying] = useState(false);
  const [manualHash, setManualHash] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [cardEnabled, setCardEnabled] = useState(false);
  useEffect(() => {
    void fetch("/api/billing/card").then(r => r.json()).then(b => setCardEnabled(!!b.enabled)).catch(() => {});
    if (new URLSearchParams(window.location.search).get("paid") === "card") setPay({ ok: true, text: "Card payment received — your plan updates within a few seconds. Refresh if it hasn't yet." });
  }, []);
  const payByCard = async () => {
    setPay(null);
    const res = await fetch("/api/billing/card", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan }) });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.url) window.location.href = body.url;
    else setPay({ ok: false, text: body.error || "Couldn't start the card payment." });
  };

  useEffect(() => { setName(persona.name); setFace(persona.face); setVoice(persona.voice); }, [persona]);
  useEffect(() => { void fetch("/api/billing/unc").then(r => r.json()).then(setUnc).catch(() => {}); }, []);

  const saveAssistant = async () => {
    const res = await fetch("/api/me", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, face, voice }) });
    const body = await res.json().catch(() => ({}));
    setSaved(res.ok ? { ok: true, text: `Saved. Say “Hey ${name}” to talk.` } : { ok: false, text: body.error || "Couldn't save." });
    if (res.ok) await reload();
  };

  /** Starts an order: the server picks this order's exact, unique amount. */
  const startOrder = async (): Promise<Order | null> => {
    setPay(null);
    const res = await fetch("/api/billing/unc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setPay({ ok: false, text: body.error || "Couldn't start the order." }); return null; }
    setOrder(body);
    return body as Order;
  };

  /** Asks the server to confirm a transaction for the order, waiting while it is mined. */
  const claim = async (current: Order, txHash: string) => {
    for (let tries = 0; tries < 40; tries++) {
      const res = await fetch("/api/billing/unc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: current.orderId, txHash }) });
      const body = await res.json().catch(() => ({}));
      if (res.status === 202) { setPay({ ok: true, text: "Waiting for the blockchain to confirm your payment…" }); await new Promise(r => setTimeout(r, 6000)); continue; }
      if (!res.ok) { setPay({ ok: false, text: body.error || "Couldn't confirm the payment." }); return; }
      setPay({ ok: true, text: `Paid — your ${body.plan} plan runs until ${new Date(body.periodEnd).toLocaleDateString()}.` });
      setOrder(null); setManualHash("");
      await reload();
      return;
    }
    setPay({ ok: false, text: "Still not confirmed. Press Confirm payment again in a few minutes." });
  };

  const payWithWallet = async () => {
    if (!unc?.configured) return;
    const eth = (window as unknown as { ethereum?: Eth }).ethereum;
    if (!eth) { setPay({ ok: false, text: "No crypto wallet found in this browser. Install MetaMask, or use “Pay from an exchange” below." }); return; }
    setPaying(true);
    try {
      const current = order?.plan === plan ? order : await startOrder();
      if (!current) return;
      const [from] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const chainHex = `0x${unc.chainId.toString(16)}`;
      if ((await eth.request({ method: "eth_chainId" })) !== chainHex) {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
      }
      // ERC-20 transfer(receiver, this order's exact amount)
      const data = "0xa9059cbb" + current.receiver.replace(/^0x/, "").padStart(64, "0") + BigInt(current.amountUnits).toString(16).padStart(64, "0");
      const txHash = (await eth.request({ method: "eth_sendTransaction", params: [{ from, to: current.token, data }] })) as string;
      setPay({ ok: true, text: "Payment sent. Confirming on the blockchain…" });
      await claim(current, txHash);
    } catch (err) {
      const e = err as { code?: number; message?: string };
      setPay({ ok: false, text: e.code === 4001 ? "You cancelled in your wallet." : e.code === 4902 ? `Add the ${unc.chainName} network to your wallet, then try again.` : e.message || "The wallet couldn't send the payment." });
    } finally { setPaying(false); }
  };

  if (!user) return <div className="auth"><p style={{ color: "var(--muted)" }}>Loading your account…</p></div>;
  const ends = subscription ? new Date(subscription.periodEnd).toLocaleDateString() : "";

  return (
    <div style={{ padding: "16px 0 72px", display: "grid", gap: 18 }}>
      <div>
        <p className="eyebrow">Account</p>
        <h1 style={{ margin: "0 0 6px", fontSize: 34 }}>Hi {user.displayName.split(" ")[0]}</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>{user.email}{user.role === "owner" ? " · Owner" : ""} · <Link href="/connections" style={{ color: "var(--accent)" }}>Connections</Link> · <Link href="/" style={{ color: "var(--accent)" }}>Open the assistant</Link></p>
      </div>

      <section className="card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 18 }}>Your assistant</h3>
        <p style={{ marginBottom: 16 }}>Its name is also the wake word: say “Hey {name || "…"}”.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18 }}>
          <label className="field">Name<input value={name} onChange={e => setName(e.target.value)} maxLength={24} placeholder="Sarah, Adam, Zara…" /></label>
          <div className="field">Face
            <div className="choice">{(["female", "male"] as const).map(f => <button type="button" key={f} className={face === f ? "is-on" : ""} onClick={() => setFace(f)}>{FACES[f].label}</button>)}</div>
          </div>
          <div className="field">Voice
            <div className="choice">{(["female", "male"] as const).map(v => <button type="button" key={v} className={voice === v ? "is-on" : ""} onClick={() => setVoice(v)}>{v === "female" ? "Female" : "Male"}</button>)}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 6 }}>
          <button type="button" className="btn btn-primary btn-small" onClick={saveAssistant}>Save assistant</button>
          {saved && <span className={saved.ok ? "form-ok" : "form-error"} style={{ margin: 0 }}>{saved.text}</span>}
        </div>
      </section>

      <section className="card" id="plan" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 18 }}>Your plan</h3>
        <p style={{ marginBottom: 16 }}>
          {user.role === "owner" ? "You own this server: no plan needed." : subscription?.status === "pending"
            ? <>Your free trial starts once your card is checked. <Link href="/billing" style={{ color: "var(--accent)" }}>Add your card</Link> — or choose a plan below.</>
            : subscription?.status === "active"
            ? <>{subscription.plan === "trial" ? "Free trial" : PLANS.find(p => p.id === subscription.plan)?.name ?? subscription.plan} — active until {ends}.</>
            : <>Your plan ended on {ends}. Choose a plan to keep talking.</>}
        </p>
        {usage && <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 6 }}>
            <span>Voice this month</span><span>{usage.voiceMinutesUsed} of {usage.voiceMinutes.toLocaleString()} minutes · up to {usage.computers} computer{usage.computers === 1 ? "" : "s"}</span>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: "#020d18", border: "1px solid var(--line)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, (usage.voiceMinutesUsed / usage.voiceMinutes) * 100)}%`, background: usage.voiceMinutesUsed >= usage.voiceMinutes ? "#e8735a" : "var(--accent)" }} />
          </div>
        </div>}
        <div className="choice" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", marginBottom: 14 }}>
          {PLANS.map(p => <button type="button" key={p.id} className={plan === p.id ? "is-on" : ""} onClick={() => setPlan(p.id)}>
            <b>{p.name}</b><br /><span style={{ color: "var(--warm)" }}>{priceUnc(p).toLocaleString()} UNC</span> <span style={{ color: "var(--muted)" }}>(${p.priceUsd}) / 30 days</span>
          </button>)}
        </div>
        {cardEnabled && <div style={{ marginBottom: 14 }}>
          <button type="button" className="btn btn-primary" onClick={payByCard}>Pay ${PLANS.find(p => p.id === plan)!.priceUsd} by card</button>
          <span style={{ color: "var(--muted)", fontSize: 13, marginLeft: 12 }}>Secure checkout by Stripe</span>
        </div>}
        {unc && !unc.configured
          ? <p className="form-error">UNC payments aren&apos;t switched on yet{user.role === "owner" ? ` — add ${unc.missing.join(", ")} to .env.local.` : ". Please check back soon."}</p>
          : <>
            <button type="button" className="btn btn-primary" disabled={paying || !unc} onClick={payWithWallet}>{paying ? "Waiting for your wallet…" : `Pay ${priceUnc(PLANS.find(p => p.id === plan)!).toLocaleString()} UNC with your wallet`}</button>
            {unc?.configured && <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
              <p style={{ fontSize: 14, marginBottom: 10 }}><b style={{ color: "var(--text)" }}>Pay from an exchange or another wallet</b></p>
              {!order || order.plan !== plan
                ? <button type="button" className="btn btn-ghost btn-small" onClick={startOrder}>Get my payment amount</button>
                : <>
                  <p style={{ fontSize: 14, lineHeight: 1.7 }}>
                    Send <b style={{ color: "var(--warm)" }}>exactly {order.amount} {order.symbol}</b> on {order.chainName} to<br />
                    <code style={{ color: "var(--text)", wordBreak: "break-all" }}>{order.receiver}</code><br />
                    before {new Date(order.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. The exact amount is how we know the payment is yours — don&apos;t round it, and if your exchange takes its fee from the amount, add the fee on top.
                  </p>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <input style={{ flex: "1 1 320px", background: "#020d18", border: "1px solid var(--line)", color: "var(--text)", borderRadius: 10, padding: "10px 12px" }} placeholder="0x… transaction hash" value={manualHash} onChange={e => setManualHash(e.target.value)} />
                    <button type="button" className="btn btn-ghost btn-small" disabled={!manualHash.trim()} onClick={() => claim(order, manualHash.trim())}>Confirm payment</button>
                  </div>
                </>}
            </div>}
          </>}
        {pay && <p className={pay.ok ? "form-ok" : "form-error"} style={{ marginTop: 12 }}>{pay.text}</p>}
      </section>

      <button type="button" className="btn btn-ghost btn-small" style={{ justifySelf: "start" }} onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/welcome"; }}>Log out</button>

      <Computers />
      <Music />

      {user.role !== "owner" && <DeleteAccount />}
    </div>
  );
}

/** Permanently deletes the account, after typing the password again. */
function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true); setError("");
    const res = await fetch("/api/me/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setError(body.error || "Couldn't delete the account."); setBusy(false); return; }
    window.location.href = "/welcome";
  };
  return (
    <section className="card" style={{ padding: 24, borderColor: "#5a2a2a" }}>
      <h3 style={{ fontSize: 18 }}>Delete account</h3>
      <p style={{ marginBottom: 14 }}>Permanently deletes your account, assistant settings, saved keys, community posts and memory. Payment records are kept for accounting. This can&apos;t be undone.</p>
      {!open ? <button type="button" className="btn btn-ghost btn-small" style={{ borderColor: "#7a3a3a", color: "#ffb4a2" }} onClick={() => setOpen(true)}>Delete my account…</button> : <>
        <label className="field" style={{ maxWidth: 360 }}>Type your password to confirm<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" className="btn btn-small" style={{ background: "#c0392b", color: "#fff" }} disabled={busy || !password} onClick={remove}>{busy ? "Deleting…" : "Delete permanently"}</button>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => { setOpen(false); setPassword(""); setError(""); }}>Cancel</button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </>}
    </section>
  );
}

type LinkedComputer = { id: string; name: string; os: string; lastSeen: string | null; online: boolean };

/** Computers linked through the desktop app, and linking a new one. */
function Computers() {
  const [devices, setDevices] = useState<LinkedComputer[]>([]);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState("");
  const load = async () => { const res = await fetch("/api/devices"); if (res.ok) setDevices((await res.json()).devices); };
  useEffect(() => { void load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, []);
  const pair = async () => {
    setError("");
    const res = await fetch("/api/devices/pair", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error || "Couldn't create a code."); else setPairing(body);
  };
  const unlink = async (id: string) => { await fetch(`/api/devices?id=${encodeURIComponent(id)}`, { method: "DELETE" }); await load(); };
  const server = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <section className="card" style={{ padding: 24 }}>
      <h3 style={{ fontSize: 18 }}>Your computers</h3>
      <p style={{ marginBottom: 14 }}>Link a Mac, Windows or Linux computer so your assistant can open apps and sites, switch Chrome profiles, set the volume and more. <a href="/docs#computer" style={{ color: "var(--accent)" }}>Setup guide</a></p>
      {devices.length > 0 && <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
        {devices.map(d => <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px" }}>
          <span><span style={{ color: d.online ? "#7ee2a8" : "var(--muted)" }}>●</span> <b style={{ color: "var(--text)" }}>{d.name}</b> <span style={{ color: "var(--muted)" }}>· {d.os} · {d.online ? "online" : d.lastSeen ? `last seen ${new Date(d.lastSeen).toLocaleString()}` : "never connected"}</span></span>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => unlink(d.id)}>Unlink</button>
        </div>)}
      </div>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/download" className="btn btn-primary btn-small">Download the desktop app</Link>
        {!pairing && <button type="button" className="btn btn-ghost btn-small" onClick={pair}>Use a pairing code instead</button>}
      </div>
      <p style={{ marginTop: 10, fontSize: 14, color: "var(--muted)" }}>Install it and sign in with this account — the computer appears here within a few seconds.</p>
      {pairing && (
        <ol style={{ lineHeight: 1.9, margin: "10px 0 0", paddingLeft: 20 }}>
          <li>Without the app (needs <a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Node.js</a>): download <a href="/downloads/sarah-desktop.mjs" download style={{ color: "var(--accent)" }}>sarah-desktop.mjs</a> on that computer.</li>
          <li>In a terminal in the download folder, run:<br /><code style={{ color: "var(--text)", wordBreak: "break-all" }}>node sarah-desktop.mjs pair {pairing.code} --server {server}</code></li>
          <li>Then keep it running with <code style={{ color: "var(--text)" }}>node sarah-desktop.mjs</code>.</li>
          <li style={{ color: "var(--muted)" }}>The code <b style={{ color: "var(--warm)", letterSpacing: "0.1em" }}>{pairing.code}</b> works once, until {new Date(pairing.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</li>
        </ol>
      )}
      {error && <p className="form-error" style={{ marginTop: 10 }}>{error}</p>}
    </section>
  );
}

type MusicTrack = { id: string; name: string; size: number };

/** This account's own background music: uploads, list and delete. Only this account can play them. */
function Music() {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const changed = (next: MusicTrack[]) => { setTracks(next); window.dispatchEvent(new Event("sarah:music-library")); };
  useEffect(() => { void fetch("/api/music").then(r => r.ok ? r.json() : null).then(b => b && setTracks(b.tracks)); }, []);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setErrors([]);
    const problems: string[] = [];
    // One request per file keeps each upload small and lets the others go through if one fails.
    for (const [i, file] of Array.from(files).entries()) {
      setBusy(`Uploading ${i + 1} of ${files.length}…`);
      const form = new FormData();
      form.append("files", file);
      const res = await fetch("/api/music", { method: "POST", body: form }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (body.tracks) changed(body.tracks);
      if (!res) problems.push(`${file.name}: upload failed — check your connection.`);
      else if (res.status === 413) problems.push(`${file.name} is too large.`);
      problems.push(...(body.errors ?? []), ...(body.error && !body.errors ? [body.error] : []));
    }
    setErrors(problems);
    setBusy("");
  };
  const remove = async (id: string) => {
    const res = await fetch(`/api/music?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (body.tracks) changed(body.tracks);
  };
  return (
    <section className="card" style={{ padding: 24 }}>
      <h3 style={{ fontSize: 18 }}>Your background music</h3>
      <p style={{ marginBottom: 14 }}>Upload your own MP3s to play behind your assistant instead of the built-in music. They&apos;re private to your account. Up to 30 tracks, 15 MB each.</p>
      {tracks.length > 0 && <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
        {tracks.map(t => <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px" }}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>♪ <b style={{ color: "var(--text)" }}>{t.name}</b> <span style={{ color: "var(--muted)" }}>· {(t.size / 1024 / 1024).toFixed(1)} MB</span></span>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => remove(t.id)}>Delete</button>
        </div>)}
      </div>}
      <label className="btn btn-primary btn-small" style={{ cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1 }}>
        {busy || (tracks.length ? "Add more MP3s" : "Upload MP3s")}
        <input type="file" accept=".mp3,audio/mpeg" multiple hidden disabled={!!busy} onChange={e => { void upload(e.target.files); e.target.value = ""; }} />
      </label>
      {!tracks.length && <p style={{ marginTop: 10, color: "var(--muted)", fontSize: 14 }}>No tracks yet — the built-in music plays.</p>}
      {errors.map((e, i) => <p key={i} className="form-error" style={{ marginTop: 8 }}>{e}</p>)}
    </section>
  );
}
