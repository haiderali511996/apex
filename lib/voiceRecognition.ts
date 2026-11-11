export type InputMode = "wake" | "command";
export type InputStatus = "off" | "starting" | "wake" | "listening";
export type RecognitionResult = { 0: { transcript: string }; isFinal?: boolean };
export type RecognitionEvent = { resultIndex?: number; results: ArrayLike<RecognitionResult> };
export type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
export type RecognitionCtor = new () => Recognition;

export function getRecognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const browser = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return browser.SpeechRecognition || browser.webkitSpeechRecognition;
}

/**
 * The language the browser listens for, one per session. en-IN suits someone
 * switching between English and Urdu: Chrome hears both and writes the Urdu
 * in English letters (Roman Urdu). ur-PK writes everything in Urdu script.
 */
export const SPEECH_LANG = (() => {
  // Next inlines the value at build time; the guard is for plain Node and tests.
  try { return process.env.NEXT_PUBLIC_SPEECH_LANG?.trim() || "en-US"; } catch { return "en-US"; }
})();

// The Urdu spellings are what Chrome writes for "Sarah" when listening in Urdu.
const SARAH = "sarah|sara|serah|sera|sarra|سارہ|سارا|سارة|سارھ|سرہ";
const GREETINGS = "hello|hey|hi|ok|okay|ہیلو|ہائے|ہے|اوکے";
// Urdu writes its comma, full stop and question mark differently.
const SEP = "\\s,!.?:;،۔؟-";
const wakeFor = (names: string) => new RegExp(`^\\s*(?:(?:${GREETINGS})[${SEP}]+)?(?:${names})(?=$|[${SEP}])[${SEP}]*`, "i");
let WAKE = wakeFor(SARAH);

/** The wake word follows the name the user gave their assistant ("Hey Adam"). */
export function setWakeName(name: string) {
  const own = name.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  WAKE = wakeFor(own === "sarah" || !own ? SARAH : own);
}
export function matchWake(text: string): string | null {
  const match = text.match(WAKE);
  return match ? text.slice(match[0].length).trim() : null;
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow the microphone for this site, then press the mic button.",
  "service-not-allowed": "Speech recognition is blocked by the browser. Allow speech recognition, then press the mic button.",
  "audio-capture": "No microphone audio is available. Select your input device in the browser or Mac sound settings, then press the mic button.",
  network: "The browser's speech recognition service could not connect. Check your connection, then press the mic button to retry.",
  "language-not-supported": `The browser cannot recognize ${SPEECH_LANG} speech. Change NEXT_PUBLIC_SPEECH_LANG in .env.local, then restart.`,
};

/**
 * How long the user must be quiet before what they said is sent. The browser
 * marks a phrase "final" after even a short breath, so finals are collected
 * and only sent once this much silence has passed since the last word.
 */
export const END_OF_TURN_MS = 4000;

// Navigation and React's development remount can briefly leave an old hook
// stopping while a new hook mounts. The microphone lease spans both hooks.
let microphoneOwner: VoiceRecognition | null = null;

/** Own exactly one recognizer; switching modes waits for its end event. */
export class VoiceRecognition {
  private active: Recognition | null = null;
  private mode: InputMode | null = null;
  private wanted: InputMode | null = null;
  private stopping = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private quickEnds = 0;
  // The turn being spoken: finished phrases so far, the phrase still forming,
  // and the countdown that sends them once the user goes quiet.
  private phrases: string[] = [];
  private forming = "";
  private silence: ReturnType<typeof setTimeout> | null = null;
  /** Conversation mode: silence and the browser's own session cutoffs reopen the mic. */
  keepAlive = false;

  constructor(private Ctor: RecognitionCtor, private callbacks: {
    status(status: InputStatus): void;
    interim(text: string): void;
    transcript(text: string): void;
    error(message: string): void;
  }) {}

