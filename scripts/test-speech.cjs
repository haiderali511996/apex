const ts = require('typescript');
const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
function load(file, globals) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(js, { exports, Buffer, AbortSignal, console, ...globals });
  return exports;
}
(async () => {
  const speech = load('lib/agent/geminiSpeech.ts', {
    process: { env: { GEMINI_API_KEY: 'test' } },
    fetch: async (_, options) => {
      const request = JSON.parse(options.body);
      assert.equal(request.generationConfig.responseModalities[0], 'AUDIO');
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.alloc(48000).toString('base64'), mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] }) };
    },
  });
  const result = await speech.generateGeminiSpeech('Sound check');
  const wav = Buffer.from(result.audioBase64, 'base64');
  assert.equal(result.mimeType, 'audio/wav');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(40), 48000);
  assert.equal(wav.length, 48044);
  let element;
  const timers = new Map(); let id = 0;
  const motion = load("lib/speechMotion.ts", {});
  const alignment = { characters: ['a', ' ', 'm', 'o'], character_start_times_seconds: [0, .2, .4, .6], character_end_times_seconds: [.18, .38, .58, .8] };
  assert(motion.sampleSpeechMotion('a mo', .1, alignment).open > .7, 'vowels open the lips');
  assert.equal(motion.sampleSpeechMotion('a mo', .3, alignment).open, 0, 'pauses close the lips');
  assert(motion.sampleSpeechMotion('a mo', .5, alignment).open < .05, 'bilabial sounds close the lips');
  assert(motion.sampleSpeechMotion('a mo', .7, alignment).round > .8, 'O rounds the lips');
  motion.updateSpeechMotion('a', .1, alignment);
  assert(motion.readSpeechMotion().active);
  motion.resetSpeechMotion();
  assert.equal(motion.readSpeechMotion().open, 0);

  const client = load('lib/neuralVoice.ts', {
    AbortController, Blob, atob, Uint8Array,
    require: name => { if (name === "./speechMotion") return motion; throw Error(name); },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
    Audio: class { constructor() { element = this; } play() { return Promise.resolve(); } pause() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ audioBase64: 'AAAA', mimeType: 'audio/wav', alignment: null }) }),
    setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: n => timers.delete(n),
    cancelAnimationFrame: () => {}, requestAnimationFrame: () => 1,
  });
  const canceled = client.speakNeural('Hello', {});
  await new Promise(resolve => setImmediate(resolve));
  assert(element);
  client.cancelNeuralSpeech();
  assert.equal(await canceled, true, 'cancellation must settle without triggering fallback speech');
  const stalled = client.speakNeural('Hello', {});
  await new Promise(resolve => setImmediate(resolve));
  [...timers.values()].forEach(fn => fn());
  assert.equal(await stalled, false, 'stalled audio must fall back instead of hanging');
  // A canceled request can finish parsing after a new reply has started.
  // It must never create an audio element for the stale reply.
  let resolvePayload;
  let created = 0;
  const racingClient = load('lib/neuralVoice.ts', {
    AbortController, Blob, atob, Uint8Array,
    require: () => motion,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
    Audio: class { constructor() { created++; } play() { return Promise.resolve(); } pause() {} },
    fetch: async () => ({ ok: true, status: 200, json: () => new Promise(resolve => { resolvePayload = resolve; }) }),
    setTimeout, clearTimeout, cancelAnimationFrame: () => {}, requestAnimationFrame: () => 1,
  });
  const obsolete = racingClient.speakNeural('Old reply', {});
  await new Promise(resolve => setImmediate(resolve));
  racingClient.cancelNeuralSpeech();
  resolvePayload({ audioBase64: 'AAAA', mimeType: 'audio/wav', alignment: null });
  assert.equal(await obsolete, true);
  assert.equal(created, 0, 'a canceled response must never start late playback');
  console.log('PASS: Gemini speech request, WAV encoding, cancellation, stalled playback timeout, timed mouth shapes');
})().catch(error => { console.error(error); process.exit(1); });
