import { requireUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { generateImage } from "@/lib/agent/geminiImage";
import { GeminiError } from "@/lib/agent/gemini";
import { enterUser } from "@/lib/credentials";

export const runtime = "nodejs";

/** Data URLs arrive as "data:image/jpeg;base64,…" — split off the payload. */
function parseDataUrl(input: string): { mimeType: string; data: string } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(input);
  return m ? { mimeType: m[1], data: m[2] } : null;
}

/** Edits a camera photo — or makes a new picture — from Haider's instruction. */
export async function POST(req: NextRequest) {
  const guard = await requireUser({ plan: true });
  if ("response" in guard) return guard.response;
  // This request runs on this account's own keys from here on.
  enterUser(guard.user.id, guard.user.role === "owner");
  const { image, instruction } = (await req.json()) as { image?: string; instruction?: string };
  if (!instruction?.trim()) return NextResponse.json({ error: "Say what you'd like the picture to be." }, { status: 400 });
  const photo = image ? parseDataUrl(image) : null;
  if (image && !photo) return NextResponse.json({ error: "image must be a base64 data URL" }, { status: 400 });
  if (photo && photo.data.length > 8_000_000) return NextResponse.json({ error: "That photo is too large." }, { status: 413 });

  try {
    const result = await generateImage(instruction.trim(), photo ?? undefined);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent/imagine]", err);
    return NextResponse.json({ error: message }, { status: err instanceof GeminiError ? err.status : 502 });
  }
}
