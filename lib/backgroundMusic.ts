"use client";

import { useCallback, useEffect, useState } from "react";

/** Commands the BackgroundMusic component listens for on `window`. */
/**
 * pause/play: a temporary step aside (Sarah talking) that never overrides the
 * user's choice. off/on: the user's own choice, like pressing the button.
 */
export type MusicCommand = "pause" | "play" | "toggle" | "off" | "on";

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
export function sendMusicCommand(command: MusicCommand) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MusicCommand>(MUSIC_COMMAND_EVENT, { detail: command }));
}

export const pauseMusic = () => sendMusicCommand("pause");
export const playMusic = () => sendMusicCommand("play");
export const toggleMusic = () => sendMusicCommand("toggle");
export const musicOff = () => sendMusicCommand("off");
export const musicOn = () => sendMusicCommand("on");

// What the user says to switch the music, in English or Roman Urdu.
const MUSIC = /\b(music|song|songs|gaana|gana|gaane|gane|background music)\b/i;
const OFF = /\b(pause|stop|mute|off|band|bund|rok|roko|rokein|rokain|hatao|silence)\b/i;
const ON = /\b(play|start|resume|unmute|on|chala|chalao|chalaen|chalain|chalayein|lagao|laga do|shuru)\b/i;

/** "pause the music", "music band karo" → off; "play music", "gaana chalao" → on. */
export function musicCommand(text: string): "on" | "off" | null {
  if (!MUSIC.test(text) || text.length > 80) return null;
  if (OFF.test(text)) return "off";
  if (ON.test(text)) return "on";
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
