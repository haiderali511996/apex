import type { ConnectorStatus, Report } from "../types";
import { cred } from "@/lib/credentials";

/**
 * A bank account through Wise (business or personal), read-only: balances in
 * every currency and recent statement lines. Uses a personal API token set to
 * "Read only" in Wise → Settings → API tokens.
 */

const API = "https://api.wise.com";

function missingEnv(): string[] {
  return cred("WISE_API_TOKEN") ? [] : ["WISE_API_TOKEN"];
}

export function isConfigured(): boolean {
  return missingEnv().length === 0;
}

export function status(): ConnectorStatus {
  return { platform: "finance", label: "Bank (Wise)", configured: isConfigured(), missingEnv: missingEnv(), capabilities: ["read"] };
}

async function wiseGet(path: string) {
  if (!isConfigured()) throw new Error("No bank account is connected. Add a read-only Wise API token on the Connections page.");
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${cred("WISE_API_TOKEN")}` } });
  // Statements for UK/EEA accounts need a one-time approval in the Wise app (strong customer authentication).
  if (res.status === 403 && res.headers.get("x-2fa-approval")) throw new Error("Wise needs you to approve statement access in the Wise app first.");
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("Wise rejected the API token. Create a new read-only token and save it on the Connections page.");
  if (!res.ok) throw new Error(`Wise API error: ${data?.errors?.[0]?.message || data?.message || res.statusText}`);
  return data;
}

type Profile = { id: number; type: string; fullName?: string; businessName?: string };
type Balance = { id: number; currency: string; amount: { value: number; currency: string } };
type StatementLine = { date: string; amount: { value: number; currency: string }; details?: { description?: string; senderName?: string; recipient?: { name?: string } } };

/** Business profile first, else personal. */
async function profile(): Promise<Profile> {
  const profiles = (await wiseGet("/v2/profiles")) as Profile[];
  const chosen = profiles.find(p => p.type?.toLowerCase() === "business") ?? profiles[0];
  if (!chosen) throw new Error("This Wise token has no profile.");
  return chosen;
}

export async function getBankReport(days = 30): Promise<Report> {
  const p = await profile();
  const balances = (await wiseGet(`/v4/profiles/${p.id}/balances?types=STANDARD`)) as Balance[];
  const metrics: Report["metrics"] = balances.map(b => ({ label: `Balance (${b.currency})`, value: `${b.amount.value.toFixed(2)} ${b.currency}` }));
  const notes: string[] = [];
  const end = new Date(), start = new Date(Date.now() - Math.min(days, 469) * 86400000);
  for (const b of balances.filter(b => b.amount.value !== 0).slice(0, 4)) {
    try {
      const q = new URLSearchParams({ currency: b.currency, intervalStart: start.toISOString(), intervalEnd: end.toISOString(), type: "COMPACT" });
      const st = await wiseGet(`/v1/profiles/${p.id}/balance-statements/${b.id}/statement.json?${q}`);
      const lines = (st.transactions ?? []) as StatementLine[];
      const inflow = lines.filter(l => l.amount.value > 0).reduce((s, l) => s + l.amount.value, 0);
      const outflow = lines.filter(l => l.amount.value < 0).reduce((s, l) => s - l.amount.value, 0);
      metrics.push({ label: `Money in (${b.currency})`, value: `${inflow.toFixed(2)} ${b.currency}` }, { label: `Money out (${b.currency})`, value: `${outflow.toFixed(2)} ${b.currency}` });
      for (const l of lines.slice(0, 6)) {
        const who = l.details?.senderName || l.details?.recipient?.name || l.details?.description || "";
        notes.push(`${l.date.slice(0, 10)} — ${l.amount.value.toFixed(2)} ${l.amount.currency}${who ? ` — ${who}` : ""}`);
      }
    } catch (err) {
      notes.push(`${b.currency} statement: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return {
    platform: "finance",
    title: `Bank (Wise) — ${p.businessName || p.fullName || "account"}`,
    rangeLabel: `last ${days} days`,
    metrics,
    notes: notes.length ? ["Recent lines:", ...notes] : ["No statement lines in this window."],
    fetchedAt: new Date().toISOString(),
  };
}
