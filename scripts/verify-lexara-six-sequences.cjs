const fs = require('fs');
const router = fs.readFileSync('server/lexara/LexaraSequenceRouter.ts','utf8');
const orchestrator = fs.readFileSync('server/lexara/LexaraConversationOrchestrator.ts','utf8');
const authority = fs.readFileSync('server/lexara/LexaraAuthorityResearch.ts','utf8');
const legalMesh = fs.readFileSync('server/lexara/LegalProviderMesh.ts','utf8');
const retrieval = fs.readFileSync('server/lexara/LexaraRetrievalBoundary.ts','utf8');
const background = fs.readFileSync('server/lexara/LexaraBackgroundInvestigation.ts','utf8');
const routes = fs.readFileSync('server/routes/lexara.chat.routes.ts','utf8');
const planner = fs.readFileSync('server/lexara/LexaraResearchIntentRouter.ts','utf8');
const sourceRegistry = fs.readFileSync('server/lexara/LexaraPublicSourceRegistry.ts','utf8');

for (const id of [
  "'simple-factual'",
  "'lexara-background'",
  "'lexara-legal'",
  "'combined-legal-background'",
  "'deep-recursive'",
  "'document-action'",
]) {
  if (!router.includes(id)) throw new Error('Missing explicit sequence '+id);
}
for (const token of [
  'useLegalResearch',
  'useBackgroundResearch',
  'recursive',
  'classifyBackground',
  'documentAction',
]) if (!router.includes(token)) throw new Error('Sequence contract missing '+token);

if (router.includes('useBackgroundResearch: true')) {
  throw new Error('Lexara sequence router still enables Pantheon/background routing');
}
if (!router.includes("useLegalResearch: true, useBackgroundResearch: false")) {
  throw new Error('Research sequences are not routed to Lexara legal reasoning');
}
if (!orchestrator.includes('planLexaraSequence(cleanPrompt, previousUserTurns)')) {
  throw new Error('Conversation orchestrator does not use six-sequence router');
}
if (!orchestrator.includes("const backgroundResearchRequested = researchDecision.intent === 'factual' || mixedLegalFactNeed")) {
  throw new Error('Lexara factual/mixed turns do not enable the Lexara-native background investigator');
}
if (!orchestrator.includes("from './LexaraBackgroundInvestigation'")
  || orchestrator.includes("from './LexaraBackgroundResearchBoundary'")
  || orchestrator.includes('LexaraPantheonInvestigation')) {
  throw new Error('Lexara conversation orchestrator is not cleanly wired to the native background investigator');
}
for (const forbidden of ['PantheonRetrievalAdapter','pantheonRetrievalAdapter','../services/pantheon/','PantheonDiscoveryCoordinator']) {
  if (background.includes(forbidden)) throw new Error('Lexara native background investigator depends on Pantheon: '+forbidden);
}
for (const token of ['MAX_RECURSIVE_PASSES = 30','TARGETS_PER_PASS = 10','TOTAL_RESEARCH_BUDGET_MS = 10 * 60_000','discoverLegalMeshTier3','discoverLegalMeshSupplemental','lexaraRetrievalAdapter','directlyAnswers','retrievedAt','MIN_IDENTITY_CONFIDENCE = 0.62','identityConfidence']) {
  if (!background.includes(token)) throw new Error('Lexara native background investigation missing '+token);
}
if (!orchestrator.includes('const researchRouteSelected = sequencePlan.useLegalResearch || researchDecision.needed')) {
  throw new Error('Factual/research turns are not handed to the single Lexara research route');
}
if (!orchestrator.includes('backgroundResearchRequested\n      ? backgroundInvestigationPromise')
  || orchestrator.includes('Mixed-turn background-research budget reached')) {
  throw new Error('Lexara factual/mixed background research can still be cut off by an outer mixed-turn deadline');
}
if (!authority.includes('discoverLegalMeshTier3') || !authority.includes('enrichAuthoritySourcesWithLexaraRetrieval')) {
  throw new Error('Lexara legal discovery/retrieval sequence missing');
}
if (!authority.includes("research.researchIntent === 'factual' && research.subject")) {
  throw new Error('Pure person-fact authority evidence can still bypass the identity-gated background path');
}
if (authority.includes('selectLexaraCrawlerPlan') || retrieval.includes('PantheonRetrievalAdapter') || retrieval.includes('pantheonRetrievalAdapter')) {
  throw new Error('Lexara legal retrieval still depends on Pantheon');
}
for (const directLane of ['tavily', 'gemini-google-grounding', 'duckduckgo-instant-answer', 'SEARXNG_URL', 'DDGS_URL', 'OPENSERP_URL', 'index.commoncrawl.org', 'SERPAPI_KEY', 'SCRAPINGBEE_API_KEY']) {
  if (!legalMesh.includes(directLane)) throw new Error('Lexara direct legal discovery lane missing: '+directLane);
}
for (const forbidden of ['discoverPantheonSourcesParallel', 'PantheonDiscoveryCoordinator', 'LexaraBackgroundResearchBoundary']) {
  if (legalMesh.includes(forbidden)) throw new Error('Lexara legal mesh still depends on Pantheon: '+forbidden);
}
if (!legalMesh.includes('isPreferredOfficialCandidate') || !legalMesh.includes('const preferred=diversify')) {
  throw new Error('Lexara factual discovery does not prioritize matching official registries');
}
if (!legalMesh.includes("if (!options.requestedFact || options.requestedFact === 'none') return false;")) {
  throw new Error('Official-source priority can still reorder non-factual legal research');
}
if (!router.includes('const contextualContinuation') || !router.includes('const contextualPrompt')) {
  throw new Error('Lexara sequence router does not preserve short factual follow-up context');
}
for (const plannerToken of ["'age-dob'","'professional-license'","'marriage-divorce'","'employment'","standaloneQuery","sourceCategories","research-follow-up"]) {
  if (!planner.includes(plannerToken)) throw new Error('Lexara semantic research planner missing: '+plannerToken);
}
for (const sourceToken of ['cdc-vital-records','nursys-license','careeronestop-license-finder','bop-inmate-locator','finra-brokercheck','sec-edgar','icann-rdap']) {
  if (!sourceRegistry.includes(sourceToken)) throw new Error('Lexara public source registry missing: '+sourceToken);
}
if (!routes.includes('documentIntent') || !routes.includes("send('complete'")) {  throw new Error('Document/action handoff missing');
}

console.log('LEXARA six-sequence routing verification passed with Pantheon disconnected and Lexara-native factual research wired.');
