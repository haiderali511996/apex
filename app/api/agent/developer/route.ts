import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { recentJobs } from "@/lib/devices";

export const runtime = "nodejs";

/** The Developer's running and just-finished jobs, for the live panel on the deck. */
export async function GET() {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  return NextResponse.json({ jobs: recentJobs(guard.user.id) }, { headers: { "cache-control": "no-store" } });
}
