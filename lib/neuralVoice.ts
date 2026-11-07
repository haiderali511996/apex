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

import { updateSpeechMotion, resetSpeechMotion, speechAudioLevel, updateAudioSpeechMotion } from "./speechMotion";
import type { SpeakHandlers } from "./speech";
import { voiceElement, releaseVoiceElement, onGesture } from "./audioUnlock";
import { speechLang, type SpeechLang } from "./speechLanguage";

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

/** True once the neural voice has spoken in this visit: from then on it is Sarah's voice. */
export function neuralVoiceWorked(): boolean {
  return everWorked;
}
let everWorked = false;

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
    releaseVoiceElement(audio);
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

/** Longest piece voiced in one request: longer ones took past the timeout and the reply stopped. */
const MAX_PIECE = 350;
/**
 * The first piece is all that's waited for before Sarah is heard, and voicing
 * takes about a second per 40 characters, so it is one short clause.
 */
const FIRST_PIECE = 80;

/**
 * A reply split for speaking: the first sentence alone, so audio starts as
 * soon as that one sentence is voiced, then short groups of sentences, each
 * voiced while the one before it plays, however long the reply. A sentence
 * too long for one piece is split at a comma or a space. Exported for tests.
 */
export function speechPieces(text: string): Piece[] {
  const sentences: Piece[] = [];
  for (const m of text.matchAll(/[^.!?\u06D4\u061F\n]+(?:[.!?\u06D4\u061F]+|\n+|$)\s*/g)) {
    let part = m[0], offset = m.index ?? 0;
    while (part.length > MAX_PIECE) {
      const window = part.slice(0, MAX_PIECE);
      let cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("\u060C "), window.lastIndexOf("; "));
      if (cut < MAX_PIECE / 3) cut = window.lastIndexOf(" ");
      cut = cut < MAX_PIECE / 3 ? MAX_PIECE : cut + 1;
      sentences.push({ text: part.slice(0, cut), offset });
      part = part.slice(cut); offset += cut;
    }
    if (part) sentences.push({ text: part, offset });
  }
  // A long first sentence is cut at its first pause (a comma), so the voice starts sooner.
  const first = sentences[0];
  if (first && first.text.length > FIRST_PIECE) {
    const m = /[,;:\u060C]\s/.exec(first.text.slice(20, FIRST_PIECE));
    if (m) {
      const cut = 20 + m.index + m[0].length;
      sentences.splice(0, 1, { text: first.text.slice(0, cut), offset: first.offset }, { text: first.text.slice(cut), offset: first.offset + cut });
    }
  }
  if (sentences.length <= 1) return [{ text, offset: 0 }];
  const pieces: Piece[] = [];
  let at = 0;
  const take = (minLength: number, max: number) => {
    const start = sentences[at];
    let piece = "";
    while (at < sentences.length && (!piece || (piece.length < minLength && piece.length + sentences[at].text.length <= max))) piece += sentences[at++].text;
    pieces.push({ text: piece, offset: start.offset });
  };
  // A very short opener ("Sure!") is joined to the next sentence if that stays short.
  take(25, FIRST_PIECE);
  // The second is voiced while the first plays, so it stays short too.
  if (at < sentences.length) take(140, 200);
  while (at < sentences.length) take(MAX_PIECE, MAX_PIECE);
  return pieces.filter(p => p.text.trim());
}

type Fetched = TtsResponse | { failed: string } | "canceled";

async function fetchPiece(text: string, lang: SpeechLang, controller: AbortController): Promise<Fetched> {
  // Later pieces are voiced while earlier ones play, so they can take longer.
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]);
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: text.trim(), lang }),
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
  // One voice for the whole reply, never one per piece.
  const lang = speechLang(text);
  // Two pieces are voiced at a time, the next starting as one finishes, so the
  // first is heard after its own wait only. More at once slowed every request
  // on the free tiers, sometimes past the timeout.
  const requests: (Promise<Fetched> | undefined)[] = [];
  const request = (i: number): Promise<Fetched> | undefined => {
    if (i >= pieces.length || requests[i]) return requests[i];
    // A piece that fails is asked for twice more before giving up, so a single
    // slow request doesn't cut the reply short.
    const retry = (r: Fetched) => typeof r === "object" && "failed" in r && available !== "no" ? fetchPiece(pieces[i].text, lang, controller) : r;
    const pending = fetchPiece(pieces[i].text, lang, controller).then(retry).then(retry);
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
      if (!started && i === 0) return false;
      // Part of the reply was spoken: skip this piece and go on in the same
      // voice, rather than stop or switch voices mid-reply.
      if (i === pieces.length - 1) handlers.onEnd?.();
      continue;
    }
    available = "yes";
    unavailableReason = "";
    const outcome = await playPiece(result, pieces[i], handlers, i === 0, i === pieces.length - 1);
    if (outcome === "canceled") return true;
    if (outcome === "failed") {
      if (!started && i === 0) return false;
      // Sound is blocked until a tap: the rest would be blocked too.
      if (/blocked/i.test(unavailableReason)) { handlers.onEnd?.(); return true; }
      if (i === pieces.length - 1) handlers.onEnd?.();
      continue;
    }
    started = true;
  }
  return true;
}

