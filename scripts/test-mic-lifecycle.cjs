const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the hook together with its real recognition controller. Effects
// rerun on dependency changes, as they do when the UI changes voice state.
let slots = [], cursor = 0, effects = [], dirty = false, voice;
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const React = {
  useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
  useState(value) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = value;
    return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; dirty = true; }];
  },
  useCallback(fn, deps) {
    const i = cursor++;
    if (!same(slots[i]?.deps, deps)) slots[i] = { fn, deps };
    return slots[i].fn;
  },
  useEffect(fn, deps) {
    const i = cursor++;
    if (!same(slots[i]?.deps, deps)) effects.push(() => {
      slots[i]?.cleanup?.();
      slots[i] = { deps, cleanup: fn() };
    });
  },
};
let timers = new Map(), timerId = 0, starts = 0, active, speechHandlers;
const globals = {
  console, process,
  setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
  clearTimeout: id => timers.delete(id),
  setInterval: fn => { timers.set(++timerId, fn); return timerId; },
  clearInterval: id => timers.delete(id),
};
function load(path, require, extra = {}) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(js, { exports, require, ...globals, ...extra });
  return exports;
}
class Recognition {
  start() { starts++; active = this; this.onstart?.(); }
  abort() { this.onend?.(); }
  result(text, isFinal = true) { this.onresult?.({ results: [{ 0: { transcript: text }, isFinal }] }); }
}
const window = { webkitSpeechRecognition: Recognition };
const recognition = load('lib/voiceRecognition.ts', () => {}, { window });
const speech = {
  speechAvailable: () => true,
  cancelSpeech: () => {},
  speakText: (_, __, handlers) => { speechHandlers = handlers; },
};
const { useApexVoice } = load('lib/useApexVoice.ts', name => {
  if (name === 'react') return React;
  if (name === './speech') return speech;
  if (name === './voiceRecognition') return recognition;
  throw Error(name);
}, { window, fetch: async () => ({ json: async () => ({ reply: 'Hello.' }) }) });
function render() {
  do {
    dirty = false; cursor = 0;
    voice = useApexVoice();
    const pending = effects; effects = []; pending.forEach(fn => fn());
  } while (dirty);
}
function drainTimers() {
  const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); render();
}
async function settle() { await new Promise(resolve => setImmediate(resolve)); render(); }
(async () => {
  render(); drainTimers();
  assert.equal(starts, 0, 'mount must never open the mic');
  voice.toggle(); render(); drainTimers();
  assert.equal(starts, 1);
  assert.equal(voice.inputStatus, 'listening');
  assert.equal(active.continuous, true, 'one click must allow continuous capture before the command is ready');
  drainTimers(); drainTimers();
  assert.equal(voice.inputStatus, 'listening', 'waiting to speak must not trigger an app timer to stop the mic');
  active.result('Hel', false);
  active.result('Hello'); await settle();
  assert.equal(voice.state, 'speaking');
  assert.equal(voice.inputStatus, 'off');
  speechHandlers.onStart(); render(); speechHandlers.onEnd(); render(); drainTimers();
  assert.equal(voice.state, 'idle');
  assert.equal(starts, 1, 'reply completion must not reopen the mic');
  voice.toggle(); render(); drainTimers();
  active.onerror({ error: 'no-speech' }); active.onend(); render(); drainTimers();
  assert.equal(starts, 2, 'silence must not restart recognition');
  assert.equal(voice.inputStatus, 'off');
  voice.toggle(); render(); voice.toggle(); render(); drainTimers();
  assert.equal(starts, 2, 'cancel during startup must prevent mic capture');
  await voice.send('Typed message'); render(); speechHandlers.onEnd(); render(); drainTimers();
  assert.equal(starts, 2, 'typed messages must not open the mic');
  slots.forEach(slot => slot?.cleanup?.());
  console.log('PASS: hook lifecycle stays off on mount, after replies, silence, startup cancellation, and typed messages');
})().catch(error => { console.error(error); process.exitCode = 1; });
