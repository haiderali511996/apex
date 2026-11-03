import { requireUser } from "@/lib/auth";
import { BACKEND, generateGemini, geminiText, GeminiError } from "@/lib/agent/gemini";
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, MODEL } from "@/lib/agent/anthropicClient";
import { SPECIALISTS } from "@/lib/agent/roles";
import { enterUser } from "@/lib/credentials";

export const runtime = "nodejs";

const SYSTEM = (name: string, who: string) => `You are ${name}, looking through ${who}'s webcam. Describe what you actually see in one or two short spoken sentences — this is read aloud, so no lists and no preamble.

If you see a person, greet them naturally and say something specific and true about the scene (the room, the light, what they're wearing or doing). Assume the person is ${who} unless the image clearly shows several people. If the frame is dark, empty or unreadable, say so plainly rather than inventing a description. Never guess at age, ethnicity, mood, health, or anything else the image doesn't actually show.`;

/** Agents Sarah can hand a message to, by key, with the name it says aloud. */
const AGENTS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(SPECIALISTS).map(([key, s]) => [key, s.name])),
  developer: "Developer",
};

const READ_SYSTEM = (name: string, who: string) => `You read messages off a phone screen that ${who} is holding up to their webcam.
Transcribe the message shown — a chat, SMS, email or notification — exactly as written, in its original language. If several messages are visible, take the most recent one and its sender. Ignore the status bar, buttons and keyboard.
Reply with JSON only, no prose:
{"found": true|false, "app": "WhatsApp|SMS|Email|…" or null, "sender": "name as shown" or null, "text": "the message", "agents": ["key", …]}
"agents" is the one or two best fits for working on this message, from: ${Object.entries(AGENTS).map(([k, n]) => `${k} (${n})`).join(", ")}.
If no message can be read (no phone, too blurry, glare), return {"found": false}.`;

type ReadResult = { found?: boolean; app?: string | null; sender?: string | null; text?: string; agents?: string[] };

/** Turns the transcription into what Sarah says: the message, then which agent to use. */
function readReply(raw: string): string {
  let parsed: ReadResult = {};
  try {
    parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
  } catch {
    // fall through to "couldn't read"
  }
  const text = parsed.text?.trim();
  if (!parsed.found || !text) {
    return "I can't make out a message on that screen. Hold the phone a little closer and steady, with the brightness up, and I'll try again.";
  }
  const from = parsed.sender ? `${parsed.sender}${parsed.app ? ` on ${parsed.app}` : ""}` : parsed.app ? `your ${parsed.app}` : "";
  const names = (parsed.agents ?? []).map((k) => AGENTS[k]).filter(Boolean);
  const suggestion = names.length ? ` I'd suggest ${names.join(" or ")}.` : "";
  return `${from ? `Message from ${from}` : "The message says"}: “${text}” Which agent should work on this?${suggestion}`;
}

/** Data URLs arrive as "data:image/jpeg;base64,…" — split off the payload. */
function parseDataUrl(input: string): { mediaType: string; data: string } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(input);
  if (!m) return null;
  return { mediaType: m[1], data: m[2] };
}

export async function POST(req: NextRequest) {
  const guard = await requireUser({ plan: true });
  if ("response" in guard) return guard.response;
  // This request runs on this account's own keys from here on.
  enterUser(guard.user.id, guard.user.role === "owner");
  const name = guard.persona.name, who = guard.persona.userName || "the user";
  if (BACKEND !== "gemini" && !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server. See SETUP.md." }, { status: 500 });
  }

  const { image, prompt, mode } = (await req.json()) as { image?: string; prompt?: string; mode?: "look" | "read" };
  if (!image) return NextResponse.json({ error: "image is required" }, { status: 400 });

  const parsed = parseDataUrl(image);
  if (!parsed) return NextResponse.json({ error: "image must be a base64 data URL" }, { status: 400 });

  // ~5MB of base64 is the practical ceiling for a single request.
  if (parsed.data.length > 5_000_000) {
    return NextResponse.json({ error: "That frame is too large." }, { status: 413 });
  }

  try {
    if (BACKEND === "gemini") {
      const reading = mode === "read";
      const response = await generateGemini(reading ? READ_SYSTEM(name, who) : SYSTEM(name, who), [{ role: "user", parts: [
        { inlineData: { mimeType: parsed.mediaType, data: parsed.data } },
        { text: reading ? "Read the message on this phone screen." : prompt || "What do you see right now?" },
      ] }]);
      const text = geminiText(response);
      return NextResponse.json({ reply: reading ? readReply(text) : text });
    }
    if (mode === "read") {
      return NextResponse.json({ error: "Reading messages from the camera needs the Gemini backend (IMEX_BACKEND=gemini)." }, { status: 501 });
    }
    const anthropic = anthropicClient();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM(name, who),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: parsed.mediaType as "image/jpeg", data: parsed.data },
            },
            { type: "text", text: prompt || "What do you see right now?" },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ reply: "I'd rather not describe that one." });
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();

    return NextResponse.json({ reply: text || "I can see the camera, but I can't make anything out." });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent/see]", err);
    return NextResponse.json({ error: `I couldn't look at that: ${message}` }, { status: err instanceof GeminiError ? err.status : 502 });
  }
}
