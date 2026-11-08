"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The Trading agent's card: autopilot mode (off / paper / live, live only
 * after accepting the risk here), the honest track record, open positions
 * with a close button each and an emergency close-all, one-off analysis,
 * the risk rules, brokers per market, and what it did lately.
 */

type Market = "crypto" | "forex" | "stock";
type Settings = { mode: "off" | "paper" | "live"; watchlist: string[]; riskPct: number; dailyLossPct: number; maxPositions: number; minConfidence: number; intervalMin: number; brokers: Record<Market, string>; liveAcceptedAt?: string };
type Open = { id: string; name: string; side: string; qty: number; entry: number; stop: number; target: number; price: number; unrealized: number; mode: string };
type Closed = { id: string; name: string; side: string; entry: number; exit?: number; pnl?: number; mode: string; closeNote?: string; closedAt?: string };
type Record_ = { trades: number; winRate: number; pnl: number; profitFactor: number | null; maxDrawdown: number };
type Status = { settings: Settings; open: Open[]; closed: Closed[]; log: { at: string; text: string }[]; paper: Record_ & { equity: number }; live: Record_; brokers: { id: string; name: string; connected: boolean }[] };
type Analysis = { name: string; decision: { action: string; confidence: number; entry: number; stop: number; target: number; rewardRisk: number; horizon: string; reasons: string[]; risks: string[]; invalidation: string }; checks: string[]; news: { events: string[]; sources: { title: string; uri: string; trusted?: boolean }[]; trusted: number } };

const MUTED = "#8aa0b4", GREEN = "#34d399", RED = "#ff6b6b", AMBER = "#ffb74d";
const usd = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
const box = { border: "1px solid #ffffff14", borderRadius: 10, padding: "8px 10px" } as const;
const label = { fontSize: 11, letterSpacing: "0.12em", color: MUTED } as const;
const input = { background: "#ffffff0a", border: "1px solid #ffffff22", borderRadius: 8, color: "#e8eef5", padding: "6px 8px", fontSize: 13, width: "100%" } as const;
const btn = (tone = "#ffffff22") => ({ background: "transparent", border: `1px solid ${tone}`, color: "#e8eef5", borderRadius: 8, padding: "6px 10px", fontSize: 12.5, cursor: "pointer" }) as const;

