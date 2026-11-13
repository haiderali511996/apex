import { generateGemini, geminiText } from './gemini';
import { cred } from "@/lib/credentials";

/**
 * Fish Audio TTS returns finished MP3 bytes. It has no per-character timings,
 * so alignment is null and the mouth/captions fall back to estimated timing,
 * the same as Gemini speech.
 */

import { isRomanUrdu, isUrdu, type SpeechLang } from "@/lib/speechLanguage";

export { isRomanUrdu, isUrdu };

/** Western, Arabic-Indic and Urdu (Extended Arabic-Indic) digits. */
const DIGITS = /[0-9\u0660-\u0669\u06F0-\u06F9]/;

/**
 * Roman Urdu spelling doesn't say how a word sounds, so even a native voice
 * stumbles over it. The chat shows Roman Urdu; only the voice gets Urdu script.
 * Digits are spelled out too: in Urdu script (shared with Arabic) the voice
 * read them as Arabic numbers.
 */
async function toUrduScript(text: string) {
  const content = await generateGemini(
    'Rewrite the user\'s text in Urdu script so an Urdu voice can read it aloud. Roman Urdu becomes Urdu script; text already in Urdu script stays as it is. Write English words the way an Urdu speaker would write them in Urdu script. Write every number out in Urdu words, the way it is said in Urdu: counts, prices, percentages, times, dates and years (25 → پچیس, 3:30 → ساڑھے تین, 2026 → دو ہزار چھبیس, 50% → پچاس فیصد, Rs 1,500 → پندرہ سو روپے); phone numbers and codes digit by digit in Urdu words. No digits may remain. Keep the meaning and wording exactly; do not translate, add or drop anything. Reply with the Urdu text only.',
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
  if (urduVoice && urdu) {
    voiceId = urduVoice;
    // Roman Urdu needs Urdu script, and numbers in either need Urdu words.
    // If the conversion fails, the Urdu voice still reads the text as it was.
    if (!isUrdu(text) || DIGITS.test(text)) {
      try { text = (await toUrduScript(text)) || text; } catch (err) { console.warn('[tts] Urdu transliteration failed:', err instanceof Error ? err.message : err); }
    }
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
