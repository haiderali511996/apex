import { NextRequest } from "next/server";
import { publicDesign } from "@/lib/designs";

export const runtime = "nodejs";

/**
 * A design's public link, which Instagram and Facebook fetch when posting it.
 * The id is 36 random hex characters, so a link is only known to its owner and
 * whoever it was posted to. Not indexed.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const m = /^([a-f0-9]{36})\.jpg$/.exec(file);
  const bytes = m ? await publicDesign(m[1]) : null;
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable",
      "x-robots-tag": "noindex",
    },
  });
}
