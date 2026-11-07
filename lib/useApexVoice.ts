"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientAction, PendingAction } from "./agent/types";
import { speakText, cancelSpeech, speechAvailable } from "./speech";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";
export type ChatMessage = { role: "user" | "assistant"; content: string };

import { getRecognitionCtor, VoiceRecognition, type InputStatus } from "./voiceRecognition";
import { CloudRecognition } from "./cloudRecognition";
import { musicCommand, musicOff, musicOn, pauseMusic, playMusic } from "./backgroundMusic";
import { chatContext } from "./userLocation";

/** Quiet this long after an exchange before the background music returns. */
const MUSIC_RESUME_MS = 3000;

export function speechSupported(): boolean {
  return CloudRecognition.supported() || Boolean(getRecognitionCtor());
}

/** Where the chosen voice is remembered between visits. */
export const VOICE_STORAGE_KEY = "apex.voice";

/**
 * Fallback order when nothing has been chosen yet. The browser's own default
 * is usually the flattest voice installed, so name the good ones first:
 * Daniel and Serena are macOS British, Samantha macOS American.
 */
const VOICE_PREFERENCES = ["Daniel", "Serena", "Samantha"];

/**
 * English voices installed on this machine — the macOS ones. Chrome's online
 * "Google" voices are left out; Sarah speaks with the OS's own.
 */
export function englishVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("en") && v.localService);
}

