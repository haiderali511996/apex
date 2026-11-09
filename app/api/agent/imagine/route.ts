import { requireUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { generateImage } from "@/lib/agent/geminiImage";
import { GeminiError } from "@/lib/agent/gemini";
import { enterUser } from "@/lib/credentials";
import { hasLogo, LOGO_SPACE_NOTE, saveDesign, wantsBrandLogo } from "@/lib/designs";
import { startStep } from "@/lib/activity";
import { pickPhotos, readPhoto } from "@/lib/photos";

export const runtime = "nodejs";

/** Data URLs arrive as "data:image/jpeg;base64,…" — split off the payload. */
function parseDataUrl(input: string): { mimeType: string; data: string } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(input);
  return m ? { mimeType: m[1], data: m[2] } : null;
}

/** Edits a camera photo — or makes a new picture — from the user's instruction. */
export async function POST(req: NextRequest) {
  const guard = await requireUser({ plan: true });
  if ("response" in guard) return guard.response;
  // This request runs on this account's own keys from here on.
  enterUser(guard.user.id, guard.user.role === "owner");
  const { image, instruction, photoIds } = (await req.json()) as { image?: string; instruction?: string; photoIds?: unknown };
  if (!instruction?.trim()) return NextResponse.json({ error: "Say what you'd like the picture to be." }, { status: 400 });
  const photo = image ? parseDataUrl(image) : null;
  if (image && !photo) return NextResponse.json({ error: "image must be a base64 data URL" }, { status: 400 });
  if (photo && photo.data.length > 8_000_000) return NextResponse.json({ error: "That photo is too large." }, { status: 413 });

  // Photos the user showed, for Design to work from (their product, an old design).
  const references: { mimeType: string; data: string }[] = [];
  try {
    for (const p of pickPhotos(guard.user.id, photoIds).slice(0, 4)) {
      const bytes = await readPhoto(guard.user.id, p.id);
      if (bytes) references.push({ mimeType: "image/jpeg", data: bytes.toString("base64") });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  const end = startStep(guard.user.id, "design_picture", { instruction, use_camera: !!photo, references: references.length });
  try {
    // Post designs carry the account's real logo, stamped on afterwards
    // exactly as uploaded; the model is told to leave room and draw none.
    // The user's own photos already carry their real branding: no logo stamped over it.
    const withLogo = !references.length && wantsBrandLogo(instruction, !!photo) && await hasLogo(guard.user.id);
    const result = await generateImage(instruction.trim() + (withLogo ? LOGO_SPACE_NOTE : ""), photo ?? undefined, references);
    // Saved so it can be posted; a failure to save still shows the picture.
    try {
      const saved = await saveDesign(guard.user.id, instruction.trim(), result.image, withLogo);
      end(true, withLogo ? "Picture ready, with your logo" : "Picture ready");
      return NextResponse.json({ ...result, image: saved.image, designId: saved.design.id, url: saved.design.url });
    } catch (err) {
      console.error("[agent/imagine] save", err);
      end(true, "Picture ready");
      return NextResponse.json(result);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent/imagine]", err);
    end(false, message);
    return NextResponse.json({ error: message }, { status: err instanceof GeminiError ? err.status : 502 });
  }
}
