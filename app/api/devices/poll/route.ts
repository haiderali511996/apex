import { NextRequest, NextResponse } from "next/server";
import { deviceForToken, takeCommands } from "@/lib/devices";

export const runtime = "nodejs";

/**
 * Called by the desktop app in a loop. Holds the request open for up to 20 s
 * until there is work, so commands arrive within a moment without the
 * computer accepting any incoming connection.
 */
export async function GET(req: NextRequest) {
  const device = deviceForToken(req.headers.get("authorization"));
  if (!device) return NextResponse.json({ error: "This computer isn't linked any more. Pair it again." }, { status: 401 });
  const until = Date.now() + 20_000;
  while (Date.now() < until && !req.signal.aborted) {
    const commands = takeCommands(device.id);
    if (commands.length) return NextResponse.json({ commands });
    await new Promise(r => setTimeout(r, 500));
  }
  deviceForToken(req.headers.get("authorization"));
  return NextResponse.json({ commands: [] });
}
