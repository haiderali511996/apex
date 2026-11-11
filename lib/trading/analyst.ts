import { generateGemini, geminiText } from "@/lib/agent/gemini";
import { candles, instrument, type Instrument, type Market } from "./market";
import { px, snapshot, type Snapshot } from "./indicators";

/**
 * The Trading agent's analysis of one market, the way a disciplined
 * professional works:
 * 1. Technicals on three timeframes, computed exactly (indicators.ts):
 *    the daily for direction, 4-hour for the setup, 1-hour for timing.
 * 2. News and scheduled events from authoritative sources only (wire
 *    services, financial press, central banks, regulators, filings), through
 *    Google Search.
 * 3. A decision from the model, given both, under fixed rules.
 * 4. Hard checks in code the model can't talk its way past: the stop is on
 *    the right side, reward is at least 1.5x the risk, the stop is a sane
 *    distance for this market's volatility, and confidence is stated.
 * No analysis is right every time; the track record (engine.ts) shows how
 * often these calls actually work.
 */

export type Decision = {
  action: "buy" | "sell" | "wait";
  confidence: number;
  entry: number; stop: number; target: number;
  rewardRisk: number;
  horizon: string;
  reasons: string[];
  risks: string[];
  invalidation: string;
};
export type News = { summary: string; sentiment: number; events: string[]; sources: { title: string; uri: string; trusted?: boolean }[]; trusted: number; at: number };

/** Wire services, financial press, central banks, statistics offices, regulators and established data and crypto desks. */
const TRUSTED = /(^|\.)(reuters\.com|bloomberg\.com|apnews\.com|ft\.com|wsj\.com|cnbc\.com|marketwatch\.com|barrons\.com|economist\.com|nikkei\.com|bbc\.co\.uk|bbc\.com|nytimes\.com|federalreserve\.gov|ecb\.europa\.eu|europa\.eu|bankofengland\.co\.uk|boj\.or\.jp|snb\.ch|rba\.gov\.au|bankofcanada\.ca|pbc\.gov\.cn|sbp\.org\.pk|imf\.org|bis\.org|sec\.gov|bls\.gov|bea\.gov|treasury\.gov|cmegroup\.com|nasdaq\.com|nyse\.com|finance\.yahoo\.com|tradingeconomics\.com|investing\.com|forexfactory\.com|fxstreet\.com|morningstar\.com|spglobal\.com|coindesk\.com|theblock\.co|decrypt\.co|cointelegraph\.com|binance\.com|coinbase\.com|kitco\.com|gold\.org)$/i;
const isTrusted = (title: string) => TRUSTED.test(title.trim().toLowerCase().replace(/^www\./, ""));
export type Analysis = { instrument: Instrument; name: string; at: string; frames: Record<"1d" | "4h" | "1h", Snapshot>; news: News; decision: Decision; checks: string[] };

const SOURCES = "Reuters, Bloomberg, Associated Press, Financial Times, Wall Street Journal, CNBC, MarketWatch, Barron's, The Economist, Nikkei; central banks (Federal Reserve, ECB, Bank of England, Bank of Japan, SNB, RBA, Bank of Canada, PBoC, State Bank of Pakistan), statistics offices (BLS, BEA, Eurostat, ONS), regulators and filings (SEC/EDGAR, company investor-relations pages, exchange notices); for crypto also CoinDesk, The Block, Decrypt and official project or exchange announcements";

const newsCache = new Map<string, News>();
const NEWS_FRESH_MS = 30 * 60_000;

