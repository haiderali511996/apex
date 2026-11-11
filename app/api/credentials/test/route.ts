import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { enterUser, cred } from "@/lib/credentials";
import { isConfigured as mailboxConfigured, testMailbox } from "@/lib/agent/connectors/mailbox";

export const runtime = "nodejs";

/** Checks a saved key really works, with one cheap call to its provider. */
export async function POST(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  // This request runs on this account's own keys from here on.
  enterUser(guard.user.id, guard.user.role === "owner");
  const { group } = (await req.json().catch(() => ({}))) as { group?: string };
  try {
    if (group === "gemini") {
      const key = cred("GEMINI_API_KEY");
      if (!key) return NextResponse.json({ ok: false, message: "No Gemini key saved yet." });
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(20_000) });
      return NextResponse.json(res.ok ? { ok: true, message: "Gemini key works." } : { ok: false, message: res.status === 400 || res.status === 403 ? "Google rejected this key. Copy it again from AI Studio." : `Gemini answered HTTP ${res.status}.` });
    }
    if (group === "fish") {
      const key = cred("FISH_AUDIO_API_KEY");
      if (!key) return NextResponse.json({ ok: false, message: "No Fish Audio key saved yet." });
      const res = await fetch("https://api.fish.audio/model?self=true&page_size=1", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
      return NextResponse.json(res.ok ? { ok: true, message: "Fish Audio key works." } : { ok: false, message: res.status === 401 || res.status === 403 ? "Fish Audio rejected this key." : `Fish Audio answered HTTP ${res.status}.` });
    }
    if (group === "email") {
      if (!mailboxConfigured()) return NextResponse.json({ ok: false, message: "Save your email address and password first." });
      try { return NextResponse.json({ ok: true, message: await testMailbox() }); }
      catch (err) { return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "Couldn't connect." }); }
    }
    return NextResponse.json({ ok: false, message: "This connection is checked the first time your assistant uses it." });
  } catch {
    return NextResponse.json({ ok: false, message: "Couldn't reach the provider. Check the internet connection and try again." });
  }
}
