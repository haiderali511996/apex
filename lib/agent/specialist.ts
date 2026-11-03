import { BACKEND, generateGemini, geminiText } from "./gemini";

// Roles whose answers depend on what's true today (prices, competitors, news): they search the web.
const SEARCHES = new Set(["researcher", "marketing", "ops", "strategist", "sales"]);
import type Anthropic from "@anthropic-ai/sdk";
import { SPECIALISTS } from "./roles";
import { anthropicClient, MODEL } from "./anthropicClient";

/**
 * Runs one specialist as a focused sub-call. No tools: these roles reason over
 * what they're given, so anything needing live data is fetched by the main
 * agent first and passed in as context.
 */
export async function askSpecialist(role: string, request: string, context?: string): Promise<string> {
  const specialist = SPECIALISTS[role];
  if (!specialist) throw new Error(`Unknown specialist: ${role}`);
  if (BACKEND === "gemini") {
    const search = SEARCHES.has(role);
    const response = await generateGemini(
      `You are Sarah's ${specialist.name} specialist. ${specialist.brief} Be concise. Advise and draft only; never claim to have acted.${search ? ` You can search the web: use it for anything current (prices, competitors, news, laws, statistics) and don't guess those. Today is ${new Date().toDateString()}.` : ""}`,
      [{ role: "user", parts: [{ text: context ? `${request}\n\nContext: ${context}` : request }] }],
      undefined,
      { search }
    );
    const sources = (response.sources ?? []).slice(0, 5);
    return `${geminiText(response)}${sources.length ? `\n\nSources:\n${sources.map(s => `- ${s.title}: ${s.uri}`).join("\n")}` : ""}`;
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set.");

  const anthropic = anthropicClient();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system: `You are the ${specialist.name} specialist inside Sarah, assistant to Haider — a solo founder running websites and social channels. ${specialist.brief}\n\nBe concise and concrete. Never claim to have taken an action — you only advise and draft; the main agent handles anything that touches a real account.`,
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
