import type { ConnectorStatus, Report } from "../types";

const API = "https://api.stripe.com/v1";

function missingEnv(): string[] {
  return process.env.STRIPE_SECRET_KEY ? [] : ["STRIPE_SECRET_KEY"];
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
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
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
