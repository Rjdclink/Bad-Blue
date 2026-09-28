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
const mistralAudio = () => json({ audio_data: Buffer.from('ID3-audio-fixture').toString('base64') });
const state = (api, provider) => api.getLexaraTTSReadiness().providers.find(p => p.provider === provider);
function wav(samples = Buffer.from([1,0,2,0]), rate=24000) {
  const b = Buffer.alloc(44); b.write('RIFF'); b.writeUInt32LE(36+samples.length,4); b.write('WAVEfmt ',8);
  b.writeUInt32LE(16,16); b.writeUInt16LE(1,20); b.writeUInt16LE(1,22); b.writeUInt32LE(rate,24);
  b.writeUInt32LE(rate*2,28); b.writeUInt16LE(2,32); b.writeUInt16LE(16,34); b.write('data',36); b.writeUInt32LE(samples.length,40);
  return Buffer.concat([b,samples]);
}
const wavResponse = (rate) => new Response(wav(undefined, rate), {headers:{'content-type':'audio/wav'}});
function abortedFetch(signal) { return new Promise((_, reject) => { const abort = () => reject(signal.reason || new Error('aborted')); if(signal.aborted) abort(); else signal.addEventListener('abort', abort, {once:true}); }); }

test('OpenRouter never becomes a configured or called voice route', async () => {
  const {api,calls}=load({OPENROUTER_API_KEY:'fixture'}, () => {throw new Error('must not call');});
  await api.refreshLexaraTTSReadiness();
  assert.equal(api.getConfiguredLexaraTTSProviders().length,0); assert.equal(calls.length,0);
});
test('Mistral preserves catalog identity when voice detail metadata is sparse and probes MP3', async () => {
  const {api,calls}=load({MISTRAL_API_KEY:'fixture'}, url => url.includes('?') ? json({items:[{id:'jane',name:'Jane'}]}) : url.endsWith('/jane') ? json({id:'jane',gender:null,languages:['en']}) : mistralAudio());
  await api.refreshLexaraTTSReadiness();
  assert.equal(state(api,'mistral').healthy,true);
  const speech=calls.find(c=>c.url.endsWith('/speech'));
  assert.equal(JSON.parse(speech.init.body).response_format,'mp3');
  const audio=await api.synthesizeLexaraSpeechWithFailover('Hello.');
  assert.equal(audio.mimeType,'audio/mpeg'); assert.equal(audio.audioData.toString(),'ID3-audio-fixture');
});
test('Mistral uses verified catalog metadata without unnecessary detail calls', async () => {
  const {api,calls}=load({MISTRAL_API_KEY:'fixture'}, url => url.includes('?') ? json({items:[{id:'voice-1',gender:'female',languages:['en']}]}) : url.endsWith('/speech') ? mistralAudio() : json({error:'detail temporarily unavailable'},503));
  await api.refreshLexaraTTSReadiness(); assert.equal(state(api,'mistral').healthy,true);
  assert.equal(calls.filter(c=>c.url.includes('/voices/')).length,0);
});
test('Mistral does not overwrite permission or temporary failures as missing voice configuration', async () => {
  for (const [status,expected] of [[403,'permission_blocked'],[503,'transport_failed'],[429,'rate_limited']]) {
    const {api}=load({MISTRAL_API_KEY:'fixture',MISTRAL_TTS_VOICE_ID:'jane'},()=>json({error:'fixture'},status));
    await api.refreshLexaraTTSReadiness(); assert.equal(state(api,'mistral').lastFailure,expected);
  }
});
test('Mistral refuses a conflicting male or non-English voice despite its name', async () => {
  for(const details of [{gender:'male',languages:['en']},{gender:'female',languages:['fr']}]){
    const {api,calls}=load({MISTRAL_API_KEY:'fixture',MISTRAL_TTS_VOICE_ID:'jane'},()=>json({id:'jane',name:'Jane',...details}));
    await api.refreshLexaraTTSReadiness(); assert.equal(state(api,'mistral').healthy,false);
    assert.equal(calls.some(c=>c.url.endsWith('/speech')),false);
  }
});
test('network and malformed-response probes leave probing state and cool down', async () => {
  for(const fetch of [()=>{throw new Error('network unavailable');},()=>new Response('{bad json')]){
    const {api}=load({MISTRAL_API_KEY:'fixture'},fetch);
    await api.refreshLexaraTTSReadiness(); assert.notEqual(state(api,'mistral').state,'probing');
    assert.ok(state(api,'mistral').cooldownUntil>Date.now());
  }
});
test('Groq permission denial remains honest while Deepgram stays healthy', async () => {
  const {api}=load({GROQ_API_KEY:'fixture',DEEPGRAM_API_KEY:'fixture'},url=>url.includes('groq')?json({error:{code:'model_terms_required'}},403):mp3());
  await api.refreshLexaraTTSReadiness(); assert.equal(state(api,'groq').state,'permission_blocked');
  assert.equal(state(api,'deepgram').healthy,true);
  assert.equal((await api.synthesizeLexaraSpeechWithFailover('Hello')).provider,'deepgram');
});
test('Groq speaks the whole long message using valid 200-character requests and one usable WAV', async () => {
  const {api,calls}=load({GROQ_API_KEY:'fixture'},()=>wavResponse());
  await api.refreshLexaraTTSReadiness(); calls.length=0;
  const input='An entire legal answer with every word retained. '.repeat(11).trim();
  const audio=await api.synthesizeLexaraSpeechWithFailover(input);
  const chunks=calls.map(c=>JSON.parse(c.init.body).input);
  assert.ok(chunks.length>1); assert.ok(chunks.every(s=>s.length<=200));
  assert.equal(chunks.join(''),input); assert.equal(audio.mimeType,'audio/wav');
  assert.equal(audio.audioData.readUInt32LE(4),audio.audioData.length-8);
  assert.equal(audio.audioData.readUInt32LE(40),chunks.length*4);
});
test('Groq rejects incompatible WAV chunks instead of creating corrupt audio', async () => {
  let n=0; const {api}=load({GROQ_API_KEY:'fixture'},()=>wavResponse(++n>2?16000:24000));
  await api.refreshLexaraTTSReadiness();
  await assert.rejects(api.synthesizeLexaraSpeechWithFailover('Full legal explanation. '.repeat(20)),/format|sample|compatible/i);
});
test('a stalled response body times out instead of hanging readiness forever', async () => {
  const {api}=load({GROQ_API_KEY:'fixture'},()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'audio/wav'}}));
  await Promise.race([api.refreshLexaraTTSReadiness(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('readiness hung')),700))]);
  assert.equal(state(api,'groq').state,'transport_failed');
});
test('a healthy fast Deepgram stream does not start a redundant request', async () => {
  const {api,calls}=load({DEEPGRAM_API_KEY:'fixture',MISTRAL_API_KEY:'fixture'},url=>url.includes('deepgram')?mp3():url.includes('/voices?')?json({items:[{id:'jane',name:'Jane',gender:'female',languages:['en']}]}):url.includes('/voices/')?json({id:'jane',name:'Jane',gender:'female',languages:['en']}):mistralAudio());
  await api.refreshLexaraTTSReadiness(); calls.length=0;
  const stream=await api.openLexaraSpeechStream('Hello'); assert.equal(stream.provider,'deepgram');
  await new Response(stream.body).arrayBuffer(); await new Promise(r=>setTimeout(r,25));
  assert.equal(calls.length,1);
});
test('Mistral wins a delayed voice hedge without quarantining intentionally cancelled Deepgram', async () => {
  let slow=false;
  const {api}=load({DEEPGRAM_API_KEY:'fixture',MISTRAL_API_KEY:'fixture'},(url,init)=>url.includes('deepgram')?(slow?abortedFetch(init.signal):mp3()):url.includes('/voices?')?json({items:[{id:'jane',name:'Jane',gender:'female',languages:['en']}]}):url.includes('/voices/')?json({id:'jane',name:'Jane',gender:'female',languages:['en']}):mistralAudio());
  await api.refreshLexaraTTSReadiness(); slow=true;
  const stream=await api.openLexaraSpeechStream('Hello'); assert.equal(stream?.provider,'mistral');
  await new Response(stream.body).arrayBuffer(); await new Promise(r=>setTimeout(r,0));
  assert.equal(state(api,'deepgram').healthy,true); assert.equal(state(api,'deepgram').failures,0);
});
test('Groq is an independent buffered hedge when the primary is slow', async () => {
  let slow=false;
  const {api}=load({DEEPGRAM_API_KEY:'fixture',GROQ_API_KEY:'fixture'},(url,init)=>url.includes('groq')?wavResponse():(slow?abortedFetch(init.signal):mp3()));
  await api.refreshLexaraTTSReadiness(); slow=true;
  assert.equal((await api.synthesizeLexaraSpeechWithFailover('Hello')).provider,'groq');
  await new Promise(r=>setTimeout(r,0)); assert.equal(state(api,'deepgram').healthy,true);
});
test('failure of the first two routes still reaches the next ready route', async () => {
  let failing=false;
  const {api}=load({DEEPGRAM_API_KEY:'fixture',MISTRAL_API_KEY:'fixture',XAI_API_KEY:'fixture'},url=>url.includes('/voices?')?json({items:[{id:'jane',name:'Jane',gender:'female',languages:['en']}]}):url.includes('/voices/')?json({id:'jane',name:'Jane',gender:'female',languages:['en']}):url.includes('x.ai')?mp3():failing?json({error:'temporarily down'},503):url.includes('mistral')?mistralAudio():mp3());
  await api.refreshLexaraTTSReadiness(); failing=true;
  const stream=await api.openLexaraSpeechStream('Hello'); assert.equal(stream?.provider,'xai');
  await new Response(stream.body).arrayBuffer();
});

