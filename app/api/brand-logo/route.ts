import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { enterUser } from "@/lib/credentials";
import { hasLogo, readLogo, removeLogo, saveLogo } from "@/lib/designs";

export const runtime = "nodejs";

/** The account's brand logo, stamped onto the post designs Sarah makes. */
export async function GET(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  if (req.nextUrl.searchParams.has("image")) {
    const png = await readLogo(guard.user.id);
    return png ? new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "private, no-store" } }) : new Response("Not found", { status: 404 });
  }
  return NextResponse.json({ logo: await hasLogo(guard.user.id) });
}

export async function POST(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  enterUser(guard.user.id, guard.user.role === "owner");
  const form = await req.formData().catch(() => null);
  const file = form?.get("logo");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a logo file." }, { status: 400 });
  try {
    await saveLogo(guard.user.id, new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json({ logo: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't save the logo." }, { status: 400 });
  }
}

export async function DELETE() {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  await removeLogo(guard.user.id);
  return NextResponse.json({ logo: false });
}
