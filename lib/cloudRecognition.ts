import { resumeOnGesture, forgetContext } from "./audioUnlock";
import { matchWake, type InputMode, type InputStatus } from "./voiceRecognition";

/**
 * Microphone input transcribed on the server, so any language — or a mix of
 * them in one sentence — is understood. The browser's SpeechRecognition only
 * hears the one language it was started with.
 *
 * It listens for the voice locally (a level meter, no network), keeps a short
 * pre-roll so the first syllable isn't clipped, and once the speaker pauses
 * sends that turn to /api/agent/transcribe. Same surface as VoiceRecognition,
 * so the voice hook drives either one.
 */

type Callbacks = {
  status(status: InputStatus): void;
  interim(text: string): void;
  transcript(text: string): void;
  /** The mic can't be used; it is now off. */
  error(message: string): void;
  /** Something went wrong with one turn; the mic stays on. */
  warning?(message: string): void;
  /** The voice was detected: someone has started talking. */
  speech?(): void;
  /** In barge mode: the user has started talking over Sarah. */
  bargeIn?(): void;
  /** In barge mode: that turned out to be nothing (noise, too faint, no words). */
  bargeOff?(): void;
};

/**
 * "barge" listens while Sarah is thinking or speaking, so the user can cut in.
 * It needs a clearer, closer voice to open a turn, so her own voice leaking
 * past echo cancellation doesn't interrupt her.
 */
export type CloudMode = InputMode | "barge";

const RATE = 16000;
/** Quiet this long after speaking ends the turn; short pauses to think don't. */
const END_SILENCE_MS = 650;
/** Audio kept from just before the voice was detected. */
const PRE_ROLL_MS = 400;
/** Sustained voice needed to count as speech rather than a click or a cough. */
const START_MS = 180;
/** Talking over Sarah: voice this long stops her. */
const BARGE_START_MS = 240;
/** Talking over Sarah needs this share of the user's usual level. */
const BARGE_SHARE = 0.6;
/** A turn with less voice than this is noise and isn't sent. */
const MIN_VOICE_MS = 450;
const MAX_TURN_MS = 45_000;
/**
 * Only the person at the microphone counts. Their voice, close to the mic, is
 * far louder than people talking nearby (twice the distance is about a
 * quarter of the level), so the level of turns that turned out to be real
 * requests is learned per device, and a turn much quieter than that is
 * someone else's conversation and isn't sent.
 */
const LEVEL_KEY = "sarah.voiceLevel";
/** A turn's voice must reach this share of the user's usual level. */
const NEAR_SHARE = 0.45;
/** Speech starts only above this share, so distant chatter doesn't open a turn. */
const START_SHARE = 0.3;
/** Turns heard before the level is trusted. */
const LEARN_TURNS = 2;

type AudioCtor = typeof AudioContext;

export class CloudRecognition {
  static supported(): boolean {
    let engine = "";
    // Next inlines the value at build time; the guard is for plain Node and tests.
    try { engine = process.env.NEXT_PUBLIC_SPEECH_ENGINE?.trim() || ""; } catch { return false; }
    if (engine !== "gemini" || typeof window === "undefined") return false;
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    return !!navigator.mediaDevices?.getUserMedia && !!(w.AudioContext || w.webkitAudioContext);
  }

  /** Conversation mode: keep the mic open between turns instead of releasing it. */
  keepAlive = false;
  private mode: CloudMode | null = null;
  private disposed = false;
  // Bumped on every mode change, so a transcription for a turn the user has
  // since abandoned is dropped instead of sent.
  private generation = 0;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private opening: Promise<boolean> | null = null;

  // The turn being spoken.
  private preRoll: Int16Array[] = [];
  private chunks: Int16Array[] = [];
  private speaking = false;
  private voicedRun = 0;
  private voicedTotal = 0;
  private silentRun = 0;
  private turnMs = 0;
  private noise = 0.004;
  private sending = false;
  private levelSum = 0;
  private peak = 0;
  // The user's own voice level at this device, and how many turns it's from.
  private userLevel = 0;
  private userTurns = 0;
  private dropped = 0;

  constructor(private callbacks: Callbacks) {
    try {
      const saved = JSON.parse(localStorage.getItem(LEVEL_KEY) || "null") as { level?: number; turns?: number } | null;
      if (saved && typeof saved.level === "number" && saved.level > 0) { this.userLevel = saved.level; this.userTurns = saved.turns ?? LEARN_TURNS; }
    } catch { /* storage blocked: learn again this session */ }
  }

