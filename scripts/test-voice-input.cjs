const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('fs');
const vm = require('vm');
const exportsObject = {}, timers = new Map(); let timerId = 0;
const js = ts.transpileModule(fs.readFileSync('lib/voiceRecognition.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
vm.runInNewContext(js, { exports: exportsObject, setTimeout: fn => {timers.set(++timerId, fn);return timerId;}, clearTimeout: id => timers.delete(id) });
const { VoiceRecognition, matchWake } = exportsObject;
const drain = () => { const callbacks=[...timers.values()];timers.clear();callbacks.forEach(fn=>fn()); };
let active = null, instances = [], maxActive = 0;
class Recognition {
  constructor(){instances.push(this);}
  start(){assert.equal(active,null,'recognizers must never overlap');active=this;maxActive++;this.onstart?.();}
  abort(){this.aborting=true;}
  end(){if(active===this)active=null;this.onend?.();}
  result(text,isFinal=true,index=0,previous=[]){this.onresult?.({resultIndex:index,results:[...previous,{0:{transcript:text},isFinal}]});}
}
const transcripts=[], statuses=[], errors=[], interim=[];
const input = new VoiceRecognition(Recognition, {transcript:t=>transcripts.push(t),status:s=>statuses.push(s),error:e=>errors.push(e),interim:t=>interim.push(t)});
assert.equal(matchWake('Hey, Nova, show your face.'),'show your face.');
assert.equal(matchWake('Nova tell me about my accounts'),'tell me about my accounts');
assert.equal(matchWake('Hey Novah'),'');
assert.equal(matchWake('Hey Imex, hello'),'hello');
assert.equal(matchWake('innovation is useful'),null);
input.setMode('wake');drain();const wake=active;
assert.equal(wake.continuous,true,'keep one session open through initial silence and pauses');
assert.equal(wake.aborting,undefined,'opening the microphone must not immediately abort capture');
wake.result('Hey Nova',false);assert.equal(transcripts.length,0,'partial wake words must not cut off the following instruction');assert.equal(wake.aborting,undefined);
wake.result('Hey Nova show your face');assert.deepEqual(transcripts,['show your face']);assert(wake.aborting);
wake.result('Hey Nova show your face');assert.equal(transcripts.length,1,'late result is ignored');
// Request direct listening while the old session is still stopping.
input.setMode('command');assert.equal(instances.length,1,'wait for old onend before starting another recognizer');wake.end();drain();assert.equal(instances.length,2);
const command=active;command.result('turn on the',false);assert.equal(transcripts.length,1);assert.equal(interim.at(-1),'turn on the');command.result('turn on the camera');assert.equal(transcripts.at(-1),'turn on the camera');command.end();
input.setMode('wake');drain();const wakeOnly=active;wakeOnly.result('Hello Nova');assert.equal(transcripts.length,2,'a bare wake phrase opens direct listening without a chat request');wakeOnly.end();drain();const followup=active;followup.result('do this next');followup.end();
input.setMode('command');drain();const silent=active;silent.onerror({error:'no-speech'});silent.end();drain();assert.equal(active,null,'silence must close the microphone without restarting');
assert.match(errors.at(-1),/detected no speech/,'report why the browser ended capture instead of silently closing');
assert.equal(timers.size,0,'silence must not schedule another microphone session');
input.setMode('command');drain();const ended=active;ended.end();drain();assert.equal(active,null,'a completed direct session must wait for another mic press');
input.setMode('command');drain();const network=active;network.onerror({error:'network'});network.end();drain();assert.equal(active,null);assert.match(errors.at(-1),/recognition service could not connect/);assert.equal(statuses.at(-1),'off');
input.setMode('wake');drain();const endedWake=active;endedWake.end();drain();assert.equal(active,null,'natural wake session ending must not reopen the mic');
input.setMode('command');drain();const denied=active;denied.onerror({error:'not-allowed'});denied.end();drain();assert.match(errors.at(-1),/Microphone access is blocked/);assert.equal(active,null,'permission failures must not restart in a loop');
input.setMode('wake');drain();const stopped=active;input.setMode(null);stopped.result('Hey Nova ignore this');stopped.end();drain();assert.equal(transcripts.length,3,'manual stop discards late commands');assert.equal(active,null);
input.setMode('command');drain();const disposed=active;input.dispose();assert(disposed.aborting);assert.equal(disposed.onresult,null);assert.equal(typeof disposed.onend,'function');assert.equal(timers.size,0);
const nextInput=new VoiceRecognition(Recognition,{transcript:()=>{},status:()=>{},error:()=>{},interim:()=>{}});nextInput.setMode('command');drain();assert.equal(active,disposed,'newly mounted hook waits for old microphone session to end');disposed.end();drain();assert.notEqual(active,disposed);const nextActive=active;nextInput.dispose();nextActive.end();assert.equal(timers.size,0);
console.log('PASS: Nova wake matching, whole-utterance commands, exclusive mic handoff, follow-up listening, permission/network errors, stop and cleanup');
