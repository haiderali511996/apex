"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MUSIC_COMMAND_EVENT, MUSIC_STATE_EVENT, setListeningMode, type MusicCommand, type MusicState } from "@/lib/backgroundMusic";
import { installAudioUnlock, onGesture, resumeOnGesture } from "@/lib/audioUnlock";

// Unique tracks from /public (the "(1)" copies are byte-identical duplicates, so they are skipped).
const DEFAULT_TRACKS = [
  "alisiabeats-apollo-552216.mp3",
  "atlasaudio-innovation-522427.mp3",
  "audioknap-innovation-458047.mp3",
  "audioknap-innovation-458050.mp3",
  "berrydeep-modern-innovation-inspiring-605145.mp3",
  "berrydeep-technology-innovation-background-612984.mp3",
  "berrydeep-technology-inspiring-innovation-corporate-background-612926.mp3",
  "paulyudin-technology-innovation-113978.mp3",
  "the_mountain-innovation-171613.mp3",
  "the_mountain-tech-innovation-149935.mp3",
  "tunetank-inspiring-innovation-347767.mp3",
].map(name => `/${encodeURIComponent(name)}`);

const VOLUME = 0.12; // soft, so it sits under Sarah's voice
const LISTEN_VOLUME = 0.6; // "play music": out loud, to listen to
const DUCK_VOLUME = 0.06; // while Sarah thinks and speaks in listening mode

/** A readable name for a track URL: the file name without the store id or extension. */
const trackName = (url: string) => decodeURIComponent(url.split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, "").replace(/[-_]\d{3,}/g, "").replace(/[-_]+/g, " ").trim();
const STORAGE_KEY = "sarah.music.enabled";

type AudioCtor = typeof AudioContext;

/**
 * iPhones and iPads ignore `audio.volume` (it always reads back as 1), so the
 * music would drown out Sarah. There the element is routed through a Web Audio
 * gain instead. Must run inside a tap, so the audio clock starts running.
 */
function softenOnIOS(audio: HTMLAudioElement, state: { routed: boolean }) {
  if (state.routed || Math.abs(audio.volume - VOLUME) < 0.01) return;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const Ctor = w.AudioContext || w.webkitAudioContext;
  if (!Ctor) return;
  try {
    const ctx = new Ctor();
    const gain = ctx.createGain();
    gain.gain.value = VOLUME;
    ctx.createMediaElementSource(audio).connect(gain);
    gain.connect(ctx.destination);
    state.routed = true;
    resumeOnGesture(ctx);
  } catch { /* stays at full volume rather than silent */ }
}

