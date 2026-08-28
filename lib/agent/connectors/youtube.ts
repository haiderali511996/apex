import { google } from "googleapis";
import type { ConnectorStatus, Report } from "../types";

const REQUIRED_ENV = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "YOUTUBE_CHANNEL_ID"] as const;

function missingEnv(): string[] {
  return REQUIRED_ENV.filter((key) => !process.env[key]);
}

export function isConfigured(): boolean {
  return missingEnv().length === 0;
}

export function status(): ConnectorStatus {
  return {
    platform: "youtube",
    label: "YouTube",
    configured: isConfigured(),
    missingEnv: missingEnv(),
    capabilities: ["read"],
  };
}

function client() {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.youtube({ version: "v3", auth });
}

export async function getYoutubeReport(): Promise<Report> {
  if (!isConfigured()) throw new Error(`YouTube is not configured. Missing: ${missingEnv().join(", ")}. See SETUP.md.`);
  const yt = client();
  const channelId = process.env.YOUTUBE_CHANNEL_ID!;

  const channelRes = await yt.channels.list({ part: ["statistics", "snippet"], id: [channelId] });
  const channel = channelRes.data.items?.[0];
  const stats = channel?.statistics;

  const recentRes = await yt.search.list({
    part: ["id"],
    channelId,
    order: "date",
    maxResults: 5,
    type: ["video"],
  });
  const videoIds = (recentRes.data.items ?? []).map((i) => i.id?.videoId).filter(Boolean) as string[];
  let topVideosNote = "no recent videos found";
  if (videoIds.length) {
    const videosRes = await yt.videos.list({ part: ["statistics", "snippet"], id: videoIds });
    topVideosNote = (videosRes.data.items ?? [])
      .map((v) => `"${v.snippet?.title}" (${v.statistics?.viewCount ?? 0} views)`)
      .join("; ");
  }

  return {
    platform: "youtube",
    title: `YouTube — ${channel?.snippet?.title ?? "channel"}`,
    rangeLabel: "all time / most recent uploads",
    metrics: [
      { label: "Subscribers", value: stats?.subscriberCount ?? "—" },
      { label: "Total views", value: stats?.viewCount ?? "—" },
      { label: "Video count", value: stats?.videoCount ?? "—" },
    ],
    notes: [`Recent uploads: ${topVideosNote}`],
    fetchedAt: new Date().toISOString(),
  };
}
