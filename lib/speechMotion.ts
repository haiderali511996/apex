/** Shared playback clock: animation reads it without re-rendering React. */
export type SpeechMotion = { active: boolean; open: number; width: number; round: number };
export type SpeechAlignment = { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
const REST: SpeechMotion = { active: false, open: 0, width: 1, round: 0 };
let motion: SpeechMotion = REST;
export function readSpeechMotion(): SpeechMotion { return motion; }
export function resetSpeechMotion() { motion = REST; }

export function sampleSpeechMotion(text: string, time: number, alignment: SpeechAlignment | null, duration?: number): SpeechMotion {
  let character = "", progress = .5;
  if (alignment?.characters.length) {
    const starts = alignment.character_start_times_seconds;
    let low = 0, high = starts.length - 1, index = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (starts[mid] <= time) { index = mid; low = mid + 1; } else high = mid - 1;
    }
    if (index < 0 || time > (alignment.character_end_times_seconds[index] ?? starts[index] + .12)) return { ...REST, active: true };
    character = alignment.characters[index].toLowerCase();
    progress = (time - starts[index]) / Math.max(.03, (alignment.character_end_times_seconds[index] ?? starts[index] + .12) - starts[index]);
  } else {
    const cps = duration && Number.isFinite(duration) && duration > 0 ? text.length / duration : 13;
    const position = time * cps;
    character = text[Math.floor(position)]?.toLowerCase() || " ";
    progress = position % 1;
  }
  const envelope = .65 + .35 * Math.sin(Math.min(1, progress) * Math.PI);
  if (/\s|[.,!?;:]/.test(character) || !character) return { ...REST, active: true };
  if (/[bmp]/.test(character)) return { active: true, open: .025, width: .93, round: 0 };
  if (/[ou]/.test(character)) return { active: true, open: .7 * envelope, width: .73, round: .9 };
  if (/[ae]/.test(character)) return { active: true, open: .86 * envelope, width: 1.07, round: .1 };
  if (/[iy]/.test(character)) return { active: true, open: .42 * envelope, width: 1.12, round: .05 };
  if (/[fv]/.test(character)) return { active: true, open: .14 * envelope, width: 1, round: .05 };
  return { active: true, open: .3 * envelope, width: .98, round: .2 };
}
export function updateSpeechMotion(text: string, time: number, alignment: SpeechAlignment | null, duration?: number) {
  motion = sampleSpeechMotion(text, time, alignment, duration);
}
