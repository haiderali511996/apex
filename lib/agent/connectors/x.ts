import type { ConnectorStatus, Report } from "../types";
import { cred } from "@/lib/credentials";

const API = "https://api.twitter.com/2";

const REQUIRED_ENV_READ = ["X_BEARER_TOKEN", "X_USERNAME"] as const;

function missingEnv(): string[] {
  return REQUIRED_ENV_READ.filter((key) => !cred(key));
}

export function isConfigured(): boolean {
  return missingEnv().length === 0;
}

export function canPost(): boolean {
  return Boolean(cred("X_ACCESS_TOKEN"));
}

export function status(): ConnectorStatus {
  const missing = missingEnv();
  if (!canPost()) missing.push("X_ACCESS_TOKEN (needed to post, not just read)");
  return {
    platform: "x",
    label: "X (Twitter)",
    configured: isConfigured(),
    missingEnv: missing,
    capabilities: canPost() ? ["read", "write"] : ["read"],
  };
}

export async function getXReport(): Promise<Report> {
  if (!isConfigured()) throw new Error(`X is not configured. Missing: ${missingEnv().join(", ")}. See SETUP.md.`);
  const username = cred("X_USERNAME")!;
  const res = await fetch(`${API}/users/by/username/${username}?user.fields=public_metrics`, {
    headers: { Authorization: `Bearer ${cred("X_BEARER_TOKEN")}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`X API error: ${data?.detail || res.statusText}`);
  const m = data.data?.public_metrics ?? {};
  return {
    platform: "x",
    title: `X — @${data.data?.username ?? username}`,
    rangeLabel: "current totals",
    metrics: [
      { label: "Followers", value: m.followers_count ?? "—" },
      { label: "Following", value: m.following_count ?? "—" },
      { label: "Posts", value: m.tweet_count ?? "—" },
    ],
    fetchedAt: new Date().toISOString(),
  };
}

/** Executes an already-approved tweet. Never call directly from a tool — always go through a pending action confirmed by the user. Requires a user-context OAuth2 access token with the tweet.write scope (see SETUP.md); app-only bearer tokens cannot post. */
/** Uploads a picture to X and returns its media id. Needs the media.write scope on the token. */
async function uploadPicture(imageUrl: string): Promise<string> {
  const picture = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!picture.ok) throw new Error(`Couldn't load the picture to post (HTTP ${picture.status}).`);
  const form = new FormData();
  form.append("media", new Blob([await picture.arrayBuffer()], { type: picture.headers.get("content-type") || "image/jpeg" }), "design.jpg");
  form.append("media_category", "tweet_image");
  const res = await fetch("https://api.x.com/2/media/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${cred("X_ACCESS_TOKEN")}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.data?.id) {
    const why = data?.detail || data?.title || res.statusText;
    throw new Error(res.status === 403 || res.status === 401
      ? `X refused the picture upload (${why}). The X token needs the media.write permission — reconnect X with it.`
      : `X picture upload failed: ${why}`);
  }
  return String(data.data.id);
}

export async function publishTweet(payload: { text: string; imageUrl?: string }): Promise<string> {
  if (!canPost()) throw new Error("X_ACCESS_TOKEN is not set — posting requires a user-context OAuth2 token, not the app-only bearer token. See SETUP.md.");
  const media = payload.imageUrl ? { media: { media_ids: [await uploadPicture(payload.imageUrl)] } } : {};
  const res = await fetch(`${API}/tweets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cred("X_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: payload.text, ...media }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`X API error: ${data?.detail || res.statusText}`);
  return `Posted to X: https://x.com/${cred("X_USERNAME")}/status/${data.data.id}`;
}
