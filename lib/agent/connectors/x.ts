import type { ConnectorStatus, Report } from "../types";

const API = "https://api.twitter.com/2";

const REQUIRED_ENV_READ = ["X_BEARER_TOKEN", "X_USERNAME"] as const;

function missingEnv(): string[] {
  return REQUIRED_ENV_READ.filter((key) => !process.env[key]);
}

export function isConfigured(): boolean {
  return missingEnv().length === 0;
}

export function canPost(): boolean {
  return Boolean(process.env.X_ACCESS_TOKEN);
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
  const username = process.env.X_USERNAME!;
  const res = await fetch(`${API}/users/by/username/${username}?user.fields=public_metrics`, {
    headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` },
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
export async function publishTweet(payload: { text: string }): Promise<string> {
  if (!canPost()) throw new Error("X_ACCESS_TOKEN is not set — posting requires a user-context OAuth2 token, not the app-only bearer token. See SETUP.md.");
  const res = await fetch(`${API}/tweets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.X_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: payload.text }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`X API error: ${data?.detail || res.statusText}`);
  return `Posted to X: https://x.com/${process.env.X_USERNAME}/status/${data.data.id}`;
}
