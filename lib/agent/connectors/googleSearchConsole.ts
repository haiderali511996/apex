import { google } from "googleapis";
import type { ConnectorStatus, Report } from "../types";

const REQUIRED_ENV = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GSC_SITE_URL"] as const;

function missingEnv(): string[] {
  return REQUIRED_ENV.filter((key) => !process.env[key]);
}

export function isConfigured(): boolean {
  return missingEnv().length === 0;
}

export function status(): ConnectorStatus {
  return {
    platform: "search_console",
    label: "Google Search Console (SEO)",
    configured: isConfigured(),
    missingEnv: missingEnv(),
    capabilities: ["read"],
  };
}

function client() {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.searchconsole({ version: "v1", auth });
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Search performance summary for the site: overall clicks/impressions/CTR/
 * position plus the top queries and pages. This is on-page/organic-search
 * data only — GSC has no backlink (off-page) data; pair it with a backlink
 * tool if that's needed.
 */
export async function getSeoReport(days = 28): Promise<Report> {
  if (!isConfigured()) {
    throw new Error(
      `Search Console is not configured. Missing: ${missingEnv().join(", ")}. See SETUP.md.`
    );
  }
  const sc = client();
  const siteUrl = process.env.GSC_SITE_URL!;
  const startDate = isoDaysAgo(days);
  const endDate = isoDaysAgo(1);

  const [totals, byQuery, byPage] = await Promise.all([
    sc.searchanalytics.query({ siteUrl, requestBody: { startDate, endDate } }),
    sc.searchanalytics.query({
      siteUrl,
      requestBody: { startDate, endDate, dimensions: ["query"], rowLimit: 5 },
    }),
    sc.searchanalytics.query({
      siteUrl,
      requestBody: { startDate, endDate, dimensions: ["page"], rowLimit: 5 },
    }),
  ]);

  const row = totals.data.rows?.[0];
  return {
    platform: "search_console",
    title: "Search Console — organic search performance",
    rangeLabel: `${startDate} to ${endDate}`,
    metrics: [
      { label: "Clicks", value: row?.clicks ?? 0 },
      { label: "Impressions", value: row?.impressions ?? 0 },
      { label: "Average CTR", value: row?.ctr ? `${(row.ctr * 100).toFixed(2)}%` : "0%" },
      { label: "Average position", value: row?.position ? row.position.toFixed(1) : "—" },
    ],
    notes: [
      "Top queries: " +
        (byQuery.data.rows?.map((r) => `"${r.keys?.[0]}" (${r.clicks} clicks)`).join("; ") || "none"),
      "Top pages: " +
        (byPage.data.rows?.map((r) => `${r.keys?.[0]} (${r.clicks} clicks)`).join("; ") || "none"),
      "Off-page metrics (backlinks, domain authority) aren't available from Search Console — connect a backlink tool for those.",
    ],
    fetchedAt: new Date().toISOString(),
  };
}
