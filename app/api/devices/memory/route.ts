import { NextRequest, NextResponse } from "next/server";
import { deviceForToken } from "@/lib/devices";
import { enterUser } from "@/lib/credentials";
import { getPersona, getUserById } from "@/lib/auth";
import { memoryMarkdown } from "@/lib/memory";

export const runtime = "nodejs";

/** The desktop app keeps a readable copy of the account's memory on the computer. */
export async function GET(req: NextRequest) {
  const device = deviceForToken(req.headers.get("authorization"));
  if (!device) return NextResponse.json({ error: "Not linked." }, { status: 401 });
  const user = getUserById(device.userId);
  if (!user) return NextResponse.json({ error: "Not linked." }, { status: 401 });
  enterUser(user.id, user.role === "owner");
  return new Response(await memoryMarkdown(user.id, getPersona(user).name), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } });
}
