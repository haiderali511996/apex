import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, executeTool } from "@/lib/agent/tools";
import { anthropicClient, MODEL } from "@/lib/agent/anthropicClient";
import type { PendingAction } from "@/lib/agent/types";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are Imex, chief of staff to Haider — a solo founder running websites and social channels. Address him as Haider, sparingly, the way a colleague would rather than after every sentence. You coordinate a roster of specialists and connected accounts:

- SEO & site: Google Search Console (organic search), Google Analytics (traffic).
- Social: Facebook, Instagram, YouTube, X, TikTok.
- Workspace: Gmail, Google Calendar, Google Drive.
- Business: a Google Sheet CRM pipeline, Stripe revenue and invoices.
- Thinking roles (no external account, delegate via ask_specialist): chief of staff, strategist, researcher, editor, sales, marketing, ops, engineering, design, developer.
- Memory: use "remember" whenever the user tells you something durable (a client detail, a decision, a preference), and "recall" when they reference the past.

CRITICAL — you never take a visible or irreversible action yourself. Publishing a post, sending an email, and creating a calendar event all go through a "propose_*" tool that only queues a draft for the user to approve in the UI. Never say something was sent, posted or scheduled unless get_recent_activity confirms it actually executed. Adding or updating a CRM row is the one exception: that's a private spreadsheet, so it runs immediately.

When asked for a report or "how are we doing", pull the relevant data first, then brief the user like a sharp operator: the numbers, what they actually mean, and one concrete next step — never a raw dump. For strategy, writing, or planning work, delegate to the right specialist with ask_specialist and pass in any live data you already fetched.

Keep replies conversational and tight, the way you'd say them out loud — replies may be read aloud. If an account isn't configured yet, say so plainly and never invent numbers.`;

const MAX_TOOL_ROUNDS = 8;

/** Turns an SDK failure into something the user can actually act on. */
function describeError(err: unknown): { message: string; status: number } {
  if (err instanceof Anthropic.AuthenticationError) {
    return { message: "Your ANTHROPIC_API_KEY was rejected. Check it's the full key from console.anthropic.com and restart the dev server.", status: 401 };
  }
  if (err instanceof Anthropic.NotFoundError) {
    return { message: `The model "${MODEL}" wasn't found. Set ANTHROPIC_MODEL in .env.local to a model your account can use.`, status: 404 };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { message: "Rate limited by the Claude API — wait a moment and try again.", status: 429 };
  }
  if (err instanceof Anthropic.BadRequestError) {
    // Identity-linked keys are rejected until they name a workspace.
    if (/workspace/i.test(err.message)) {
      return {
        message:
          "Your API key is identity-linked, so it needs a workspace. Add ANTHROPIC_WORKSPACE_ID to .env.local (Console → Settings → Workspaces; the id starts with wrkspc_) and restart the dev server.",
        status: 400,
      };
    }
    return { message: `The Claude API rejected the request: ${err.message}`, status: 400 };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { message: "Couldn't reach the Claude API — check your network connection.", status: 502 };
  }
  if (err instanceof Anthropic.APIError) {
    return { message: `Claude API error ${err.status}: ${err.message}`, status: err.status ?? 500 };
  }
  return { message: err instanceof Error ? err.message : String(err), status: 500 };
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set on the server. See SETUP.md." },
      { status: 500 }
    );
  }

  const { messages } = (await req.json()) as {
    messages: { role: "user" | "assistant"; content: string }[];
  };
  if (!Array.isArray(messages) || !messages.length) {
    return NextResponse.json({ error: "messages is required" }, { status: 400 });
  }

  const anthropic = anthropicClient();
  const newPendingActions: PendingAction[] = [];

  const conversation: Anthropic.MessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));

  try {
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      tools: toolDefinitions,
      // Deciding which accounts to pull and how to read the numbers is real
      // reasoning, so let the model think as much as the question warrants.
      thinking: { type: "adaptive" },
      messages: conversation,
    });

    // A safety decline stops the turn; say so rather than returning "(no response)".
    if (response.stop_reason === "refusal") {
      return NextResponse.json({
        reply: "I can't help with that one. Try rephrasing, or ask me something else.",
        pendingActions: newPendingActions,
      });
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (!toolUses.length || response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return NextResponse.json({ reply: text || "(no response)", pendingActions: newPendingActions });
    }

    conversation.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      try {
        const result = await executeTool(use.name, (use.input as Record<string, unknown>) ?? {});
        if (result.pendingAction) newPendingActions.push(result.pendingAction);
        toolResults.push({ type: "tool_result", tool_use_id: use.id, content: result.text });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toolResults.push({ type: "tool_result", tool_use_id: use.id, content: `Error: ${message}`, is_error: true });
      }
    }
    conversation.push({ role: "user", content: toolResults });
  }

  return NextResponse.json({
    reply: "I ran into too many tool calls in a row and stopped to avoid looping — try rephrasing or asking for one thing at a time.",
    pendingActions: newPendingActions,
  });
  } catch (err) {
    const { message, status } = describeError(err);
    console.error("[agent/chat]", err);
    return NextResponse.json({ error: message, pendingActions: newPendingActions }, { status });
  }
}
