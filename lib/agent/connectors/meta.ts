import type { ConnectorStatus, Report } from "../types";

const GRAPH = "https://graph.facebook.com/v21.0";

const REQUIRED_ENV = ["META_PAGE_ID", "META_PAGE_ACCESS_TOKEN"] as const;

function missingEnv(): string[] {
  return REQUIRED_ENV.filter((key) => !process.env[key]);
}

export function isConfigured(): boolean {
  return missingEnv().length === 0;
}

export function status(): ConnectorStatus {
  return {
    platform: "meta",
    label: "Meta — Facebook Page + Instagram",
    configured: isConfigured(),
    missingEnv: missingEnv(),
    capabilities: ["read", "write"],
  };
}

async function graphGet(pathAndQuery: string) {
  const res = await fetch(`${GRAPH}/${pathAndQuery}`);
  const data = await res.json();
  if (!res.ok) throw new Error(`Meta Graph API error: ${data?.error?.message || res.statusText}`);
  return data;
}

async function graphPost(path: string, body: Record<string, string>) {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Meta Graph API error: ${data?.error?.message || res.statusText}`);
  return data;
}

export async function getFacebookReport(): Promise<Report> {
  if (!isConfigured()) throw new Error(`Facebook is not configured. Missing: ${missingEnv().join(", ")}. See SETUP.md.`);
  const pageId = process.env.META_PAGE_ID!;
  const token = process.env.META_PAGE_ACCESS_TOKEN!;
  const [page, insights] = await Promise.all([
    graphGet(`${pageId}?fields=fan_count,name&access_token=${token}`),
    graphGet(
      `${pageId}/insights?metric=page_impressions,page_engaged_users&period=days_28&access_token=${token}`
    ),
  ]);
  const byName: Record<string, number> = {};
  for (const m of insights.data ?? []) {
    const latest = m.values?.[m.values.length - 1]?.value;
    byName[m.name] = typeof latest === "number" ? latest : 0;
  }
  return {
    platform: "meta",
    title: `Facebook — ${page.name ?? "Page"}`,
    rangeLabel: "last 28 days",
    metrics: [
      { label: "Followers", value: page.fan_count ?? "—" },
      { label: "Impressions (28d)", value: byName.page_impressions ?? 0 },
      { label: "Engaged users (28d)", value: byName.page_engaged_users ?? 0 },
    ],
    fetchedAt: new Date().toISOString(),
  };
}

export async function getInstagramReport(): Promise<Report> {
  if (!process.env.META_IG_USER_ID) throw new Error("Instagram is not configured. Missing: META_IG_USER_ID. See SETUP.md.");
  if (!isConfigured()) throw new Error(`Instagram is not configured. Missing: ${missingEnv().join(", ")}. See SETUP.md.`);
  const igId = process.env.META_IG_USER_ID;
  const token = process.env.META_PAGE_ACCESS_TOKEN!;
  const [profile, insights] = await Promise.all([
    graphGet(`${igId}?fields=followers_count,username&access_token=${token}`),
    graphGet(`${igId}/insights?metric=reach,profile_views&period=day&access_token=${token}`),
  ]);
  const byName: Record<string, number> = {};
  for (const m of insights.data ?? []) {
    const total = (m.values ?? []).reduce((sum: number, v: { value: number }) => sum + (v.value || 0), 0);
    byName[m.name] = total;
  }
  return {
    platform: "meta",
    title: `Instagram — @${profile.username ?? "account"}`,
    rangeLabel: "last day",
    metrics: [
      { label: "Followers", value: profile.followers_count ?? "—" },
      { label: "Reach", value: byName.reach ?? 0 },
      { label: "Profile views", value: byName.profile_views ?? 0 },
    ],
    fetchedAt: new Date().toISOString(),
  };
}

/** Executes an already-approved Facebook Page post. Never call directly from a tool — always go through a pending action confirmed by the user. */
export async function publishFacebookPost(payload: { message: string; link?: string }): Promise<string> {
  const pageId = process.env.META_PAGE_ID!;
  const token = process.env.META_PAGE_ACCESS_TOKEN!;
  const body: Record<string, string> = { message: payload.message, access_token: token };
  if (payload.link) body.link = payload.link;
  const res = await graphPost(`${pageId}/feed`, body);
  return `Posted to Facebook: https://facebook.com/${res.id}`;
}

/** Executes an already-approved Instagram post (image + caption). Never call directly from a tool — always go through a pending action confirmed by the user. */
export async function publishInstagramPost(payload: { imageUrl: string; caption: string }): Promise<string> {
  const igId = process.env.META_IG_USER_ID!;
  const token = process.env.META_PAGE_ACCESS_TOKEN!;
  const container = await graphPost(`${igId}/media`, {
    image_url: payload.imageUrl,
    caption: payload.caption,
    access_token: token,
  });
  const published = await graphPost(`${igId}/media_publish`, {
    creation_id: container.id,
    access_token: token,
  });
  return `Posted to Instagram: media id ${published.id}`;
}
