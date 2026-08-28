import { google } from "googleapis";
import type { ConnectorStatus, Report } from "../types";
import { auth, isConfigured as googleConfigured } from "./google";

function missingEnv(): string[] {
  const missing: string[] = [];
  if (!googleConfigured()) missing.push("GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN");
  if (!process.env.GA4_PROPERTY_ID) missing.push("GA4_PROPERTY_ID");
  return missing;
}

export function isConfigured(): boolean {
  return missingEnv().length === 0;
}

export function status(): ConnectorStatus {
  return {
    platform: "analytics",
    label: "Analytics (GA4)",
    configured: isConfigured(),
    missingEnv: missingEnv(),
    capabilities: ["read"],
  };
}

export async function getTrafficReport(days = 28): Promise<Report> {
  if (!isConfigured()) throw new Error(`Analytics is not configured. Missing: ${missingEnv().join(", ")}. See SETUP.md.`);
  const analyticsData = google.analyticsdata({ version: "v1beta", auth: auth() });
  const property = `properties/${process.env.GA4_PROPERTY_ID}`;
  const dateRanges = [{ startDate: `${days}daysAgo`, endDate: "yesterday" }];

  const [totals, byChannel, byPage] = await Promise.all([
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges,
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "screenPageViews" },
          { name: "bounceRate" },
        ],
      },
    }),
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges,
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
        limit: "6",
      },
    }),
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges,
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        limit: "5",
      },
    }),
  ]);

  const row = totals.data.rows?.[0]?.metricValues ?? [];
  const channelLines = (byChannel.data.rows ?? []).map(
    (r) => `${r.dimensionValues?.[0]?.value}: ${r.metricValues?.[0]?.value} sessions`
  );
  const pageLines = (byPage.data.rows ?? []).map(
    (r) => `${r.dimensionValues?.[0]?.value}: ${r.metricValues?.[0]?.value} views`
  );

  return {
    platform: "analytics",
    title: "Google Analytics — site traffic",
    rangeLabel: `last ${days} days`,
    metrics: [
      { label: "Sessions", value: row[0]?.value ?? "—" },
      { label: "Users", value: row[1]?.value ?? "—" },
      { label: "Page views", value: row[2]?.value ?? "—" },
      { label: "Bounce rate", value: row[3]?.value ? `${(Number(row[3].value) * 100).toFixed(1)}%` : "—" },
    ],
    notes: [
      channelLines.length ? `Traffic by channel — ${channelLines.join("; ")}` : "No channel data.",
      pageLines.length ? `Top pages — ${pageLines.join("; ")}` : "No page data.",
    ],
    fetchedAt: new Date().toISOString(),
  };
}
