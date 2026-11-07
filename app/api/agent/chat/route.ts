import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, executeTool } from "@/lib/agent/tools";
import { anthropicClient, MODEL } from "@/lib/agent/anthropicClient";
import { runViaClaudeCode, describeClaudeCodeError } from "@/lib/agent/claudeCode";
import { BACKEND, GeminiError } from "@/lib/agent/gemini";
import { runViaGemini } from "@/lib/agent/geminiAgent";
import type { ClientAction, PendingAction } from "@/lib/agent/types";
import { requireUser } from "@/lib/auth";
import type { Persona } from "@/lib/persona";
import { enterUser } from "@/lib/credentials";
import { learnFromTurn, logTurn, memoryBrief } from "@/lib/memory";
import { enginesBrief } from "@/lib/agentEngines";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are Sarah, chief of staff to Haider — a solo founder running websites and social channels. Address him as Haider, sparingly, the way a colleague would rather than after every sentence. You coordinate a roster of specialists and connected accounts:

- SEO & site: Google Search Console (organic search), Google Analytics (traffic).
- Social: Facebook, Instagram, YouTube, X, TikTok.
- Workspace: Gmail, Google Calendar, Google Drive.
- Web: web_search looks anything current up on Google (news, prices, exchange rates, sports, people, companies, opening hours) and returns sources. Use it instead of guessing or saying you can't browse.
- Business and money: a Google Sheet CRM pipeline, Stripe revenue and invoices, PayPal (balance, money in/out, fees) and the bank account via Wise (balances, statement). All read-only — you can never move money.
- Thinking roles (no external account, delegate via ask_specialist): chief of staff, strategist, researcher, editor, sales, marketing, ops, engineering, design.
- This MacBook: you run on Haider's Mac and can operate it. Open apps (mac_open_app), see what is open (mac_list_apps), open any website — in a specific Chrome profile with mac_open_url's chrome_profile (Gmail is https://mail.google.com in that profile; check mac_list_chrome_profiles when the name is ambiguous) — list and switch Chrome tabs, set the volume, and pause/play Music or Spotify (mac_media). Quitting apps, quitting everything, restarting/shutting down/sleeping, and any other Mac task via AppleScript are proposed for his approval with the propose_mac_* tools. Do these yourself instead of telling him how; say briefly what you did.
- Developer: Claude Code on this Mac. For anything about Haider's code projects — whether or not he has opened them in Claude Code — use list_projects and ask_developer (a project name as he says it is fine — his pinned names in the Claude app may differ from folder names, so when a name is ambiguous ask which folder and save his answer with name_project; only ask for a path if it can't be found); for his past Claude Code chats (what was discussed or decided), use search_claude_chats. ask_developer only reads. For anything that runs a command or changes files — git pull, installs, tests, builds, fixes — use propose_developer_task: it waits for Haider's approval, then Claude Code does it in his terminal. Never tell him to run a command himself when the Developer can. Say you're checking before calling the Developer, since it can take a minute.
- Messages from Haider's phone: Sarah can read a message he holds up to the camera, then asks which agent should work on it. When he picks one, delegate with the full message as context (ask_specialist, or ask_developer for code). Then say back what the agent produced — the key points, or the drafted reply itself if it is short — and ask whether to send it. Sending still goes through propose_* for approval.
- Design: makes and edits pictures with Gemini on Haider's screen. You DO have his webcam through design_picture: whenever he asks for a photo, selfie, picture, image, logo or design — any wording, any language — call design_picture (use_camera true for a photo of him or his surroundings). Never tell him to use his phone's camera instead.
- Posting designs: every picture Design makes is saved. To post one, call propose_facebook_post / propose_instagram_post / propose_tweet with design_id "latest" (or an id from list_designs) and write the caption yourself; he approves each post with the picture shown. Post designs automatically carry his real uploaded logo (Account page → Your brand logo), so never describe or draw a logo in a design_picture instruction; if he complains the logo is wrong and none is uploaded, tell him to upload it there.
- Memory: use "remember" whenever the user tells you something durable (a client detail, a decision, a preference), and "recall" when they reference the past.

CRITICAL — you never take a visible or irreversible action yourself. Publishing a post, sending an email, and creating a calendar event all go through a "propose_*" tool that only queues a draft for the user to approve in the UI. Never say something was sent, posted or scheduled unless get_recent_activity confirms it actually executed. Adding or updating a CRM row is the one exception: that's a private spreadsheet, so it runs immediately.

When asked for a report or "how are we doing", pull the relevant data first, then brief the user like a sharp operator: the numbers, what they actually mean, and one concrete next step — never a raw dump. For strategy, writing, or planning work, delegate to the right specialist with ask_specialist and pass in any live data you already fetched.

