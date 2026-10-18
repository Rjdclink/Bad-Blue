// Isolated real LegalProviderMesh timing fixture: no network, credentials or user records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync('server/lexara/LegalProviderMesh.ts','utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const lanes = [];
let stallDdgs = false;
const ddgsTimeouts = [];
const wait = (ms, signal) => new Promise((resolve,reject) => {
  const timer = setTimeout(resolve,ms);
  signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('cancelled'));},{once:true});
});
async function mockFetch(url, options) {
  const requestUrl = String(url);
  if (requestUrl.includes('api.duckduckgo.com')) {
    return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),
      json:async()=>({AbstractURL:'',RelatedTopics:[]})};
  }
  if (requestUrl.includes(':14479/search/text')) {
    lanes.push('ddgs');
    if (stallDdgs) {
      const started = Date.now();
      try { await wait(9_000, options?.signal); }
      catch (error) { ddgsTimeouts.push(Date.now() - started); throw error; }
      throw new Error('Stalled DDGS unexpectedly returned');
    }
    // A federal directory is not the Iowa traffic law publisher.
    return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),
      json:async()=>({results:[{href:'https://www.justice.gov/jmd/ls/state/iowa',
        title:'Generic government directory',body:'Directory with no controlling statute text'}]})};
  }
  if (requestUrl.includes(':18080/search')) {
    lanes.push('searxng');
    if (stallDdgs) return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>({results:[],unresponsive_engines:[]})};
    await wait(650,options?.signal);
    return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),
      json:async()=>({results:[{url:'https://www.legis.iowa.gov/docs/code/321.261.pdf',
        title:'Iowa Code 321.261',content:'Official legislative statute lead'}],
        unresponsive_engines:[]})};
  }
  if (requestUrl.includes(':17000/mega/search')) {
    lanes.push('openserp');
    await wait(1700,options?.signal);
    return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),
      json:async()=>({results:[],meta:{}})};
  }
  throw new Error('Unexpected network request: '+requestUrl);
}
const stubs = {
  './TavilyBudget':{TavilyBudget:class {}},
  './DiscoveryDiagnostics':{
    discoveryFetch:(_lane,url,options)=>mockFetch(url,options),
    discoverySignal:signal=>signal,
    beginDiscoveryAttempt:()=>{const record=()=>{};record.dispatch=()=>{};return record;},
    getDiscoveryDiagnostics:()=>null,
    markDiscoveryPartial:()=>{},
    discoveryErrorType:error=>error?.name==='TimeoutError'?'timeout':null,
  },
  './LexaraPublicSourceRegistry':{
    buildLexaraSourceQueries:input=>[input.query],
    getLexaraPublicSources:()=>[],
    getLexaraSourceQueryHints:()=>[],
  },
  './LexaraDiscoveryLearning':{
    getLexaraLearnedQueryPatterns:async()=>[],
    getLexaraLearnedSources:async()=>[],
    rankLexaraDiscoveryUrls:items=>items,
  },
  './LexaraResearchAssist':{planLexaraResearchQueries:async()=>({queries:[],providers:[]})},
};
const moduleStub={exports:{}};
const localRequire=id=>{
  assert(id in stubs,'unexpected dependency '+id);
  return stubs[id];
};
vm.runInNewContext('(function(require,module,exports){'+compiled+'\n})',
  {console,process:{env:{LEXARA_EMBEDDED_SEARCH:'true'}},fetch:mockFetch,
    setTimeout,clearTimeout,URL,URLSearchParams,AbortController,DOMException,Headers})(
  localRequire,moduleStub,moduleStub.exports);

(async()=>{
  const start=Date.now();
  const results=await moduleStub.exports.discoverLegalMeshTier3(
    'Iowa leaving the scene of an accident statutes',
    undefined,{firstUseful:true,strictLegalSource:true,
      queryAlreadyPlanned:true,jurisdiction:'Iowa',allowPaidSearch:false});
  const elapsed=Date.now()-start;
  assert(lanes.includes('ddgs')&&lanes.includes('searxng')&&lanes.includes('openserp'),
    'start all three independent embedded engines');
  assert(results.some(item=>item.url.includes('legis.iowa.gov')),
    'generic first government lead must not cancel later legislative authority');
  assert(elapsed>=600 && elapsed<1450,'must wait for actual authority, but not slow unrelated engines');
  console.log('PASS: all 3 engines started; later Iowa legislature result retained');
  console.log('PASS: legal search returned in '+elapsed+'ms, before slow OpenSERP');
  stallDdgs = true;
  for (let i=0;i<2;i++) {
    await moduleStub.exports.discoverLegalMeshTier3('Iowa statute evidence unavailable test '+i,
      undefined,{firstUseful:true,strictLegalSource:true,queryAlreadyPlanned:true,
        jurisdiction:'Iowa',allowPaidSearch:false});
  }
  assert.equal(ddgsTimeouts.length,6,'three independent DDGS backends are checked on each of two searches');
  assert(ddgsTimeouts.slice(0,3).every(ms=>ms>=2000&&ms<2600),
    'each initially healthy DDGS backend retains normal search coverage');
  assert(ddgsTimeouts.slice(3).every(ms=>ms>=1200&&ms<1900),
    'each previously failed backend receives a shorter recovery deadline');
  console.log('PASS: one failed DDGS attempt shortens only the next recovery deadline');
})().catch(error=>{console.error(error);process.exitCode=1;});
