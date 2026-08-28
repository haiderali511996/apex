"use client";

/**
 * Speaking, with the browser's rough edges handled.
 *
 * speechSynthesis is unusually failure-prone and fails *silently* — the call
 * returns normally and no sound is produced. The three causes worth guarding:
 *
 *  1. The synth gets stuck in a paused state and every later speak() is mute
 *     until something calls resume().
 *  2. cancel() immediately followed by speak() drops the new utterance, so the
 *     new one needs to start on a later tick.
 *  3. An utterance with no live reference can be garbage-collected mid-sentence,
 *     which cuts the audio off or stops it starting at all.
 *
 * Callers get onStart/onError so the UI can say "nothing came out" instead of
 * pretending it worked.
 */

// (3) — a module-level reference keeps the utterance alive while it speaks.
let active: SpeechSynthesisUtterance | null = null;

/**
 * Chrome on macOS accepts an utterance with a named voice attached, reports
 * speaking = true, and plays nothing. The browser's own default voice works
 * fine. Once that has been seen, stop attaching voice objects for the rest of
 * the session and steer the accent with `lang` instead, which does work.
 */
const NAMED_VOICE_BROKEN_KEY = "imex.namedVoiceBroken";

function namedVoicesBroken(): boolean {
  try {
    return window.sessionStorage.getItem(NAMED_VOICE_BROKEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markNamedVoicesBroken() {
  try {
    window.sessionStorage.setItem(NAMED_VOICE_BROKEN_KEY, "1");
  } catch {
    // not persisted; the per-utterance retry still covers it
  }
}

export type SpeakHandlers = {
  onStart?: () => void;
  onBoundary?: (charIndex: number, charLength: number) => void;
  onEnd?: () => void;
  onError?: (reason: string) => void;
};

export function speechAvailable(): boolean {
  return typeof window !== "undefined" && !!window.speechSynthesis;
}

export function cancelSpeech() {
  if (!speechAvailable()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // nothing to cancel
  }
  active = null;
}

export function speakText(
  text: string,
  voice: SpeechSynthesisVoice | null,
  handlers: SpeakHandlers = {},
  // Set when this is already the no-voice retry, so it can't loop.
  isRetry = false
): void {
  if (!speechAvailable()) {
    handlers.onError?.("This browser has no speech synthesis.");
    return;
  }

  const synth = window.speechSynthesis;
  try {
    synth.cancel();
  } catch {
    // ignore
  }

  // (2) — start on a later tick so the cancel above can't swallow this one.
  setTimeout(() => {
    try {
      const utter = new SpeechSynthesisUtterance(text);
      // Always steer the accent with lang — that part works everywhere.
      if (voice?.lang) utter.lang = voice.lang;
      const attachVoice = voice && !isRetry && !namedVoicesBroken();
      if (attachVoice) {
        try {
          utter.voice = voice;
        } catch {
          // Browser rejected the voice object; lang alone still speaks.
        }
      }
      utter.rate = 1;
      utter.pitch = 1;
      utter.volume = 1;

      let started = false;
      utter.onstart = () => {
        started = true;
        handlers.onStart?.();
      };
      utter.onboundary = (e) => handlers.onBoundary?.(e.charIndex, e.charLength ?? 0);
      utter.onend = () => {
        active = null;
        handlers.onEnd?.();
      };
      utter.onerror = (e) => {
        active = null;
        const reason = (e as SpeechSynthesisErrorEvent).error || "unknown";
        // "interrupted"/"canceled" are ordinary — we stopped it on purpose.
        if (reason === "interrupted" || reason === "canceled") handlers.onEnd?.();
        else handlers.onError?.(reason);
      };

      active = utter;

      // (1) — clear a stuck paused state before speaking.
      try {
        if (synth.paused) synth.resume();
      } catch {
        // ignore
      }

      synth.speak(utter);

      // `onstart` is the only trustworthy signal that audio began — Chrome
      // sets speaking = true even when the named voice produces nothing, so
      // that flag is deliberately not consulted here.
      setTimeout(() => {
        if (started) return;

        if (attachVoice) {
          // The named voice is the problem, not the audio path. Remember it
          // and retry on the default, keeping the language for the accent.
          markNamedVoicesBroken();
          cancelSpeech();
          speakText(text, voice, handlers, true);
          return;
        }
        handlers.onError?.("silent");
      }, 1400);
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err.message : String(err));
    }
  }, 60);
}
