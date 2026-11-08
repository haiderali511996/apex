import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { enterUser } from "@/lib/credentials";
import { analyze } from "@/lib/trading/analyst";
import { closeTrades, scan, status, updateSettings, type Settings } from "@/lib/trading/engine";

export const runtime = "nodejs";
export const maxDuration = 300;

/** The Trading card: status, settings (including switching live trading on), analysis, closing and scanning. */
export async function GET() {
  const guard = await requireUser({ plan: true });
  if ("response" in guard) return guard.response;
  enterUser(guard.user.id, guard.user.role === "owner");
  try { return NextResponse.json(await status(guard.user.id)); }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't read trading status." }, { status: 502 }); }
}

export async function POST(req: NextRequest) {
  const guard = await requireUser({ plan: true });
  if ("response" in guard) return guard.response;
  enterUser(guard.user.id, guard.user.role === "owner");
  const userId = guard.user.id;
  const body = await req.json().catch(() => ({})) as { action?: string; patch?: Partial<Settings>; acceptLive?: boolean; symbol?: string; which?: string };
  try {
    switch (body.action) {
      case "settings":
        updateSettings(userId, { ...(body.patch ?? {}), acceptLive: body.acceptLive === true });
        return NextResponse.json(await status(userId));
      case "analyze":
        if (!body.symbol?.trim()) return NextResponse.json({ error: "Which market? e.g. BTC, EURUSD, gold, AAPL." }, { status: 400 });
        return NextResponse.json({ analysis: await analyze(body.symbol) });
      case "close":
        return NextResponse.json({ message: await closeTrades(userId, body.which || "all"), ...(await status(userId)) });
      case "scan":
        return NextResponse.json({ notes: await scan(userId, true), ...(await status(userId)) });
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "That didn't work." }, { status: 400 });
  }
}
