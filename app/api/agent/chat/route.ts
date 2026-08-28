import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, executeTool } from "@/lib/agent/tools";
import type { PendingAction } from "@/lib/agent/types";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are Apex, the user's always-on digital marketing and SEO assistant. You have live read access to their Google Search Console, Facebook Page, Instagram, YouTube, and X accounts, plus read access to TikTok, through tools. You can also draft posts for Facebook, Instagram, X, and TikTok — but you can NEVER publish anything yourself. Every write action goes through a "propose_*" tool that only queues a draft; the user must explicitly approve it in the UI before it goes live. Never claim something was posted unless get_recent_activity confirms it actually executed.

When asked for a report, a status update, or "what's happening", pull the relevant reports and summarize them like a marketing analyst briefing a founder: the numbers, what they mean, and one concrete next step — not a raw dump. Keep replies conversational and concise, the way you'd speak out loud, since replies may be read aloud. If a platform isn't configured yet, say so plainly and don't invent numbers.`;

const MAX_TOOL_ROUNDS = 6;

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

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const newPendingActions: PendingAction[] = [];

  let conversation: Anthropic.MessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: toolDefinitions,
      messages: conversation,
    });

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
}
