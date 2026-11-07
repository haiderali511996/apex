import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { agentEngines, CHOOSABLE, FIXED, setAgentEngine } from "@/lib/agentEngines";

export const runtime = "nodejs";

/** Which AI each agent uses for this account. */
export async function GET() {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  return NextResponse.json({ engines: agentEngines(guard.user.id), names: CHOOSABLE, fixed: FIXED });
}

export async function POST(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  const { agent, engine } = (await req.json().catch(() => ({}))) as { agent?: string; engine?: string };
  if (!agent || (engine !== "gemini" && engine !== "claude-code")) return NextResponse.json({ error: "Choose an agent and gemini or claude-code." }, { status: 400 });
  try { setAgentEngine(guard.user.id, agent, engine); }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't save." }, { status: 400 }); }
  return NextResponse.json({ engines: agentEngines(guard.user.id) });
}
