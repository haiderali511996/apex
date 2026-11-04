"use client";

/**
 * Phones (iOS Safari, Android Chrome, every iOS browser) only let a page make
 * sound from inside a real tap or key press. Sarah's replies arrive seconds
 * after the tap, so anything created then is blocked. The fix is to start
 * every sound source once, silently, during the first tap: an audio element
 * or audio clock that has played inside a gesture may play again later.
 *
 * Only these events count as a gesture for that purpose; `pointerdown` from a
 * finger does not, which is why listening for it alone left phones silent.
 */

const GESTURES = ["touchend", "pointerup", "click", "keydown"] as const;

let voiceEl: HTMLAudioElement | null = null;
let silenceUrl: string | null = null;
let unlocked = false;
let listening = false;
const contexts = new Set<AudioContext>();
const callbacks = new Set<() => void>();

/** A tenth of a second of silence as a WAV, built here so no file is needed. */
function silence(): string {
  if (silenceUrl) return silenceUrl;
  const rate = 8000, samples = 800;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF"); v.setUint32(4, 36 + samples * 2, true); text(8, "WAVE");
  text(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, "data"); v.setUint32(40, samples * 2, true);
  silenceUrl = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  return silenceUrl;
}

/** The one audio element Sarah's voice plays through, reused for every reply. */
export function voiceElement(): HTMLAudioElement {
  if (!voiceEl) {
    voiceEl = new Audio();
    voiceEl.preload = "auto";
    voiceEl.setAttribute("playsinline", "");
    (voiceEl as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
  }
  return voiceEl;
}

/** Stops the voice element and empties it without firing an error event. */
export function releaseVoiceElement(el: HTMLAudioElement) {
  el.onplaying = el.onended = el.onerror = null;
  el.pause();
  el.removeAttribute("src");
  try { el.load(); } catch { /* nothing loaded */ }
}

/** An audio clock that should be started by the next tap if it is suspended. */
export function resumeOnGesture(ctx: AudioContext) {
  contexts.add(ctx);
  if (ctx.state !== "running") void ctx.resume().catch(() => {});
  listen();
}

export function forgetContext(ctx: AudioContext) {
  contexts.delete(ctx);
}

/** Runs `fn` inside every tap (until removed), for sources that need a gesture each time they start. */
export function onGesture(fn: () => void): () => void {
  callbacks.add(fn);
  listen();
  return () => { callbacks.delete(fn); };
}

export function audioUnlocked() {
  return unlocked;
}

function unlock() {
  for (const ctx of contexts) if (ctx.state !== "running" && ctx.state !== "closed") void ctx.resume().catch(() => {});
  for (const fn of [...callbacks]) { try { fn(); } catch { /* one source failing must not stop the rest */ } }
  if (unlocked) return;

  const el = voiceElement();
  // Never interrupt a reply that is already playing.
  if (el.paused && !el.getAttribute("src")) {
    el.src = silence();
    el.play().then(() => {
      unlocked = true;
      if (el.src === silenceUrl) releaseVoiceElement(el);
    }).catch(() => { /* not a qualifying gesture; the next one will try again */ });
  }

  // The system voice (the fallback) also has to speak once inside a tap on iOS.
  try {
    const synth = window.speechSynthesis;
    if (synth && !synth.speaking && !synth.pending) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      synth.speak(u);
    }
  } catch { /* no speech synthesis */ }
}

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  GESTURES.forEach(g => window.addEventListener(g, unlock, { capture: true, passive: true }));
}

/** Call once on page load so the first tap anywhere unlocks sound. */
export function installAudioUnlock() {
  listen();
}
