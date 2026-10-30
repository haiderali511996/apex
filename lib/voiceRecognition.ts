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

// Keep old wake names working for people who have already learned them.
const NAMES = "nova|no va|novah|imex|imax|i max|eemex|emex|apex";
const WAKE = new RegExp(`^\\s*(?:(?:hello|hey|hi|ok|okay)[\\s,!.:;-]+)?(?:${NAMES})(?=$|[\\s,!.?:;-])[\\s,!.?:;-]*`, "i");
export function matchWake(text: string): string | null {
  const match = text.match(WAKE);
  return match ? text.slice(match[0].length).trim() : null;
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow the microphone for this site, then press the mic button.",
  "service-not-allowed": "Speech recognition is blocked by the browser. Allow speech recognition, then press the mic button.",
  "audio-capture": "No microphone audio is available. Select your input device in the browser or Mac sound settings, then press the mic button.",
  network: "The browser's speech recognition service could not connect. Check your connection, then press the mic button to retry.",
  "language-not-supported": "The browser cannot recognize English with its current speech settings. Check its speech language, then retry.",
};

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

  constructor(private Ctor: RecognitionCtor, private callbacks: {
    status(status: InputStatus): void;
    interim(text: string): void;
    transcript(text: string): void;
    error(message: string): void;
  }) {}

  setMode(mode: InputMode | null) {
    if (this.disposed) return;
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
    recognition.lang = "en-US";
    let lastFinal = -1;
    let failureReported = false;
    this.callbacks.status("starting");
    recognition.onstart = () => {
      if (this.active === recognition && !this.stopping) this.callbacks.status(mode === "wake" ? "wake" : "listening");
    };
    recognition.onresult = event => {
      if (this.active !== recognition || this.stopping || this.disposed) return;
      for (let i = Math.max(event.resultIndex ?? 0, lastFinal + 1); i < event.results.length; i++) {
        const result = event.results[i], text = result?.[0]?.transcript?.trim() || "";
        if (!text) continue;
        this.callbacks.interim(text);
        // Never send a partial "Hey Nova" while the user is still adding a request.
        if (!result.isFinal) continue;
        lastFinal = i;
        const command = mode === "wake" ? matchWake(text) : matchWake(text) ?? text;
        if (command === null) continue;
        if (!command) { this.setMode("command"); continue; }
        this.setMode(null);
        this.callbacks.transcript(command);
        return;
      }
    };
    recognition.onerror = event => {
      if (this.active !== recognition || this.disposed || this.stopping) return;
      if (event.error === "aborted") return;
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
      if (!this.stopping && !this.disposed && !failureReported) {
        this.callbacks.error("The browser ended microphone listening. Press the mic button to try again.");
      }
      // Natural endings never restart capture. Only an explicit mode change may start again.
      if (!this.stopping) this.wanted = null;
      this.active = null; this.mode = null; this.stopping = false;
      if (this.disposed) return;
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
    if (this.active) {
      this.active.onstart = this.active.onresult = this.active.onerror = null;
      // Retain only onend to release the lease; it does not update unmounted UI.
      this.active.abort();
    }
  }
}
