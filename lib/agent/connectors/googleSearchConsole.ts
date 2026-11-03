import { google } from "googleapis";
import type { ConnectorStatus, Report } from "../types";
import { cred } from "@/lib/credentials";

const REQUIRED_ENV = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GSC_SITE_URL"] as const;

function missingEnv(): string[] {
  return REQUIRED_ENV.filter((key) => !cred(key));
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
  const auth = new google.auth.OAuth2(cred("GOOGLE_CLIENT_ID"), cred("GOOGLE_CLIENT_SECRET"));
  auth.setCredentials({ refresh_token: cred("GOOGLE_REFRESH_TOKEN") });
  return google.searchconsole({ version: "v1", auth });
}

/**
 * Search Console only accepts a property exactly as registered —
 * "https://unctech.co/" or "sc-domain:unctech.co". A bare "unctech.co" is read
 * as http://unctech.co and refused with a permission error, so a bare domain
 * is matched against the properties the account actually has.
 */
async function resolveSiteUrl(sc: ReturnType<typeof client>, configured: string): Promise<string> {
  if (configured.startsWith("sc-domain:") || /^https?:\/\//.test(configured)) return configured;
  const domain = configured.replace(/^www\./, "").replace(/\/+$/, "").toLowerCase();
  const { data } = await sc.sites.list();
  const owned = (data.siteEntry ?? []).filter(s => s.permissionLevel !== "siteUnverifiedUser").map(s => s.siteUrl ?? "");
  const match = [`sc-domain:${domain}`, `https://${domain}/`, `https://www.${domain}/`, `http://${domain}/`, `http://www.${domain}/`].find(u => owned.includes(u));
  if (!match) throw new Error(`GSC_SITE_URL "${configured}" isn't a Search Console property on this Google account. Properties: ${owned.join(", ") || "none"}.`);
  return match;
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
  const siteUrl = await resolveSiteUrl(sc, cred("GSC_SITE_URL")!.trim());
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
