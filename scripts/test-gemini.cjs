const ts = require(process.cwd() + '/node_modules/typescript');
const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
function load(file, env, dependencies, fetch) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(js, { exports, require: n => { if (!(n in dependencies)) throw Error(n); return dependencies[n]; }, process: { env }, fetch, AbortSignal, console });
  return exports;
}
(async () => {
  let requests = [];
  let responses = [
    { candidates: [{ content: { role: 'model', parts: [{ thoughtSignature: 'keep-me', functionCall: { name: 'propose_email', args: { to: 'test@example.com' } } }] } }] },
    { candidates: [{ content: { role: 'model', parts: [{ text: 'Draft ready for approval.' }] } }] },
  ];
  const transport = load('lib/agent/gemini.ts', { GEMINI_API_KEY: 'test' }, {}, async (url, opts) => {
    assert.equal(new URL(url).hostname, 'generativelanguage.googleapis.com');
    requests.push(JSON.parse(opts.body));
    return { ok: true, json: async () => responses.shift() };
  });
  const action = { id: 'draft-1', status: 'pending' };
  const agent = load('lib/agent/geminiAgent.ts', {}, {
    './gemini': transport,
    './tools': { toolDefinitions: [{ name: 'propose_email', input_schema: { type: 'object' } }], executeTool: async () => ({ text: 'Queued', pendingAction: action }) },
  });
  const result = await agent.runViaGemini([{ role: 'user', content: 'Draft an email' }], 'Be helpful');
  assert.equal(result.reply, 'Draft ready for approval.');
  assert.equal(result.pendingActions[0].status, 'pending');
  assert.equal(requests[1].contents[1].parts[0].thoughtSignature, 'keep-me');
  assert.equal(requests[1].contents[2].parts[0].functionResponse.response.result, 'Queued');
  const missing = load('lib/agent/gemini.ts', {}, {}, () => { throw Error('Must not call network'); });
  await assert.rejects(missing.generateGemini('x', []), e => e.status === 503);
  const quota = load('lib/agent/gemini.ts', { GEMINI_API_KEY: 'test' }, {}, async () => ({ ok: false, status: 429 }));
  await assert.rejects(quota.generateGemini('x', []), e => e.status === 429 && /no paid fallback/.test(e.message));
  responses = [{ candidates: [{ content: { role: 'model', parts: [{ text: 'Hello' }] } }] }];
  const specialist = load('lib/agent/specialist.ts', {}, {
    './gemini': transport, './roles': { SPECIALISTS: { editor: { name: 'Editor', brief: 'Edit copy' } } },
    './anthropicClient': { anthropicClient: () => { throw Error('Paid API called'); }, MODEL: 'unused' },
  });
  assert.equal(await specialist.askSpecialist('editor', 'Hi'), 'Hello');
  console.log('PASS: tool loop, draft approval, thought signatures, missing key, quota handling, specialist avoids Anthropic');
})().catch(e => { console.error(e); process.exit(1); });