  setMode(mode: InputMode | null) {
    if (this.disposed) return;
    // A stop or a mode switch drops a half-spoken turn rather than sending it.
    this.clearTurn();
    this.wanted = mode;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.active) {
      if (mode !== this.mode && !this.stopping) {
        this.stopping = true;
        this.callbacks.status(mode ? "starting" : "off");
        // abort discards late results from a session the user has stopped.
        this.active.abort();
      }
      return;
    }
    if (mode) this.timer = setTimeout(() => { this.timer = null; this.start(); }, 0);
    else this.callbacks.status("off");
  }

  private clearTurn() {
    if (this.silence) { clearTimeout(this.silence); this.silence = null; }
    this.phrases = []; this.forming = "";
  }

  /** The user has been quiet long enough (or the session ended): send the whole turn. */
  private endTurn(mode = this.wanted) {
    if (this.silence) { clearTimeout(this.silence); this.silence = null; }
    const text = [...this.phrases, this.forming].join(" ").replace(/\s+/g, " ").trim();
    this.phrases = []; this.forming = "";
    if (!text || !mode || this.disposed) return;
    const command = mode === "wake" ? matchWake(text) : matchWake(text) ?? text;
    // Without the wake phrase there is nothing to act on; keep listening.
    if (command === null) return;
    // A bare "Hey Sarah" opens direct listening for the request that follows.
    if (!command) { this.setMode("command"); return; }
    this.setMode(null);
    this.callbacks.transcript(command);
  }

  private start() {
    if (this.disposed || !this.wanted || this.active) return;
    if (microphoneOwner && microphoneOwner !== this) {
      this.timer = setTimeout(() => { this.timer = null; this.start(); }, 50);
      return;
    }
    const mode = this.wanted, recognition = new this.Ctor();
    this.active = recognition; this.mode = mode; this.stopping = false;
    microphoneOwner = this;
    // Keep one browser session open through initial silence and pauses.
    // This does not enable automatic follow-up listening: we still stop
    // explicitly after receiving a complete command or a manual stop.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = SPEECH_LANG;
    let lastFinal = -1;
    let failureReported = false;
    let startedAt = Date.now(), heard = false;
    this.callbacks.status("starting");
    recognition.onstart = () => {
      startedAt = Date.now();
      if (this.active === recognition && !this.stopping) this.callbacks.status(mode === "wake" ? "wake" : "listening");
    };
    recognition.onresult = event => {
      if (this.active !== recognition || this.stopping || this.disposed) return;
      let forming = "";
      for (let i = Math.max(event.resultIndex ?? 0, lastFinal + 1); i < event.results.length; i++) {
        const result = event.results[i], text = result?.[0]?.transcript?.trim() || "";
        if (!text) continue;
        heard = true;
        if (result.isFinal) { lastFinal = i; this.phrases.push(text); }
        else forming += (forming ? " " : "") + text;
      }
      this.forming = forming;
      const sofar = [...this.phrases, forming].join(" ").trim();
      if (!sofar) return;
      this.callbacks.interim(sofar);
      // Every word restarts the countdown: a pause to think doesn't end the turn.
      if (this.silence) clearTimeout(this.silence);
      this.silence = setTimeout(() => this.endTurn(), END_OF_TURN_MS);
    };
    recognition.onerror = event => {
      if (this.active !== recognition || this.disposed || this.stopping) return;
      if (event.error === "aborted") return;
      // Waiting quietly for the user is normal in a conversation; onend reopens.
      if (event.error === "no-speech" && this.keepAlive) return;
      failureReported = true;
      this.wanted = null;
      this.callbacks.status("off");
      this.callbacks.error(event.error === "no-speech"
        ? "The browser stopped listening because it detected no speech. Check your microphone input, then press the mic button to retry."
        : ERROR_MESSAGES[event.error || ""] || "Speech recognition stopped. Press the mic button to try again.");
    };
    recognition.onend = () => {
      if (this.active !== recognition) return;
      if (microphoneOwner === this) microphoneOwner = null;
      // A session that keeps dying instantly is a broken mic, not a pause; don't spin.
      this.quickEnds = !heard && Date.now() - startedAt < 1000 ? this.quickEnds + 1 : 0;
      const reopen = this.keepAlive && !failureReported && this.quickEnds < 3;
      if (!this.stopping && !this.disposed && !failureReported && !reopen) {
        // Chrome runs one recognizer at a time; another tab starting one ends ours at once.
        this.callbacks.error(this.quickEnds >= 3
          ? "Another tab or app keeps taking the microphone. Close other Sarah tabs, then press the mic button."
          : "The browser ended microphone listening. Press the mic button to try again.");
      }
      // A session that ends for good mid-turn still delivers what was said.
      const finishTurn = !this.stopping && !reopen && !failureReported && (this.phrases.length > 0 || !!this.forming);
      const turnMode = this.wanted;
      // Outside conversation mode, natural endings never restart capture.
      if (!this.stopping && !reopen) this.wanted = null;
      this.active = null; this.mode = null; this.stopping = false;
      if (this.disposed) return;
      if (finishTurn) this.endTurn(turnMode);
      if (this.wanted) {
        this.callbacks.status("starting");
        this.timer = setTimeout(() => { this.timer = null; this.start(); }, 300);
      } else this.callbacks.status("off");
    };
    try { recognition.start(); } catch {
      if (microphoneOwner === this) microphoneOwner = null;
      this.active = null; this.mode = null; this.wanted = null;
      this.callbacks.status("off");
      this.callbacks.error("Speech recognition could not start. Press the mic button to retry.");
    }
  }

  dispose() {
    this.disposed = true; this.wanted = null;
    if (this.timer) clearTimeout(this.timer);
    this.clearTurn();
    if (this.active) {
      this.active.onstart = this.active.onresult = this.active.onerror = null;
      // Retain only onend to release the lease; it does not update unmounted UI.
      this.active.abort();
    }
  }
}
