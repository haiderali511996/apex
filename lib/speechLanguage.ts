/**
 * Which voice a reply should be read in. Decided once for the whole reply, in
 * the browser, and sent with every piece of it: deciding per piece made one
 * reply switch between the English and the Urdu voice mid-sentence.
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

export type SpeechLang = "en" | "ur";

export function speechLang(text: string): SpeechLang {
  return isUrdu(text) || isRomanUrdu(text) ? "ur" : "en";
}
