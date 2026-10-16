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
    // A federal directory is not the Iowa traffic law publisher.
    return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),
      json:async()=>({results:[{href:'https://www.justice.gov/jmd/ls/state/iowa',
        title:'Generic government directory',body:'Directory with no controlling statute text'}]})};
  }
  if (requestUrl.includes(':18080/search')) {
    lanes.push('searxng');
    await wait(160,options?.signal);
    return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),
      json:async()=>({results:[{url:'https://www.legis.iowa.gov/docs/code/321.261.pdf',
        title:'Iowa Code 321.261',content:'Official legislative statute lead'}],
        unresponsive_engines:[]})};
  }
  if (requestUrl.includes(':17000/mega/search')) {
    lanes.push('openserp');
    await wait(950,options?.signal);
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
    discoveryErrorType:()=>null,
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
  assert(elapsed<900,'return before slow engine completes');
  console.log('PASS: all 3 engines started; later Iowa legislature result retained');
  console.log('PASS: legal search returned in '+elapsed+'ms, before slow OpenSERP');
})().catch(error=>{console.error(error);process.exitCode=1;});
