import { cred } from "@/lib/credentials";
import type { Instrument, Market } from "./market";

/**
 * Real-money brokers, one interface. Every order goes in with its stop-loss
 * and take-profit attached, held by the broker itself, so the protection
 * works even if this server or the internet goes down.
 *
 * Alpaca (US stocks and ETFs) and OANDA (forex, gold, silver) run from the
 * server. Binance and Bybit refuse connections from US servers, so crypto
 * orders will run from the user's own computer through the desktop app.
 * Each account uses its own keys from the Connections page; practice/paper
 * accounts are supported for testing with fake money.
 */

export type BrokerId = "paper" | "alpaca" | "oanda" | "binance" | "bybit";
export type Account = { equity: number; cash: number; currency: string };
export type Placed = { orderId: string; fillPrice: number; qty: number };
export type Status = { open: boolean; exitPrice?: number; pnl?: number };

export interface Broker {
  id: BrokerId;
  name: string;
  account(): Promise<Account>;
  /** Market order with the stop and target attached. qty in shares / units. */
  place(inst: Instrument, side: "buy" | "sell", qty: number, stop: number, target: number): Promise<Placed>;
  status(inst: Instrument, orderId: string): Promise<Status>;
  close(inst: Instrument, orderId: string): Promise<void>;
  /** Rounds a size to what the broker accepts; 0 if below its minimum. */
  size(inst: Instrument, qty: number): Promise<number>;
}

export const BROKER_NAMES: Record<BrokerId, string> = { paper: "Paper (practice money)", alpaca: "Alpaca", oanda: "OANDA", binance: "Binance", bybit: "Bybit" };
/** Which brokers trade which market. */
export const BROKERS_FOR: Record<Market, BrokerId[]> = { stock: ["paper", "alpaca"], forex: ["paper", "oanda"], crypto: ["paper", "binance", "bybit"] };

async function call(url: string, init: RequestInit, who: string): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const b = body as { message?: string; errorMessage?: string } | null;
    throw new Error(`${who} ${res.status}: ${(b && (b.message || b.errorMessage)) || String(text).slice(0, 200) || "request failed"}`);
  }
  return body;
}

// ── Alpaca (stocks) ──

function alpaca(): Broker | null {
  const key = cred("ALPACA_KEY_ID")?.trim(), secret = cred("ALPACA_SECRET_KEY")?.trim();
  if (!key || !secret) return null;
  const live = /^live$/i.test(cred("ALPACA_MODE")?.trim() || "paper");
  const base = live ? "https://api.alpaca.markets" : "https://paper-api.alpaca.markets";
  const headers = { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret, "content-type": "application/json" };
  const api = (path: string, init: RequestInit = {}) => call(`${base}${path}`, { ...init, headers }, "Alpaca");
  type Order = { id: string; status: string; filled_avg_price?: string | null; filled_qty?: string; side: string; legs?: Order[] | null; type?: string };
  return {
    id: "alpaca", name: live ? "Alpaca" : "Alpaca (paper account)",
    async account() {
      const a = await api("/v2/account") as { equity: string; cash: string; currency?: string };
      return { equity: Number(a.equity), cash: Number(a.cash), currency: a.currency || "USD" };
    },
    async size(_inst, qty) { return Math.floor(qty); },
    async place(inst, side, qty, stop, target) {
      if (!inst.alpaca) throw new Error(`${inst.symbol} can't be traded on Alpaca (US stocks and ETFs only).`);
      const o = await api("/v2/orders", { method: "POST", body: JSON.stringify({
        symbol: inst.alpaca, qty: String(qty), side, type: "market", time_in_force: "gtc", order_class: "bracket",
        take_profit: { limit_price: target.toFixed(2) }, stop_loss: { stop_price: stop.toFixed(2) },
      }) }) as Order;
      // The fill arrives a moment later.
      let fill = 0;
      for (let i = 0; i < 6 && !fill; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const now = await api(`/v2/orders/${o.id}`) as Order;
        fill = Number(now.filled_avg_price) || 0;
        if (/rejected|canceled|expired/.test(now.status)) throw new Error(`Alpaca ${now.status} the order.`);
      }
      return { orderId: o.id, fillPrice: fill, qty };
    },
    async status(inst, orderId) {
      const o = await api(`/v2/orders/${orderId}?nested=true`) as Order;
      if (/rejected|canceled|expired/.test(o.status) && !Number(o.filled_qty)) return { open: false, exitPrice: 0, pnl: 0 };
      const exit = (o.legs ?? []).find(l => l.status === "filled");
      if (exit) return { open: false, exitPrice: Number(exit.filled_avg_price) };
      // Closed by hand at the broker: the position is gone.
      const pos = await api(`/v2/positions/${encodeURIComponent(inst.alpaca ?? inst.symbol)}`).catch(() => null);
      return pos ? { open: true } : { open: false };
    },
    async close(inst, orderId) {
      const o = await api(`/v2/orders/${orderId}?nested=true`) as Order;
      for (const l of o.legs ?? []) if (!/filled|canceled|expired/.test(l.status)) await api(`/v2/orders/${l.id}`, { method: "DELETE" }).catch(() => {});
      await api(`/v2/positions/${encodeURIComponent(inst.alpaca ?? inst.symbol)}`, { method: "DELETE" }).catch(() => {});
    },
  };
}

