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
  const calls = { research: [], researchContexts: [], grade: [], final: [], streaming: 0, classifier: 0, directory: 0, court: 0, logs: [], signals: [], mesh: [], retrieval: [], web: [] };
  const cache = new Map();
  const stubs = {
    'server/claude.ts': {
      async callClaude(prompt, config) {
        if (prompt.startsWith('Classify whether')) { calls.classifier++; return {content: JSON.stringify(options.semantic || {needed: true, intent:'legal', requestedFact:'none', objective:'Under Iowa law, may a landlord keep this security deposit?'})}; }
        if (prompt.startsWith('Assess whether') || prompt.startsWith('Verify only the specific rule')) {
          calls.grade.push(prompt);
          if (options.gradeThrows) throw new Error('fixture assessment outage');
          const grade = options.grade?.(calls.grade.length) || {sufficient: true, supportingUrls:[url]};
          return {content: typeof grade === 'string' ? grade : JSON.stringify(grade)};
        }
        calls.final.push({prompt, config});
        if (config.systemPrompt.includes('LEGAL VERIFICATION PARTIAL OR TIMED OUT')) {
          assert(!config.systemPrompt.includes('LEGAL RESEARCH COMPLETED BEFORE ANSWERING'));
          assert.match(config.systemPrompt, /Do NOT present an unverified statute/);
          assert.match(config.systemPrompt, /A search timeout is not proof that no statute exists/);
          assert.match(config.systemPrompt, /Never volunteer internal research timeouts/);
          assert(!config.systemPrompt.includes('APPLICATION RESEARCH STATUS'), 'internal source failure must not be inserted as an additional warning');
          return {content:'Which state is this about, and what happened?'};
        }
        assert(config.systemPrompt.includes(doc.excerpt), 'verified final model must receive the supporting document');
        return {content:'The supplied authority supports this fixture answer.'};
      },
      async callClaudeStreaming() { calls.streaming++; throw new Error('legal answer streamed before verification'); },
      async callClaudeWebSearch(prompt, config) {
        calls.web.push({prompt, config});
        return {sources:options.claudeWebSources || [], searches:1, content:''};
      },
    },
    'server/aiHarmonyModelRegistry.ts': {CURRENT_AI_MODELS:{claudeFast:'fixture',claudeBalanced:'fixture'},LEGAL_AI_MODELS:{claudeFast:'fixture'}},
    'server/lexara/LexaraAuthorityResearch.ts': {
      async researchLegalAuthority(question, context) {
        calls.research.push(question); calls.researchContexts.push(context); calls.signals.push(context.signal);
        assert.equal(context.requirePrimaryText, true);
        if (options.hang) return new Promise(() => {});
        if (options.delay) await new Promise(resolve => clock.setTimeout(resolve, options.delay));
        return options.research ? options.research(calls.research.length) : packet([doc]);
      },
      formatAuthorityResearchForSystem: r => r ? r.summary : '',
      hasLexaraDirectStatutePublisher: jurisdiction => /^(?:iowa|california|texas|new york|florida)$/i.test(String(jurisdiction)),
    },
    'server/lexara/RecordReliefWorkflow.ts': {recordReliefTopic:()=>false},
    'shared/lawTypes.ts':{LAW_TYPE_DATA:[]},
    'shared/legalDomainMapping.ts':{mapProductLawTypeToExpert:()=>undefined},
    'server/lexara/LexaraLegalDomainProfiles.ts':{getLexaraLegalDomainProfile:()=>null,formatLexaraDomainSpecialization:()=>''},
    'server/lexara/LexaraCourtRecords.ts':{planLexaraCourtRecords:()=>null,formatLexaraCourtRecordPlan:()=>''},
    'server/lexara/LexaraJurisdictionResolver.ts':{hasExplicitLocationCue:()=>false,resolveUSJurisdiction:async()=>null},
    'server/lexara/LexaraJurisdictionAuthority.ts':{resolveJurisdictionAuthorityProfile:async()=>{calls.directory++;return {officialResources:[],preferredOfficialDomains:['legis.iowa.gov']}},formatJurisdictionAuthorityForSystem:()=>''},
    'server/lexara/LegalDeadlineEngine.ts':{inferLegalDeadlineFromPrompt:()=>null,formatDeadlineCalculationForSystem:()=>''},
    'server/lexara/LexaraBackgroundInvestigation.ts':{formatLexaraBackgroundResearchForSystem:()=>'',investigateLexaraBackgroundQuestion:async()=>{throw new Error('unexpected personal investigation');}},
    'server/lexara/LexaraCitationVerifier.ts':{verifyLegalCitationsInText:async()=>[],formatCitationVerificationForCorrection:()=>''},
  };
  if (options.actualAuthority) {
    delete stubs['server/lexara/LexaraAuthorityResearch.ts'];
    stubs['server/lexara/LexaraCourtListenerClient.ts'] = {lexaraCourtListenerJson:async()=>{calls.court++;return {results:[{caseName:'Unrelated federal opinion',absolute_url:'/opinion/1/',snippet:'Index snippet'}]}}};
    stubs['server/lexara/LexaraDiscoveryLearning.ts'] = {rememberLexaraDiscoveryOutcome:async()=>{}};
    stubs['server/lexara/RecordReliefSources.ts'] = {getRecordReliefProfile:()=>undefined,recordReliefDomains:()=>[]};
    stubs['server/lexara/LegalProviderMesh.ts'] = {
      discoverLegalMeshTier3:async (query,_signal,config)=>{
        calls.mesh.push({query, config});
        if(options.meshLeads) return options.meshLeads;
        return options.weakNative
          ? [{url:'https://example.org/irrelevant',title:'Unrelated search lead',excerpt:'A search snippet',provider:'fixture'}]
          : [{url,title:doc.title,excerpt:'A search snippet',provider:'fixture'}];
      },
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
    assert.match(result.text,/Which state is this about/);assert.doesNotMatch(result.text,/could not verify|source unavailable|timed out/i); assert.equal(h.calls.final.length,1);assert.equal(h.calls.grade.length,0);assert.equal(h.calls.research.length,3);
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
  await h.clock.tickAsync(15001);const result=await pending;
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
  assert.equal(result.status,'supported');assert.equal(h.calls.mesh.length,2);
  assert(h.calls.mesh.some(entry=>entry.config.strictLegalSource===true),'legal searches must await authority leads');
  assert(h.calls.retrieval[0].targets.includes(url));assert.equal(h.calls.retrieval[0].timeoutMs,4000);
  assert.equal(result.research.sources[0].evidenceLevel,'document');assert.equal(h.calls.web.length,0);assert.equal(h.clock.countTimers(),0);
});

