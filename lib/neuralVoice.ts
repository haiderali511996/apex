"use client";

/**
 * Speaking through ElevenLabs rather than the operating system.
 *
 * The point of doing this client-side work at all is the captions. With
 * speechSynthesis the browser fires `onboundary` as it reaches each word, and
 * the HUD reveals text in step with the voice. Playing an audio file gives you
 * no such event — so the route asks ElevenLabs for per-character timestamps,
 * and this turns them back into the same word-boundary callbacks. Everything
 * upstream of here keeps working unchanged.
 */

import { updateSpeechMotion, resetSpeechMotion } from "./speechMotion";
import type { SpeakHandlers } from "./speech";

type Alignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

type TtsResponse = {
  audioBase64: string;
  mimeType: string;
  alignment: Alignment | null;
};

/** One word, as the caption code wants it: where it starts and when it's said. */
type WordCue = { charIndex: number; charLength: number; at: number };

/**
 * Once the server says it isn't configured, stop asking. Otherwise every
 * single utterance pays a round-trip before falling back.
 */
let available: "unknown" | "yes" | "no" = "unknown";
let unavailableReason = "";

export function neuralVoiceRuledOut(): boolean {
  return available === "no";
}

export function neuralVoiceReason(): string {
  return unavailableReason;
}

let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let frame = 0;
let abort: AbortController | null = null;
let finishCanceled: (() => void) | null = null;

export function cancelNeuralSpeech() {
  resetSpeechMotion();
  finishCanceled?.();
  finishCanceled = null;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  abort?.abort();
  abort = null;
  if (audio) {
    audio.pause();
    audio.src = "";
    audio = null;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

/** Walks the alignment and marks where each word begins. Exported for tests. */
export function wordCues(alignment: Alignment | null): WordCue[] {
  if (!alignment?.characters?.length) return [];
  const { characters, character_start_times_seconds: starts } = alignment;
  const cues: WordCue[] = [];

  let i = 0;
  while (i < characters.length) {
    if (/\s/.test(characters[i])) {
      i++;
      continue;
    }
    const begin = i;
    while (i < characters.length && !/\s/.test(characters[i])) i++;
    cues.push({ charIndex: begin, charLength: i - begin, at: starts[begin] ?? 0 });
  }
  return cues;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/**
 * Speaks `text`. Resolves true if it played, false if the caller should fall
 * back to the system voice — it never throws for an unconfigured service,
 * because that's an expected state rather than a failure.
 */
export async function speakNeural(text: string, handlers: SpeakHandlers): Promise<boolean> {
  if (available === "no") return false;

  cancelNeuralSpeech();
  const controller = new AbortController();
  abort = controller;
  const requestTimeout = setTimeout(() => controller.abort("timeout"), 15000);

  let payload: TtsResponse;
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });

    if (controller !== abort) return true;
    if (res.status === 503) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      available = "no";
      unavailableReason = body.error ?? "Neural voice is not configured.";
      return false;
    }
    if (!res.ok) {
      // A transient failure — fall back for this utterance, but keep trying
      // on the next one.
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      unavailableReason = body.error ?? `Speech service error ${res.status}.`;
      return false;
    }
    payload = (await res.json()) as TtsResponse;
  } catch (err) {
    if (controller !== abort) return true; // deliberately canceled
    if (controller.signal.aborted) {
      unavailableReason = "Speech generation timed out.";
      return false;
    }
    unavailableReason = err instanceof Error ? err.message : String(err);
    return false;
  } finally {
    clearTimeout(requestTimeout);
  }

  if (controller !== abort) return true;
  if (!payload.audioBase64) {
    unavailableReason = "The speech service returned no audio.";
    return false;
  }
  available = "yes";
  unavailableReason = "";

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resetSpeechMotion();
      clearTimeout(startTimeout);
      finishCanceled = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (audio) {
        audio.onplaying = audio.onended = audio.onerror = null;
        audio.pause();
        audio.src = "";
        audio = null;
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      resolve(value);
    };
    const startTimeout = setTimeout(() => {
      if (settled) return;
      unavailableReason = "Audio did not start. Click Test Sound to enable playback, and check that the tab is unmuted.";
      if (audio) audio.pause();
      finish(false);
    }, 10_000);
    finishCanceled = () => finish(true);

    const blob = base64ToBlob(payload.audioBase64, payload.mimeType || "audio/mpeg");
    objectUrl = URL.createObjectURL(blob);
    const el = new Audio(objectUrl);
    audio = el;

    const cues = wordCues(payload.alignment);
    let next = 0;

    const tick = () => {
      if (audio !== el) return;
      const t = el.currentTime;
      if (!el.paused && !el.ended && !(el.readyState < 3)) updateSpeechMotion(text, t, payload.alignment, el.duration);
      else resetSpeechMotion();
      while (next < cues.length && cues[next].at <= t) {
        handlers.onBoundary?.(cues[next].charIndex, cues[next].charLength);
        next++;
      }
      frame = requestAnimationFrame(tick);
    };

    el.onplaying = () => {
      clearTimeout(startTimeout);
      if (frame) cancelAnimationFrame(frame);
      handlers.onStart?.(cues.length > 0);
      frame = requestAnimationFrame(tick);
    };
    el.onended = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      // Reveal anything the timer hasn't reached, so a caption can't be left
      // half-written if playback ends early.
      while (next < cues.length) {
        handlers.onBoundary?.(cues[next].charIndex, cues[next].charLength);
        next++;
      }
      handlers.onEnd?.();
      finish(true);
    };
    el.onerror = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      unavailableReason = "The audio returned by the speech service wouldn't play.";
      finish(false);
    };

    el.play().catch((err: unknown) => {
      // Autoplay was blocked, or the element was torn down. The system voice
      // is subject to the same gesture rules, but let the caller decide.
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      unavailableReason =
        (err as Error)?.name === "NotAllowedError"
          ? "The browser blocked audio until you interact with the page — tap the orb once."
          : "Audio playback failed to start.";
      finish(false);
    });
  });
}
