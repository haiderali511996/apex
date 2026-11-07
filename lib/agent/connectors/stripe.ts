import type { ConnectorStatus, Report } from "../types";
import { cred } from "@/lib/credentials";

const API = "https://api.stripe.com/v1";

function missingEnv(): string[] {
  return cred("STRIPE_SECRET_KEY") ? [] : ["STRIPE_SECRET_KEY"];
}

export function isConfigured(): boolean {
  return missingEnv().length === 0;
}

export function status(): ConnectorStatus {
  return {
    platform: "finance",
    label: "Finance (Stripe)",
    configured: isConfigured(),
    missingEnv: missingEnv(),
    capabilities: ["read"],
  };
}

async function stripeGet(path: string) {
  if (!isConfigured()) throw new Error("Stripe is not configured. Missing: STRIPE_SECRET_KEY. See SETUP.md.");
  const res = await fetch(`${API}/${path}`, {
    headers: { Authorization: `Bearer ${cred("STRIPE_SECRET_KEY")}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe API error: ${data?.error?.message || res.statusText}`);
  return data;
}

function money(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

export async function getRevenueReport(days = 30): Promise<Report> {
  const since = Math.floor((Date.now() - days * 86400000) / 1000);
  const charges = await stripeGet(`charges?limit=100&created[gte]=${since}`);

  let gross = 0;
  let refunded = 0;
  let failed = 0;
  let currency = "usd";
  const recent: string[] = [];

  for (const charge of charges.data ?? []) {
    if (charge.currency) currency = charge.currency;
    if (charge.paid && charge.status === "succeeded") {
      gross += charge.amount;
      refunded += charge.amount_refunded ?? 0;
    } else if (charge.status === "failed") {
      failed += 1;
    }
    if (recent.length < 8 && charge.status === "succeeded") {
      recent.push(
        `${new Date(charge.created * 1000).toISOString().slice(0, 10)} — ${money(charge.amount, charge.currency)} — ${charge.description || charge.billing_details?.email || "no description"}`
      );
    }
  }

  return {
    platform: "finance",
    title: "Stripe — revenue",
    rangeLabel: `last ${days} days`,
    metrics: [
      { label: "Gross revenue", value: money(gross, currency) },
      { label: "Refunded", value: money(refunded, currency) },
      { label: "Net", value: money(gross - refunded, currency) },
      { label: "Successful charges", value: (charges.data ?? []).filter((c: { status: string }) => c.status === "succeeded").length },
      { label: "Failed charges", value: failed },
    ],
    notes: recent.length ? ["Recent payments:", ...recent] : ["No successful charges in this window."],
    fetchedAt: new Date().toISOString(),
  };
}

export async function getUpcomingInvoices(): Promise<Report> {
  const invoices = await stripeGet("invoices?limit=20&status=open");
  const lines = (invoices.data ?? []).map(
    (inv: { number?: string; customer_email?: string; amount_due: number; currency: string; due_date?: number }) =>
      `${inv.number ?? "(draft)"} — ${inv.customer_email ?? "unknown"} — ${money(inv.amount_due, inv.currency)}${inv.due_date ? ` due ${new Date(inv.due_date * 1000).toISOString().slice(0, 10)}` : ""}`
  );
  const total = (invoices.data ?? []).reduce((sum: number, inv: { amount_due: number }) => sum + inv.amount_due, 0);
  const currency = invoices.data?.[0]?.currency ?? "usd";
  return {
    platform: "finance",
    title: "Stripe — open invoices",
    rangeLabel: `${lines.length} open`,
    metrics: [
      { label: "Open invoices", value: lines.length },
      { label: "Outstanding", value: money(total, currency) },
    ],
    notes: lines.length ? lines : ["No open invoices."],
    fetchedAt: new Date().toISOString(),
  };
}

// ---------- Month-on-month summary (the Finance card) ----------

type Txn = { amount: number; fee: number; net: number; currency: string; type: string; created: number };
export type MonthFigures = { label: string; sales: number; salesCount: number; refunds: number; fees: number; disputes: number; net: number; payouts: number };
export type FinanceSummary = {
  currency: string;
  previous: MonthFigures;
  current: MonthFigures;
  /** Last month up to the same day, for a fair comparison with this month so far. */
  previousToDate: MonthFigures;
  dayOfMonth: number;
  balance: { available: number; pending: number };
  verdict: string;
  fetchedAt: string;
};

async function transactions(from: number, to: number): Promise<Txn[]> {
  const out: Txn[] = [];
  let after = "";
  for (let page = 0; page < 30; page++) {
    const data = await stripeGet(`balance_transactions?limit=100&created[gte]=${from}&created[lt]=${to}${after ? `&starting_after=${after}` : ""}`);
    out.push(...(data.data ?? []));
    if (!data.has_more || !data.data?.length) break;
    after = data.data.at(-1).id;
  }
  return out;
}

function figures(label: string, txns: Txn[], currency: string): MonthFigures {
  const f: MonthFigures = { label, sales: 0, salesCount: 0, refunds: 0, fees: 0, disputes: 0, net: 0, payouts: 0 };
  for (const t of txns) {
    if (t.currency !== currency) continue;
    if (t.type === "payout") { f.payouts += -t.amount; continue; }
    if (t.type === "charge" || t.type === "payment") { f.sales += t.amount; f.salesCount++; }
    else if (t.type === "refund" || t.type === "payment_refund") f.refunds += -t.amount;
    else if (t.type === "adjustment" || t.type.startsWith("dispute")) f.disputes += -t.amount;
    f.fees += t.fee;
    f.net += t.net;
  }
  return f;
}

const fmt = (minor: number, currency: string) => `${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency.toUpperCase()}`;

/** Last month and this month side by side, with the balance and a plain verdict. */
export async function getFinanceSummary(now = new Date()): Promise<FinanceSummary> {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const start = (yy: number, mm: number) => Date.UTC(yy, mm, 1) / 1000;
  const thisStart = start(y, m), prevStart = start(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1);
  const nowSec = Math.floor(now.getTime() / 1000);
  const [prevTx, curTx, balance] = await Promise.all([transactions(prevStart, thisStart), transactions(thisStart, nowSec + 1), stripeGet("balance")]);

  // The currency most of the money is in.
  const totals = new Map<string, number>();
  for (const t of [...prevTx, ...curTx]) totals.set(t.currency, (totals.get(t.currency) ?? 0) + Math.abs(t.amount));
  for (const b of balance.available ?? []) if (!totals.size) totals.set(b.currency, 0);
  const currency = [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "usd";

  const name = (sec: number) => new Date(sec * 1000).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const elapsed = nowSec - thisStart;
  const previous = figures(name(prevStart), prevTx, currency);
  const current = figures(`${name(thisStart)} so far`, curTx, currency);
  const previousToDate = figures(`${name(prevStart)}, same days`, prevTx.filter(t => t.created < prevStart + elapsed), currency);
  const sum = (list: { amount: number; currency: string }[] = []) => list.filter(b => b.currency === currency).reduce((n, b) => n + b.amount, 0);

  const dayOfMonth = now.getUTCDate();
  const pace = previousToDate.net ? Math.round(((current.net - previousToDate.net) / Math.abs(previousToDate.net)) * 100) : null;
  const lines: string[] = [];
  if (previous.net > 0) lines.push(`${previous.label} earned ${fmt(previous.net, currency)} after fees and refunds.`);
  else if (previous.net < 0) lines.push(`${previous.label} lost ${fmt(-previous.net, currency)} after fees and refunds.`);
  else lines.push(`${previous.label} had no earnings in Stripe.`);
  if (current.net < 0) lines.push(`This month is negative so far (${fmt(current.net, currency)}).`);
  else if (pace === null) lines.push(`This month has ${fmt(current.net, currency)} so far; there was nothing by day ${dayOfMonth} last month to compare.`);
  else if (pace >= 0) lines.push(`This month is ${pace}% ahead of last month's pace by day ${dayOfMonth} (${fmt(current.net, currency)} vs ${fmt(previousToDate.net, currency)}).`);
  else lines.push(`This month is ${-pace}% behind last month's pace by day ${dayOfMonth} (${fmt(current.net, currency)} vs ${fmt(previousToDate.net, currency)}).`);
  if (current.refunds > 0 && current.refunds >= current.sales * 0.1) lines.push(`Refunds are high this month: ${fmt(current.refunds, currency)}.`);

  return {
    currency, previous, current, previousToDate, dayOfMonth,
    balance: { available: sum(balance.available), pending: sum(balance.pending) },
    verdict: lines.join(" "),
    fetchedAt: now.toISOString(),
  };
}
