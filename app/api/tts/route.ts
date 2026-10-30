import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Neural speech, so Imex doesn't sound like a robot.
 *
 * The browser's speechSynthesis plays the operating system's built-in voices.
 * On macOS the compact ones are robotic by design and no setting fixes that —
 * the only real fix is to stop using them. This proxies ElevenLabs instead.
 *
 * It's a server route because the API key is a secret and must never reach the
 * browser. It asks for the `with-timestamps` variant, which returns per
 * character start times alongside the audio: that's what lets the captions
 * stay in step with the speech, the job `onboundary` did for speechSynthesis.
 */

const API = "https://api.elevenlabs.io/v1";

/** Confirmed default. Override with ELEVENLABS_MODEL_ID for a faster one. */
const DEFAULT_MODEL = "eleven_multilingual_v2";

function key(): string | undefined {
  return process.env.ELEVENLABS_API_KEY?.trim() || undefined;
}

/**
 * Lists the voices and models on the account, so a voice can be chosen by
 * name rather than by pasting in an id found somewhere else. Also how the
 * client learns whether neural speech is configured at all.
 */
export async function GET() {
  const apiKey = key();
  if (!apiKey) {
    return NextResponse.json({
      enabled: false,
      reason: "ELEVENLABS_API_KEY is not set — falling back to the system voice.",
    });
  }

  try {
    const [voicesRes, modelsRes] = await Promise.all([
      fetch(`${API}/voices`, { headers: { "xi-api-key": apiKey } }),
      fetch(`${API}/models`, { headers: { "xi-api-key": apiKey } }),
    ]);

    if (!voicesRes.ok) {
      return NextResponse.json(
        { enabled: false, reason: `ElevenLabs rejected the key (${voicesRes.status}).` },
        { status: 200 }
      );
    }

    const voices = (await voicesRes.json()) as {
      voices?: { voice_id: string; name: string; labels?: Record<string, string> }[];
    };
    const models = modelsRes.ok
      ? ((await modelsRes.json()) as { model_id: string; name?: string; can_do_text_to_speech?: boolean }[])
      : [];

    return NextResponse.json({
      enabled: true,
      configuredVoiceId: process.env.ELEVENLABS_VOICE_ID?.trim() || null,
      voices: (voices.voices ?? []).map((v) => ({
        id: v.voice_id,
        name: v.name,
        labels: v.labels ?? {},
      })),
      models: models
        .filter((m) => m.can_do_text_to_speech !== false)
        .map((m) => ({ id: m.model_id, name: m.name })),
    });
  } catch (err) {
    return NextResponse.json({
      enabled: false,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function POST(req: NextRequest) {
  const apiKey = key();
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();

  // 503 rather than 500: the client treats it as "not configured" and falls
  // back to the system voice for the rest of the session instead of retrying.
  if (!apiKey) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not set." },
      { status: 503 }
    );
  }
  if (!voiceId) {
    return NextResponse.json(
      { error: "ELEVENLABS_VOICE_ID is not set. GET /api/tts lists the voices on your account." },
      { status: 503 }
    );
  }

  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${API}/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL,
          voice_settings: {
            // A shade below the default, which reads as more expressive —
            // this is a colleague talking, not an audiobook.
            stability: 0.4,
            similarity_boost: 0.75,
            style: 0.15,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!res.ok) {
      const detail = await res.text();
      // A bad key or an exhausted quota won't fix itself on retry, so these
      // are reported as "not configured" too and the client stops asking.
      const status = res.status === 401 || res.status === 403 || res.status === 429 ? 503 : 502;
      return NextResponse.json(
        { error: `ElevenLabs error ${res.status}: ${detail.slice(0, 300)}` },
        { status }
      );
    }

    const body = (await res.json()) as {
      audio_base64: string;
      alignment?: {
        characters: string[];
        character_start_times_seconds: number[];
        character_end_times_seconds: number[];
      };
    };

    return NextResponse.json({
      audioBase64: body.audio_base64,
      mimeType: "audio/mpeg",
      // `alignment` maps to the text as submitted, so its indices line up with
      // the string the caption code is already holding. `normalized_alignment`
      // would not.
      alignment: body.alignment ?? null,
    });
  } catch (err) {
    console.error("[tts]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
