import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { addTrack, deleteTrack, listTracks, MAX_TRACK_BYTES, MAX_TRACKS } from "@/lib/music";

export const runtime = "nodejs";

/** This account's own background music. */
export async function GET() {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  return NextResponse.json({ tracks: listTracks(guard.user.id), maxTracks: MAX_TRACKS, maxTrackMb: MAX_TRACK_BYTES / 1024 / 1024 });
}

/** Uploads one or more MP3s (form field "files"). Each is checked on its own; the reply lists what was refused. */
export async function POST(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter((f): f is File => typeof f === "object" && "arrayBuffer" in f);
  if (!files.length) return NextResponse.json({ error: "Choose one or more .mp3 files." }, { status: 400 });
  const added = [], errors: string[] = [];
  for (const file of files) {
    try {
      if (file.size > MAX_TRACK_BYTES) throw new Error(`${file.name} is over ${MAX_TRACK_BYTES / 1024 / 1024} MB.`);
      added.push(await addTrack(guard.user.id, file.name, new Uint8Array(await file.arrayBuffer())));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return NextResponse.json({ added, errors, tracks: listTracks(guard.user.id) }, { status: added.length ? 200 : 400 });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  if (!(await deleteTrack(guard.user.id, req.nextUrl.searchParams.get("id") || ""))) return NextResponse.json({ error: "That track isn't in your music." }, { status: 404 });
  return NextResponse.json({ ok: true, tracks: listTracks(guard.user.id) });
}
