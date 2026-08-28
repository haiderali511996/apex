import type { ConnectorStatus, Report } from "../types";
import { getTikTokTokens, setTikTokTokens } from "../store";

const REQUIRED_ENV = ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REFRESH_TOKEN"] as const;

function missingEnv(): string[] {
  return REQUIRED_ENV.filter((key) => !process.env[key]);
}

export function isConfigured(): boolean {
  return missingEnv().length === 0;
}

export function status(): ConnectorStatus {
  return {
    platform: "tiktok",
    label: "TikTok",
    configured: isConfigured(),
    missingEnv: missingEnv(),
    capabilities: ["read", "write"],
  };
}

/**
 * TikTok access tokens expire in ~24h and refresh tokens rotate on every
 * use, so the current pair is cached in the local state file (seeded from
 * TIKTOK_REFRESH_TOKEN the first time) rather than re-read from env each call.
 */
async function getAccessToken(): Promise<string> {
  const cached = await getTikTokTokens();
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) return cached.accessToken;

  const refreshToken = cached?.refreshToken ?? process.env.TIKTOK_REFRESH_TOKEN;
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: refreshToken!,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`TikTok token refresh failed: ${data?.error_description || res.statusText}`);
  }
  await setTikTokTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: now + data.expires_in * 1000,
  });
  return data.access_token;
}

export async function getTiktokReport(): Promise<Report> {
  if (!isConfigured()) throw new Error(`TikTok is not configured. Missing: ${missingEnv().join(", ")}. See SETUP.md.`);
  const token = await getAccessToken();
  const res = await fetch(
    "https://open.tiktokapis.com/v2/user/info/?fields=display_name,follower_count,likes_count,video_count",
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`TikTok API error: ${data?.error?.message || res.statusText}`);
  const u = data.data?.user ?? {};
  return {
    platform: "tiktok",
    title: `TikTok — ${u.display_name ?? "account"}`,
    rangeLabel: "current totals",
    metrics: [
      { label: "Followers", value: u.follower_count ?? "—" },
      { label: "Total likes", value: u.likes_count ?? "—" },
      { label: "Videos", value: u.video_count ?? "—" },
    ],
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Kicks off a TikTok video post from a publicly reachable video URL.
 * Executes an already-approved post — never call directly from a tool,
 * always go through a pending action confirmed by the user. TikTok's
 * Content Posting API processes uploads asynchronously; this returns the
 * publish_id you can use to poll TikTok's status endpoint for delivery.
 */
export async function publishTiktokVideo(payload: { videoUrl: string; caption: string }): Promise<string> {
  const token = await getAccessToken();
  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      post_info: { title: payload.caption, privacy_level: "SELF_ONLY" },
      source_info: { source: "PULL_FROM_URL", video_url: payload.videoUrl },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`TikTok API error: ${data?.error?.message || res.statusText}`);
  return `TikTok upload started (publish_id: ${data.data?.publish_id}). Note: privacy_level is SELF_ONLY (draft) until TikTok approves your app for public posting — see SETUP.md.`;
}
