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
const listeners = {};
const document = {
  visibilityState: 'visible',
  addEventListener: (type, fn) => { listeners[type] = fn; },
  removeEventListener: type => { delete listeners[type]; },
};
const globals = {
  document,
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
const music = [];
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
  if (name === './cloudRecognition') return { CloudRecognition: { supported: () => false } };
  if (name === './userLocation') return { chatContext: async () => ({}) };
  if (name === './backgroundMusic') return { pauseMusic: () => music.push('pause'), playMusic: () => music.push('play'), musicCommand: () => null, musicOn() {}, musicOff() {} };
  throw Error(name);
}, { window, fetch: async () => ({ json: async () => ({ reply: 'Hello.' }) }) });
let hookOptions = {};
function render() {
  do {
    dirty = false; cursor = 0;
    voice = useApexVoice(hookOptions);
    const pending = effects; effects = []; pending.forEach(fn => fn());
  } while (dirty);
}
function drainTimers() {
  const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); render();
}
async function settle() { await new Promise(resolve => setImmediate(resolve)); render(); }
function unmount() { slots.forEach(slot => slot?.cleanup?.()); slots = []; effects = []; timers.clear(); }
(async () => {
  // Conversation mode (the default): Sarah listens, replies, and listens again.
  render(); drainTimers(); drainTimers();
  assert.equal(starts, 1, 'mount opens the mic in conversation mode');
  assert.equal(voice.inputStatus, 'listening');
  assert.equal(voice.state, 'listening');
  assert.equal(active.continuous, true);
  active.result('Hel', false);
  active.result('Hello'); drainTimers(); await settle();
  assert.equal(voice.state, 'speaking');
  assert.equal(voice.inputStatus, 'off', 'the mic is closed while Sarah speaks so it cannot hear itself');
  speechHandlers.onStart(); render(); speechHandlers.onEnd(); render(); drainTimers(); drainTimers();
  assert.equal(starts, 2, 'reply completion reopens the mic');
  assert.equal(voice.state, 'listening');
  active.onerror({ error: 'no-speech' }); active.onend(); render(); drainTimers();
  assert.equal(starts, 3, 'silence quietly reopens the mic');
  assert.equal(voice.error, null, 'silence is not reported as a failure in conversation mode');
  active.onend(); render(); drainTimers(); active.onend(); render(); drainTimers();
  assert.equal(starts, 4, 'a mic that keeps dying instantly stops retrying');
  assert.equal(voice.inputStatus, 'off');
  assert.match(voice.error, /Another tab or app/, 'say why the mic keeps closing');
  voice.toggle(); render(); drainTimers();
  assert.equal(starts, 5, 'pressing the mic resumes the conversation');
  document.visibilityState = 'hidden'; listeners.visibilitychange(); render(); drainTimers();
  assert.equal(voice.inputStatus, 'off', 'a hidden tab gives up the mic so other tabs can use it');
  speechHandlers = null;
  document.visibilityState = 'visible'; listeners.visibilitychange(); render(); drainTimers(); drainTimers();
  assert.equal(starts, 6, 'returning to the tab reopens the mic');
  voice.toggle(); render(); drainTimers();
  assert.equal(voice.inputStatus, 'off', 'pressing it again stops listening');
  await voice.send('Typed message'); render(); speechHandlers.onEnd(); render(); drainTimers(); drainTimers();
  assert.equal(starts, 6, 'after a manual stop, replies do not reopen the mic');
  voice.toggle(); render(); drainTimers();
  active.onerror({ error: 'not-allowed' }); active.onend(); render(); drainTimers();
  assert.equal(starts, 7, 'permission failures must not restart in a loop');
  assert.match(voice.error, /Microphone access is blocked/);
  unmount();

  // autoListen: false (the text chat): the mic waits for a press.
  hookOptions = { autoListen: false }; starts = 0;
  render(); drainTimers();
  assert.equal(starts, 0, 'mount must not open the mic without autoListen');
  voice.toggle(); render(); voice.toggle(); render(); drainTimers();
  assert.equal(starts, 0, 'cancel during startup must prevent mic capture');
  await voice.send('Typed message'); render(); speechHandlers.onEnd(); render(); drainTimers(); drainTimers();
  assert.equal(starts, 0, 'typed messages must not open the mic');
  unmount();
  assert.ok(music.includes('pause') && music.lastIndexOf('play') > music.lastIndexOf('pause'), 'music pauses for the exchange and returns after it: ' + music.join(','));
console.log('PASS: conversation mode opens on mount, reopens after replies and silence, yields the mic in hidden tabs, stops on press or failure; autoListen:false stays off');
})().catch(error => { console.error(error); process.exitCode = 1; });