test('real authority discovery with unreadable primary leads does not pass the gate',async()=>{
  const h=harness({actualAuthority:true,emptyRetrieval:true});
  const result=await h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch('Iowa landlord security deposit obligations',{jurisdiction:'Iowa'});
  assert.equal(result.status,'sources-insufficient');assert(h.calls.mesh.length>=2);assert.equal(h.calls.web.length,1);assert.equal(h.calls.grade.length,0);
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
    assert(h.calls.mesh.some(entry=>entry.query.includes('site:'+officialDomain.replace(/^www\./,'')) || entry.query.includes('site:'+officialDomain)), jurisdiction+' official law query missing');
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


test('weak native legal evidence triggers one real Claude web-search fallback with independently downloaded primary text', async()=>{
  const h=harness({actualAuthority:true,weakNative:true,claudeWebSources:[{
    url,title:'Official Iowa Code result',citedText:'An index snippet is not source text',
  }]});
  const result=await h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch(
    'What Iowa statute regulates security deposits?',{jurisdiction:'Iowa'});
  assert.equal(result.status,'supported');
  assert.equal(h.calls.web.length,1,'one Claude web-search fallback only');
  assert(h.calls.web[0].prompt.includes('Iowa'));
  assert(h.calls.web[0].config.maxUses===1);
  assert.equal(h.calls.mesh.length,2,'Claude fallback must not relaunch native search after its initial official and broad queries');
  assert(h.calls.retrieval.some(request=>request.targets.includes(url)),'verify the web-search citation by direct retrieval');
  assert(h.calls.grade.some(prompt=>prompt.includes(doc.excerpt)),'model may assess only actual retrieved text');
  assert.equal(result.research.sources[0].evidenceLevel,'document');
});

test('Claude web-search snippets alone cannot pass primary-authority verification', async()=>{
  const h=harness({actualAuthority:true,weakNative:true,emptyRetrieval:true,claudeWebSources:[{
    url,title:'Official Iowa Code search lead',citedText:'Unverified snippet',
  }]});
  const result=await h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch(
    'What Iowa statute regulates security deposits?',{jurisdiction:'Iowa'});
  assert.equal(result.status,'sources-insufficient');
  assert.equal(h.calls.web.length,1);
  assert.equal(h.calls.grade.length,0);
  assert.equal(result.research,null);
});


test('legal budget is 15 seconds by default and 20 seconds for compound-law questions', async()=>{
  const h=harness();
  const {lexaraLegalResearchBudgetMs:budget}=h.load('server/lexara/LexaraLegalResearchGate.ts');
  assert.equal(budget('Which Iowa statute controls this issue?'),15_000);
  assert.equal(budget('Which statutes apply, including the elements, penalties, and reporting duties?'),20_000);
  assert.equal(budget('Compare controlling statutes and cases across states.'),20_000);
  const hung=harness({hang:true});
  const pending=hung.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch(
    'Compare controlling statutes and cases across states.',{jurisdiction:'Iowa'});
  await hung.clock.tickAsync(19_999);
  assert.equal(hung.calls.signals[0].aborted,false,'complex research must not stop at the normal deadline');
  await hung.clock.tickAsync(2);
  const result=await pending;
  assert.equal(result.status,'timed-out');
  assert.equal(hung.calls.signals[0].aborted,true);
  assert.equal(hung.clock.countTimers(),0);
});

test('Iowa legal search targets the legislature before generic federal directory domains', async()=>{
  const h=harness({actualAuthority:true});
  const result=await h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch(
    'Which Iowa Code section governs security deposits?', {
      jurisdiction:'Iowa',
      preferredOfficialDomains:['justice.gov','uscourts.gov','legis.iowa.gov'],
      officialResources:[{title:'Iowa laws',url:'https://www.legis.iowa.gov/law/iowacode',host:'legis.iowa.gov',kind:'laws'}],
    });
  assert.equal(result.status,'supported');
  assert(h.calls.mesh.some(entry=>entry.query.includes('site:legis.iowa.gov')),
    'state law search must prefer the official legislature');
  assert(!h.calls.mesh.some(entry=>entry.query.includes('site:justice.gov')),
    'generic federal directory must not displace the state law publisher');
  assert.equal(h.calls.web.length,0,'a successful native source must not trigger paid fallback');
});

test('search-discovered Iowa Code citations expand to retrieved official statute PDFs', async()=>{
  const h=harness({actualAuthority:true,meshLeads:[
    {url:'https://law.justia.com/codes/iowa/2026/',title:'Iowa Code 562A.12 landlord deposit',excerpt:'Iowa Code 562A.12',provider:'fixture'},
    {url:'https://www.legis.iowa.gov/law/iowacode',title:'Iowa Legislature code index',excerpt:'Iowa Code section 562A.12',provider:'fixture'},
  ]});
  const result=await h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch(
    'Which Iowa statutes govern landlord security deposits?', {jurisdiction:'Iowa'});
  assert.equal(result.status,'supported');
  assert(h.calls.retrieval.some(request=>request.targets.includes('https://www.legis.iowa.gov/docs/code/562A.12.pdf')),
    'a number returned by discovery should be followed to official text, not declared verified from a snippet');
  assert(result.research.sources.some(source=>source.url==='https://www.legis.iowa.gov/docs/code/562A.12.pdf'
    && source.evidenceLevel==='document'), 'official statute PDF must be independently retrieved');
});

test('Claude fallback keeps an official statute in ninth position ahead of eight blocked mirrors',async()=>{
  const mirrors=Array.from({length:8},(_,index)=>({
    url:'https://law.justia.com/codes/iowa/2026/title-'+index+'/chapter-123/',
    title:'Commercial search mirror',citedText:'Search snippet only',
  }));
  const h=harness({actualAuthority:true,weakNative:true,claudeWebSources:[
    ...mirrors,{url,title:'Official Iowa Code section 562A.12',citedText:'Search snippet only'},
  ]});
  const result=await h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch(
    'What current Iowa Code section governs deposits?',{jurisdiction:'Iowa'});
  assert.equal(result.status,'supported');
  assert.equal(h.calls.web.length,1);
  assert(h.calls.retrieval.some(request=>request.targets.includes(url)),
    'the ninth authoritative result must be retrieved despite earlier commercial mirrors');
  assert(result.research.sources.some(source=>source.url===url && source.evidenceLevel==='document'),
    'a commercial snippet cannot replace retrieved official text');
});

test('native primary documents do not trigger an unnecessary Claude web search when another targeted legal query will verify them',async()=>{
  const h=harness({grade:n=>n===1?{sufficient:false,supportingUrls:[],nextQuery:'Find statutory exceptions'}:{sufficient:true,supportingUrls:[url]}});
  const result=await h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch('Iowa deposit rule',{jurisdiction:'Iowa'});
  assert.equal(result.status,'supported');assert.equal(h.calls.research.length,2);
  assert.equal(h.calls.web.length,0,'do not buy a fallback search when a primary statute was already downloaded');
  assert(h.calls.research[1].includes('statutory exceptions'));
});

test('partial primary evidence survives without claiming that incomplete legal verification succeeded',async()=>{
  const h=harness({grade:()=>({sufficient:false,supportingUrls:[url],nextQuery:'Find unverified material qualifications'})});
  const result=await h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch('Iowa exception question',{jurisdiction:'Iowa'});
  assert.equal(result.status,'sources-insufficient');
  assert.equal(result.research.hasUsableEvidence,false);
  assert.equal(result.research.hasPrimaryAuthority,false);
  assert.equal(result.research.sources.length,1);
  assert.match(result.research.summary,/NOT fully verified/);
  assert.equal(h.calls.web.length,0);
  assert.equal(h.calls.researchContexts[2].forceClaudeLegalWebFallback,true, 'a still-incomplete native investigation retains its late Claude discovery option');
  assert.equal(h.clock.countTimers(),0);
});

test('direct official retrieval is reused across targeted retries, and web fallback has sufficient bounded output',async()=>{
  const h=harness({actualAuthority:true,grade:n=>n===1?{sufficient:false,supportingUrls:[],nextQuery:'Iowa deposit exceptions'}:{sufficient:true,supportingUrls:[url]}});
  const result=await h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch('Iowa deposit statute',{jurisdiction:'Iowa'});
  assert.equal(result.status,'supported');
  assert.equal(h.calls.retrieval.filter(request=>request.targets.includes(url)).length,1,'do not redownload the same primary document');
  assert.equal(h.calls.web.length,0);
  const weak=harness({actualAuthority:true,weakNative:true,emptyRetrieval:true});
  await weak.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch('Iowa deposit statute',{jurisdiction:'Iowa'});
  assert.equal(weak.calls.web.length,1);
  assert.equal(weak.calls.web[0].config.maxTokens,900);
  assert.equal(weak.calls.web[0].config.retryTruncatedOutput,true);
});

test('statute-depth planner is jurisdiction-independent and keeps drafting, precedents and complex procedures deep',async()=>{
  const {planLexaraLegalResearchDepth:plan}=harness().load('server/lexara/LexaraLegalResearchGate.ts');
  for(const request of [
    'What Iowa statute applies to hit and run?',
    'What California law covers traffic accidents?',
    'Which Texas code section regulates deposits?',
    'What Vermont law covers leaving the scene of an accident?',
    'What is 18 USC 924c?',
  ]) assert.equal(plan(request), 'direct',request);
  assert.equal(plan('Can they do that?'),'standard');
  for(const request of [
    'Draft a complaint under Iowa Code 321.261',
    'Prepare a motion with court rules and supporting law',
    'Compare case law and precedent across jurisdictions',
    'Check amendments and effective date of the statute',
    'Analyze constitutional appeals and appellate precedent',
    'Which statutes apply, including the elements, penalties, and reporting duties?',
  ]) assert.equal(plan(request),'deep',request);
  assert.equal(plan('What Iowa statute applies?',{courtRecordPlan:{}}),'deep');
  assert.equal(plan('Which Iowa statute controls?',{documentAction:true}),'deep');
  assert.equal(plan('Which Iowa statute controls?',{researchIntent:'mixed'}),'deep');
  assert.equal(plan('Which state law applies?',{jurisdiction:'Federal + Iowa'}),'deep');
  assert.equal(plan('What are all legal requirements for a medical facility?'),'deep');
  assert.equal(plan('What is the municipal noise ordinance?'),'standard');
  assert.equal(plan('What regulations apply to clinical licensing?'),'standard');
});

test('direct statute question accepts one independently verified primary source without three broad passes',async()=>{
  const h=harness();
  const result=await h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch(
    'Which Iowa statute covers hit and run?',{jurisdiction:'Iowa',researchIntent:'legal',allowDirectStatuteLookup:true});
  assert.equal(result.status,'supported');assert.equal(result.attempts,1);
  assert.equal(h.calls.research.length,1);assert.equal(h.calls.web.length,0);
  assert.equal(h.calls.researchContexts[0].directStatuteLookup,true);
  assert(h.calls.grade[0].startsWith('Verify only the specific rule'));
  assert.match(h.calls.grade[0],/conditional answer with one clarifying question/);
  assert.match(h.calls.grade[0],/Never claim a penalty, deadline or exception/);
  assert.match(h.calls.grade[0],/respect material qualifications/);
  assert.equal(h.clock.countTimers(),0);
});

test('a URL, metadata or a false grade never authorizes the fast statute answer',async()=>{
  for(const options of [
    {research:()=>packet([{...doc,evidenceLevel:'snippet'}])},
    {research:()=>packet([{...doc,evidenceLevel:'metadata'}])},
    {grade:()=>({sufficient:true,supportingUrls:['https://invented.example/']})},
    {grade:()=>({sufficient:false,supportingUrls:[]})},
  ]) {
    const h=harness(options);
    const out=await h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch(
      'Which Iowa statute applies?',{jurisdiction:'Iowa',allowDirectStatuteLookup:true});
    assert.equal(out.status,'sources-insufficient');assert.equal(out.attempts,1);
    assert(!out.research?.hasUsableEvidence);assert.equal(h.calls.web.length,0);
    assert.equal(h.clock.countTimers(),0);
  }
});

test('simple statute research has a bounded seven-second deadline and preserves cancellations',async()=>{
  const h=harness({hang:true});let done=false;
  const pending=h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch(
    'What Iowa law covers leaving the scene?',{jurisdiction:'Iowa',allowDirectStatuteLookup:true}).then(out=>{done=true;return out});
  await h.clock.tickAsync(6_999);assert.equal(done,false);
  await h.clock.tickAsync(2);const out=await pending;
  assert.equal(out.status,'timed-out');assert.equal(out.attempts,1);
  assert.equal(h.calls.signals[0].aborted,true);assert.equal(h.clock.countTimers(),0);
});

test('standalone simple legal question avoids semantic classification and unnecessary directory',async()=>{
  const h=harness();
  const result=await h.load('server/lexara/LexaraConversationOrchestrator.ts').generateLexaraConversationResponse(
    'What Iowa law covers leaving the scene of an accident?',{jurisdiction:'Iowa'});
  assert.match(result.text,/supports this fixture/);
  assert.equal(h.calls.classifier,0,'obvious direct-law request should not wait for a model just to classify it');
  assert.equal(h.calls.directory,0,'known official legislative publisher does not need a court directory');
  assert.equal(h.calls.researchContexts[0].allowDirectStatuteLookup,true);
  assert.equal(h.calls.researchContexts[0].directStatuteLookup,true);
  assert.equal(h.calls.research.length,1);
  assert.equal(h.calls.streaming,0);
});

test('contextual legal follow-up keeps comprehensive verification despite a synthesized state-law query',async()=>{
  const h=harness({grade:n=>n===1?{sufficient:false,supportingUrls:[],nextQuery:'Find statutory exceptions'}:{sufficient:true,supportingUrls:[url]}});
  const out=await h.load('server/lexara/LexaraConversationOrchestrator.ts').generateLexaraConversationResponse(
    'Can they do that?',{jurisdiction:'Iowa',previousMessages:[{role:'user',content:'My landlord kept a security deposit.'}]});
  assert.match(out.text,/supports this fixture/);
  assert.equal(h.calls.researchContexts[0].allowDirectStatuteLookup,false);
  assert.equal(h.calls.researchContexts[0].directStatuteLookup,false);
  assert.equal(h.calls.research.length,2);
});

test('direct Iowa statute lookup retrieves actual official law and skips unrelated federal case indexes',async()=>{
  const actualUrl='https://www.legis.iowa.gov/docs/code/321.261.pdf';
  const h=harness({actualAuthority:true,meshLeads:[
    {url:'https://www.legis.iowa.gov/law/iowacode',title:'Iowa code listing',excerpt:'Iowa Code section 321.261',provider:'fixture'},
  ],grade:()=>({sufficient:true,supportingUrls:[actualUrl]})});
  const out=await h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch(
    'What Iowa law covers leaving the scene?',{jurisdiction:'Iowa',researchIntent:'legal',allowDirectStatuteLookup:true});
  assert.equal(out.status,'supported');assert.equal(out.attempts,1);
  assert(h.calls.retrieval.some(request=>request.targets.includes(actualUrl)), 'official PDF text was actually retrieved');
  assert.equal(h.calls.court,0,'state statute lookup must not initiate irrelevant federal opinion index searches');
  assert.equal(h.calls.web.length,0);
});

test('unknown legal venue gets one necessary question without source calls',async()=>{
  const h=harness();
  const output=await h.load('server/lexara/LexaraConversationOrchestrator.ts').generateLexaraConversationResponse(
    'What statute covers hit and run?',{});
  assert.match(output.text,/Which state or jurisdiction/);
  assert.equal(h.calls.research.length,0);
  assert.equal(h.calls.final.length,0);
  assert.equal(h.calls.web.length,0);
});

test('direct California statute retrieves primary text without a jurisdiction-specific PDF seed',async()=>{
  const official='https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=20001&lawCode=VEH';
  const h=harness({actualAuthority:true,meshLeads:[{
    url:official,title:'California Vehicle Code section 20001',excerpt:'Official code search lead',provider:'fixture',
  }],grade:()=>({sufficient:true,supportingUrls:[official]})});
  const result=await h.load('server/lexara/LexaraLegalResearchGate.ts').completeLexaraLegalResearch(
    'Which California law addresses leaving an accident scene?',{
      jurisdiction:'California',researchIntent:'legal',allowDirectStatuteLookup:true,
    });
  assert.equal(result.status,'supported');assert.equal(result.attempts,1);
  assert(h.calls.retrieval.some(request=>request.targets.includes(official)));
  assert(h.calls.mesh.some(item=>item.query.includes('site:leginfo.legislature.ca.gov')), 'state legislature searched directly');
  assert.equal(h.calls.web.length,0);
});

(async()=>{for(const {name,run} of tests){await run();console.log('PASS:',name);}console.log(`${tests.length} verification-before-answer behavioral groups passed.`);})().catch(e=>{console.error(e);process.exitCode=1;});
