import { requireUser } from "@/lib/auth";
import { addVoiceSeconds, voiceLimitReached } from "@/lib/usage";
import { generateGemini, geminiText, GeminiError } from "@/lib/agent/gemini";
import { pcmToWav } from "@/lib/agent/geminiSpeech";
import { NextRequest, NextResponse } from "next/server";
import { enterUser } from "@/lib/credentials";
import { acceptTranscript } from "@/lib/transcript";

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

const SYSTEM = (name: string) => `You transcribe one recording from the microphone of a voice assistant called ${name}.
First decide whether a real person is clearly speaking words directly into the microphone.
It is NOT speech when the recording is only music, singing, song lyrics, a video or TV, the assistant's own voice, typing, traffic, breathing, mumbling or noise.
Never guess, never complete a half-heard phrase, and never write a typical assistant command (like "play music", "what's the weather", "what's on my schedule", "how are you") unless those exact words are clearly spoken.
Do not add the name "${name}" unless it is clearly said.

When it is speech, write exactly what is said, in whatever language or mix of languages is used:
- English stays English.
- Urdu and Hindi are written as Roman Urdu (English letters, e.g. "aaj kya plan hai"), never in Urdu or Devanagari script.
- Any other language is written in its usual script.
- The assistant's name is spelled "${name}".
Do not translate, answer, summarize or add anything.

Reply with JSON only: {"speech": true or false, "clear": true or false, "text": "the transcript, or empty"}.
"clear" is false when any part was too faint or muffled to be sure of.`;

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
        { text: "Is a person clearly speaking? If so, transcribe it." },
      ],
    }], undefined, { json: true });
    const raw = geminiText(content);
    const text = acceptTranscript(raw);
    addVoiceSeconds(guard.user, pcm.length / (RATE * 2));
    console.log(`[heard] ${(pcm.length / (RATE * 2)).toFixed(1)}s -> ${text ? JSON.stringify(text) : `ignored ${raw.slice(0, 160)}`}`);
    return NextResponse.json({ text });
  } catch (err) {
    console.warn(`[heard] ${(pcm.length / (RATE * 2)).toFixed(1)}s -> error: ${err instanceof Error ? err.message : err}`);
    const status = err instanceof GeminiError ? err.status : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Transcription failed." }, { status });
  }
}
