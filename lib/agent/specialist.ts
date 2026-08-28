import Anthropic from "@anthropic-ai/sdk";
import { SPECIALISTS } from "./roles";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

/**
 * Runs one specialist as a focused sub-call. No tools: these roles reason over
 * what they're given, so anything needing live data is fetched by the main
 * agent first and passed in as context.
 */
export async function askSpecialist(role: string, request: string, context?: string): Promise<string> {
  const specialist = SPECIALISTS[role];
  if (!specialist) throw new Error(`Unknown specialist: ${role}`);
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set.");

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system: `You are the ${specialist.name} specialist inside Apex, an assistant for a solo founder running websites and social channels. ${specialist.brief}\n\nBe concise and concrete. Never claim to have taken an action — you only advise and draft; the main agent handles anything that touches a real account.`,
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
