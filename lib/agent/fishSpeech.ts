import { generateGemini, geminiText } from './gemini';
import { cred } from "@/lib/credentials";

/**
 * Fish Audio TTS returns finished MP3 bytes. It has no per-character timings,
 * so alignment is null and the mouth/captions fall back to estimated timing,
 * the same as Gemini speech.
 */

import { isRomanUrdu, isUrdu, type SpeechLang } from "@/lib/speechLanguage";

export { isRomanUrdu, isUrdu };

/**
 * Roman Urdu spelling doesn't say how a word sounds, so even a native voice
 * stumbles over it. The chat shows Roman Urdu; only the voice gets Urdu script.
 */
async function toUrduScript(text: string) {
  const content = await generateGemini(
    'Transliterate the user\'s Roman Urdu into Urdu script so it can be read aloud. Write English words the way an Urdu speaker would write them in Urdu script. Keep the meaning and wording exactly; do not translate, add or drop anything. Reply with the Urdu text only.',
    [{ role: 'user', parts: [{ text }] }],
  );
  return geminiText(content);
}

/** The Fish voices for each gender: English, and native Urdu. */
function voices(gender: 'female' | 'male') {
  const env = process.env;
  return gender === 'male'
    ? { en: env.FISH_AUDIO_MALE_VOICE_ID?.trim(), ur: env.FISH_AUDIO_MALE_URDU_VOICE_ID?.trim() }
    : { en: env.FISH_AUDIO_VOICE_ID?.trim(), ur: env.FISH_AUDIO_URDU_VOICE_ID?.trim() };
}

/** `lang` is the whole reply's language; without it this piece alone decides. */
export async function generateFishSpeech(text: string, signal?: AbortSignal, gender: 'female' | 'male' = 'female', lang?: SpeechLang) {
  const key = cred("FISH_AUDIO_API_KEY")?.trim();
  if (!key) throw new Error('FISH_AUDIO_API_KEY is missing.');
  const { en, ur: urduVoice } = voices(gender);
  let voiceId = en;
  const urdu = lang ? lang === 'ur' : isUrdu(text) || isRomanUrdu(text);
  if (urduVoice && urdu && isUrdu(text)) voiceId = urduVoice;
  else if (urduVoice && urdu) {
    voiceId = urduVoice;
    // If the conversion fails, the Urdu voice still reads the Roman text.
    try { text = (await toUrduScript(text)) || text; } catch (err) { console.warn('[tts] Urdu transliteration failed:', err instanceof Error ? err.message : err); }
  }
  const response = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      model: process.env.FISH_AUDIO_MODEL?.trim() || 's1',
    },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    body: JSON.stringify({
      text,
      format: 'mp3',
      latency: 'balanced',
      ...(voiceId ? { reference_id: voiceId } : {}),
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(response.status === 402
      ? 'Fish Audio balance is empty. Top up, or use a system voice.'
      : `Fish Audio ${response.status}: ${detail || 'speech request failed'}`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) throw new Error('Fish Audio returned no speech audio.');
  return { audioBase64: audio.toString('base64'), mimeType: 'audio/mpeg', alignment: null };
}