test('headers without audio cannot win the voice race or extend provider readiness', async () => {
  let stall=false;
  const {api}=load({DEEPGRAM_API_KEY:'fixture',MISTRAL_API_KEY:'fixture'},url=>url.includes('deepgram')?(stall?new Response(new ReadableStream({start(){}}),{headers:{'content-type':'audio/mpeg'}}):mp3()):url.includes('/voices?')?json({items:[{id:'jane',gender:'female',languages:['en']}]}):mistralAudio());
  await api.refreshLexaraTTSReadiness(); const successes=state(api,'deepgram').successes; stall=true;
  const stream=await api.openLexaraSpeechStream('Hello'); assert.equal(stream.provider,'mistral');
  await new Response(stream.body).arrayBuffer(); await new Promise(r=>setTimeout(r,0));
  assert.equal(state(api,'deepgram').successes,successes); assert.equal(state(api,'deepgram').failures,0);
});
test('Groq short audio stays byte-for-byte intact and empty audio data is rejected', async () => {
  const fixture=wav(); const {api}=load({GROQ_API_KEY:'fixture'},()=>new Response(fixture,{headers:{'content-type':'audio/wav'}}));
  await api.refreshLexaraTTSReadiness(); assert.deepEqual((await api.synthesizeLexaraSpeechWithFailover('Hello')).audioData,fixture);
  const broken=load({GROQ_API_KEY:'fixture'},()=>new Response(wav(Buffer.alloc(0))));
  await broken.api.refreshLexaraTTSReadiness(); assert.equal(state(broken.api,'groq').healthy,false);
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