/** What's moving this market now, and what's scheduled, from authoritative sources only. */
export async function marketNews(inst: Instrument, name: string): Promise<News> {
  const hit = newsCache.get(inst.symbol);
  if (hit && Date.now() - hit.at < NEWS_FRESH_MS) return hit;
  const what = inst.market === "crypto" ? `the cryptocurrency ${name} (${inst.symbol.replace(/USDT$/, "")}) and the crypto market overall`
    : inst.market === "forex" ? `the ${name} exchange rate (both currencies, their central banks and economies${/XAU|XAG/.test(inst.symbol) ? ", and the metal's drivers: real yields, the dollar, central-bank buying, geopolitics" : ""})`
    : `${name} (ticker ${inst.symbol}): the company or fund, its sector and the broader market`;
  const today = new Date().toUTCString();
  const ask = (system: string) => generateGemini(system,
    [{ role: "user", parts: [{ text: `Search Google News now (several searches: latest news, this week's economic calendar, analyst coverage), then report for ${what}:
1. NEWS: the most important developments of the last 72 hours that move its price, each with its date and source name, most important first (at most 6).
2. EVENTS: scheduled events in the next 7 days that could move it (rate decisions, CPI, jobs reports, GDP, earnings, token unlocks, regulatory rulings, ETF decisions), each with its date and time in UTC if known, and marked HIGH or MEDIUM impact.
3. SENTIMENT: one line: overall news bias for the price — a number from -2 (strongly bearish) to +2 (strongly bullish) — and why.
Plain text, concise, these three headings.` }] }],
    undefined, { search: true });
  let res = await ask(`You are a markets news desk. Today is ${today}. Use Google Search and rely ONLY on authoritative sources: ${SOURCES}. Ignore social media, forums, YouTube, price-prediction sites, sponsored or promotional content, and anything you can't date. Never invent news, numbers or dates; if you find little, say so.`);
  // The model sometimes answers from memory without searching; ask again, more plainly.
  if (!res.sources?.length) res = await ask(`You are a markets news desk. Today is ${today}. Always search Google before answering. Prefer Reuters, Bloomberg, central banks, official statistics and filings; never invent news, numbers or dates.`);
  if (!res.sources?.length) res = await ask(`Today is ${today}. Search the web first.`);
  // Top-tier sources first.
  const sources = (res.sources ?? []).map(s => ({ ...s, trusted: isTrusted(s.title) })).sort((a, b) => Number(b.trusted) - Number(a.trusted)).slice(0, 8);
  const trusted = sources.filter(s => s.trusted).length;
  const text = geminiText(res).replace(/\*\*/g, "");
  // Without search results this is the model's memory, not news: it isn't used.
  if (!sources.length) return { summary: "No verified news this round (the search returned no sources), so news is not taken into account.", sentiment: 0, events: [], sources: [], trusted: 0, at: Date.now() };
  const m = /SENTIMENT[\s:#*]*([+-]?\d(?:\.\d)?)/i.exec(text);
  const sentiment = m ? Math.max(-2, Math.min(2, Number(m[1]))) : 0;
  const events = /EVENTS:?([\s\S]*?)(?:\n[\s#\d.]*SENTIMENT|$)/i.exec(text)?.[1].split("\n").map(s => s.replace(/^[\s*•#\-\d.]+/, "").trim()).filter(s => s.length > 8 && !/^EVENTS/i.test(s)).slice(0, 6) ?? [];
  const news: News = { summary: text.slice(0, 3500), sentiment, events, sources, trusted, at: Date.now() };
  newsCache.set(inst.symbol, news);
  return news;
}

const fmt = (s: Snapshot) => `price ${px(s.price)}, trend ${s.trend}, EMA20 ${px(s.ema20)} / EMA50 ${px(s.ema50)} / EMA200 ${px(s.ema200)}, RSI ${s.rsi.toFixed(0)}, MACD histogram ${s.macdHist > 0 ? "positive" : "negative"}${s.macdTurn !== "none" ? ` (just turned ${s.macdTurn})` : ""}, ATR ${px(s.atr)} (${(s.atrPct * 100).toFixed(2)}% of price), Bollinger ${px(s.bbLower)}–${px(s.bbUpper)}, support ${s.support.map(px).join(", ") || "none near"}, resistance ${s.resistance.map(px).join(", ") || "none near"}, volume ${s.volumeRatio.toFixed(1)}x average, setup score ${s.score.toFixed(1)} of ±3`;

const RULES = `You are a senior discretionary trader with decades of experience across crypto, forex and equities, known for discipline and capital preservation, not bravado.
Rules you never break:
- Trade with the daily trend; counter-trend only at a clear daily level with confirmation, and then with lower confidence.
- Need agreement: daily direction, a 4-hour setup and 1-hour timing. When they conflict, or price is mid-range with no edge, the answer is "wait". Waiting is a position.
- Respect the news: if a HIGH-impact event for this market is due within about 12 hours, "wait" unless the setup is exceptional, and say so. Strong news against the technicals means "wait".
- The stop goes beyond the structure that proves the idea wrong (a swing low/high or level), typically 1–2.5x the 4-hour ATR away. The target is the next meaningful level; reward must be at least 1.5x the risk.
- Entry is the current price (market order) unless a nearby level is clearly better.
- Confidence (0–100) is your honest probability the target is reached before the stop. Professionals are right roughly half the time; above 70 is rare and needs everything aligned. Never inflate it.
Reply with JSON only: {"action":"buy"|"sell"|"wait","confidence":0-100,"entry":number,"stop":number,"target":number,"horizon":"e.g. 1-3 days","reasons":["…"],"risks":["…"],"invalidation":"what would prove this wrong"}. For "wait", still give the levels you'd act at as entry/stop/target if any, else 0.`;

/** A full analysis and decision for one market. */
export async function analyze(symbol: string, hint?: Market): Promise<Analysis> {
  const inst = instrument(symbol, hint);
  const [d, h4, h1] = await Promise.all([candles(inst, "1d", 300), candles(inst, "4h", 300), candles(inst, "1h", 300)]);
  // Forex and metals keep their own names (Yahoo names gold after its futures contract).
  const name = inst.market === "forex" ? inst.name : d.name || inst.name;
  const frames = { "1d": snapshot(d.candles), "4h": snapshot(h4.candles), "1h": snapshot(h1.candles) };
  const news = await marketNews(inst, name).catch(err => ({ summary: `News unavailable: ${err instanceof Error ? err.message : err}`, sentiment: 0, events: [], sources: [], trusted: 0, at: Date.now() } as News));
  const sourcing = news.sources.length ? `Sources: ${news.trusted} of ${news.sources.length} are top-tier (${news.sources.map(s => `${s.title}${s.trusted ? "" : " [lower tier]"}`).join(", ")}). Give lower-tier claims less weight unless a top-tier source agrees.` : "";
  const res = await generateGemini(RULES, [{ role: "user", parts: [{ text: `Market: ${name} (${inst.symbol}, ${inst.market}). Now: ${new Date().toUTCString()}.
DAILY: ${fmt(frames["1d"])}
4-HOUR: ${fmt(frames["4h"])}
1-HOUR: ${fmt(frames["1h"])}
NEWS DESK:
${news.summary}
${sourcing}` }] }], undefined, { json: true });
  let raw: Partial<Decision> = {};
  try { raw = JSON.parse(geminiText(res)) as Partial<Decision>; } catch { /* treated as wait below */ }
  const { decision, checks } = check(raw, frames);
  return { instrument: inst, name, at: new Date().toISOString(), frames, news, decision, checks };
}

/** The rules in code: anything that fails becomes "wait", with the reason. */
export function check(raw: Partial<Decision>, frames: Record<"1d" | "4h" | "1h", Snapshot>): { decision: Decision; checks: string[] } {
  const price = frames["1h"].price, atr4 = frames["4h"].atr || frames["1d"].atr / 3;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
  const d: Decision = {
    action: raw.action === "buy" || raw.action === "sell" ? raw.action : "wait",
    confidence: Math.max(0, Math.min(100, Math.round(n(raw.confidence)))),
    entry: n(raw.entry) || price, stop: n(raw.stop), target: n(raw.target), rewardRisk: 0,
    horizon: String(raw.horizon ?? ""), reasons: Array.isArray(raw.reasons) ? raw.reasons.map(String).slice(0, 6) : [],
    risks: Array.isArray(raw.risks) ? raw.risks.map(String).slice(0, 5) : [], invalidation: String(raw.invalidation ?? ""),
  };
  const checks: string[] = [];
  if (d.action !== "wait") {
    // A market order fills near the current price, not a stale one.
    if (Math.abs(d.entry - price) > atr4 * 0.75) { checks.push(`Entry ${px(d.entry)} is far from the price ${px(price)}; using the price.`); d.entry = price; }
    const long = d.action === "buy";
    const risk = long ? d.entry - d.stop : d.stop - d.entry;
    const reward = long ? d.target - d.entry : d.entry - d.target;
    if (!(risk > 0)) checks.push("The stop is on the wrong side of the entry.");
    else if (!(reward > 0)) checks.push("The target is on the wrong side of the entry.");
    else {
      d.rewardRisk = reward / risk;
      if (d.rewardRisk < 1.5) checks.push(`Reward is only ${d.rewardRisk.toFixed(2)}x the risk (1.5x needed).`);
      if (risk < atr4 * 0.4) checks.push("The stop is too tight for this market's normal swings; it would likely be hit by noise.");
      if (risk > atr4 * 4) checks.push("The stop is too far away for a sound position size.");
    }
    if (!d.confidence) checks.push("No confidence was given.");
    if (checks.some(c => !c.startsWith("Entry"))) d.action = "wait";
  } else if (d.stop && d.target && d.entry) {
    const risk = Math.abs(d.entry - d.stop);
    d.rewardRisk = risk ? Math.abs(d.target - d.entry) / risk : 0;
  }
  d.entry = px(d.entry); d.stop = px(d.stop); d.target = px(d.target);
  d.rewardRisk = Number(d.rewardRisk.toFixed(2));
  return { decision: d, checks };
}

/** One analysis in a few lines, for Sarah to say and the card to show. */
export function describeAnalysis(a: Analysis): string {
  const d = a.decision, f = a.frames;
  const call = d.action === "wait"
    ? `WAIT — no trade now${d.entry && d.stop && d.target ? ` (would act around ${d.entry}, stop ${d.stop}, target ${d.target})` : ""}.`
    : `${d.action.toUpperCase()} at ${d.entry}, stop ${d.stop}, target ${d.target} (reward ${d.rewardRisk}x the risk), confidence ${d.confidence}%, horizon ${d.horizon || "a few days"}.`;
  return [
    `${a.name} (${a.instrument.market}) — ${call}`,
    `Trend: daily ${f["1d"].trend}, 4h ${f["4h"].trend}, 1h ${f["1h"].trend}; RSI(4h) ${f["4h"].rsi.toFixed(0)}; price ${px(f["1h"].price)}.`,
    d.reasons.length ? `Why: ${d.reasons.join("; ")}` : "",
    d.risks.length ? `Risks: ${d.risks.join("; ")}` : "",
    d.invalidation ? `Wrong if: ${d.invalidation}` : "",
    a.checks.length ? `Risk checks: ${a.checks.join(" ")}` : "",
    a.news.events.length ? `Coming up: ${a.news.events.slice(0, 3).join(" | ")}` : "",
    a.news.sources.length ? `News sources (${a.news.trusted} of ${a.news.sources.length} top-tier): ${a.news.sources.slice(0, 5).map(s => s.title).join(", ")}` : "News: no verified sources this time, so it was left out.",
  ].filter(Boolean).join("\n");
}
