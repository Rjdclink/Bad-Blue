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
const semanticIntent = fs.readFileSync('server/lexara/LexaraSemanticIntentInterpreter.ts','utf8');
const claudeBackground = fs.readFileSync('server/lexara/LexaraClaudeBackgroundSearch.ts','utf8');
const claudeTransport = fs.readFileSync('server/claude.ts','utf8');
const representationEngine = fs.readFileSync('server/lexara/LexaraRepresentationEngine.ts','utf8');
const storage = fs.readFileSync('server/storage.ts','utf8');
const liveStreamStart = routes.indexOf("router.post('/chat/stream'");
const legacyChatStart = routes.indexOf("router.post('/chat'", liveStreamStart + 1);
const liveStreamRoute = routes.slice(liveStreamStart, legacyChatStart);

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

if (!router.includes('useBackgroundResearch: true')
  || !router.includes("useLegalResearch: false, useBackgroundResearch: true")
  || !router.includes("useLegalResearch: true, useBackgroundResearch: false")) {
  throw new Error('Lexara sequence router does not preserve independent legal/background AND-OR routing');
}
if (!orchestrator.includes('resolveLexaraResearchDecisionSemantic')
  || !orchestrator.includes('planLexaraSequence(cleanPrompt, previousUserTurns, semanticResearchDecision)')) {
  throw new Error('Conversation orchestrator does not feed semantic intent into the six-sequence router');
}
if (!orchestrator.includes('const semanticResearchDecisionPromise = resolveLexaraResearchDecisionSemantic(')
  || orchestrator.indexOf('semanticResearchDecisionPromise') > orchestrator.indexOf('await resolveUSJurisdiction(')
  || !orchestrator.includes('const semanticResearchDecision = await semanticResearchDecisionPromise')) {
  throw new Error('Semantic background inference is not overlapped with existing turn preparation');
}
if (!planner.includes('export function isLexaraGenericLegalIntake')
  || !planner.includes('isLexaraGenericLegalIntake(text)')
  || !orchestrator.includes("text: 'Yes. Tell me what happened.'")
  || orchestrator.indexOf('if (isLexaraGenericLegalIntake(cleanPrompt))')
    > orchestrator.indexOf('const semanticResearchDecisionPromise = resolveLexaraResearchDecisionSemantic(')) {
  throw new Error('Generic legal intake can still launch semantic research or Claude before the immediate intake response');
}
if (liveStreamStart < 0 || legacyChatStart < 0
  || !liveStreamRoute.includes('matterEnrichmentPending: durableEnrichmentNeeded')
  || !liveStreamRoute.includes("res.once('finish', scheduleMatterEnrichmentDrain)")
  || !liveStreamRoute.includes('!representationContext.persistent && !genericLegalIntake')
  || !liveStreamRoute.includes('? await advanceRepresentationMatter({')
  || !routes.includes('async function drainDurableMatterEnrichmentJobs()')
  || !routes.includes('claimNextLexaraMatterEnrichmentJob')
  || !storage.includes('FOR UPDATE SKIP LOCKED')
  || !storage.includes("matterEnrichmentJob'->>'status' IN ('pending', 'processing')")
  || !routes.includes('getUserLexaraRestorableMatterStates')
  || !storage.includes('getUserLexaraRestorableMatterStates')
  || !storage.includes('getUserLexaraMatterStates')
  || !storage.includes('getLatestCompletedLexaraMatterEnrichmentState')
  || !storage.includes("matterEnrichmentJob' IS NULL")
  || !storage.includes('matterEnrichmentCompletedAt')
  || !representationEngine.includes('export function shouldEnrichRepresentationMatter')
  || !representationEngine.includes('skipPacketPlanning?: boolean')
  || !representationEngine.includes('!input.skipPacketPlanning && shouldPlanPacket')) {
  throw new Error('Durable post-response matter enrichment or ephemeral-state preservation invariant is missing');
}
if (!orchestrator.includes("const backgroundResearchRequested = sequencePlan.useBackgroundResearch")) {
  throw new Error('Lexara factual/mixed turns do not follow the sequence router into the native background investigator');
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
if (!orchestrator.includes('const researchRouteSelected = sequencePlan.useLegalResearch')) {
  throw new Error('Legal authority research does not follow the sequence router');
}
if (!orchestrator.includes('const backgroundWaitBudgetMs = deepBackgroundRequested')
  || !orchestrator.includes('? 10 * 60_000')
  || !orchestrator.includes(': LIVE_BACKGROUND_FACT_BUDGET_MS')
  || !orchestrator.includes('backgroundResearchRequested\n      ? Promise.race([')
  || !orchestrator.includes('new Promise<null>(resolve => setTimeout(() => resolve(null), backgroundWaitBudgetMs))')
  || !orchestrator.includes('backgroundResearchRequested && !backgroundInvestigation && !deepBackgroundRequested')
  || orchestrator.includes('Mixed-turn background-research budget reached')) {
  throw new Error('Lexara factual/mixed background research does not preserve its explicit ordinary/deep live budgets');
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
for (const directLane of ['tavily', 'duckduckgo-instant-answer', 'SEARXNG_URL', 'DDGS_URL', 'OPENSERP_URL', 'index.commoncrawl.org', 'SERPAPI_KEY', 'SCRAPINGBEE_API_KEY']) {
  if (!legalMesh.includes(directLane)) throw new Error('Lexara direct legal discovery lane missing: '+directLane);
}
for (const forbidden of ['discoverPantheonSourcesParallel', 'PantheonDiscoveryCoordinator', 'LexaraBackgroundResearchBoundary']) {
  if (legalMesh.includes(forbidden)) throw new Error('Lexara legal mesh still depends on Pantheon: '+forbidden);
}
if (!legalMesh.includes('isPreferredOfficialCandidate') || !legalMesh.includes('const preferred=diversify')) {
  throw new Error('Lexara factual discovery does not prioritize matching official registries');
}
if (!legalMesh.includes('async function firstUsefulParallelSearch')
  || !legalMesh.includes('Promise.any(attempts)')
  || legalMesh.includes('const learnedOutcomes=await Promise.allSettled')
  || legalMesh.includes('const plannedOutcomes=await Promise.allSettled')) {
  throw new Error('Lexara supplemental discovery lost optimized parallel first-useful-result behavior');
}
if (!legalMesh.includes('firstUseful?: boolean')
  || !legalMesh.includes('Promise.any(providerAttempts)')
  || !legalMesh.includes('Promise.any(variantAttempts)')
  || !legalMesh.includes('const groups=options.firstUseful')
  || !background.includes('firstUseful: !deepAcquisitionRequested')) {
  throw new Error('Lexara live background discovery lost first-useful provider/query timing');
}
if (!background.includes('LIVE_TOTAL_CANDIDATES = 18')
  || !background.includes('LIVE_TARGETS_PER_PASS = 6')
  || background.includes('BROAD_PERSON_LIVE_TOTAL_CANDIDATES')
  || background.includes('BROAD_PERSON_LIVE_TARGETS_PER_PASS')) {
  throw new Error('Lexara broad-person research no longer keeps optimized live retrieval breadth');
}
if (!legalMesh.includes("if (!options.requestedFact || options.requestedFact === 'none') return false;")) {
  throw new Error('Official-source priority can still reorder non-factual legal research');
}
if (!router.includes('const contextualContinuation') || !router.includes('const contextualPrompt')) {
  throw new Error('Lexara sequence router does not preserve short factual follow-up context');
}
for (const plannerToken of ["'age-dob'","'professional-license'","'marriage-divorce'","'employment'","for a living","criminal background","arrest\\w*","standaloneQuery","sourceCategories","research-follow-up"]) {
  if (!planner.includes(plannerToken)) throw new Error('Lexara semantic research planner missing: '+plannerToken);
}
for (const semanticToken of [
  'resolveLexaraResearchDecisionSemantic',
  'Do not require special words',
  "deterministic.intent === 'legal'",
  "'mixed'",
]) {
  if (!semanticIntent.includes(semanticToken)) throw new Error('Lexara dynamic semantic inference missing: '+semanticToken);
}
for (const claudeToken of [
  'searchLexaraBackgroundWithClaude',
  'callClaudeWebSearch',
  "provider: 'claude-web-search'",
  'Always use the provided web search tool',
]) {
  if (!claudeBackground.includes(claudeToken)) throw new Error('Lexara Claude parallel background lane missing: '+claudeToken);
}
if (!background.includes('Promise.allSettled([')
  || !background.includes('searchLexaraBackgroundWithClaude({')
  || !background.includes('claudeCitationEvidence')) {
  throw new Error('Claude web search is not running in parallel with Lexara native background discovery/evidence scoring');
}
for (const claudeTransportToken of [
  'callClaudeWebSearch',
  "web_search_20260318",
  "allowed_callers: ['direct']",
  'web_search_requests',
  "response?.stop_reason === 'pause_turn'",
  "response?.stop_reason === 'max_tokens'",
  'sourceMap.size === 0',
  'preserving source evidence after max_tokens stop',
]) {
  if (!claudeTransport.includes(claudeTransportToken)) throw new Error('Claude web-search transport missing: '+claudeTransportToken);
}
if (!orchestrator.includes('const backgroundClaudeModel = context.allowClaudeOpus === true')
  || !orchestrator.includes('CURRENT_AI_MODELS.claudeBalanced')
  || !orchestrator.includes('CURRENT_AI_MODELS.claudeFast')
  || !orchestrator.includes('claudeResearchModel: backgroundClaudeModel')) {
  throw new Error('Claude background web search does not preserve trial/paid model routing');
}
if (!background.includes('dynamicGeneralObjectiveMatch')
  || !background.includes("decision.requestedFact !== 'general-public-record'")
  || !background.includes('decision.objective || decision.standaloneQuery')) {
  throw new Error('Open-ended semantic background facts still depend on a fixed keyword taxonomy');
}
if (!background.includes('This is only a guess, not a verified fact')
  || !background.includes('ANSWER-SCOPE RULE')
  || !background.includes('CORROBORATION RULE')) {
  throw new Error('Lexara narrow-answer and explicit-guess contract is missing');
}

for (const sourceToken of ['cdc-vital-records','nursys-license','careeronestop-license-finder','bop-inmate-locator','finra-brokercheck','sec-edgar','icann-rdap']) {
  if (!sourceRegistry.includes(sourceToken)) throw new Error('Lexara public source registry missing: '+sourceToken);
}
if (!routes.includes('documentIntent') || !routes.includes("send('complete'")) {  throw new Error('Document/action handoff missing');
}

console.log('LEXARA six-sequence routing verification passed with Pantheon disconnected and Lexara-native factual research wired.');
