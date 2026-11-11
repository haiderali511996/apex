import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { enterUser } from "@/lib/credentials";
import { MAX_PHOTO_BYTES, savePhoto } from "@/lib/photos";

export const runtime = "nodejs";

/**
 * A photo or screenshot the user shows Sarah: a data URL from the camera, or
 * a file attached, pasted or dropped. Returns its id, which the next message
 * carries so Sarah can see it and hand it to an agent.
 */
export async function POST(req: NextRequest) {
  const guard = await requireUser({ plan: true });
  if ("response" in guard) return guard.response;
  enterUser(guard.user.id, guard.user.role === "owner");
  let bytes: Uint8Array | null = null, note = "";
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("photo");
    if (file instanceof File) { bytes = new Uint8Array(await file.arrayBuffer()); note = file.name; }
  } else {
    const body = await req.json().catch(() => ({})) as { image?: unknown; note?: unknown };
    const m = typeof body.image === "string" ? /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(body.image) : null;
    if (m) bytes = new Uint8Array(Buffer.from(m[1], "base64"));
    if (typeof body.note === "string") note = body.note;
  }
  if (!bytes?.length) return NextResponse.json({ error: "No picture was sent." }, { status: 400 });
  if (bytes.length > MAX_PHOTO_BYTES) return NextResponse.json({ error: "That picture is too big (12 MB at most)." }, { status: 413 });
  try {
    const photo = await savePhoto(guard.user.id, bytes, note);
    return NextResponse.json({ id: photo.id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't save the picture." }, { status: 400 });
  }
}
