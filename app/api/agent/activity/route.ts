import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { activity } from "@/lib/activity";
import { recentJobs } from "@/lib/devices";

export const runtime = "nodejs";

/** Every agent at work for this account (and Claude Code jobs on its computers), for the deck's live cards. */
export async function GET() {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  return NextResponse.json({ agents: activity(guard.user.id), jobs: recentJobs(guard.user.id), now: Date.now() }, { headers: { "cache-control": "no-store" } });
}