export default function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const indexRef = useRef(0);
  // The signed-in account's own uploads replace the built-in tracks.
  const tracksRef = useRef<string[]>(DEFAULT_TRACKS);
  // Names to match "play <song>" against: uploads by their file name, built-ins by theirs.
  const namesRef = useRef<string[]>(DEFAULT_TRACKS.map(trackName));
  const listenRef = useRef(false);
  // The volume the user asked for: soft background, or out loud.
  const levelRef = useRef(VOLUME);
  const [enabled, setEnabled] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const enabledRef = useRef(true);
  const suspendedRef = useRef(false);
  enabledRef.current = enabled;
  suspendedRef.current = suspended;

  // Waiting for the visitor's first click/tap/key before sound is allowed.
  const [blocked, setBlocked] = useState(false);

  const routeRef = useRef({ routed: false });

  const start = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = false;
    audio.play().then(() => { setPlaying(true); setBlocked(false); }).catch(() => {
      // Sound blocked until a gesture: keep the track rolling silently so it is
      // already playing (and buffered) the moment the visitor interacts.
      setPlaying(false); setBlocked(true);
      audio.muted = true;
      audio.play().catch(() => {});
    });
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const on = saved !== "off";
    setEnabled(on);

    indexRef.current = Math.floor(Math.random() * DEFAULT_TRACKS.length);
    installAudioUnlock();
    const audio = new Audio(DEFAULT_TRACKS[indexRef.current]);
    audio.volume = VOLUME;
    audio.preload = "auto";
    audio.setAttribute("playsinline", "");
    audio.addEventListener("ended", () => {
      indexRef.current = (indexRef.current + 1) % tracksRef.current.length;
      audio.src = tracksRef.current[indexRef.current];
      audio.play().catch(() => {});
    });
    audioRef.current = audio;

    // Browsers block sound until the user taps, so unmute on a tap. Keep
    // listening until it actually plays out loud: on phones some touches
    // (a scroll, a press that isn't a tap) don't count.
    const stopListening = onGesture(() => {
      if (!enabledRef.current || suspendedRef.current) return;
      softenOnIOS(audio, routeRef.current);
      if (!audio.paused && !audio.muted) { stopListening(); return; }
      start();
    });
    if (on) start();

    return () => {
      stopListening();
      audio.pause();
      audioRef.current = null;
    };
  }, [start]);

  // Load this account's uploads (401 when signed out: keep the built-in music), and again when they change.
  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/music").catch(() => null);
      const body = res?.ok ? await res.json().catch(() => null) : null;
      const list: { id: string; name?: string }[] = body?.tracks ?? [];
      const own: string[] = list.map(t => `/api/music/${encodeURIComponent(t.id)}`);
      const next = own.length ? own : DEFAULT_TRACKS;
      if (next.join() === tracksRef.current.join()) return;
      tracksRef.current = next;
      namesRef.current = own.length ? list.map(t => trackName(t.name || t.id)) : DEFAULT_TRACKS.map(trackName);
      const audio = audioRef.current;
      if (!audio) return;
      const wasPlaying = !audio.paused;
      indexRef.current = Math.floor(Math.random() * next.length);
      audio.src = next[indexRef.current];
      if (wasPlaying) audio.play().catch(() => {});
    };
    void load();
    window.addEventListener("sarah:music-library", load);
    return () => window.removeEventListener("sarah:music-library", load);
  }, []);

  // Programmatic control (see lib/backgroundMusic.ts). Commands pause or resume
  // without touching the saved preference; resuming never overrides a user mute.
  useEffect(() => {
    const onCommand = (e: Event) => {
      const audio = audioRef.current;
      if (!audio) return;
      const raw = (e as CustomEvent<MusicCommand | { command: MusicCommand; query?: string }>).detail;
      let command = typeof raw === "string" ? raw : raw.command;
      const query = typeof raw === "string" ? "" : (raw.query ?? "").trim().toLowerCase();
      if (command === "toggle") command = suspendedRef.current ? "play" : "pause";
      // Music the user asked for (by voice or the button) keeps playing while
      // Sarah listens, at the level they asked for; it only dips while she talks.
      const keep = (level: number | null) => {
        listenRef.current = level !== null; setListeningMode(level !== null);
        levelRef.current = level ?? VOLUME; audio.volume = levelRef.current;
      };
      // "Play music": out loud, a named song if asked for, and it keeps playing while Sarah listens.
      if (command === "listen" || command === "next") {
        const names = namesRef.current, tracks = tracksRef.current;
        let index = command === "next" ? (indexRef.current + 1) % tracks.length : indexRef.current;
        if (query) {
          const words = query.split(/\s+/).filter(w => w.length > 2);
          const hit = names.findIndex(n => words.length && words.every(w => n.toLowerCase().includes(w))) ;
          const some = hit >= 0 ? hit : names.findIndex(n => words.some(w => n.toLowerCase().includes(w)));
          if (some >= 0) index = some;
        }
        if (index !== indexRef.current || audio.src === "" ) { indexRef.current = index; audio.src = tracks[index]; }
        keep(LISTEN_VOLUME);
        setSuspended(false); setEnabled(true);
        localStorage.setItem(STORAGE_KEY, "on");
        softenOnIOS(audio, routeRef.current);
        start();
        return;
      }
      // The user's own choice, asked for by voice: same as pressing the button.
      if (command === "off") {
        keep(null);
        audio.pause();
        setPlaying(false); setSuspended(false); setEnabled(false); setBlocked(false);
        localStorage.setItem(STORAGE_KEY, "off");
        return;
      }
      if (command === "on") {
        keep(VOLUME);
        setSuspended(false); setEnabled(true);
        localStorage.setItem(STORAGE_KEY, "on");
        start();
        return;
      }
      // Listening mode only dips under Sarah's voice instead of stopping.
      if (listenRef.current && (command === "pause" || command === "play")) {
        audio.volume = command === "pause" ? Math.min(DUCK_VOLUME, levelRef.current / 2) : levelRef.current;
        if (command === "play" && audio.paused && enabledRef.current) start();
        return;
      }
      if (command === "pause") {
        if (!audio.paused) {
          audio.pause();
          setPlaying(false);
          setSuspended(true);
        }
      } else if (command === "play") {
        if (suspendedRef.current && enabledRef.current) start();
        setSuspended(false);
      }
    };
    window.addEventListener(MUSIC_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(MUSIC_COMMAND_EVENT, onCommand);
  }, [start]);

  useEffect(() => {
    const detail: MusicState = { playing, suspended };
    window.dispatchEvent(new CustomEvent(MUSIC_STATE_EVENT, { detail }));
  }, [playing, suspended]);

  const toggle = () => {
    setSuspended(false);
    const audio = audioRef.current;
    if (!audio) return;
    if (enabled && playing) {
      listenRef.current = false; setListeningMode(false); audio.volume = VOLUME;
      audio.pause();
      setPlaying(false);
      setEnabled(false); setBlocked(false);
      localStorage.setItem(STORAGE_KEY, "off");
    } else {
      // Pressed on: the user wants it, so it plays on while Sarah listens.
      listenRef.current = true; setListeningMode(true); levelRef.current = VOLUME; audio.volume = VOLUME;
      setEnabled(true);
      localStorage.setItem(STORAGE_KEY, "on");
      softenOnIOS(audio, routeRef.current);
      start();
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={playing ? "Mute background music" : "Play background music"}
      title={playing ? "Background music: on" : blocked ? "Music starts when you click or tap the page" : "Background music: off"}
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 50,
        width: 36,
        height: 36,
        borderRadius: "50%",
        border: "1px solid rgba(255,255,255,0.25)",
        background: "rgba(0,0,0,0.45)",
        color: "#fff",
        cursor: "pointer",
        fontSize: 16,
        opacity: playing || blocked ? 0.9 : 0.5,
      }}
    >
      {playing || blocked ? "♪" : "🔇"}
    </button>
  );
}
