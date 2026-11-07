"use client";

import { useEffect, useState } from "react";

/**
 * Last month next to this month, from Stripe: sales, refunds, fees, net
 * earnings and payouts; this month against last month's pace on the same
 * day; the balance; and a one-line verdict. Read-only.
 */

type Month = { label: string; sales: number; salesCount: number; refunds: number; fees: number; disputes: number; net: number; payouts: number };
type Summary = { currency: string; previous: Month; current: Month; previousToDate: Month; dayOfMonth: number; balance: { available: number; pending: number }; verdict: string; fetchedAt: string };

const money = (minor: number, cur: string) => `${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur.toUpperCase()}`;

export default function FinancePanel({ color = "#00e5ff" }: { color?: string }) {
  const [data, setData] = useState<{ summary?: Summary; message?: string; error?: string } | null>(null);

  useEffect(() => {
    let live = true;
    void fetch("/api/finance/summary").then(r => r.json()).then(b => { if (live) setData(b); }).catch(() => { if (live) setData({ error: "Couldn't reach the server." }); });
    return () => { live = false; };
  }, []);

  if (!data) return <div style={{ color: "#8aa0b4", fontSize: 13 }}>Reading Stripe…</div>;
  if (!data.summary) return <div style={{ color: data.error ? "#ff8a80" : "#8aa0b4", fontSize: 13 }}>{data.error ?? data.message}</div>;

  const s = data.summary, c = s.currency;
  const rows: [string, (m: Month) => string, boolean?][] = [
    ["Sales", m => `${money(m.sales, c)} · ${m.salesCount}`],
    ["Refunds", m => m.refunds ? `−${money(m.refunds, c)}` : "—"],
    ["Stripe fees", m => m.fees ? `−${money(m.fees, c)}` : "—"],
    ...(s.previous.disputes || s.current.disputes ? [["Disputes", (m: Month) => m.disputes ? `−${money(m.disputes, c)}` : "—"] as [string, (m: Month) => string]] : []),
    ["Net earnings", m => money(m.net, c), true],
    ["Paid out to bank", m => money(m.payouts, c)],
  ];
  const max = Math.max(Math.abs(s.previous.net), Math.abs(s.current.net), Math.abs(s.previousToDate.net), 1);
  const bar = (v: number, tone: string) => (
    <div style={{ height: 6, borderRadius: 3, background: "#ffffff10", overflow: "hidden" }}>
      <div style={{ width: `${Math.max(2, (Math.abs(v) / max) * 100)}%`, height: "100%", background: v < 0 ? "#ff6b6b" : tone }} />
    </div>
  );
  const ahead = s.current.net >= s.previousToDate.net;

  return (
    <div style={{ display: "grid", gap: 12, fontSize: 13 }}>
      <div style={{ color: ahead ? "#7ee2a8" : "#ffb74d", lineHeight: 1.5 }}>{s.verdict}</div>

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: "5px 10px", alignItems: "baseline" }}>
        <span />
        <b style={{ color: "#8aa0b4", fontSize: 11, letterSpacing: "0.08em" }}>{s.previous.label.toUpperCase()}</b>
        <b style={{ color, fontSize: 11, letterSpacing: "0.08em" }}>{s.current.label.toUpperCase()}</b>
        {rows.map(([label, value, strong]) => [
          <span key={`${label}-l`} style={{ color: "#8aa0b4" }}>{label}</span>,
          <span key={`${label}-p`} style={{ fontWeight: strong ? 700 : 400, color: strong ? "#e8eef5" : "#c8d3de", fontVariantNumeric: "tabular-nums" }}>{value(s.previous)}</span>,
          <span key={`${label}-c`} style={{ fontWeight: strong ? 700 : 400, color: strong ? "#e8eef5" : "#c8d3de", fontVariantNumeric: "tabular-nums" }}>{value(s.current)}</span>,
        ])}
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.16em", color }}>NET EARNINGS BY DAY {s.dayOfMonth}</div>
        <div style={{ display: "grid", gridTemplateColumns: "92px 1fr auto", gap: "4px 8px", alignItems: "center" }}>
          <span style={{ color: "#8aa0b4" }}>Last month</span>{bar(s.previousToDate.net, "#7f9bb3")}<span style={{ fontVariantNumeric: "tabular-nums" }}>{money(s.previousToDate.net, c)}</span>
          <span style={{ color: "#8aa0b4" }}>This month</span>{bar(s.current.net, ahead ? "#34d399" : "#ffb74d")}<span style={{ fontVariantNumeric: "tabular-nums" }}>{money(s.current.net, c)}</span>
          <span style={{ color: "#8aa0b4" }}>All last month</span>{bar(s.previous.net, "#7f9bb366")}<span style={{ fontVariantNumeric: "tabular-nums", color: "#8aa0b4" }}>{money(s.previous.net, c)}</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 120px", border: "1px solid #ffffff14", borderRadius: 10, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", color: "#8aa0b4" }}>BALANCE NOW</div>
          <div style={{ fontWeight: 700, fontSize: 15, fontVariantNumeric: "tabular-nums" }}>{money(s.balance.available, c)}</div>
        </div>
        <div style={{ flex: "1 1 120px", border: "1px solid #ffffff14", borderRadius: 10, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", color: "#8aa0b4" }}>ON THE WAY (PENDING)</div>
          <div style={{ fontWeight: 700, fontSize: 15, fontVariantNumeric: "tabular-nums" }}>{money(s.balance.pending, c)}</div>
        </div>
      </div>
      <div style={{ color: "#5d6b78", fontSize: 11.5 }}>From Stripe, in {c.toUpperCase()}. Net earnings are after Stripe fees, refunds and disputes. Your other costs aren&apos;t included, so this isn&apos;t full profit.</div>
    </div>
  );
}
