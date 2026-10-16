// Behavioral fixtures: real routing, research gate and conversation orchestration.
// No live model, network, database or private conversation data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const FakeTimers = require('@sinonjs/fake-timers');
const { getEventListeners } = require('node:events');
const root = path.resolve(__dirname, '..');
const url = 'https://www.legis.iowa.gov/docs/code/562A.12.pdf';
const doc = { title: 'Synthetic Iowa authority fixture', url, kind: 'primary', evidenceLevel: 'document', excerpt: 'Synthetic legal text for ordering tests, not a statement of Iowa law.', provider: 'fixture' };
const packet = sources => ({sources, summary: 'fixture', hasPrimaryAuthority: true, hasUsableEvidence: true, searchedAt: new Date().toISOString(), selectedCrawlers: ['fixture'], researchIntent: 'legal', sourceCategories: []});

function harness(options = {}) {
  const clock = FakeTimers.createClock();
  const calls = { research: [], grade: [], final: [], streaming: 0, logs: [], signals: [], mesh: [], retrieval: [] };
  const cache = new Map();
  const stubs = {
    'server/claude.ts': {
      async callClaude(prompt, config) {
        if (prompt.startsWith('Classify whether')) return {content: JSON.stringify(options.semantic || {needed: true, intent:'legal', requestedFact:'none', objective:'Under Iowa law, may a landlord keep this security deposit?'})};
        if (prompt.startsWith('Assess whether')) {
          calls.grade.push(prompt);
          if (options.gradeThrows) throw new Error('fixture assessment outage');
          const grade = options.grade?.(calls.grade.length) || {sufficient: true, supportingUrls:[url]};
          return {content: typeof grade === 'string' ? grade : JSON.stringify(grade)};
        }
        calls.final.push({prompt, config});
        if (config.systemPrompt.includes('LEGAL VERIFICATION PARTIAL OR TIMED OUT')) {
          assert(!config.systemPrompt.includes('LEGAL RESEARCH COMPLETED BEFORE ANSWERING'));
          assert.match(config.systemPrompt, /Do NOT present an unverified statute/);
          return {content:'The general legal question depends on the facts and controlling authority; the specific current rule was not verified.'};
        }
        assert(config.systemPrompt.includes(doc.excerpt), 'verified final model must receive the supporting document');
        return {content:'The supplied authority supports this fixture answer.'};
      },
      async callClaudeStreaming() { calls.streaming++; throw new Error('legal answer streamed before verification'); },
    },
    'server/aiHarmonyModelRegistry.ts': {CURRENT_AI_MODELS:{claudeFast:'fixture',claudeBalanced:'fixture'},LEGAL_AI_MODELS:{claudeFast:'fixture'}},
    'server/lexara/LexaraAuthorityResearch.ts': {
      async researchLegalAuthority(question, context) {
        calls.research.push(question); calls.signals.push(context.signal);
        assert.equal(context.requirePrimaryText, true);
        if (options.hang) return new Promise(() => {});
        if (options.delay) await new Promise(resolve => clock.setTimeout(resolve, options.delay));
        return options.research ? options.research(calls.research.length) : packet([doc]);
      },
      formatAuthorityResearchForSystem: r => r ? r.summary : '',
    },
    'server/lexara/RecordReliefWorkflow.ts': {recordReliefTopic:()=>false},
    'shared/lawTypes.ts':{LAW_TYPE_DATA:[]},
    'shared/legalDomainMapping.ts':{mapProductLawTypeToExpert:()=>undefined},
    'server/lexara/LexaraLegalDomainProfiles.ts':{getLexaraLegalDomainProfile:()=>null,formatLexaraDomainSpecialization:()=>''},
    'server/lexara/LexaraCourtRecords.ts':{planLexaraCourtRecords:()=>null,formatLexaraCourtRecordPlan:()=>''},
    'server/lexara/LexaraJurisdictionResolver.ts':{hasExplicitLocationCue:()=>false,resolveUSJurisdiction:async()=>null},
    'server/lexara/LexaraJurisdictionAuthority.ts':{resolveJurisdictionAuthorityProfile:async()=>({officialResources:[],preferredOfficialDomains:['legis.iowa.gov']}),formatJurisdictionAuthorityForSystem:()=>''},
    'server/lexara/LegalDeadlineEngine.ts':{inferLegalDeadlineFromPrompt:()=>null,formatDeadlineCalculationForSystem:()=>''},
    'server/lexara/LexaraBackgroundInvestigation.ts':{formatLexaraBackgroundResearchForSystem:()=>'',investigateLexaraBackgroundQuestion:async()=>{throw new Error('unexpected personal investigation');}},
    'server/lexara/LexaraCitationVerifier.ts':{verifyLegalCitationsInText:async()=>[],formatCitationVerificationForCorrection:()=>''},
  };
  if (options.actualAuthority) {
    delete stubs['server/lexara/LexaraAuthorityResearch.ts'];
    stubs['server/lexara/LexaraCourtListenerClient.ts'] = {lexaraCourtListenerJson:async()=>({results:[{caseName:'Unrelated federal opinion',absolute_url:'/opinion/1/',snippet:'Index snippet'}]})};
    stubs['server/lexara/LexaraDiscoveryLearning.ts'] = {rememberLexaraDiscoveryOutcome:async()=>{}};
    stubs['server/lexara/RecordReliefSources.ts'] = {getRecordReliefProfile:()=>undefined,recordReliefDomains:()=>[]};
    stubs['server/lexara/LegalProviderMesh.ts'] = {
      discoverLegalMeshTier3:async query=>{calls.mesh.push(query);return [{url,title:doc.title,excerpt:'A search snippet',provider:'fixture'}];},
      discoverLegalMeshSupplemental:async()=>[],legalMeshSufficient:()=>true,
    };
    stubs['server/lexara/LexaraRetrievalBoundary.ts'] = {lexaraRetrievalAdapter:{retrieve:async request=>{
      calls.retrieval.push(request);
      if(options.retrievalDelay) await new Promise(resolve=>clock.setTimeout(resolve,options.retrievalDelay));
      return {evidence:options.emptyRetrieval?[]:request.targets.map(target=>({target,content:doc.excerpt}))};
    }}};
  }
  function load(file) {
    if (stubs[file]) return stubs[file];
    if (cache.has(file)) return cache.get(file).exports;
    const module = {exports:{}}; cache.set(file, module);
    const source = fs.readFileSync(path.join(root,file),'utf8');
    const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const localRequire = spec => {
      assert(spec.startsWith('.'), 'unexpected external dependency: ' + spec);
      return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)) + '.ts');
    };
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`,{console:{log:(...x)=>calls.logs.push(x),info:(...x)=>calls.logs.push(x),warn:()=>{}},process:{env:{}},URL,AbortController,Date:clock.Date,setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout},{filename:file})(localRequire,module,module.exports);
    return module.exports;
  }
  return {load,clock,calls};
}
const tests = [];
const test = (name, run) => tests.push({name, run});

test('implicit legal follow-up verifies actual authority inside the shortened live budget', async()=>{
  const h=harness({delay:2500});
  const {generateLexaraConversationResponse: respond}=h.load('server/lexara/LexaraConversationOrchestrator.ts');
  let done=false;
  const pending=respond('Can they do that?',{previousMessages:[{role:'user',content:'My landlord in Iowa kept my security deposit.'},{role:'lexara',content:'I need to verify the Iowa law.'}],onSpeechChunk:()=>assert.fail('premature speech'),onTextDelta:()=>assert.fail('premature text')}).then(x=>{done=true;return x;});
  await h.clock.tickAsync(1500);
  assert.equal(done,false); assert.equal(h.calls.final.length,0); assert.equal(h.calls.streaming,0);
  await h.clock.tickAsync(1500);
  assert.match((await pending).text,/supports this fixture/);
  assert.equal(h.calls.final.length,1); assert(h.calls.research[0].includes('Iowa'));
  assert(h.calls.logs.some(x=>x[1]?.legalResearchStatus==='supported'));
});

test('irrelevant documents trigger a gap-specific second query before final generation',async()=>{
  const h=harness({grade:n=>n===1?{sufficient:false,supportingUrls:[],nextQuery:'Iowa security deposit controlling rule exceptions effective date'}:{sufficient:true,supportingUrls:[url]}});
  const pending=h.load('server/lexara/LexaraConversationOrchestrator.ts').generateLexaraConversationResponse('Can they do that?',{jurisdiction:'Iowa'});
  await h.clock.tickAsync(1); await pending;
  assert.equal(h.calls.research.length,2); assert.match(h.calls.research[1],/exceptions effective date/); assert.equal(h.calls.final.length,1);
});

test('snippets, URL-only sources and metadata never unlock a legal answer',async()=>{
  for(const evidenceLevel of ['snippet','metadata',undefined]) {
    const h=harness({research:()=>packet([{...doc,evidenceLevel,excerpt:evidenceLevel?'Issued: 2026-01-01':undefined}])});
    const pending=h.load('server/lexara/LexaraConversationOrchestrator.ts').generateLexaraConversationResponse('Can they do that?',{jurisdiction:'Iowa'});
    await h.clock.tickAsync(1); const result=await pending;
    assert.match(result.text,/specific current rule was not verified/); assert.equal(h.calls.final.length,1);assert.equal(h.calls.grade.length,0);assert.equal(h.calls.research.length,3);
  }
});

test('assessment failures and invented support URLs cannot authorize an answer',async()=>{
  for(const options of [{gradeThrows:true},{grade:()=>({sufficient:true,supportingUrls:['https://invented.example/']})},{grade:()=>'{bad json'},{grade:()=>({sufficient:'true',supportingUrls:[url]})}]) {
    const h=harness(options);
    const result=await h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch('Iowa fixture question',{jurisdiction:'Iowa'});
    assert.equal(result.status,'sources-insufficient');assert.equal(result.research,null);assert.equal(h.clock.countTimers(),0);
  }
});

test('timeout cancels research and cannot report verification',async()=>{
  const h=harness({hang:true});
  const pending=h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch('Iowa fixture question',{});
  await h.clock.tickAsync(6001);const result=await pending;
  assert.equal(result.status,'timed-out');assert.equal(result.research,null);assert(h.calls.signals[0].aborted);assert.equal(h.clock.countTimers(),0);
});

test('caller cancellation and already-cancelled requests clean up without generating',async()=>{
  for(const preCancelled of [false,true]) {
    const h=harness({hang:true});const controller=new AbortController();const reason=new Error('superseded');
    if(preCancelled) controller.abort(reason);
    const pending=h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch('Iowa fixture question',{signal:controller.signal});
    const check=assert.rejects(pending,/superseded/);
    if(!preCancelled) controller.abort(reason);
    await check;assert.equal(getEventListeners(controller.signal,'abort').length,0);assert.equal(h.clock.countTimers(),0);
    assert.equal(h.calls.research.length,preCancelled?0:1);
  }
});

test('greetings and basic intake do not start research',async()=>{
  const h=harness();const respond=h.load('server/lexara/LexaraConversationOrchestrator.ts').generateLexaraConversationResponse;
  assert.match((await respond('Can you help me with a legal issue?',{})).text,/Tell me what happened/);
  assert.equal(h.calls.research.length,0);
  const semantic=h.load('server/lexara/LexaraSemanticIntentInterpreter.ts');
  assert.equal((await semantic.resolveLexaraResearchDecisionSemantic('Thanks')).needed,false);
});

test('deterministic legal follow-up survives unavailable semantic inference without capturing new factual questions',()=>{
  const h=harness();const {decideLexaraResearchNeed:decide}=h.load('server/lexara/LexaraResearchIntentRouter.ts');
  const prior=['My landlord in Iowa retained my security deposit.'];
  const follow=decide('Can they do that?',prior);
  assert.equal(follow.intent,'legal');assert.equal(follow.needed,true);assert.match(follow.standaloneQuery,/security deposit/);
  assert.equal(decide('Thanks',prior).needed,false);
  const newFact=decide('Where does Avery Example work?',prior);
  assert.equal(newFact.requestedFact,'employment');assert.notEqual(newFact.intent,'legal');
  assert.equal(decide('Explain the Iowa laws and statutes.').intent,'legal');
});

test('real authority discovery continues past federal snippets and reads Iowa primary text',async()=>{
  const h=harness({actualAuthority:true,retrievalDelay:2500});
  const pending=h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch('Iowa landlord security deposit obligations',{jurisdiction:'Iowa'});
  await h.clock.tickAsync(3000);const result=await pending;
  assert.equal(result.status,'supported');assert.equal(h.calls.mesh.length,1);
  assert(h.calls.retrieval[0].targets.includes(url));assert.equal(h.calls.retrieval[0].timeoutMs,4000);
  assert.equal(result.research.sources[0].evidenceLevel,'document');assert.equal(h.clock.countTimers(),0);
});

test('real authority discovery with unreadable primary leads does not pass the gate',async()=>{
  const h=harness({actualAuthority:true,emptyRetrieval:true});
  const result=await h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch('Iowa landlord security deposit obligations',{jurisdiction:'Iowa'});
  assert.equal(result.status,'sources-insufficient');assert.equal(h.calls.mesh.length,3);assert.equal(h.calls.grade.length,0);
});

 
test('primary-text discovery retains official sources across state and federal jurisdictions', async()=>{
  for(const [jurisdiction, officialDomain] of [
    ['California','leginfo.legislature.ca.gov'],
    ['New York','www.nysenate.gov'],
    ['Texas','statutes.capitol.texas.gov'],
    ['Federal','www.uscourts.gov'],
  ]) {
    const h=harness({actualAuthority:true,emptyRetrieval:true});
    const outcome=await h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch(
      'What controlling statutes and cases govern this dispute?',
      {jurisdiction,preferredOfficialDomains:[officialDomain]});
    assert.equal(outcome.status,'sources-insufficient');
    assert.equal(h.calls.grade.length,0);
    assert(h.calls.mesh.some(query=>query.includes('site:'+officialDomain)), jurisdiction+' official law query missing');
    assert.equal(h.clock.countTimers(),0);
  }
});

test('legal precedent assessment applies to all jurisdictions, not just Iowa',async()=>{
  const h=harness({grade:()=>({sufficient:false,supportingUrls:[]})});
  await h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch(
    'Is this case still binding?',{jurisdiction:'New York'});
  assert(h.calls.grade.some(prompt=>prompt.includes('For EVERY state or federal jurisdiction')));
  assert(h.calls.grade.every(prompt=>!prompt.includes('For Iowa, consider')));
});

(async()=>{for(const {name,run} of tests){await run();console.log('PASS:',name);}console.log(`${tests.length} verification-before-answer behavioral groups passed.`);})().catch(e=>{console.error(e);process.exitCode=1;});
