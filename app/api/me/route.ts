import { NextRequest, NextResponse } from "next/server";
import { currentUser, getPersona, getSubscription, savePersona } from "@/lib/auth";
import { cleanAssistantName } from "@/lib/persona";
import { voiceUsage } from "@/lib/usage";
import { limitsFor } from "@/lib/plans";

export const runtime = "nodejs";

/** The signed-in user, their assistant's settings and their plan. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  const subscription = getSubscription(user), voice = voiceUsage(user);
  const usage = user.role === "owner" ? null : { voiceMinutesUsed: Math.round(voice.usedMinutes * 10) / 10, voiceMinutes: voice.limitMinutes, computers: limitsFor(subscription.plan).computers };
  return NextResponse.json({ user, persona: getPersona(user), subscription, usage });
}

/** Saves the assistant's name, face and voice. */
export async function PUT(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; face?: unknown; voice?: unknown };
  const name = cleanAssistantName(body.name);
  if (!name) return NextResponse.json({ error: "Use a name of 1–24 letters, e.g. Sarah, Adam or Zara." }, { status: 400 });
  if (body.face !== "female" && body.face !== "male") return NextResponse.json({ error: "Choose a female or male face." }, { status: 400 });
  if (body.voice !== "female" && body.voice !== "male") return NextResponse.json({ error: "Choose a female or male voice." }, { status: 400 });
  savePersona(user.id, { name, face: body.face, voice: body.voice });
  return NextResponse.json({ ok: true, persona: getPersona(user) });
}