  private get learned() { return this.userTurns >= LEARN_TURNS && this.userLevel > 0; }

  /** A turn that was a real request: its level is the user's voice. */
  private learnLevel(level: number) {
    if (!(level > 0)) return;
    this.userLevel = this.userTurns ? this.userLevel * 0.7 + level * 0.3 : level;
    this.userTurns++;
    this.dropped = 0;
    try { localStorage.setItem(LEVEL_KEY, JSON.stringify({ level: this.userLevel, turns: this.userTurns })); } catch { /* fine */ }
  }

  setMode(mode: CloudMode | null) {
    if (this.disposed) return;
    if (mode === "barge" && this.mode === "barge") return;
    // Sarah finished while the user was already talking over her: keep their turn.
    if (this.mode === "barge" && mode === "command" && (this.speaking || this.sending)) { this.mode = mode; return; }
    this.generation++;
    this.mode = mode;
    this.resetTurn();
    this.sending = false;
    if (!mode) {
      if (!this.keepAlive) this.close();
      this.callbacks.status("off");
      return;
    }
    this.callbacks.status("starting");
    const generation = this.generation;
    void this.open().then(ok => {
      if (!ok || this.disposed || generation !== this.generation) return;
      this.callbacks.status(mode === "wake" ? "wake" : "listening");
    });
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    this.mode = null;
    this.close();
  }

  private resetTurn() {
    this.preRoll = []; this.chunks = [];
    this.speaking = false;
    this.voicedRun = this.voicedTotal = this.silentRun = this.turnMs = 0;
    this.levelSum = this.peak = 0;
  }

  private open(): Promise<boolean> {
    if (this.processor) return Promise.resolve(true);
    this.opening ??= this.start().finally(() => { this.opening = null; });
    return this.opening;
  }

