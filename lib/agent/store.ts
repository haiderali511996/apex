import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { ActionLogEntry, PendingAction } from "./types";

// Persisted to disk (not a database) because this agent is meant to run as a
// single always-on process holding long-lived OAuth tokens, not on ephemeral
// serverless invocations. See SETUP.md for deployment notes.
const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "agent-state.json");

type TikTokTokens = { accessToken: string; refreshToken: string; expiresAt: number };

type State = {
  pendingActions: PendingAction[];
  actionLog: ActionLogEntry[];
  tiktokTokens?: TikTokTokens;
};

const EMPTY_STATE: State = { pendingActions: [], actionLog: [] };

// Serializes read-modify-write cycles within this process so concurrent
// requests can't clobber each other's writes.
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function readState(): Promise<State> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    return { ...EMPTY_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function writeState(state: State): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export function createPendingAction(
  input: Omit<PendingAction, "id" | "createdAt" | "status">
): Promise<PendingAction> {
  return serialize(async () => {
    const state = await readState();
    const action: PendingAction = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    state.pendingActions.unshift(action);
    await writeState(state);
    return action;
  });
}

export function listPendingActions(): Promise<PendingAction[]> {
  return serialize(async () => (await readState()).pendingActions);
}

export function getPendingAction(id: string): Promise<PendingAction | undefined> {
  return serialize(async () => (await readState()).pendingActions.find((a) => a.id === id));
}

export function resolvePendingAction(
  id: string,
  status: PendingAction["status"],
  result?: string
): Promise<PendingAction | undefined> {
  return serialize(async () => {
    const state = await readState();
    const action = state.pendingActions.find((a) => a.id === id);
    if (!action) return undefined;
    action.status = status;
    if (result) action.result = result;
    await writeState(state);
    return action;
  });
}

export function appendActionLog(entry: Omit<ActionLogEntry, "id" | "at">): Promise<ActionLogEntry> {
  return serialize(async () => {
    const state = await readState();
    const full: ActionLogEntry = { ...entry, id: randomUUID(), at: new Date().toISOString() };
    state.actionLog.unshift(full);
    state.actionLog = state.actionLog.slice(0, 200);
    await writeState(state);
    return full;
  });
}

export function listActionLog(limit = 20): Promise<ActionLogEntry[]> {
  return serialize(async () => (await readState()).actionLog.slice(0, limit));
}

// TikTok's OAuth2 refresh tokens rotate on every use, so the current pair
// has to be persisted here rather than kept in a static env var.
export function getTikTokTokens(): Promise<TikTokTokens | undefined> {
  return serialize(async () => (await readState()).tiktokTokens);
}

export function setTikTokTokens(tokens: TikTokTokens): Promise<void> {
  return serialize(async () => {
    const state = await readState();
    state.tiktokTokens = tokens;
    await writeState(state);
  });
}