// ── OANDA (forex, metals) ──

function oanda(): Broker | null {
  const token = cred("OANDA_API_TOKEN")?.trim(), accountId = cred("OANDA_ACCOUNT_ID")?.trim();
  if (!token || !accountId) return null;
  const live = /^live$/i.test(cred("OANDA_MODE")?.trim() || "practice");
  const base = `${live ? "https://api-fxtrade.oanda.com" : "https://api-fxpractice.oanda.com"}/v3/accounts/${encodeURIComponent(accountId)}`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const api = (path: string, init: RequestInit = {}) => call(`${base}${path}`, { ...init, headers }, "OANDA");
  const specs = new Map<string, { precision: number; units: number; min: number }>();
  const spec = async (inst: Instrument) => {
    const name = inst.oanda ?? inst.symbol;
    if (!specs.has(name)) {
      const b = await api(`/instruments?instruments=${name}`) as { instruments?: { displayPrecision: number; tradeUnitsPrecision: number; minimumTradeSize: string }[] };
      const i = b.instruments?.[0];
      if (!i) throw new Error(`OANDA doesn't offer ${name} on this account.`);
      specs.set(name, { precision: i.displayPrecision, units: i.tradeUnitsPrecision, min: Number(i.minimumTradeSize) || 1 });
    }
    return specs.get(name)!;
  };
  return {
    id: "oanda", name: live ? "OANDA" : "OANDA (practice account)",
    async account() {
      const b = await api("/summary") as { account: { NAV: string; balance: string; currency: string } };
      return { equity: Number(b.account.NAV), cash: Number(b.account.balance), currency: b.account.currency };
    },
    async size(inst, qty) {
      const s = await spec(inst);
      const q = Number(qty.toFixed(s.units));
      return q >= s.min ? q : 0;
    },
    async place(inst, side, qty, stop, target) {
      const s = await spec(inst);
      const b = await api("/orders", { method: "POST", body: JSON.stringify({ order: {
        type: "MARKET", instrument: inst.oanda, units: String(side === "buy" ? qty : -qty), timeInForce: "FOK", positionFill: "DEFAULT",
        stopLossOnFill: { price: stop.toFixed(s.precision), timeInForce: "GTC" }, takeProfitOnFill: { price: target.toFixed(s.precision), timeInForce: "GTC" },
      } }) }) as { orderFillTransaction?: { price?: string; tradeOpened?: { tradeID: string; price?: string } }; orderCancelTransaction?: { reason?: string } };
      const t = b.orderFillTransaction?.tradeOpened;
      if (!t) throw new Error(`OANDA didn't fill the order${b.orderCancelTransaction?.reason ? `: ${b.orderCancelTransaction.reason}` : ""}.`);
      return { orderId: t.tradeID, fillPrice: Number(t.price ?? b.orderFillTransaction?.price) || 0, qty };
    },
    async status(_inst, tradeId) {
      const b = await api(`/trades/${tradeId}`) as { trade: { state: string; averageClosePrice?: string; realizedPL?: string } };
      return b.trade.state === "OPEN" ? { open: true } : { open: false, exitPrice: Number(b.trade.averageClosePrice) || undefined, pnl: Number(b.trade.realizedPL) };
    },
    async close(_inst, tradeId) { await api(`/trades/${tradeId}/close`, { method: "PUT", body: "{}" }); },
  };
}

/** The connected broker for an id, or null when its keys aren't on the Connections page. */
export function broker(id: BrokerId): Broker | null {
  if (id === "alpaca") return alpaca();
  if (id === "oanda") return oanda();
  return null;
}

export function connectedBrokers(): BrokerId[] {
  return (["alpaca", "oanda"] as BrokerId[]).filter(id => broker(id));
}
