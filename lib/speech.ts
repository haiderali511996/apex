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

import { updateSpeechMotion, resetSpeechMotion } from "./speechMotion";
import { speakNeural, cancelNeuralSpeech, neuralVoiceRuledOut, neuralVoiceReason, neuralVoiceWorked } from "./neuralVoice";

// (3) — a module-level reference keeps the utterance alive while it speaks.
let active: SpeechSynthesisUtterance | null = null;
let speechVersion = 0;
let motionTimer: ReturnType<typeof setInterval> | null = null;
function stopMotion() {
  if (motionTimer) clearInterval(motionTimer);
  motionTimer = null;
  resetSpeechMotion();
}

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
  onStart?: (hasAlignment?: boolean) => void;
  onWarning?: (reason: string) => void;
  onBoundary?: (charIndex: number, charLength: number) => void;
  onEnd?: () => void;
  onError?: (reason: string) => void;
};

function synthAvailable(): boolean {
  return typeof window !== "undefined" && !!window.speechSynthesis;
}

/** True if anything at all can speak — the neural voice or the OS one. */
export function speechAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.speechSynthesis || !neuralVoiceRuledOut();
}

export function cancelSpeech() {
  speechVersion++;
  stopMotion();
  cancelNeuralSpeech();
  if (!synthAvailable()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // nothing to cancel
  }
  active = null;
}

/**
 * Speaks, preferring the neural voice.
 *
 * ElevenLabs is tried first and the operating system's voice is the fallback,
 * for an unconfigured key, a transient failure, or a browser that blocks the
 * audio. Both paths report through the same handlers — the neural one rebuilds
 * word boundaries from timestamps — so callers never need to know which spoke.
 */
export function speakText(
  text: string,
  voice: SpeechSynthesisVoice | null,
  handlers: SpeakHandlers = {}
): void {
  cancelSpeech();
  const version = speechVersion;
  if (neuralVoiceRuledOut()) {
    const reason = neuralVoiceReason();
    if (neuralVoiceWorked()) {
      handlers.onError?.(reason || "The voice service stopped working.");
      return;
    }
    if (reason) handlers.onWarning?.(`${reason} Using the system voice for this reply.`);
    speakViaSynth(text, voice, handlers);
    return;
  }

  void speakNeural(text, handlers).then((spoke) => {
    if (spoke || version !== speechVersion) return;
    // The system voice is the fallback, and on some machines it is silent
    // too. When both fail, the useful thing to report is why the neural
    // voice didn't run — "check your volume" sends the user hunting for a
    // problem that isn't there.
    const why = neuralVoiceReason();
    // Once Sarah's own voice has been heard, never switch to a different-
    // sounding system voice: show the reply as text instead.
    if (neuralVoiceWorked()) {
      handlers.onError?.(why || "The voice couldn't play this reply.");
      return;
    }
    if (why) handlers.onWarning?.(`${why} Using the system voice for this reply.`);
    speakViaSynth(text, voice, {
      ...handlers,
      onError: (reason) => handlers.onError?.(reason === "silent" && why ? why : reason),
    });
  });
}

function speakViaSynth(
  text: string,
  voice: SpeechSynthesisVoice | null,
  handlers: SpeakHandlers = {},
  // Set when this is already the no-voice retry, so it can't loop.
  isRetry = false
): void {
  if (!synthAvailable()) {
    handlers.onError?.("This browser has no speech synthesis.");
    return;
  }

  const version = speechVersion;
  const synth = window.speechSynthesis;
  try {
    synth.cancel();
  } catch {
    // ignore
  }

  // (2) — start on a later tick so the cancel above can't swallow this one.
  setTimeout(() => {
    if (version !== speechVersion) return;
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
      let anchor = 0, anchorTime = 0, wordEnd = text.length;
      let charactersPerSecond = 13;
      let previousBoundary: { index: number; time: number } | null = null;
      const sample = () => {
        if (version !== speechVersion || active !== utter) return;
        const elapsed = (performance.now() - anchorTime) / 1000;
        // Stay within the spoken word until the next real boundary arrives.
        const position = Math.min(wordEnd, anchor + elapsed * charactersPerSecond);
        updateSpeechMotion(text, position / 13, null);
      };
      utter.onstart = () => {
        if (version !== speechVersion || active !== utter) return;
        started = true;
        stopMotion();
        anchorTime = performance.now();
        sample();
        motionTimer = setInterval(sample, 16);
        handlers.onStart?.();
      };
      utter.onboundary = (e) => {
        if (version !== speechVersion || active !== utter) return;
        if (e.name === "word" || !e.name) {
          const now = performance.now();
          if (previousBoundary && e.charIndex > previousBoundary.index) {
            const seconds = (now - previousBoundary.time) / 1000;
            if (seconds > .02) charactersPerSecond = Math.max(5, Math.min(30, (e.charIndex - previousBoundary.index) / seconds));
          }
          anchor = e.charIndex;
          anchorTime = now;
          const length = e.charLength || text.slice(anchor).match(/^\S+/)?.[0].length || 1;
          wordEnd = Math.min(text.length, anchor + length);
          previousBoundary = { index: anchor, time: now };
          sample();
        }
        handlers.onBoundary?.(e.charIndex, e.charLength ?? 0);
      };
      utter.onpause = () => {
        if (version === speechVersion && active === utter) stopMotion();
      };
      utter.onresume = () => {
        if (version !== speechVersion || active !== utter) return;
        anchorTime = performance.now();
        if (motionTimer) clearInterval(motionTimer);
        motionTimer = setInterval(sample, 16);
      };
      utter.onend = () => {
        if (version !== speechVersion || active !== utter) return;
        stopMotion();
        active = null;
        handlers.onEnd?.();
      };
      utter.onerror = (e) => {
        if (version !== speechVersion || active !== utter) return;
        stopMotion();
        active = null;
        const reason = (e as SpeechSynthesisErrorEvent).error || "unknown";
        // "interrupted"/"canceled" are ordinary — we stopped it on purpose.
        if (reason === "interrupted" || reason === "canceled") handlers.onEnd?.();
        // Chrome refuses speech on a page nobody has clicked yet; with the mic
        // opening on its own, that is easy to hit.
        else if (reason === "not-allowed") handlers.onError?.("Chrome won't speak until you click the page once. Click anywhere and Sarah will talk from then on.");
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
      // that flag is deliberately not consulted here. The wait is generous:
      // a macOS voice's first utterance takes ~2s while the voice loads.
      setTimeout(() => {
        if (started || active !== utter || version !== speechVersion) return;

        if (attachVoice) {
          // The named voice is the problem, not the audio path. Remember it
          // and retry on the default, keeping the language for the accent.
          markNamedVoicesBroken();
          cancelSpeech();
          speakViaSynth(text, voice, handlers, true);
          return;
        }
        // Still "speaking" with nothing started is Chrome's synth wedged, which
        // only a browser restart clears — the volume is not the problem.
        if (synth.speaking || synth.pending) {
          handlers.onError?.("Chrome's speech engine is stuck. Quit Chrome completely (⌘Q) and reopen it.");
          return;
        }
        handlers.onError?.("silent");
      }, 4000);
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err.message : String(err));
    }
  }, 60);
}
