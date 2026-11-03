import { generateGemini, geminiText } from './gemini';
import { cred } from "@/lib/credentials";

/**
 * Fish Audio TTS returns finished MP3 bytes. It has no per-character timings,
 * so alignment is null and the mouth/captions fall back to estimated timing,
 * the same as Gemini speech.
 */

/**
 * Urdu read by an English voice keeps the English accent, so Urdu goes to a
 * native Urdu voice when one is set. Text that is mostly Urdu script is Urdu.
 */
export function isUrdu(text: string) {
  const letters = text.match(/\p{L}/gu) ?? [];
  const urdu = letters.filter(ch => /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(ch)).length;
  return letters.length > 0 && urdu / letters.length > 0.3;
}

// Everyday Urdu words that don't occur in English, to spot Roman Urdu.
const ROMAN_URDU = new Set(('hai hain hoon hun kya kia nahi nahin nai aap ap tum mujhe mujhay mera meri mere tera teri apka aapka apki aapki '
  + 'kar karo karna karen karein karta karti raha rahi rahe tha thi ka ki ke ko se bhi aur lekin kyun kyon kaise kaisa kaisi '
  + 'acha accha achha theek thik shukriya jee ji haan han bohat bahut abhi sakta sakti sakte chahiye dekho batao bataen bataiye '
  + 'hum yeh ye woh wo kuch sab kab kahan phir agar toh mein hy hay gaya gayi diya liya wala wali kaam baat din aaj kal').split(' '));

/** Roman Urdu: Urdu written in English letters, often mixed with English words. */
export function isRomanUrdu(text: string) {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  const hits = words.filter(w => ROMAN_URDU.has(w)).length;
  return hits >= 2 && hits / words.length >= 0.2;
}

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

export async function generateFishSpeech(text: string, signal?: AbortSignal, gender: 'female' | 'male' = 'female') {
  const key = cred("FISH_AUDIO_API_KEY")?.trim();
  if (!key) throw new Error('FISH_AUDIO_API_KEY is missing.');
  const { en, ur: urduVoice } = voices(gender);
  let voiceId = en;
  if (urduVoice && isUrdu(text)) voiceId = urduVoice;
  else if (urduVoice && isRomanUrdu(text)) {
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
