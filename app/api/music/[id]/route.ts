import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getTrack, trackFile, trackSize } from "@/lib/music";

export const runtime = "nodejs";

/** Streams one of this account's tracks, with Range support so players can seek (Safari needs it). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  const { id } = await params;
  if (!getTrack(guard.user.id, id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const file = trackFile(guard.user.id, id);
  const size = await trackSize(guard.user.id, id).catch(() => 0);
  if (!size) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const headers: Record<string, string> = { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=86400" };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new NextResponse(body, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  return new NextResponse(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { ...headers, "Content-Length": String(size) } });
}
