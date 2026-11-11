"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PLANS, priceUnc, TRIAL_DAYS } from "@/lib/plans";

type State = {
  subscription: { plan: string; status: "active" | "expired" | "pending"; periodEnd: string };
  card: { brand: string; last4: string } | null;
  trialRefused: boolean;
  cardPayments: boolean;
};

/** The Billing page: the $1 card check that starts the free trial, then the plan and card on file. */
export default function Billing() {
  const [state, setState] = useState<State | null>(null);
  const [owner, setOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Back from Stripe: the webhook may land a few seconds after the redirect.
  const [confirming, setConfirming] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("card") === "done");

  const load = useCallback(async () => {
    const [res, me] = await Promise.all([fetch("/api/billing/trial"), fetch("/api/me")]);
    if (res.ok) setState(await res.json());
    if (me.ok) setOwner((await me.json()).user?.role === "owner");
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!confirming) return;
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      const res = await fetch("/api/billing/trial");
      const body = res.ok ? (await res.json()) as State : null;
      if (body) setState(body);
      if ((body && (body.subscription.status !== "pending" || body.trialRefused)) || tries > 20) { clearInterval(t); setConfirming(false); }
    }, 2000);
    return () => clearInterval(t);
  }, [confirming]);

  const addCard = async () => {
    setBusy(true); setError("");
    const res = await fetch("/api/billing/trial", { method: "POST" }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    if (body.url) { window.location.href = body.url; return; }
    setError(body.error || "Couldn't open the card check.");
    setBusy(false);
  };

  if (!state) return <div style={{ padding: "60px 0" }}><p>Loading…</p></div>;
  const { subscription, card } = state;
  const ends = new Date(subscription.periodEnd).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  const planName = subscription.plan === "trial" ? "Free trial" : PLANS.find(p => p.id === subscription.plan)?.name ?? subscription.plan;
  const daysLeft = Math.max(0, Math.ceil((Date.parse(subscription.periodEnd) - Date.now()) / 86_400_000));

  return (
    <div style={{ display: "grid", gap: 20, padding: "32px 0 60px", maxWidth: 880 }}>
      <div>
        <p className="eyebrow">Billing</p>
        <h2 style={{ marginBottom: 6 }}>{subscription.status === "pending" ? `Start your ${TRIAL_DAYS}-day free trial` : "Your plan and payment"}</h2>
      </div>

      {owner && <section className="card" style={{ padding: 24 }}><p style={{ margin: 0 }}>You own this server: no plan or card needed.</p></section>}

      {!owner && subscription.status === "pending" && (
        <section className="card" style={{ padding: 28, display: "grid", gap: 16 }}>
          {confirming ? <p style={{ margin: 0 }}>Confirming your card with Stripe…</p> : state.trialRefused ? <>
            <h3 style={{ fontSize: 19 }}>This card has already had a free trial</h3>
            <p style={{ margin: 0 }}>Your card ({card?.brand} •••• {card?.last4}) works, but it was already used for a free trial on another account. Choose a plan to start using your assistant.</p>
            <Link href="/account#plan" className="btn btn-primary" style={{ justifySelf: "start" }}>Choose a plan</Link>
          </> : <>
            <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
              <li><b style={{ color: "var(--text)" }}>Add your card</b> on Stripe&apos;s secure page — your card number never reaches our servers.</li>
              <li>We charge <b style={{ color: "var(--warm)" }}>$1 once</b> to make sure the card works.</li>
              <li>Your <b style={{ color: "var(--text)" }}>{TRIAL_DAYS}-day free trial</b> starts straight away. Nothing else is charged automatically — when it ends, you choose a plan.</li>
            </ol>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-primary" disabled={busy || !state.cardPayments} onClick={addCard}>{busy ? "Opening Stripe…" : "Add card and start trial — $1"}</button>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>🔒 Secure checkout by Stripe · Visa, Mastercard, Amex and more</span>
            </div>
            {!state.cardPayments && <p className="form-error" style={{ margin: 0 }}>Card payments aren&apos;t switched on yet. Please check back soon.</p>}
          </>}
          {error && <p className="form-error" style={{ margin: 0 }}>{error}</p>}
        </section>
      )}

      {!owner && subscription.status !== "pending" && (
        <section className="card" style={{ padding: 24, display: "grid", gap: 10 }}>
          <h3 style={{ fontSize: 18 }}>{planName}</h3>
          <p style={{ margin: 0 }}>{subscription.status === "active" ? <>Active until <b style={{ color: "var(--text)" }}>{ends}</b> · {daysLeft} day{daysLeft === 1 ? "" : "s"} left</> : <>Ended on {ends}. Choose a plan to keep talking.</>}</p>
          {card && <p style={{ margin: 0 }}>Card on file: <b style={{ color: "var(--text)" }}>{card.brand.toUpperCase()} •••• {card.last4}</b></p>}
          {confirming && <p style={{ margin: 0, color: "#7ee2a8" }}>Card confirmed — your free trial has started.</p>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
            <Link href="/account#plan" className="btn btn-primary btn-small">{subscription.plan === "trial" || subscription.status !== "active" ? "Choose a plan" : "Change or extend plan"}</Link>
            {subscription.plan === "trial" && subscription.status === "active" && <Link href="/connections?welcome=1" className="btn btn-ghost btn-small">Next: connect your keys</Link>}
          </div>
        </section>
      )}

      {!owner && <section className="card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 18, marginBottom: 10 }}>Plans</h3>
        <div className="grid3">
          {PLANS.map(p => <div key={p.id} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 16 }}>
            <b style={{ color: "var(--text)" }}>{p.name}</b>
            <div style={{ fontSize: 22, color: "var(--text)", margin: "6px 0 2px" }}>${p.priceUsd}<span style={{ fontSize: 14, color: "var(--muted)" }}> / month</span></div>
            <div style={{ color: "var(--warm)", fontSize: 14 }}>or {priceUnc(p).toLocaleString()} UNC</div>
          </div>)}
        </div>
        <p style={{ margin: "12px 0 0", fontSize: 14 }}>Pay by card or with UNC on your <Link href="/account#plan" style={{ color: "var(--accent)" }}>Account</Link> page.</p>
      </section>}
    </div>
  );
}
