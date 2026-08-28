import { google } from "googleapis";
import type { ConnectorStatus, Report } from "../types";
import { auth, isConfigured as googleConfigured } from "./google";

const RANGE = "A1:Z1000";

function missingEnv(): string[] {
  const missing: string[] = [];
  if (!googleConfigured()) missing.push("GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN");
  if (!process.env.CRM_SHEET_ID) missing.push("CRM_SHEET_ID");
  return missing;
}

export function isConfigured(): boolean {
  return missingEnv().length === 0;
}

export function status(): ConnectorStatus {
  return {
    platform: "crm",
    label: "CRM (Google Sheet)",
    configured: isConfigured(),
    missingEnv: missingEnv(),
    capabilities: ["read", "write"],
  };
}

function sheets() {
  if (!isConfigured()) throw new Error(`CRM is not configured. Missing: ${missingEnv().join(", ")}. See SETUP.md.`);
  return google.sheets({ version: "v4", auth: auth() });
}

function sheetName(): string {
  return process.env.CRM_SHEET_NAME || "Sheet1";
}

/** Reads the pipeline. Row 1 is treated as the header row. */
export async function getPipeline(): Promise<Report> {
  const api = sheets();
  const res = await api.spreadsheets.values.get({
    spreadsheetId: process.env.CRM_SHEET_ID!,
    range: `${sheetName()}!${RANGE}`,
  });
  const rows = res.data.values ?? [];
  if (!rows.length) {
    return {
      platform: "crm",
      title: "CRM — pipeline",
      rangeLabel: "empty",
      metrics: [{ label: "Leads", value: 0 }],
      notes: ["The CRM sheet is empty. Row 1 should hold column headers (e.g. Name, Company, Email, Stage, Value, Notes)."],
      fetchedAt: new Date().toISOString(),
    };
  }

  const [header, ...data] = rows;
  const stageIdx = header.findIndex((h) => String(h).toLowerCase().includes("stage"));
  const stageCounts: Record<string, number> = {};
  if (stageIdx >= 0) {
    for (const row of data) {
      const stage = String(row[stageIdx] ?? "unspecified").trim() || "unspecified";
      stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
    }
  }

  return {
    platform: "crm",
    title: "CRM — pipeline",
    rangeLabel: `${data.length} leads`,
    metrics: [
      { label: "Total leads", value: data.length },
      ...Object.entries(stageCounts).map(([stage, count]) => ({ label: stage, value: count })),
    ],
    notes: [
      `Columns: ${header.join(" | ")}`,
      ...data.slice(0, 15).map((row) => row.join(" | ")),
      data.length > 15 ? `…and ${data.length - 15} more rows.` : "",
    ].filter(Boolean),
    fetchedAt: new Date().toISOString(),
  };
}

/** Appends a lead row. Values are matched to the sheet's existing header order. */
export async function addLead(payload: Record<string, string>): Promise<string> {
  const api = sheets();
  const spreadsheetId = process.env.CRM_SHEET_ID!;
  const headerRes = await api.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName()}!1:1`,
  });
  const header = headerRes.data.values?.[0] ?? [];
  if (!header.length) throw new Error("The CRM sheet has no header row — add column names to row 1 first.");

  const row = header.map((col) => {
    const key = Object.keys(payload).find((k) => k.toLowerCase() === String(col).toLowerCase());
    return key ? payload[key] : "";
  });

  await api.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName()}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
  return `Lead added to the CRM sheet: ${row.filter(Boolean).join(" | ")}`;
}

/** Updates the stage of the first lead whose name matches. */
export async function updateLeadStage(payload: { name: string; stage: string }): Promise<string> {
  const api = sheets();
  const spreadsheetId = process.env.CRM_SHEET_ID!;
  const res = await api.spreadsheets.values.get({ spreadsheetId, range: `${sheetName()}!${RANGE}` });
  const rows = res.data.values ?? [];
  if (!rows.length) throw new Error("The CRM sheet is empty.");

  const [header, ...data] = rows;
  const nameIdx = header.findIndex((h) => String(h).toLowerCase().includes("name"));
  const stageIdx = header.findIndex((h) => String(h).toLowerCase().includes("stage"));
  if (nameIdx < 0 || stageIdx < 0) throw new Error("The CRM sheet needs both a 'Name' and a 'Stage' column.");

  const target = payload.name.toLowerCase();
  const rowOffset = data.findIndex((row) => String(row[nameIdx] ?? "").toLowerCase().includes(target));
  if (rowOffset < 0) throw new Error(`No lead matching "${payload.name}" found in the CRM.`);

  // +2: one for the header row, one because Sheets rows are 1-indexed.
  const rowNumber = rowOffset + 2;
  const columnLetter = String.fromCharCode(65 + stageIdx);
  await api.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName()}!${columnLetter}${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[payload.stage]] },
  });
  return `Moved "${data[rowOffset][nameIdx]}" to stage "${payload.stage}".`;
}