export function savedVoiceName(): string | null {
  try {
    return window.localStorage.getItem(VOICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveVoiceName(name: string) {
  try {
    window.localStorage.setItem(VOICE_STORAGE_KEY, name);
  } catch {
    // private mode — the choice just won't persist
  }
}

export function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices().filter((v) => v.localService);
  if (!voices.length) return null;

  // What the user picked wins, then a build-time pin, then the preference list.
  const chosen = savedVoiceName() || process.env.NEXT_PUBLIC_APEX_VOICE?.trim();
  if (chosen) {
    const exact = voices.find((v) => v.name === chosen);
    if (exact) return exact;
  }
  for (const name of VOICE_PREFERENCES) {
    const match = voices.find((v) => v.name === name);
    if (match) return match;
  }
  return voices.find((v) => v.lang?.startsWith("en")) ?? null;
}

/**
 * The single voice + chat loop shared by the orb and the chat panel, so both
 * drive the same conversation rather than keeping two rival copies of it.
 */
export function useApexVoice(options: {
  speak?: boolean;
  /**
   * Handles commands about the interface itself ("show your face"). Return the
   * line to say back and the request never reaches the agent — the screen
   * changes immediately rather than after a round trip.
   */
  onLocalCommand?: (text: string) => string | null | Promise<string | null>;
  /** Open the mic as soon as the view mounts, without waiting for a press. */
  autoListen?: boolean;
  /**
   * Carries out what a tool asked the screen to do (take a photo for Design).
   * Returns the line Sarah says once it's done.
   */
  onClientAction?: (action: ClientAction) => Promise<string | null>;
} = {}) {
  const speakEnabled = options.speak ?? true;
  const autoListen = options.autoListen ?? true;
  // Conversation mode: once the user is talking, the mic reopens after every
  // reply until they press it off.
  const conversationRef = useRef(autoListen);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // The saved conversation comes back on every visit and device (lib/memory.ts).
  useEffect(() => {
    let live = true;
    void fetch("/api/agent/history").then(r => (r.ok ? r.json() : null)).then((body: { messages?: ChatMessage[] } | null) => {
      if (live && body?.messages?.length) setMessages(current => (current.length ? current : body.messages!));
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  const [state, setState] = useState<VoiceState>("idle");
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The reply being spoken, and how much of it has been voiced so far.
  const [spokenText, setSpokenText] = useState("");
  const [spokenChars, setSpokenChars] = useState(0);

  const mountedRef = useRef(true);
  const inputRef = useRef<VoiceRecognition | CloudRecognition | null>(null);
  const [inputStatus, setInputStatus] = useState<InputStatus>("off");
  const [heardText, setHeardText] = useState("");
  const speechGenerationRef = useRef(0);
  const sendRef = useRef<(text: string) => void>(() => {});
  const stateRef = useRef<VoiceState>("idle");
  // Background music steps aside for the whole exchange — while the user talks,
  // while Sarah thinks and speaks — and returns once neither has spoken for a
  // few seconds. Only the music pauses; the mic stays open.
  const musicTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // While the mic is open the music stays off: music reaching the mic was
  // being heard as speech, and turned into requests nobody made.
  const micOpenRef = useRef(false);
  const holdMusic = useCallback(() => {
    if (musicTimer.current) { clearTimeout(musicTimer.current); musicTimer.current = null; }
    pauseMusic();
  }, []);
  const releaseMusic = useCallback(() => {
    if (musicTimer.current) clearTimeout(musicTimer.current);
    musicTimer.current = setTimeout(() => {
      musicTimer.current = null;
      if (stateRef.current !== "thinking" && stateRef.current !== "speaking" && !micOpenRef.current) playMusic();
    }, MUSIC_RESUME_MS);
  }, []);
  const setVoiceState = useCallback((value: VoiceState) => {
    const wasBusy = stateRef.current === "thinking" || stateRef.current === "speaking";
    stateRef.current = value;
    setState(value);
    if (value === "thinking" || value === "speaking") holdMusic();
    else if (wasBusy) releaseMusic();
  }, [holdMusic, releaseMusic]);
  // The send loop reads history through a ref so a reply can't race a stale copy.
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  // Read through a ref so a new handler doesn't rebuild the whole send loop.
  const localCommandRef = useRef(options.onLocalCommand);
  localCommandRef.current = options.onLocalCommand;
  const clientActionRef = useRef(options.onClientAction);
  clientActionRef.current = options.onClientAction;

  /**
   * The reply is revealed in step with the voice rather than dumped at once.
   * Word-boundary events are the accurate signal, but they don't fire in every
   * browser, so a paced timer runs underneath and boundaries pull the reveal
   * forward whenever they arrive — the text keeps flowing either way.
   */
  const CHARS_PER_SEC = 13; // ≈150 wpm, the default synthesis rate
  const revealTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealedRef = useRef(0);

  const stopReveal = useCallback(() => {
    if (revealTimer.current) clearInterval(revealTimer.current);
    revealTimer.current = null;
  }, []);

  const setRevealed = useCallback((n: number) => {
    revealedRef.current = n;
    setSpokenChars(n);
  }, []);

  const speak = useCallback(
    (text: string, onDone?: () => void) => {
      inputRef.current?.setMode(null);
      const generation = ++speechGenerationRef.current;
      stopReveal();
      setSpokenText(text);

      let finished = false;
      const finish = () => {
        if (finished || generation !== speechGenerationRef.current) return;
        finished = true;
        stopReveal();
        setRevealed(text.length);
        onDone?.();
      };

      if (!speakEnabled || !speechAvailable()) {
        finish();
        return;
      }

      setRevealed(0);

      // Captions begin with actual playback, never while TTS is loading.
      speakText(text, pickVoice(), {
        onStart: (hasAlignment) => {
          if (generation !== speechGenerationRef.current || hasAlignment) return;
          const tick = 60;
          revealTimer.current = setInterval(() => {
            const next = Math.min(revealedRef.current + (CHARS_PER_SEC * tick) / 1000, text.length);
            setRevealed(next);
            if (next >= text.length) stopReveal();
          }, tick);
        },
        onWarning: reason => {
          if (generation === speechGenerationRef.current) setError(reason);
        },
        onBoundary: (charIndex, charLength) => {
          if (generation !== speechGenerationRef.current) return;
          const end = charIndex + charLength;
          if (end > revealedRef.current) setRevealed(Math.min(end, text.length));
        },
        onEnd: finish,
        // Speech is a nicety; the text must survive any failure in it.
        onError: (reason) => {
          if (generation !== speechGenerationRef.current) return;
          finish();
          if (reason === "silent") {
            setError("No audio came out — check the tab isn't muted and your volume is up. The reply is above.");
          } else if (reason && reason !== "interrupted" && reason !== "canceled") {
            // A specific cause — a rejected key, a blocked autoplay — is worth
            // saying out loud instead of hiding behind a generic message.
            setError(`${reason} The reply is above.`);
          }
        },
      });
    },
    [speakEnabled, stopReveal, setRevealed]
  );

  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Another Sarah tab was used more recently, so it has the mic.
  const cededRef = useRef(false);
  /**
   * Whether this tab may listen. Sarah's own mic recording keeps working
   * while you're on another tab, so she still hears you. Only one Sarah tab
   * listens at a time, though (the one used last), so two don't answer at
   * once. The browser's built-in recognizer runs in one tab only, so with it
   * Sarah listens only while her tab is showing.
   */
  const mayListen = useCallback(() => {
    if (typeof document === "undefined" || document.visibilityState !== "hidden") return true;
    return inputRef.current instanceof CloudRecognition && !cededRef.current;
  }, []);
  /** In conversation mode, open the mic again. */
  const resumeListening = useCallback((delay: number) => {
    if (!conversationRef.current || !inputRef.current) return;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      resumeTimer.current = null;
      if (!mountedRef.current || !conversationRef.current || stateRef.current !== "idle") return;
      if (!mayListen()) return;
      setHeardText("");
      setVoiceState("listening");
      inputRef.current?.setMode("command");
    }, delay);
  }, [setVoiceState, mayListen]);

  /** A reply has finished; in conversation mode, hand the floor back to the user. */
  const afterReply = useCallback(() => {
    setVoiceState("idle");
    // A short gap so the mic doesn't catch the tail of Sarah's own voice.
    resumeListening(400);
  }, [setVoiceState, resumeListening]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || stateRef.current === "thinking") return;
      speechGenerationRef.current++;
      cancelSpeech();
      stopReveal();
      inputRef.current?.setMode(null);
      setVoiceState("thinking");
      setHeardText(trimmed);
      const next = [...messagesRef.current, { role: "user" as const, content: trimmed }];
      messagesRef.current = next;
      setMessages(next);
      setError(null);

      // Interface commands are answered here, not by the agent. They may be
      // async — opening the camera and looking through it takes a moment.
      let localReply: string | null | undefined;
      try {
        // Music on/off is answered at once, without a round trip to the agent.
        const music = musicCommand(trimmed);
        if (music === "off") { musicOff(); localReply = "Music off."; }
        else if (music === "on") { musicOn(); localReply = "Music on."; }
        else localReply = await localCommandRef.current?.(trimmed);
      } catch (err) {
        localReply = err instanceof Error ? err.message : "That didn't work.";
      }
      if (!mountedRef.current) return;
      if (localReply) {
        setMessages((m) => [...m, { role: "assistant", content: localReply }]);
        setVoiceState("speaking");
        speak(localReply, afterReply);
        return;
      }

      setVoiceState("thinking");

      // Only the request itself is guarded here. Rendering and speaking the
      // reply must not be able to masquerade as a network failure.
      let data: { reply?: string; error?: string; pendingActions?: PendingAction[]; clientActions?: ClientAction[] };
      try {
        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Where and when the user is, so "where am I" or "what's the weather" just work.
          body: JSON.stringify({ messages: next, context: await chatContext() }),
        });
        data = await res.json();
      } catch {
        if (!mountedRef.current) return;
        const message = "I couldn't reach the server. Is it running?";
        setMessages((m) => [...m, { role: "assistant", content: message }]);
        setError(message);
        afterReply();
        return;
      }

      if (!mountedRef.current) return;
      const reply: string = data.reply || data.error || "Something went wrong.";
      if (data.error) setError(data.error);

      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      if (Array.isArray(data.pendingActions) && data.pendingActions.length) {
        setPendingActions((prev) => [...(data.pendingActions ?? []), ...prev]);
      }

      // The agent asked the screen to do something (take a photo for Design):
      // do it now, then say how it went instead of the "on it" line.
      if (Array.isArray(data.clientActions) && data.clientActions.length) {
        const outcomes: string[] = [];
        for (const action of data.clientActions) {
          const handler = clientActionRef.current;
          let outcome: string | null = null;
          try {
            outcome = handler ? await handler(action) : "Pictures and the camera work on the deck — open the home screen and ask me there.";
          } catch (err) {
            outcome = err instanceof Error ? err.message : "That didn't work.";
          }
          if (!mountedRef.current) return;
          if (outcome) outcomes.push(outcome);
        }
        const said = outcomes.join(" ") || reply;
        setMessages((m) => [...m, { role: "assistant", content: said }]);
        setVoiceState("speaking");
        speak(said, afterReply);
        return;
      }

      setVoiceState("speaking");
      speak(reply, afterReply);
    },
    [speak, setVoiceState, stopReveal, afterReply]
  );

  sendRef.current = send;

  const stopListening = useCallback(() => {
    conversationRef.current = false;
    if (inputRef.current) inputRef.current.keepAlive = false;
    inputRef.current?.setMode(null);
    if (stateRef.current === "listening") setVoiceState("idle");
  }, [setVoiceState]);

  const startListening = useCallback(() => {
    if (!inputRef.current) {
      setError("Voice input isn't supported in this browser. Use Chrome or type in the chat.");
      return;
    }
    // Invalidate speech completion before canceling so it cannot reopen the mic.
    speechGenerationRef.current++;
    cancelSpeech(); stopReveal();
    conversationRef.current = true;
    inputRef.current.keepAlive = true;
    setError(null); setHeardText("");
    setVoiceState("listening");
    inputRef.current.setMode("command");
  }, [setVoiceState, stopReveal]);

  const stopSpeaking = useCallback(() => {
    speechGenerationRef.current++;
    cancelSpeech(); stopReveal();
    if (stateRef.current === "speaking") setVoiceState("idle");
  }, [stopReveal, setVoiceState]);

  const toggle = useCallback(() => {
    if (stateRef.current === "listening") { stopListening(); return; }
    if (stateRef.current === "thinking") return;
    startListening();
  }, [startListening, stopListening]);

  const refreshPending = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/confirm");
      const data = await res.json();
      if (Array.isArray(data.pendingActions)) setPendingActions(data.pendingActions);
    } catch {
      // best-effort; newly proposed actions still arrive with the chat reply
    }
  }, []);

  const respondToAction = useCallback(
    async (id: string, approve: boolean) => {
      setPendingActions((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: approve ? "approved" : "rejected" } : a))
      );
      try {
        const res = await fetch("/api/agent/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, approve }),
        });
        const data = await res.json();
        const action: PendingAction | undefined = data.action;
        if (!action) return;

        setPendingActions((prev) => prev.map((a) => (a.id === id ? action : a)));
        const summary =
          action.status === "executed"
            ? `Done — ${action.result}`
            : action.status === "failed"
            ? `That failed: ${action.result}`
            : "Okay, I won't do that.";
        setMessages((m) => [...m, { role: "assistant", content: summary }]);
        setVoiceState("speaking");
        speak(summary, afterReply);
      } catch {
        setMessages((m) => [...m, { role: "assistant", content: "Couldn't reach the server to confirm that." }]);
      }
    },
    [speak, afterReply]
  );

  // Chrome populates getVoices() asynchronously and returns an empty list on
  // the first call, so warm it up before the first reply needs a voice.
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.getVoices();
    const onVoices = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", onVoices);
    // A macOS voice is slow to say its first word while it loads. On the first
    // click (Chrome won't speak before one), say something muted to load it.
    const warm = () => {
      window.removeEventListener("pointerdown", warm);
      window.removeEventListener("keydown", warm);
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) return;
      const utter = new SpeechSynthesisUtterance("Hi.");
      const voice = pickVoice();
      if (voice) { utter.voice = voice; utter.lang = voice.lang; }
      utter.volume = 0;
      window.speechSynthesis.speak(utter);
    };
    window.addEventListener("pointerdown", warm);
    window.addEventListener("keydown", warm);
    return () => {
      window.speechSynthesis.removeEventListener?.("voiceschanged", onVoices);
      window.removeEventListener("pointerdown", warm);
      window.removeEventListener("keydown", warm);
    };
  }, []);

  // With autoListen the conversation opens on mount; otherwise the mic waits
  // for a press. Either way, pressing it off ends conversation mode.
  useEffect(() => {
    mountedRef.current = true;
    const Ctor = getRecognitionCtor();
    const callbacks = {
      status: (status: InputStatus) => {
        setInputStatus(status);
        micOpenRef.current = status !== "off";
        if (micOpenRef.current) holdMusic();
        else if (stateRef.current !== "thinking" && stateRef.current !== "speaking") releaseMusic();
        if (status === "off" && stateRef.current === "listening") setVoiceState("idle");
        if (status === "listening" && stateRef.current === "idle") setVoiceState("listening");
      },
      interim: (text: string) => {
        setHeardText(text);
        // Words arriving mean the user is talking; an empty result was noise.
        if (text) holdMusic();
        else if (stateRef.current !== "thinking" && stateRef.current !== "speaking") releaseMusic();
      },
      speech: holdMusic,
      // One lost turn: say so, keep listening.
      warning: (message: string) => setError(message),
      transcript: (text: string) => { void sendRef.current(text); },
      error: (message: string) => {
        // A blocked or broken mic must not be retried after every reply.
        conversationRef.current = false;
        if (inputRef.current) inputRef.current.keepAlive = false;
        setError(message); setVoiceState("idle");
      },
    };
    // Server transcription hears any language; the browser's hears only one.
    if (CloudRecognition.supported()) inputRef.current = new CloudRecognition(callbacks);
    else if (Ctor) inputRef.current = new VoiceRecognition(Ctor, callbacks);
    if (inputRef.current && conversationRef.current) {
      inputRef.current.keepAlive = true;
      resumeListening(0);
    }
    const releaseMic = () => {
      inputRef.current?.setMode(null);
      if (stateRef.current === "listening") setVoiceState("idle");
    };
    // The Sarah tab you look at takes the mic; the others let it go.
    let channel: BroadcastChannel | null = null;
    try { channel = new BroadcastChannel("sarah-mic"); } catch { /* old browser: one tab assumed */ }
    const claim = () => { cededRef.current = false; try { channel?.postMessage("claim"); } catch { /* closed */ } };
    if (channel) channel.onmessage = e => {
      if (e.data !== "claim" || document.visibilityState !== "hidden") return;
      cededRef.current = true;
      releaseMic();
    };
    if (typeof document !== "undefined" && document.visibilityState !== "hidden") claim();
    // Hidden: keep listening if this mic allows it, else hand it back. Shown: take it.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { if (!mayListen()) releaseMic(); }
      else { claim(); resumeListening(0); }
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mountedRef.current = false;
      channel?.close();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      speechGenerationRef.current++;
      inputRef.current?.dispose(); inputRef.current = null;
      // Never leave the music paused behind a view that has gone.
      if (musicTimer.current) { clearTimeout(musicTimer.current); musicTimer.current = null; }
      playMusic();
      stopReveal(); cancelSpeech();
    };
  }, [stopReveal, setVoiceState, resumeListening, holdMusic, releaseMusic]);

  return {
    messages,
    setMessages,
    state,
    error,
    pendingActions,
    send,
    toggle,
    startListening,
    stopListening,
    refreshPending,
    respondToAction,
    inputStatus,
    /** Conversation mode is on: the mic reopens after each reply unless pressed off. */
    handsFree: conversationRef.current,
    heardText,
    stopSpeaking,
    /** How far the voice has got through the reply, in characters. */
    spokenChars: Math.floor(spokenChars),
    /** The reply as far as it has been spoken — grows in step with the voice. */
    spokenSoFar: spokenText.slice(0, Math.floor(spokenChars)),
    /** True while there is still more of the reply left to voice. */
    stillSpeaking: spokenChars < spokenText.length,
    supported: speechSupported(),
  };
}
