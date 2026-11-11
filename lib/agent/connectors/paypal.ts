import type { ConnectorStatus, Report } from "../types";
import { cred } from "@/lib/credentials";

/**
 * PayPal, read-only: balances and the transaction history (money in, money
 * out, fees). Uses a REST app's client ID and secret; the app needs
 * "Transaction search" switched on in the PayPal developer dashboard.
 */

const KEYS = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"];

function missingEnv(): string[] {
  return KEYS.filter(k => !cred(k));
}

export function isConfigured(): boolean {
  return missingEnv().length === 0;
}

export function status(): ConnectorStatus {
  return { platform: "finance", label: "Finance (PayPal)", configured: isConfigured(), missingEnv: missingEnv(), capabilities: ["read"] };
}

const api = () => (/^sandbox$/i.test(cred("PAYPAL_MODE")?.trim() || "") ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com");

async function token(): Promise<string> {
  if (!isConfigured()) throw new Error(`PayPal is not connected. Missing: ${missingEnv().join(", ")}. Add it on the Connections page.`);
  const res = await fetch(`${api()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${cred("PAYPAL_CLIENT_ID")}:${cred("PAYPAL_CLIENT_SECRET")}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PayPal rejected the client ID or secret (${data?.error_description || res.statusText}). Check them on the Connections page${/sandbox/i.test(cred("PAYPAL_MODE") || "") ? "" : ", and that they're Live, not Sandbox"}.`);
  return data.access_token;
}

async function paypalGet(path: string, accessToken: string) {
  const res = await fetch(`${api()}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) throw new Error("PayPal refused: switch on \"Transaction search\" for this app in the PayPal developer dashboard (it can take a few hours to start working).");
  if (!res.ok) throw new Error(`PayPal API error: ${data?.message || data?.name || res.statusText}`);
  return data;
}

type Txn = { transaction_info: { transaction_initiation_date: string; transaction_amount?: { value: string; currency_code: string }; fee_amount?: { value: string }; transaction_status?: string; transaction_subject?: string; transaction_note?: string }; payer_info?: { email_address?: string; payer_name?: { alternate_full_name?: string } } };

const money = (n: number, currency: string) => `${n.toFixed(2)} ${currency}`;

export async function getPaypalReport(days = 30): Promise<Report> {
  const accessToken = await token();
  // PayPal allows at most 31 days per request, so longer ranges are fetched in windows.
  const end = Date.now(), start = end - Math.min(days, 365) * 86400000;
  const txns: Txn[] = [];
  for (let from = start; from < end; from += 31 * 86400000) {
    const to = Math.min(from + 31 * 86400000 - 1000, end);
    for (let page = 1; page <= 5; page++) {
      const q = new URLSearchParams({ start_date: new Date(from).toISOString().replace(/\.\d+Z$/, "Z"), end_date: new Date(to).toISOString().replace(/\.\d+Z$/, "Z"), fields: "transaction_info,payer_info", page_size: "500", page: String(page) });
      const data = await paypalGet(`/v1/reporting/transactions?${q}`, accessToken);
      txns.push(...(data.transaction_details ?? []));
      if (page >= (data.total_pages ?? 1)) break;
    }
  }
  const balances = await paypalGet("/v1/reporting/balances?currency_code=ALL", accessToken).catch(() => null);

  const totals: Record<string, { in: number; out: number; fees: number }> = {};
  const recent: string[] = [];
  for (const t of txns) {
    const info = t.transaction_info, amount = Number(info.transaction_amount?.value ?? 0), currency = info.transaction_amount?.currency_code ?? "USD";
    if (info.transaction_status && info.transaction_status !== "S") continue; // only completed
    const sum = (totals[currency] ??= { in: 0, out: 0, fees: 0 });
    if (amount >= 0) sum.in += amount; else sum.out += -amount;
    sum.fees += -Number(info.fee_amount?.value ?? 0);
  }
  for (const t of [...txns].reverse().slice(0, 8)) {
    const info = t.transaction_info, who = t.payer_info?.payer_name?.alternate_full_name || t.payer_info?.email_address || info.transaction_subject || info.transaction_note || "";
    recent.push(`${info.transaction_initiation_date.slice(0, 10)} — ${info.transaction_amount?.value ?? "?"} ${info.transaction_amount?.currency_code ?? ""}${who ? ` — ${who}` : ""}`);
  }

  const metrics: Report["metrics"] = Object.entries(totals).flatMap(([c, s]) => [
    { label: `Money in (${c})`, value: money(s.in, c) },
    { label: `Money out (${c})`, value: money(s.out, c) },
    { label: `PayPal fees (${c})`, value: money(s.fees, c) },
    { label: `Net (${c})`, value: money(s.in - s.out - s.fees, c) },
  ]);
  for (const b of balances?.balances ?? []) metrics.push({ label: `Balance (${b.currency})`, value: `${b.total_balance?.value ?? b.available_balance?.value} ${b.currency}` });
  metrics.push({ label: "Transactions", value: txns.length });

  return {
    platform: "finance",
    title: "PayPal — money in and out",
    rangeLabel: `last ${days} days`,
    metrics,
    notes: recent.length ? ["Recent transactions:", ...recent] : ["No PayPal transactions in this window."],
    fetchedAt: new Date().toISOString(),
  };
}