For everyday conversation, respond naturally with warmth and curiosity. Match the user’s language turn by turn: English when they speak English, Urdu when they speak Urdu, mixing the two the way they do. Always write Urdu as Roman Urdu (Urdu in English letters, e.g. "Main theek hoon, aap batayein?"), never in Urdu script — the user reads the chat in Roman Urdu. Avoid canned greetings, repeated names, and business reports unless asked. Keep spoken replies to one to three short sentences (under about 50 words) unless asked for detail — every extra sentence is extra seconds before you are heard; ask a useful follow-up when it fits. Never pretend to be human or to have experiences. Keep replies conversational and tight, the way you'd say them out loud — replies may be read aloud. If an account isn't configured yet, say so plainly and never invent numbers.`;

const MAX_TOOL_ROUNDS = 8;

/**
 * Which backend runs the turn.
 *
 * "claude-code" hands it to the Claude Agent SDK, which drives the local
 * Claude Code binary and so bills against whatever that is logged in as —
 * a subscription, rather than API credits. It needs Claude Code installed and
 * signed in on the same machine as this server, so it is for local use.
 *
 * "api" calls the Messages API with ANTHROPIC_API_KEY and is what a deployed
 * instance uses.
 */


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

/** The owner's prompt, with the name they gave their assistant. */
function ownerPrompt(persona: Persona) {
  return persona.name === "Sarah" ? SYSTEM_PROMPT : SYSTEM_PROMPT.replace(/\bSarah\b/g, persona.name);
}

/**
 * Tools that control the Mac this server runs on. Hosted, that's the server,
 * so they're left out; the computer_* tools reach the user's own computer
 * through the desktop app instead. The Developer tools (Claude Code) stay:
 * hosted, they run on the linked computer through the desktop app.
 */
const LOCAL_TOOL = (name: string) => /^(propose_)?mac_/.test(name);
/** Only when the server is the owner's own Mac do those tools reach the owner's computer; hosted, they'd act on the server. */
const SERVER_IS_OWNERS_MAC = process.platform === "darwin";

/** Everyone else: the same voice and language rules, with their own accounts' tools. */
function customerPrompt(persona: Persona) {
  const style = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf("For everyday conversation"));
  return `You are ${persona.name}, a warm, sharp voice assistant${persona.userName ? ` for ${persona.userName}` : ""}. Help with their accounts, questions, ideas, writing, planning and everyday conversation.
Use web_search for anything current or factual you aren't sure of (news, prices, exchange rates, sports, people, places) instead of guessing. Use your tools for their Search Console, Google (Gmail, Calendar, Drive, Analytics, YouTube), Facebook, Instagram, X, TikTok, and their money: Stripe, PayPal and their bank account (Wise) — all read-only, you can never move money. If a tool says an account isn't configured, tell them to connect it on the Connections page — never pretend to have data. Anything that posts, sends or changes something is queued for their approval.
Pictures: design_picture makes them, and each is saved. To post one, use the propose_* post tools with design_id "latest" (or an id from list_designs); post designs automatically carry their uploaded brand logo (Account page → Your brand logo), so never ask the image model to draw a logo.
To act on their computer (open apps or websites, switch Chrome profiles, list what's open, volume, music, quitting apps, restarting) use the computer_* tools; they reach the computer they linked with the desktop app. If none is linked or it's offline, tell them to link it on the Account page.
Developer: their developer is Claude Code, running on their linked computer through the desktop app — never ask for a developer's name or contact details. "Line up / ask / tell the developer" means these tools: list_projects (their code projects), ask_developer (questions about a project's code, read-only, answers at once), propose_developer_task (changes, git, tests, fixes — runs after they approve), search_claude_chats (what was done in past Claude Code chats). If the computer is offline or Claude Code isn't installed there, say exactly that.
Memory: you remember earlier conversations — your memory is below, and the recent conversation is included. Notes are taken automatically; use remember for anything they explicitly ask you to keep, and recall to search it.

