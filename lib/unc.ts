/**
 * Paying for a plan in UNC, an ERC-20 token on an EVM chain. The buyer sends
 * UNC from their wallet to the receiving address; the server then reads the
 * transaction from the chain itself and only accepts a successful transfer of
 * the UNC token, to the receiving wallet, of at least the plan's price, with
 * enough confirmations. Each transaction can be claimed once.
 */

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type UncConfig = {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  token: string;
  receiver: string;
  decimals: number;
  symbol: string;
  explorer: string;
  confirmations: number;
};

/** The chain settings from .env.local, or the names of what's missing. */
export function uncConfig(): UncConfig | { missing: string[] } {
  const env = process.env;
  const missing = ["UNC_CHAIN_ID", "UNC_RPC_URL", "UNC_TOKEN_ADDRESS", "UNC_RECEIVER_ADDRESS"].filter(k => !env[k]?.trim());
  if (missing.length) return { missing };
  return {
    chainId: Number(env.UNC_CHAIN_ID),
    chainName: env.UNC_CHAIN_NAME?.trim() || `Chain ${env.UNC_CHAIN_ID}`,
    rpcUrl: env.UNC_RPC_URL!.trim(),
    token: env.UNC_TOKEN_ADDRESS!.trim().toLowerCase(),
    receiver: env.UNC_RECEIVER_ADDRESS!.trim().toLowerCase(),
    decimals: Number(env.UNC_DECIMALS || 18),
    symbol: env.UNC_SYMBOL?.trim() || "UNC",
    explorer: env.UNC_EXPLORER_URL?.trim() || "",
    confirmations: Number(env.UNC_CONFIRMATIONS || 2),
  };
}

/** A decimal UNC amount in the token's smallest units. */
export function toUnits(amount: number, decimals: number): bigint {
  const [whole, frac = ""] = amount.toFixed(Math.min(decimals, 8)).split(".");
  return BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`Chain RPC error: ${body.error.message}`);
  return body.result as T;
}

type Receipt = {
  status: string;
  blockNumber: string;
  logs: { address: string; topics: string[]; data: string }[];
};

export type VerifiedPayment = { payer: string; amount: bigint };

/** Smallest units back to a readable amount, e.g. 4900000417000000000000n → "4900.000417". */
export function fromUnits(units: bigint, decimals: number): string {
  const base = BigInt(10) ** BigInt(decimals);
  const whole = units / base, frac = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/**
 * Checks a transaction sends exactly `exactUnits` UNC to the receiver, in a
 * block mined no earlier than `notBefore`. Each order has its own unique
 * amount, so a transaction can only ever match the order it was made for —
 * copying someone else's hash from a block explorer claims nothing.
 * Returns "pending" while it isn't mined or confirmed yet.
 */
export async function verifyUncPayment(config: UncConfig, txHash: string, exactUnits: bigint, notBefore: Date): Promise<VerifiedPayment | "pending"> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("That isn't a transaction hash (0x followed by 64 hex characters).");
  const chain = await rpc<string>(config.rpcUrl, "eth_chainId", []);
  if (Number(chain) !== config.chainId) throw new Error(`The RPC is on chain ${Number(chain)}, but UNC_CHAIN_ID is ${config.chainId}.`);
  const receipt = await rpc<Receipt | null>(config.rpcUrl, "eth_getTransactionReceipt", [txHash]);
  if (!receipt) return "pending";
  if (receipt.status !== "0x1") throw new Error("That transaction failed on the chain, so no UNC was sent.");
  const latest = await rpc<string>(config.rpcUrl, "eth_blockNumber", []);
  if (Number(latest) - Number(receipt.blockNumber) + 1 < config.confirmations) return "pending";

  const pad = (addr: string) => "0x" + addr.replace(/^0x/, "").padStart(64, "0");
  let paid = BigInt(0), payer = "";
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== config.token) continue;
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || log.topics[2]?.toLowerCase() !== pad(config.receiver)) continue;
    paid += BigInt(log.data);
    payer = "0x" + log.topics[1].slice(-40);
  }
  if (!paid) throw new Error(`That transaction didn't send ${config.symbol} to the payment wallet.`);
  if (paid !== exactUnits) throw new Error(`That transaction sent ${fromUnits(paid, config.decimals)} ${config.symbol}, but this order is for exactly ${fromUnits(exactUnits, config.decimals)}. Each order has its own amount — make sure you used this order's.`);

  // Mined after the order existed (a little slack for clock differences).
  const block = await rpc<{ timestamp: string } | null>(config.rpcUrl, "eth_getBlockByNumber", [receipt.blockNumber, false]);
  if (!block || Number(block.timestamp) * 1000 < notBefore.getTime() - 120_000) throw new Error("That transaction was made before this order, so it can't pay for it.");
  return { payer, amount: paid };
}
