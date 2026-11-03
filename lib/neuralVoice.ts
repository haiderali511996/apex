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

type Piece = { text: string; offset: number };

/**
 * A reply split for speaking: the first sentence alone, so audio starts as
 * soon as that one sentence is voiced, then the next few, then the rest,
 * each voiced while the one before it plays.
 * Voicing a whole reply first took 8–10 s before anything was heard. Three
 * pieces at most, because each one is a separate request. Exported for tests.
 */
export function speechPieces(text: string): Piece[] {
  const sentences = [...text.matchAll(/[^.!?\u06D4\u061F\n]+(?:[.!?\u06D4\u061F]+|\n+|$)\s*/g)]
    .map(m => ({ text: m[0], offset: m.index ?? 0 }));
  if (sentences.length <= 1) return [{ text, offset: 0 }];
  const pieces: Piece[] = [];
  let at = 0;
  const take = (minLength: number) => {
    const start = sentences[at];
    let piece = "";
    while (at < sentences.length && (piece.length < minLength || !piece)) piece += sentences[at++].text;
    pieces.push({ text: piece, offset: start.offset });
  };
  // A very short opener ("Sure!") is joined to the next sentence.
  take(25);
  if (at < sentences.length) take(160);
  if (at < sentences.length) take(Infinity);
  return pieces;
}

type Fetched = TtsResponse | { failed: string } | "canceled";

async function fetchPiece(text: string, controller: AbortController): Promise<Fetched> {
  // Later pieces are voiced while earlier ones play, so they can take longer.
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: text.trim() }),
      signal,
    });
    if (controller !== abort) return "canceled";
    const body = (await res.json().catch(() => ({}))) as Partial<TtsResponse> & { error?: string };
    if (res.status === 503) {
      available = "no";
      return { failed: body.error ?? "Neural voice is not configured." };
    }
    // A transient failure — fall back for this utterance, but keep trying on the next one.
    if (!res.ok) return { failed: body.error ?? `Speech service error ${res.status}.` };
    if (!body.audioBase64) return { failed: "The speech service returned no audio." };
    return body as TtsResponse;
  } catch (err) {
    if (controller !== abort || controller.signal.aborted) return "canceled";
    if (signal.aborted) return { failed: "Speech generation timed out." };
    return { failed: err instanceof Error ? err.message : String(err) };
  }
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
  const pieces = speechPieces(text);
  // Two pieces are voiced at a time, the next starting as one finishes, so the
  // first is heard after its own wait only. More at once slowed every request
  // on the free tiers, sometimes past the timeout.
  const requests: (Promise<Fetched> | undefined)[] = [];
  const request = (i: number): Promise<Fetched> | undefined => {
    if (i >= pieces.length || requests[i]) return requests[i];
    const pending = fetchPiece(pieces[i].text, controller);
    requests[i] = pending;
    void pending.then(() => request(i + 2));
    return pending;
  };
  request(0); request(1);
  let started = false;

  for (let i = 0; i < pieces.length; i++) {
    const result = await request(i)!;
    if (result === "canceled" || controller !== abort) return true;
    if ("failed" in result) {
      unavailableReason = result.failed;
      if (!started) return false;
      // Part of the reply was spoken; stop there rather than switch voices mid-reply.
      handlers.onEnd?.();
      return true;
    }
    available = "yes";
    unavailableReason = "";
    const outcome = await playPiece(result, pieces[i], handlers, i === 0, i === pieces.length - 1);
    if (outcome === "canceled") return true;
    if (outcome === "failed") {
      if (!started) return false;
      handlers.onEnd?.();
      return true;
    }
    started = true;
  }
  return true;
}

function playPiece(payload: TtsResponse, piece: Piece, handlers: SpeakHandlers, first: boolean, last: boolean) {
  return new Promise<"done" | "failed" | "canceled">((resolve) => {
    let settled = false;
    const finish = (value: "done" | "failed" | "canceled") => {
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
      finish("failed");
    }, 10_000);
    finishCanceled = () => finish("canceled");

    const blob = base64ToBlob(payload.audioBase64, payload.mimeType || "audio/mpeg");
    objectUrl = URL.createObjectURL(blob);
    const el = new Audio(objectUrl);
    audio = el;

    // Timings are per piece; captions index the whole reply.
    const cues = wordCues(payload.alignment);
    let next = 0;
    const reveal = (cue: WordCue) => handlers.onBoundary?.(piece.offset + cue.charIndex, cue.charLength);

    const tick = () => {
      if (audio !== el) return;
      const t = el.currentTime;
      if (!el.paused && !el.ended && !(el.readyState < 3)) updateSpeechMotion(piece.text, t, payload.alignment, el.duration);
      else resetSpeechMotion();
      while (next < cues.length && cues[next].at <= t) reveal(cues[next++]);
      frame = requestAnimationFrame(tick);
    };

    el.onplaying = () => {
      clearTimeout(startTimeout);
      if (frame) cancelAnimationFrame(frame);
      if (first) handlers.onStart?.(cues.length > 0);
      frame = requestAnimationFrame(tick);
    };
    el.onended = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      // Reveal anything the timer hasn't reached, so a caption can't be left
      // half-written if playback ends early.
      while (next < cues.length) reveal(cues[next++]);
      if (last) handlers.onEnd?.();
      finish("done");
    };
    el.onerror = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      unavailableReason = "The audio returned by the speech service wouldn't play.";
      finish("failed");
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
      finish("failed");
    });
  });
}
