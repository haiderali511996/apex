import Anthropic from "@anthropic-ai/sdk";

/** Model the agent runs on. Override with ANTHROPIC_MODEL in .env.local. */
export const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

/**
 * One client for the whole agent.
 *
 * Identity-linked API keys (the kind issued to a user rather than to a
 * workspace) are rejected without an `anthropic-workspace-id` header naming
 * the workspace the request acts in, so it's sent whenever the env var is
 * set. Plain workspace-scoped keys don't need it and work with it unset.
 */
export function anthropicClient(): Anthropic {
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
  });
}
