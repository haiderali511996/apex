"use client";

import Link from "next/link";
import { useState } from "react";

/** Sign-up and log-in. New accounts go to Connections to add their keys first. */
export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signup = mode === "signup";

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true); setError("");
    const form = new FormData(e.currentTarget);
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    if (!res?.ok) { setError(body.error || "Something went wrong."); setBusy(false); return; }
    const next = new URLSearchParams(window.location.search).get("next");
    // A whole-page load, so the app starts with the new session.
    window.location.href = signup ? "/connections?welcome=1" : next && next.startsWith("/") ? next : "/";
  };

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>{signup ? "Create your account" : "Welcome back"}</h1>
        <p>{signup ? "Your assistant is ready in a few minutes." : "Log in to talk to your assistant."}</p>
        {signup && <label className="field">Your name<input name="name" autoComplete="name" required maxLength={60} /></label>}
        <label className="field">Email<input name="email" type="email" autoComplete="email" required /></label>
        <label className="field">Password<input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 8 : 1} />
          {signup && <small>At least 8 characters.</small>}
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>{busy ? "One moment…" : signup ? "Create account" : "Log in"}</button>
        <p className="auth-switch">{signup ? <>Already have an account? <Link href="/login">Log in</Link></> : <>New here? <Link href="/signup">Create an account</Link></>}</p>
      </form>
    </div>
  );
}
