import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { toolDefinitions, executeTool } from "./tools";
import { toShape, type JsonSchema } from "./jsonSchemaToZod";
import type { PendingAction } from "./types";

/**
 * The Claude Code backend.
 *
 * Instead of calling the Messages API and running the tool loop here, this
 * hands the whole turn to the Claude Agent SDK — Claude Code as a library. The
 * SDK runs the local `claude` binary, so the turn is billed against whatever
 * that binary is logged in as: on a machine where you've signed in to Claude
 * Code, that's your subscription rather than API credits.
 *
 * Two consequences worth knowing:
 *
 *   - It spawns a subprocess, so it only works where the Next.js server is
 *     running on a machine with Claude Code installed and logged in — i.e.
 *     locally. A deployed instance needs ANTHROPIC_API_KEY and the API path.
 *   - Anthropic doesn't permit offering claude.ai login to *other people's*
 *     users without prior approval. Running it yourself, against your own
 *     login, is just you using your own Claude Code.
 */

/** The in-process MCP server the connectors are exposed through. */
const SERVER_NAME = "imex";

/**
 * Claude Code ships with file and shell tools. Imex is an assistant for
 * accounts and reports, not a coding agent, and its working directory is the
 * user's own machine — so the built-ins are blocked outright and only the
 * connectors are left. `allowedTools` alone would not do this: it auto-approves
 * without restricting.
 */
const BLOCKED_BUILTINS = [
  "Bash",
  "BashOutput",
  "KillShell",
  "Read",
  "Write",
  "Edit",
  "NotebookEdit",
  "Glob",
  "Grep",
  "Task",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "SlashCommand",
];

export type ClaudeCodeRun = {
  reply: string;
  pendingActions: PendingAction[];
  /** The SDK's own estimate for the turn. Zero on a subscription login. */
  costUsd: number;
};

/** Renders the conversation the client holds into a single prompt. */
function renderPrompt(messages: { role: "user" | "assistant"; content: string }[]): string {
  if (messages.length === 1) return messages[0].content;
  return messages
    .map((m) => `${m.role === "user" ? "Haider" : "Imex"}: ${m.content}`)
    .join("\n\n");
}

export async function runViaClaudeCode({
  messages,
  systemPrompt,
  maxTurns = 16,
}: {
  messages: { role: "user" | "assistant"; content: string }[];
  systemPrompt: string;
  maxTurns?: number;
}): Promise<ClaudeCodeRun> {
  const pendingActions: PendingAction[] = [];

  // The same connectors the API path uses, re-presented as MCP tools. The
  // schemas are converted rather than restated, so tools.ts stays the one
  // place a tool is defined.
  const tools = toolDefinitions.map((definition) =>
    tool(
      definition.name,
      definition.description ?? "",
      toShape(definition.input_schema as JsonSchema),
      async (args) => {
        try {
          const result = await executeTool(
            definition.name,
            (args ?? {}) as Record<string, unknown>
          );
          // A proposed post or email is queued for approval, not sent; the
          // route returns these so the UI can show the confirmation card.
          if (result.pendingAction) pendingActions.push(result.pendingAction);
          return { content: [{ type: "text" as const, text: result.text }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      }
    )
  );

  const server = createSdkMcpServer({ name: SERVER_NAME, version: "1.0.0", tools });

  let reply = "";
  let costUsd = 0;

  const run = query({
    prompt: renderPrompt(messages),
    options: {
      systemPrompt,
      mcpServers: { [SERVER_NAME]: server },
      allowedTools: toolDefinitions.map((d) => `mcp__${SERVER_NAME}__${d.name}`),
      disallowedTools: BLOCKED_BUILTINS,
      // Don't inherit the developer's own CLAUDE.md, skills or settings — Imex
      // should behave the same whoever's machine it runs on.
      settingSources: [],
      maxTurns,
      ...(process.env.IMEX_CLAUDE_CODE_MODEL
        ? { model: process.env.IMEX_CLAUDE_CODE_MODEL }
        : {}),
    },
  });

  for await (const message of run) {
    if (message.type !== "result") continue;
    costUsd = message.total_cost_usd ?? 0;
    if (message.subtype === "success") {
      reply = message.result;
    } else {
      throw new Error(`Claude Code ended the turn: ${message.subtype}`);
    }
  }

  return { reply: reply.trim() || "(no response)", pendingActions, costUsd };
}

/** Turns a Claude Code failure into something actionable. */
export function describeClaudeCodeError(err: unknown): { message: string; status: number } {
  const raw = err instanceof Error ? err.message : String(err);

  if (/ENOENT|not found|spawn/i.test(raw)) {
    return {
      message:
        "Couldn't start Claude Code. Install it with `npm i -g @anthropic-ai/claude-code`, run `claude` once to sign in, then restart the dev server.",
      status: 500,
    };
  }
  if (/login|auth|unauthor|credential/i.test(raw)) {
    return {
      message:
        "Claude Code isn't signed in. Run `claude` in a terminal, complete the login, then try again.",
      status: 401,
    };
  }
  if (/max_turns|maxTurns/i.test(raw)) {
    return {
      message:
        "That took too many tool calls in a row and stopped to avoid looping — try asking for one thing at a time.",
      status: 500,
    };
  }
  return { message: `Claude Code error: ${raw}`, status: 500 };
}
