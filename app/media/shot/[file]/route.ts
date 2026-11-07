import { NextRequest } from "next/server";
import { publicPhoto } from "@/lib/photos";

export const runtime = "nodejs";

/**
 * Where the Developer on the user's computer downloads a photo they showed
 * Sarah. 36 random hex characters, never listed, not indexed, and gone after
 * a week.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const m = /^([a-f0-9]{36})\.jpg$/.exec(file);
  const bytes = m ? await publicPhoto(m[1]) : null;
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600", "x-robots-tag": "noindex" },
  });
}
