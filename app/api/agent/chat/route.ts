import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, executeTool } from "@/lib/agent/tools";
import type { PendingAction } from "@/lib/agent/types";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are Apex, a solo founder's always-on chief of staff. You coordinate a roster of specialists and connected accounts:

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

// Override with ANTHROPIC_MODEL in .env.local to point at a different model.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

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
      model: MODEL,
      max_tokens: 2048,
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