${style}`;
}

/** The user's place and local time from their browser (see lib/userLocation.ts), checked and added to the prompt. */
function whereAndWhen(context: unknown): string {
  const c = (context && typeof context === "object" ? context : {}) as { location?: Record<string, unknown> | null; localTime?: unknown; timeZone?: unknown };
  const text = (v: unknown, max = 80) => (typeof v === "string" ? v.replace(/[\r\n]/g, " ").slice(0, max) : "");
  const lines: string[] = [];
  const loc = c.location;
  if (loc && typeof loc.lat === "number" && typeof loc.lon === "number" && Math.abs(loc.lat) <= 90 && Math.abs(loc.lon) <= 180) {
    const placeName = [text(loc.city), text(loc.region), text(loc.country)].filter(Boolean).join(", ") || "unknown place";
    const how = loc.source === "device"
      ? `from their device's location${typeof loc.accuracy === "number" ? `, accurate to about ${Math.round(loc.accuracy)} m` : ""}`
      : "approximate, from their internet connection (city-level, may be off)";
    lines.push(`Where the user is right now: ${placeName} (${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}), ${how}.`);
    if (loc.source !== "device" && text(loc.problem, 300)) lines.push(`Precise location isn't available: ${text(loc.problem, 300)} If they ask where they are, give the approximate place and tell them this fix in one sentence.`);
  } else {
    lines.push("The user's location is unknown (the browser didn't share it). If they ask, say so and suggest allowing Location for this site in the browser.");
  }
  if (text(c.localTime)) lines.push(`Their local time: ${text(c.localTime)}${text(c.timeZone, 60) ? ` (${text(c.timeZone, 60)})` : ""}.`);
  lines.push("Use this for questions like where they are, the weather, nearby places, directions and times. Say the coordinates only if they ask for them. Where they are never changes the reply language: still answer in the language of their last message.");
  return `\n\n${lines.join("\n")}`;
}

export async function POST(req: NextRequest) {
  const guard = await requireUser({ plan: true });
  if ("response" in guard) return guard.response;
  // This request runs on this account's own keys from here on.
  enterUser(guard.user.id, guard.user.role === "owner");
  const { user, persona } = guard;
  const isOwner = user.role === "owner";
  if (isOwner && BACKEND === "api" && !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set on the server. See SETUP.md, or set IMEX_BACKEND=claude-code to use your Claude Code login instead." },
      { status: 500 }
    );
  }

  const { messages, context } = (await req.json()) as {
    messages: { role: "user" | "assistant"; content: string }[];
    context?: unknown;
  };
  if (!Array.isArray(messages) || !messages.length) {
    return NextResponse.json({ error: "messages is required" }, { status: 400 });
  }

  if (BACKEND === "gemini" || !isOwner) {
    try {
      const local = isOwner && SERVER_IS_OWNERS_MAC;
      const said = String(messages.at(-1)?.content ?? "");
      // The last 30 messages are plenty of context; older ones live on in memory.
      const recent = messages.slice(-30);
      const brief = await memoryBrief(user.id, persona.userName).catch(() => "");
      const result = await runViaGemini(recent, (local ? ownerPrompt(persona) : customerPrompt(persona)) + enginesBrief(user.id) + brief + whereAndWhen(context), local ? {} : { exclude: LOCAL_TOOL });
      // One line per turn in the dev server log, for tuning the prompt.
      console.log(`[turn] ${user.email} said: ${JSON.stringify(said)}\n[turn] ${persona.name}: ${JSON.stringify(result.reply)}`);
      // Saved for the next visit, and learned from in the background.
      logTurn(user.id, "user", said);
      logTurn(user.id, "assistant", result.reply ?? "");
      void learnFromTurn(user.id, said, result.reply ?? "");
      return NextResponse.json(result);
    } catch (error) {
      console.warn(`[turn] you: ${JSON.stringify(messages.at(-1)?.content ?? "")} -> error: ${error instanceof Error ? error.message : error}`);
      return NextResponse.json({ error: error instanceof Error ? error.message : "Gemini request failed.", pendingActions: [] }, { status: error instanceof GeminiError ? error.status : 502 });
    }
  }

  if (BACKEND === "claude-code") {
    try {
      const { reply, pendingActions, clientActions, costUsd } = await runViaClaudeCode({
        messages,
        systemPrompt: SYSTEM_PROMPT,
      });
      return NextResponse.json({ reply, pendingActions, clientActions, costUsd });
    } catch (err) {
      const { message, status } = describeClaudeCodeError(err);
      console.error("[agent/chat:claude-code]", err);
      return NextResponse.json({ error: message, pendingActions: [] }, { status });
    }
  }

  const anthropic = anthropicClient();
  const newPendingActions: PendingAction[] = [];
  const clientActions: ClientAction[] = [];

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
      return NextResponse.json({ reply: text || "(no response)", pendingActions: newPendingActions, clientActions });
    }

    conversation.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      try {
        const result = await executeTool(use.name, (use.input as Record<string, unknown>) ?? {});
        if (result.pendingAction) newPendingActions.push(result.pendingAction);
        if (result.clientAction) clientActions.push(result.clientAction);
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