function playPiece(payload: TtsResponse, piece: Piece, handlers: SpeakHandlers, first: boolean, last: boolean) {
  return new Promise<"done" | "failed" | "canceled">((resolve) => {
    let settled = false;
    // The same element every time: phones only allow sound from an element
    // first played inside a tap (see audioUnlock), and replies come later.
    const el = voiceElement();
    let decoded: AudioBuffer | null = null;
    let decoder: AudioContext | null = null;
    const finish = (value: "done" | "failed" | "canceled") => {
      if (settled) return;
      settled = true;
      resetSpeechMotion();
      if (decoder) void decoder.close().catch(() => {});
      decoder = null;
      decoded = null;
      clearTimeout(startTimeout);
      finishCanceled = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (audio === el) {
        releaseVoiceElement(el);
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
    // Decode a separate copy for analysis; playback stays on the audio element
    // so Web Audio autoplay restrictions cannot mute the voice.
    if (!payload.alignment?.characters.length && typeof AudioContext !== "undefined") {
      try {
        decoder = new AudioContext();
        const context = decoder;
        void blob.arrayBuffer().then(bytes => context.decodeAudioData(bytes)).then(buffer => {
          if (!settled) decoded = buffer;
          void context.close().catch(() => {});
          if (decoder === context) decoder = null;
        }).catch(() => {
          void context.close().catch(() => {});
          if (decoder === context) decoder = null;
        });
      } catch { /* Timing estimates remain available when decoding is unsupported. */ }
    }
    objectUrl = URL.createObjectURL(blob);
    el.src = objectUrl;
    audio = el;

    // Timings are per piece; captions index the whole reply.
    const cues = wordCues(payload.alignment);
    let next = 0;
    const reveal = (cue: WordCue) => handlers.onBoundary?.(piece.offset + cue.charIndex, cue.charLength);

    const tick = () => {
      if (settled || audio !== el) return;
      const t = el.currentTime;
      if (!el.paused && !el.ended && !(el.readyState < 3)) {
        if (decoded) {
          const start = Math.floor(t * decoded.sampleRate);
          const end = Math.min(decoded.length, start + Math.ceil(decoded.sampleRate * .02));
          let level = 0;
          for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
            level = Math.max(level, speechAudioLevel(decoded.getChannelData(channel).subarray(start, end)));
          }
          updateAudioSpeechMotion(level);
        } else updateSpeechMotion(piece.text.trim(), t, payload.alignment, el.duration);
      }
      else resetSpeechMotion();
      while (next < cues.length && cues[next].at <= t) reveal(cues[next++]);
      frame = requestAnimationFrame(tick);
    };

    el.onplaying = () => {
      everWorked = true;
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

    let stopWaiting: (() => void) | null = null;
    const giveUp = (reason: string) => {
      stopWaiting?.(); stopWaiting = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      unavailableReason = reason;
      finish("failed");
    };
    el.play().catch((err: unknown) => {
      if (settled) return;
      if ((err as Error)?.name !== "NotAllowedError") return giveUp("Audio playback failed to start.");
      // Phones block sound until the page itself is tapped (allowing the
      // microphone doesn't count). Keep this reply ready and play it on the
      // next tap — inside the tap, the phone allows it — instead of failing.
      clearTimeout(startTimeout);
      handlers.onWarning?.("Tap anywhere on the page to hear Sarah. Your phone allows sound only after a tap.");
      stopWaiting = onGesture(() => {
        if (settled) { stopWaiting?.(); return; }
        el.play().then(() => { stopWaiting?.(); stopWaiting = null; handlers.onWarning?.(""); }).catch(() => { /* not a qualifying tap; wait for the next */ });
      });
      const prevCancel = finishCanceled;
      finishCanceled = () => { stopWaiting?.(); stopWaiting = null; prevCancel?.(); };
      setTimeout(() => { if (!settled && el.paused) giveUp("Sound is blocked until you tap the page. Tap anywhere, then ask again."); }, 120_000);
    });
  });
}
