import { BACKEND, generateGemini, geminiText } from "./gemini";

// Roles whose answers depend on what's true today (prices, competitors, news): they search the web.
const SEARCHES = new Set(["researcher", "marketing", "ops", "strategist", "sales"]);
import type Anthropic from "@anthropic-ai/sdk";
import { SPECIALISTS } from "./roles";
import { anthropicClient, MODEL } from "./anthropicClient";
import { currentUserId } from "@/lib/credentials";
import { engineFor } from "@/lib/agentEngines";
import { claudeComputer, runOnDevice } from "@/lib/devices";

/**
 * A specialist set to Claude runs on the Claude Code on the user's computer
 * (their subscription), through the desktop app. If that computer can't be
 * reached, Gemini answers instead and says so.
 */
async function viaClaudeCode(userId: string, role: string, request: string, context?: string): Promise<string> {
  const specialist = SPECIALISTS[role];
  const web = SEARCHES.has(role);
  const prompt = `You are the ${specialist.name} specialist inside the user's voice assistant, which relays your answer, often aloud. ${specialist.brief} Be concise and concrete. Advise and draft only; never claim to have acted.${web ? ` Use web search for anything current (prices, competitors, news, laws, statistics) and list your sources as links at the end. Today is ${new Date().toDateString()}.` : ""}\n\nRequest: ${request}${context ? `\n\nContext: ${context}` : ""}`;
  const device = claudeComputer(userId);
  return runOnDevice(userId, device.id, "claude_ask", { prompt, web }, 5 * 60_000);
}

/**
 * Runs one specialist as a focused sub-call. No tools: these roles reason over
 * what they're given, so anything needing live data is fetched by the main
 * agent first and passed in as context.
 */
export async function askSpecialist(role: string, request: string, context?: string): Promise<string> {
  const specialist = SPECIALISTS[role];
  if (!specialist) throw new Error(`Unknown specialist: ${role}`);
  const userId = currentUserId();
  let note = "";
  if (userId && engineFor(userId, role) === "claude-code") {
    try {
      return `(Answered by Claude)\n${await viaClaudeCode(userId, role, request, context)}`;
    } catch (err) {
      note = `(Claude wasn't reachable — ${err instanceof Error ? err.message : err} — so Gemini answered this one.)\n`;
    }
  }
  if (BACKEND === "gemini" || note) {
    const search = SEARCHES.has(role);
    const response = await generateGemini(
      `You are Sarah's ${specialist.name} specialist. ${specialist.brief} Be concise. Advise and draft only; never claim to have acted.${search ? ` You can search the web: use it for anything current (prices, competitors, news, laws, statistics) and don't guess those. Today is ${new Date().toDateString()}.` : ""}`,
      [{ role: "user", parts: [{ text: context ? `${request}\n\nContext: ${context}` : request }] }],
      undefined,
      { search }
    );
    const sources = (response.sources ?? []).slice(0, 5);
    return `${note}${geminiText(response)}${sources.length ? `\n\nSources:\n${sources.map(s => `- ${s.title}: ${s.uri}`).join("\n")}` : ""}`;
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set.");

  const anthropic = anthropicClient();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system: `You are the ${specialist.name} specialist inside the user's voice assistant. ${specialist.brief}\n\nBe concise and concrete. Never claim to have taken an action — you only advise and draft; the main agent handles anything that touches a real account.`,
    messages: [
      {
        role: "user",
        content: context ? `${request}\n\nRelevant context:\n${context}` : request,
      },
    ],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
