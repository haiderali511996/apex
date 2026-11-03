import { requireUser } from "@/lib/auth";
import { addVoiceSeconds, voiceLimitReached } from "@/lib/usage";
import { generateGemini, geminiText, GeminiError } from "@/lib/agent/gemini";
import { pcmToWav } from "@/lib/agent/geminiSpeech";
import { NextRequest, NextResponse } from "next/server";
import { enterUser } from "@/lib/credentials";

export const runtime = "nodejs";

/**
 * Speech to text for any language. The browser's own recognizer hears one
 * language per session, so someone switching between English and Urdu
 * mid-sentence was misheard; Gemini hears whatever is spoken.
 *
 * The client sends 16 kHz mono 16-bit PCM — one spoken turn — and gets the
 * transcript back.
 */

const RATE = 16000;
const MAX_SECONDS = 60;

const SYSTEM = (name: string) => `You transcribe what a person says to their voice assistant, ${name}.
Write exactly what is spoken, in whatever language or mix of languages the speaker uses.
- English stays English.
- Urdu and Hindi are written as Roman Urdu (English letters, e.g. "aaj kya plan hai"), never in Urdu or Devanagari script.
- Any other language is written in its usual script.
- The assistant's name is spelled "${name}".
Ignore music, singing, song lyrics and background audio — only words the person speaks count.
Do not translate, answer, summarize or add anything. If there is no clear speech, reply with nothing at all. Reply with the transcript only.`;

export async function POST(req: NextRequest) {
  const guard = await requireUser({ plan: true });
  if ("response" in guard) return guard.response;
  // This request runs on this account's own keys from here on.
  enterUser(guard.user.id, guard.user.role === "owner");
  const pcm = Buffer.from(await req.arrayBuffer());
  if (!pcm.length) return NextResponse.json({ error: "No audio was sent." }, { status: 400 });
  if (pcm.length > RATE * 2 * MAX_SECONDS) return NextResponse.json({ error: "That was too long to transcribe in one go." }, { status: 413 });
  const limit = voiceLimitReached(guard.user);
  if (limit) return NextResponse.json({ error: limit }, { status: 429 });

  try {
    const content = await generateGemini(SYSTEM(guard.persona.name), [{
      role: "user",
      parts: [
        { inlineData: { mimeType: "audio/wav", data: pcmToWav(pcm, RATE).toString("base64") } },
        { text: "Transcribe this." },
      ],
    }]);
    const text = geminiText(content);
    addVoiceSeconds(guard.user, pcm.length / (RATE * 2));
    console.log(`[heard] ${(pcm.length / (RATE * 2)).toFixed(1)}s -> ${JSON.stringify(text)}`);
    return NextResponse.json({ text });
  } catch (err) {
    console.warn(`[heard] ${(pcm.length / (RATE * 2)).toFixed(1)}s -> error: ${err instanceof Error ? err.message : err}`);
    const status = err instanceof GeminiError ? err.status : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Transcription failed." }, { status });
  }
}
