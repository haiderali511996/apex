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
  handlers: SpeakHandlers = {}
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
      if (voice) {
        try {
          utter.voice = voice;
          utter.lang = voice.lang;
        } catch {
          // Browser rejected the voice object; the default still speaks.
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

      // Nothing started and nothing errored: the synth swallowed it silently.
      setTimeout(() => {
        if (!started && !synth.speaking && !synth.pending) {
          handlers.onError?.("silent");
        }
      }, 1200);
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err.message : String(err));
    }
  }, 60);
}