  private async start(): Promise<boolean> {
    let stream: MediaStream;
    try {
      // Echo cancellation keeps Sarah's own voice out of the next turn.
      // Automatic gain is off: it boosts faint voices across the room up to the
      // level of the person at the mic, and that difference is how they're told apart.
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 } });
    } catch (err) {
      this.fail((err as Error)?.name === "NotAllowedError"
        ? "Microphone access is blocked. Allow the microphone for this site, then press the mic button."
        : "No microphone audio is available. Select your input device in the browser or Mac sound settings, then press the mic button.");
      return false;
    }
    if (this.disposed) { stream.getTracks().forEach(t => t.stop()); return false; }
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const ctx = new (w.AudioContext || w.webkitAudioContext)!();
    const source = ctx.createMediaStreamSource(stream);
    // Small blocks, so the start and end of speech are noticed within ~40 ms.
    const processor = ctx.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = event => this.onAudio(event.inputBuffer.getChannelData(0), ctx.sampleRate);
    source.connect(processor);
    // A processor only runs while connected; it outputs silence.
    processor.connect(ctx.destination);
    this.stream = stream; this.ctx = ctx; this.processor = processor;
    // Opened before any click, the audio clock starts suspended; the first
    // interaction with the page starts it.
    // Phones also suspend it when the screen locks or a call comes in, so it
    // stays registered: any later tap starts it again.
    resumeOnGesture(ctx);
    return true;
  }

  private close() {
    if (this.ctx) forgetContext(this.ctx);
    if (this.processor) { this.processor.onaudioprocess = null; this.processor.disconnect(); }
    this.stream?.getTracks().forEach(t => t.stop());
    void this.ctx?.close().catch(() => {});
    this.processor = null; this.stream = null; this.ctx = null;
  }

  private fail(message: string) {
    this.mode = null;
    this.generation++;
    this.close();
    this.callbacks.status("off");
    this.callbacks.error(message);
  }

  private skipTurn(message: string) {
    this.sending = false;
    if (this.mode === "barge") this.callbacks.bargeOff?.();
    this.callbacks.interim("");
    this.callbacks.warning?.(message);
  }

  private onAudio(input: Float32Array, sampleRate: number) {
    if (!this.mode || this.sending || this.disposed) return;
    const pcm = downsample(input, sampleRate);
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const level = Math.sqrt(sum / input.length);
    const ms = (input.length / sampleRate) * 1000;
    // Voice is well above the room's own level, which is tracked while quiet.
    const floor = Math.max(0.008, this.noise * 3);
    const loud = level > floor;
    // A turn opens only for a voice near the user's own level.
    const barge = this.mode === "barge";
    const near = level > Math.max(floor, barge
      ? (this.learned ? this.userLevel * BARGE_SHARE : floor * 2.5)
      : (this.learned ? this.userLevel * START_SHARE : 0));
    if (!this.speaking && !loud) this.noise = Math.max(0.002, this.noise * 0.95 + level * 0.05);

    if (loud && (this.speaking || near)) { this.voicedRun += ms; this.silentRun = 0; } else { this.voicedRun = 0; if (this.speaking) this.silentRun += ms; }

    if (!this.speaking) {
      this.preRoll.push(pcm);
      while (this.preRoll.length > 1 && this.preRoll.length * ms > PRE_ROLL_MS) this.preRoll.shift();
      if (this.voicedRun < (barge ? BARGE_START_MS : START_MS)) return;
      this.speaking = true;
      this.callbacks.speech?.();
      if (barge) this.callbacks.bargeIn?.();
      this.chunks = this.preRoll; this.preRoll = [];
      this.turnMs = this.chunks.length * ms;
      this.voicedTotal = this.voicedRun;
      this.levelSum = level * this.voicedRun;
      this.peak = level;
      return;
    }
    this.chunks.push(pcm);
    this.turnMs += ms;
    if (loud) { this.voicedTotal += ms; this.levelSum += level * ms; this.peak = Math.max(this.peak, level); }
    if (this.silentRun >= END_SILENCE_MS || this.turnMs >= MAX_TURN_MS) this.endTurn();
  }

  private endTurn() {
    const chunks = this.chunks, voiced = this.voicedTotal;
    const level = voiced ? this.levelSum / voiced : 0;
    this.resetTurn();
    const nothing = () => { if (this.mode === "barge") this.callbacks.bargeOff?.(); };
    if (voiced < MIN_VOICE_MS) return nothing();
    if (this.learned && level < this.userLevel * NEAR_SHARE) {
      nothing();
      // Someone further away. If several turns in a row fall short but are
      // still fairly close, the user has probably moved back from the mic.
      if (level >= this.userLevel * START_SHARE && ++this.dropped >= 4) { this.userLevel *= 0.8; this.dropped = 0; }
      return;
    }
    const length = chunks.reduce((n, c) => n + c.length, 0);
    const pcm = new Int16Array(length);
    let at = 0;
    for (const c of chunks) { pcm.set(c, at); at += c.length; }
    void this.transcribe(pcm, level);
  }

  private async transcribe(pcm: Int16Array, level: number) {
    const generation = this.generation, mode = this.mode;
    this.sending = true;
    this.callbacks.interim("…");
    let text = "";
    try {
      const res = await fetch("/api/agent/transcribe", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: pcm.buffer as ArrayBuffer });
      const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (generation !== this.generation || this.disposed) return;
      if (!res.ok) {
        const message = body.error || `Transcription failed (HTTP ${res.status}).`;
        // A missing or rejected key won't fix itself: stop. A network blip or
        // a busy quota is one lost turn, and the mic keeps listening.
        if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 503) this.fail(message);
        else this.skipTurn(`${message} Say that again.`);
        return;
      }
      text = (body.text || "").trim();
    } catch {
      if (generation !== this.generation || this.disposed) return;
      this.skipTurn("Couldn't reach the server to transcribe. Say that again.");
      return;
    }
    this.sending = false;
    if (!text || !mode) { this.callbacks.interim(""); if (mode === "barge") this.callbacks.bargeOff?.(); return; }
    const command = mode === "wake" ? matchWake(text) : matchWake(text) ?? text;
    // Without the wake phrase there is nothing to act on; keep listening.
    if (command === null) { this.callbacks.interim(""); return; }
    // Said to Sarah, so this is the user's voice level.
    this.learnLevel(level);
    this.callbacks.interim(text);
    // A bare "Hey Sarah" opens direct listening for the request that follows.
    // Said over Sarah, it stops her and she listens (an empty transcript).
    if (!command) {
      if (mode === "barge") { this.setMode(null); this.callbacks.transcript(""); return; }
      this.setMode("command"); return;
    }
    this.setMode(null);
    this.callbacks.transcript(command);
  }
}

/** Float samples at the device rate to 16 kHz 16-bit, averaging each step. */
function downsample(input: Float32Array, sampleRate: number): Int16Array {
  const ratio = sampleRate / RATE;
  const out = new Int16Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const from = Math.floor(i * ratio), to = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += input[j];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, to - from)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}
