import { NextRequest, NextResponse } from "next/server";

/**
 * Signed-out visitors see the marketing site; the assistant and its API need
 * an account. This only checks a session cookie is present — each API route
 * checks the session itself against the database (lib/auth.ts).
 */

const PUBLIC_PAGES = ["/sitemap.xml", "/robots.txt", "/welcome", "/download", "/pricing", "/login", "/signup", "/docs", "/privacy", "/terms"];
// Each of these routes checks the session itself for anything that writes.
const PUBLIC_API = ["/api/auth/", "/api/billing/unc", "/api/community", "/api/devices/register", "/api/devices/login", "/api/devices/self", "/api/devices/poll", "/api/devices/result", "/api/devices/memory", "/api/billing/stripe-webhook", "/api/billing/card"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Community posts are public to read; writing (/community/new) needs an account.
  const communityRead = pathname === "/community" || (pathname.startsWith("/community/") && pathname !== "/community/new");
  if (PUBLIC_PAGES.includes(pathname) || communityRead || PUBLIC_API.some(p => pathname.startsWith(p))) return NextResponse.next();
  if (req.cookies.get("sid")?.value) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = pathname === "/" ? "/welcome" : "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's own files and static assets (images, audio, video).
  matcher: ["/((?!_next/|favicon|hologram/|downloads/|.*\\.(?:png|jpg|jpeg|svg|webp|webm|mp3|ico|txt)$).*)"],
};
