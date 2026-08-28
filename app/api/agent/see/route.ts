import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, MODEL } from "@/lib/agent/anthropicClient";

export const runtime = "nodejs";

const SYSTEM = `You are Imex, looking through Haider's webcam. Describe what you actually see in one or two short spoken sentences — this is read aloud, so no lists and no preamble.

If you see a person, greet them naturally and say something specific and true about the scene (the room, the light, what they're wearing or doing). Assume the person is Haider unless the image clearly shows several people. If the frame is dark, empty or unreadable, say so plainly rather than inventing a description. Never guess at age, ethnicity, mood, health, or anything else the image doesn't actually show.`;

/** Data URLs arrive as "data:image/jpeg;base64,…" — split off the payload. */
function parseDataUrl(input: string): { mediaType: string; data: string } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(input);
  if (!m) return null;
  return { mediaType: m[1], data: m[2] };
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server. See SETUP.md." }, { status: 500 });
  }

  const { image, prompt } = (await req.json()) as { image?: string; prompt?: string };
  if (!image) return NextResponse.json({ error: "image is required" }, { status: 400 });

  const parsed = parseDataUrl(image);
  if (!parsed) return NextResponse.json({ error: "image must be a base64 data URL" }, { status: 400 });

  // ~5MB of base64 is the practical ceiling for a single request.
  if (parsed.data.length > 5_000_000) {
    return NextResponse.json({ error: "That frame is too large." }, { status: 413 });
  }

  try {
    const anthropic = anthropicClient();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM,
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
    return NextResponse.json({ error: `I couldn't look at that: ${message}` }, { status: 502 });
  }
}
