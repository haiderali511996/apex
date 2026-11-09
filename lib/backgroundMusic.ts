"use client";

import { useCallback, useEffect, useState } from "react";

/** Commands the BackgroundMusic component listens for on `window`. */
/**
 * pause/play: a temporary step aside (Sarah talking) that never overrides the
 * user's choice. off/on: the user's own choice, like pressing the button.
 */
export type MusicCommand = "pause" | "play" | "toggle" | "off" | "on" | "listen" | "next";

/**
 * Listening mode: the user asked for music to listen to ("play music"), so it
 * plays out loud and keeps playing while the mic listens; it only dips while
 * Sarah thinks and speaks. Background mode is the soft ambient music.
 */
let listening = false;
export const listeningMode = () => listening;
export const setListeningMode = (on: boolean) => { listening = on; };

export const MUSIC_COMMAND_EVENT = "sarah:music-command";
export const MUSIC_STATE_EVENT = "sarah:music-state";

export interface MusicState {
  /** Audio is actually playing right now. */
  playing: boolean;
  /** Paused by a command (e.g. Sarah speaking) rather than by the user's toggle. */
  suspended: boolean;
}

/**
 * Pause, resume or toggle the background music from anywhere. A pause here is
 * temporary: it never changes the user's saved on/off preference, and a "play"
 * will not start music the user has switched off.
 */
export function sendMusicCommand(command: MusicCommand, query?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MusicCommand | { command: MusicCommand; query?: string }>(MUSIC_COMMAND_EVENT, { detail: query ? { command, query } : command }));
}

export const pauseMusic = () => sendMusicCommand("pause");
export const playMusic = () => sendMusicCommand("play");
export const toggleMusic = () => sendMusicCommand("toggle");
export const musicOff = () => sendMusicCommand("off");
export const musicOn = () => sendMusicCommand("on");

// What the user says to play or stop Sarah's own music, in English or Roman Urdu.
const MUSIC = /\b(music|song|songs|gaana|gana|gaane|gane|track|tune)\b/i;
// These mean somewhere else (YouTube, the computer's own player): Sarah handles them.
const ELSEWHERE = /\b(youtube|you tube|laptop|pc|computer|spotify|apple music|itunes|chrome|video)\b/i;
const BACKGROUND = /\b(background|ambient|soft|halka|halki)\b/i;
const NEXT = /\b(next|skip|change|another|agla|aglaa|agli|doosra|dusra|doosri|dusri|badlo|badal)\b/i;
const OFF = /\b(pause|stop|mute|off|band|bund|rok|roko|rokein|rokain|hatao|silence|bas)\b/i;
const ON = /\b(play|start|resume|unmute|on|chala|chalao|chalaen|chalain|chalayein|lagao|laga do|shuru|sunao|bajao)\b/i;

/**
 * "play music", "gaana chalao" → listen (out loud); "next song" → next;
 * "pause / stop the music" → off; "play background music" → on (soft).
 * Music on YouTube or the computer itself goes to Sarah instead.
 */
export function musicCommand(text: string): "on" | "off" | "listen" | "next" | null {
  if (!MUSIC.test(text) || ELSEWHERE.test(text) || text.length > 80) return null;
  if (OFF.test(text)) return "off";
  if (NEXT.test(text)) return "next";
  if (ON.test(text)) return BACKGROUND.test(text) ? "on" : "listen";
  return null;
}

/** Hook form: commands plus the music's live state. */
export function useBackgroundMusic() {
  const [state, setState] = useState<MusicState>({ playing: false, suspended: false });

  useEffect(() => {
    const onState = (e: Event) => setState((e as CustomEvent<MusicState>).detail);
    window.addEventListener(MUSIC_STATE_EVENT, onState);
    return () => window.removeEventListener(MUSIC_STATE_EVENT, onState);
  }, []);

  const pause = useCallback(pauseMusic, []);
  const play = useCallback(playMusic, []);
  const toggle = useCallback(toggleMusic, []);
  return { ...state, pause, play, toggle };
}
