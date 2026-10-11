const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(process.env.LEXARA_TTS_TEST_SOURCE || path.join(__dirname, '../server/lexara/LexaraTTSMesh.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(env, fetchImpl) {
  env = { LEXARA_TTS_ACTIVE_PROVIDERS: 'deepgram,gemini,mistral,groq,azure,xai,elevenlabs', ...env };
  const exports = {};
  const calls = [];
  const context = vm.createContext({ exports, Buffer, Response, ReadableStream, AbortController, Date,
    process: { env }, require: name => { assert.equal(name, '../logger'); return { createLogger: () => ({ info(){}, warn(){}, debug(){} }) }; },
    fetch: async (url, init) => { calls.push({ url, init }); return fetchImpl(url, init); },
    // Preserve order and concurrency while keeping timeout regressions quick.
    setTimeout: (fn, ms) => setTimeout(fn, ms === 650 ? 15 : Math.min(ms, 150)), clearTimeout, setInterval, clearInterval,
  });
  vm.runInContext(compiled, context);
  return { api: exports, calls };
}
const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json'}});
const mp3 = () => new Response(Buffer.from('ID3-audio-fixture'), {headers:{'content-type':'audio/mpeg'}});
const state = (api, provider) => api.getLexaraTTSReadiness().providers.find(p => p.provider === provider);

test('OpenRouter never becomes a configured or called voice route', async () => {
  const {api,calls}=load({OPENROUTER_API_KEY:'fixture'}, () => {throw new Error('must not call');});
  await api.refreshLexaraTTSReadiness();
  assert.equal(api.getConfiguredLexaraTTSProviders().length,0); assert.equal(calls.length,0);
});
// Alternate vendor adapters are retained in the module but production routing is
// intentionally Deepgram-only. Verify that policy and the active failure paths.
test('alternate keys and an active-provider override cannot enable disabled vendors', async () => {
  const h = load({ MISTRAL_API_KEY: 'fixture', GROQ_API_KEY: 'fixture', GEMINI_API_KEY: 'fixture', XAI_API_KEY: 'fixture', ELEVENLABS_API_KEY: 'fixture', ELEVENLABS_VOICE_ID: 'fixture', AZURE_SPEECH_KEY: 'fixture', AZURE_SPEECH_REGION: 'fixture' }, () => { throw new Error('disabled vendor called'); });
  await h.api.refreshLexaraTTSReadiness();
  assert.equal(h.calls.length, 0);
  assert.equal(h.api.getConfiguredLexaraTTSProviders().length, 0);
  await assert.rejects(h.api.synthesizeLexaraSpeechWithFailover('Hello'), /No verified healthy/);
  assert.equal(await h.api.openLexaraSpeechStream('Hello'), null);
});
test('healthy Deepgram preserves buffered bytes and the whole message', async () => {
  const {api,calls}=load({DEEPGRAM_API_KEY:'fixture'},()=>mp3());
  await api.refreshLexaraTTSReadiness(); calls.length=0;
  const text='An entire legal answer with every word retained. '.repeat(11).trim();
  const audio=await api.synthesizeLexaraSpeechWithFailover(text);
  assert.equal(audio.provider,'deepgram'); assert.equal(audio.mimeType,'audio/mpeg');
  assert.equal(audio.audioData.toString(),'ID3-audio-fixture');
  assert.equal(calls.length,1); assert.equal(JSON.parse(calls[0].init.body).text,text);
  assert.match(calls[0].url,/v2\/speak\?model=flux-haley-en/);
});
test('a healthy Deepgram stream makes one request and preserves audio', async () => {
  const {api,calls}=load({DEEPGRAM_API_KEY:'fixture',MISTRAL_API_KEY:'fixture'},()=>mp3());
  await api.refreshLexaraTTSReadiness(); calls.length=0;
  const stream=await api.openLexaraSpeechStream('Hello'); assert.equal(stream.provider,'deepgram');
  assert.equal(Buffer.from(await new Response(stream.body).arrayBuffer()).toString(),'ID3-audio-fixture');
  assert.equal(calls.length,1);
});
test('permission, rate-limit and transport failures leave readiness honestly degraded', async () => {
  for(const [status,expected] of [[403,'permission_blocked'],[429,'rate_limited'],[503,'transport_failed']]) {
    const {api}=load({DEEPGRAM_API_KEY:'fixture'},()=>json({error:'fixture'},status));
    await api.refreshLexaraTTSReadiness();
    assert.equal(state(api,'deepgram').healthy,false); assert.equal(state(api,'deepgram').lastFailure,expected);
    await assert.rejects(api.synthesizeLexaraSpeechWithFailover('Hello'),/No verified healthy/);
  }
});
test('network failures cool down and empty audio cannot establish readiness', async () => {
  for(const fetch of [()=>{throw new Error('network unavailable');},()=>new Response(Buffer.alloc(0),{headers:{'content-type':'audio/mpeg'}})]) {
    const {api}=load({DEEPGRAM_API_KEY:'fixture'},fetch);
    await api.refreshLexaraTTSReadiness();
    assert.equal(state(api,'deepgram').healthy,false); assert.notEqual(state(api,'deepgram').state,'probing');
    assert.ok(state(api,'deepgram').cooldownUntil>Date.now());
  }
});
test('stalled audio bodies time out instead of hanging readiness', async () => {
  const {api}=load({DEEPGRAM_API_KEY:'fixture'},()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'audio/mpeg'}}));
  await Promise.race([api.refreshLexaraTTSReadiness(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('readiness hung')),700))]);
  assert.equal(state(api,'deepgram').state,'transport_failed');
});
test('headers without audio cannot win streaming or extend readiness', async () => {
  let stall=false;
  const {api}=load({DEEPGRAM_API_KEY:'fixture'},()=>stall?new Response(new ReadableStream({start(){}}),{headers:{'content-type':'audio/mpeg'}}):mp3());
  await api.refreshLexaraTTSReadiness(); const successes=state(api,'deepgram').successes; stall=true;
  assert.equal(await api.openLexaraSpeechStream('Hello'),null);
  assert.equal(state(api,'deepgram').successes,successes); assert.equal(state(api,'deepgram').healthy,false);
});
test('a runtime failure cannot fall back to a disabled vendor', async () => {
  let failing=false;
  const {api,calls}=load({DEEPGRAM_API_KEY:'fixture',MISTRAL_API_KEY:'fixture'},()=>failing?json({error:'temporarily down'},503):mp3());
  await api.refreshLexaraTTSReadiness(); calls.length=0; failing=true;
  await assert.rejects(api.synthesizeLexaraSpeechWithFailover('Hello'),/routes failed/);
  assert.equal(state(api,'deepgram').healthy,false);
  assert(calls.every(c=>c.url.includes('api.deepgram.com')));
});
test('legacy Deepgram key alias still uses the sole configured provider', async () => {
  const {api,calls}=load({DEEPGRAM:'fixture'},()=>mp3());
  await api.refreshLexaraTTSReadiness();
  assert.equal(JSON.stringify(api.getConfiguredLexaraTTSProviders()),JSON.stringify(['deepgram']));
  assert.equal(calls[0].init.headers.Authorization,'Token fixture');
});
test('blank speech cannot make provider calls', async () => {
  const {api,calls}=load({DEEPGRAM_API_KEY:'fixture'},()=>mp3());
  await assert.rejects(api.synthesizeLexaraSpeechWithFailover('  '),/Text is required/);
  assert.equal(await api.openLexaraSpeechStream('  '),null); assert.equal(calls.length,0);
});
test('production default uses healthy Deepgram without probing disabled provider keys', async () => {
  const h = load({ DEEPGRAM_API_KEY: 'fixture', MISTRAL_API_KEY: 'fixture', GROQ_API_KEY: 'fixture', GEMINI_API_KEY: 'fixture', ELEVENLABS_API_KEY: 'fixture', ELEVENLABS_VOICE_ID: 'fixture', LEXARA_TTS_ACTIVE_PROVIDERS: '' }, async url => {
    assert.match(String(url), /api.deepgram.com/); return mp3();
  });
  await h.api.refreshLexaraTTSReadiness();
  const readiness = h.api.getLexaraTTSReadiness();
  assert.equal(JSON.stringify(readiness.configuredProviders), JSON.stringify(['deepgram']));
  assert.equal(readiness.voiceStatus, 'live'); assert.equal(readiness.degraded, false);
  assert.equal(readiness.redundancyVerified, false); assert.equal(h.calls.length, 1);
});
