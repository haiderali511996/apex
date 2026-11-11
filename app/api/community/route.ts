import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createPost, deletePost, findLinks, listPosts } from "@/lib/community";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ posts: listPosts().map(({ body, ...p }) => ({ ...p, excerpt: body.slice(0, 220) })) });
}

/** Publishes a post as the signed-in user. */
export async function POST(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  const { title, body } = (await req.json().catch(() => ({}))) as { title?: unknown; body?: unknown };
  if (typeof title !== "string" || title.trim().length < 4 || title.trim().length > 120) return NextResponse.json({ error: "Give the post a title of 4–120 characters." }, { status: 400 });
  if (typeof body !== "string" || body.trim().length < 40 || body.length > 20_000) return NextResponse.json({ error: "Write at least 40 characters (up to 20,000)." }, { status: 400 });
  // Only the admin may publish links; everyone else's posts stay link-free.
  const links = guard.user.role === "owner" ? [] : findLinks(`${title}\n${body}`);
  if (links.length) return NextResponse.json({ error: `Links and web addresses aren't allowed in community posts. Please remove: ${links.join(", ")}` }, { status: 400 });
  const post = createPost(guard.user.id, title.trim(), body.trim());
  return NextResponse.json({ ok: true, slug: post.slug });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!deletePost(id, guard.user.id, guard.user.role === "owner")) return NextResponse.json({ error: "You can only delete your own posts." }, { status: 403 });
  return NextResponse.json({ ok: true });
}