export default function TradingPanel({ color = "#00e5ff" }: { color?: string }) {
  const [st, setSt] = useState<Status | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [symbol, setSymbol] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [rules, setRules] = useState<Settings | null>(null);
  const [showRules, setShowRules] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/trading").catch(() => null);
    const b = r ? await r.json().catch(() => ({})) : {};
    if (r?.ok) { setSt(b); setRules(x => x ?? b.settings); setErr(""); } else setErr(b.error || "Couldn't load trading.");
  }, []);
  useEffect(() => { void load(); const t = setInterval(load, 20_000); return () => clearInterval(t); }, [load]);

  const post = async (what: string, body: Record<string, unknown>) => {
    setBusy(what); setErr("");
    const r = await fetch("/api/trading", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const b = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    setBusy("");
    if (!r?.ok) { setErr(b.error || "That didn't work."); return null; }
    if (b.settings) { setSt(b); setRules(b.settings); }
    return b;
  };
  const setMode = (mode: Settings["mode"]) => {
    if (mode === "live" && !st?.settings.liveAcceptedAt) { setConfirmLive(true); return; }
    if (mode === "live" && !confirm("Trade with REAL money now, automatically, within your limits?")) return;
    void post("mode", { action: "settings", patch: { mode } });
  };

  if (!st) return <div style={{ color: err ? "#ff8a80" : MUTED, fontSize: 13 }}>{err || "Loading the trading desk…"}</div>;
  const s = st.settings;
  const record = s.mode === "live" && st.live.trades ? st.live : st.paper;

  return (
    <div style={{ display: "grid", gap: 12, fontSize: 13 }}>
      {/* Mode */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {(["off", "paper", "live"] as const).map(m => (
          <button key={m} type="button" onClick={() => setMode(m)} disabled={!!busy}
            style={{ ...btn(s.mode === m ? (m === "live" ? RED : color) : "#ffffff22"), background: s.mode === m ? `${m === "live" ? RED : color}22` : "transparent", fontWeight: s.mode === m ? 700 : 400 }}>
            {m === "off" ? "Off" : m === "paper" ? "Paper (practice)" : "Live (real money)"}
          </button>
        ))}
        <span style={{ color: s.mode === "live" ? RED : s.mode === "paper" ? GREEN : MUTED, fontSize: 12 }}>
          {s.mode === "off" ? "Autopilot off" : `Autopilot on · every ${s.intervalMin} min`}
        </span>
      </div>

      {confirmLive && (
        <div style={{ ...box, borderColor: `${RED}66`, display: "grid", gap: 8 }}>
          <b style={{ color: RED }}>Switch on automatic real-money trading?</b>
          <span style={{ color: "#c8d3de", lineHeight: 1.5 }}>
            The Trading agent will place real orders on your connected brokers by itself, each with a stop-loss, within your limits ({s.riskPct}% risk per trade, {s.dailyLossPct}% daily loss limit, up to {s.maxPositions} positions).
            No person or AI is right every time: losing trades are normal and you can lose money. Check its paper record first. You can switch it off any time, here or by saying &quot;stop trading&quot;.
          </span>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", color: "#e8eef5" }}>
            <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} style={{ marginTop: 3 }} />
            I understand the risk and that I am responsible for these trades.
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={!accepted || !!busy} style={{ ...btn(RED), opacity: accepted ? 1 : 0.5 }}
              onClick={async () => { if (await post("mode", { action: "settings", patch: { mode: "live" }, acceptLive: true })) setConfirmLive(false); }}>Switch on live trading</button>
            <button type="button" style={btn()} onClick={() => setConfirmLive(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Record */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={{ ...box, flex: "1 1 100px" }}><div style={label}>{s.mode === "live" && st.live.trades ? "LIVE RESULT" : "PAPER BALANCE"}</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{s.mode === "live" && st.live.trades ? usd(st.live.pnl) : `${st.paper.equity.toLocaleString("en-US", { maximumFractionDigits: 2 })} USD`}</div></div>
        <div style={{ ...box, flex: "1 1 80px" }}><div style={label}>WIN RATE</div><div style={{ fontWeight: 700, fontSize: 15 }}>{record.trades ? `${record.winRate}%` : "—"}</div><div style={{ color: MUTED, fontSize: 11.5 }}>{record.trades} closed</div></div>
        <div style={{ ...box, flex: "1 1 80px" }}><div style={label}>PROFIT</div><div style={{ fontWeight: 700, fontSize: 15, color: record.pnl >= 0 ? GREEN : RED }}>{record.trades ? usd(record.pnl) : "—"}</div>
          <div style={{ color: MUTED, fontSize: 11.5 }}>{record.profitFactor ? `factor ${record.profitFactor}` : ""}{record.maxDrawdown ? ` · max dip ${record.maxDrawdown}` : ""}</div></div>
      </div>

      {/* Open positions */}
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ ...label, color }}>OPEN POSITIONS</span>
          {st.open.length > 0 && <button type="button" style={btn(RED)} disabled={!!busy} onClick={() => { if (confirm("Close every open trade now at the market price?")) void post("close", { action: "close", which: "all" }); }}>Close all</button>}
        </div>
        {!st.open.length && <span style={{ color: MUTED }}>None open.</span>}
        {st.open.map(t => (
          <div key={t.id} style={{ ...box, display: "grid", gridTemplateColumns: "1fr auto", gap: 4, alignItems: "center" }}>
            <span><b style={{ color: t.side === "buy" ? GREEN : RED }}>{t.side.toUpperCase()}</b> {t.name}{t.mode === "live" && <b style={{ color: RED }}> · LIVE</b>}
              <span style={{ color: MUTED, display: "block", fontSize: 12 }}>{t.qty} from {t.entry} · now {t.price} · stop {t.stop} · target {t.target}</span></span>
            <span style={{ textAlign: "right" }}><b style={{ color: t.unrealized >= 0 ? GREEN : RED }}>{usd(t.unrealized)}</b><br />
              <button type="button" style={{ ...btn(), padding: "2px 8px", marginTop: 4 }} disabled={!!busy} onClick={() => void post("close", { action: "close", which: t.id })}>Close</button></span>
          </div>
        ))}
      </div>

      {/* Analyse */}
      <form onSubmit={async e => { e.preventDefault(); setAnalysis(null); const b = await post("analyze", { action: "analyze", symbol }); if (b?.analysis) setAnalysis(b.analysis); }} style={{ display: "flex", gap: 6 }}>
        <input value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="Analyse a market: BTC, EURUSD, gold, AAPL…" style={input} />
        <button type="submit" style={btn(color)} disabled={!!busy || !symbol.trim()}>{busy === "analyze" ? "Analysing…" : "Analyse"}</button>
      </form>
      {analysis && <AnalysisView a={analysis} />}

      {/* Rules */}
      <div>
        <button type="button" style={{ ...btn(), width: "100%", textAlign: "left" }} onClick={() => setShowRules(v => !v)}>
          {showRules ? "▾" : "▸"} Rules: {s.riskPct}% risk per trade · {s.dailyLossPct}% daily loss limit · {s.maxPositions} positions · ≥{s.minConfidence}% confidence · watching {s.watchlist.join(", ")}
        </button>
        {showRules && rules && (
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
              {([["riskPct", "Risk per trade %"], ["dailyLossPct", "Daily loss limit %"], ["maxPositions", "Max positions"], ["minConfidence", "Min confidence %"], ["intervalMin", "Check every (min)"]] as const).map(([k, l]) => (
                <label key={k} style={{ display: "grid", gap: 3 }}><span style={label}>{l.toUpperCase()}</span>
                  <input type="number" step="any" value={rules[k]} onChange={e => setRules({ ...rules, [k]: Number(e.target.value) })} style={input} /></label>
              ))}
            </div>
            <label style={{ display: "grid", gap: 3 }}><span style={label}>WATCHLIST (UP TO 12)</span>
              <input value={rules.watchlist.join(", ")} onChange={e => setRules({ ...rules, watchlist: e.target.value.split(/[,\s]+/).filter(Boolean) })} style={input} /></label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
              {([["stock", ["paper", "alpaca"]], ["forex", ["paper", "oanda"]], ["crypto", ["paper"]]] as [Market, string[]][]).map(([m, opts]) => (
                <label key={m} style={{ display: "grid", gap: 3 }}><span style={label}>{m === "stock" ? "STOCKS" : m === "forex" ? "FOREX & GOLD" : "CRYPTO"} BROKER</span>
                  <select value={rules.brokers[m]} onChange={e => setRules({ ...rules, brokers: { ...rules.brokers, [m]: e.target.value } })} style={input}>
                    {opts.map(o => { const b = st.brokers.find(x => x.id === o); return <option key={o} value={o}>{o === "paper" ? "Paper" : `${b?.name}${b?.connected ? "" : " (not connected)"}`}</option>; })}
                  </select></label>
              ))}
            </div>
            <span style={{ color: MUTED, fontSize: 12 }}>Connect brokers on the Connections page (Alpaca for US stocks, OANDA for forex and gold). Binance and Bybit (crypto) are coming through the desktop app.</span>
            <button type="button" style={btn(color)} disabled={!!busy} onClick={() => void post("rules", { action: "settings", patch: { riskPct: rules.riskPct, dailyLossPct: rules.dailyLossPct, maxPositions: rules.maxPositions, minConfidence: rules.minConfidence, intervalMin: rules.intervalMin, watchlist: rules.watchlist, brokers: rules.brokers } })}>Save rules</button>
          </div>
        )}
      </div>

      {s.mode !== "off" && <button type="button" style={btn()} disabled={!!busy} onClick={() => void post("scan", { action: "scan" })}>{busy === "scan" ? "Scanning the watchlist…" : "Scan the watchlist now"}</button>}

      {/* Latest */}
      {st.log.length > 0 && (
        <div style={{ display: "grid", gap: 4 }}>
          <span style={{ ...label, color }}>LATEST</span>
          {st.log.slice(0, 6).map((l, i) => <div key={i} style={{ color: "#c8d3de", fontSize: 12, lineHeight: 1.45 }}><span style={{ color: MUTED }}>{new Date(l.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span> · {l.text}</div>)}
        </div>
      )}
      {st.closed.length > 0 && (
        <div style={{ display: "grid", gap: 3 }}>
          <span style={{ ...label, color }}>CLOSED</span>
          {st.closed.slice(0, 6).map(t => <div key={t.id} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", gap: 8 }}><span>{t.side} {t.name} {t.entry} → {t.exit} <span style={{ color: MUTED }}>({t.closeNote}{t.mode === "live" ? ", live" : ""})</span></span><b style={{ color: (t.pnl ?? 0) >= 0 ? GREEN : RED }}>{usd(t.pnl ?? 0)}</b></div>)}
        </div>
      )}

      {err && <div style={{ color: "#ff8a80" }}>{err}</div>}
      <div style={{ color: "#5d6b78", fontSize: 11.5, lineHeight: 1.5 }}>Analysis from live prices and news from trusted sources. It is not financial advice and no one is right every time. Prove it on paper before using real money, and only risk what you can afford to lose.</div>
    </div>
  );
}

function AnalysisView({ a }: { a: Analysis }) {
  const d = a.decision, tone = d.action === "buy" ? GREEN : d.action === "sell" ? RED : AMBER;
  return (
    <div style={{ ...box, display: "grid", gap: 6, borderColor: `${tone}55` }}>
      <div><b style={{ color: tone }}>{d.action.toUpperCase()}</b> {a.name}{d.action !== "wait" && <> · {d.confidence}% confidence · {d.horizon}</>}</div>
      {(d.entry > 0 && d.stop > 0) && <div style={{ fontVariantNumeric: "tabular-nums" }}>{d.action === "wait" ? "Would act around " : "Entry "}{d.entry} · stop {d.stop} · target {d.target}{d.rewardRisk ? ` · reward ${d.rewardRisk}× risk` : ""}</div>}
      {d.reasons.length > 0 && <ul style={{ margin: 0, paddingLeft: 18, color: "#c8d3de" }}>{d.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      {d.risks.length > 0 && <div style={{ color: AMBER, fontSize: 12.5 }}>Risks: {d.risks.join("; ")}</div>}
      {d.invalidation && <div style={{ color: MUTED, fontSize: 12.5 }}>Wrong if: {d.invalidation}</div>}
      {a.checks.length > 0 && <div style={{ color: MUTED, fontSize: 12.5 }}>Risk checks: {a.checks.join(" ")}</div>}
      {a.news.events.length > 0 && <div style={{ color: "#c8d3de", fontSize: 12.5 }}>Coming up: {a.news.events.slice(0, 3).join(" · ")}</div>}
      {a.news.sources.length > 0 && <div style={{ fontSize: 12 }}><span style={{ color: MUTED }}>Sources ({a.news.trusted} top-tier): </span>
        {a.news.sources.slice(0, 6).map((s, i) => <a key={i} href={s.uri} target="_blank" rel="noreferrer" style={{ color: s.trusted ? "#7fd8ff" : MUTED, marginRight: 8 }}>{s.title}</a>)}</div>}
    </div>
  );
}
