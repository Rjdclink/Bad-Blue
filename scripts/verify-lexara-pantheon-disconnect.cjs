const fs = require('fs');

const router = fs.readFileSync('server/lexara/LexaraSequenceRouter.ts', 'utf8');
const subject = fs.readFileSync('server/lexara/LexaraBackgroundSubject.ts', 'utf8');
const orchestrator = fs.readFileSync('server/lexara/LexaraConversationOrchestrator.ts', 'utf8');
const legalMesh = fs.readFileSync('server/lexara/LegalProviderMesh.ts', 'utf8');
const authority = fs.readFileSync('server/lexara/LexaraAuthorityResearch.ts', 'utf8');
const retrieval = fs.readFileSync('server/lexara/LexaraRetrievalBoundary.ts', 'utf8');
const background = fs.readFileSync('server/lexara/LexaraBackgroundInvestigation.ts', 'utf8');
const compatibilityBoundary = fs.readFileSync('server/lexara/LexaraBackgroundResearchBoundary.ts', 'utf8');
const semantic = fs.readFileSync('server/lexara/LexaraSemanticIntentInterpreter.ts', 'utf8');
const claudeBackground = fs.readFileSync('server/lexara/LexaraClaudeBackgroundSearch.ts', 'utf8');
const pantheonRegistry = fs.readFileSync('server/services/pantheon/PantheonSovereignSourceRegistry.ts', 'utf8');
const pantheonDiscovery = fs.readFileSync('server/services/pantheon/PantheonDiscoveryCoordinator.ts', 'utf8');

if (!router.includes('useBackgroundResearch: true')
  || !router.includes("useLegalResearch: false, useBackgroundResearch: true")
  || !router.includes("useLegalResearch: true, useBackgroundResearch: false")) {
  throw new Error('Lexara AND-OR routing is not preserving independent legal/background selection');
}
for (const activeSource of [router, subject]) {
  if (activeSource.includes('LexaraBackgroundSemanticIntent') || activeSource.includes("../services/pantheon/")) {
    throw new Error('Active Lexara routing/subject classification still imports Pantheon semantics');
  }
}
if (orchestrator.includes("from './LexaraBackgroundResearchBoundary'")
  || orchestrator.includes("from './LexaraPantheonInvestigation'")
  || orchestrator.includes("from '../services/pantheon/")) {
  throw new Error('Lexara conversation runtime still imports Pantheon');
}
if (!orchestrator.includes("const backgroundResearchRequested = sequencePlan.useBackgroundResearch")
  || !orchestrator.includes('const researchRouteSelected = sequencePlan.useLegalResearch')
  || !orchestrator.includes('forceResearch: true')
  || !orchestrator.includes("from './LexaraBackgroundInvestigation'")) {
  throw new Error('Lexara factual research is not wired to the native background investigator while legal research remains intact');
}
for (const forbidden of ['discoverPantheonSourcesParallel', 'PantheonDiscoveryCoordinator', 'LexaraBackgroundResearchBoundary']) {
  if (legalMesh.includes(forbidden)) throw new Error('Lexara legal provider mesh still depends on Pantheon: ' + forbidden);
}
for (const required of ['tavily', 'SEARXNG_URL', 'DDGS_URL', 'OPENSERP_URL']) {
  if (!legalMesh.includes(required)) throw new Error('Lexara direct legal discovery lane missing: ' + required);
}
if (!authority.includes('discoverLegalMeshTier3') || !authority.includes('discoverLegalMeshSupplemental')) {
  throw new Error('Lexara authority research is not using the independent legal provider mesh');
}
if (authority.includes('selectLexaraCrawlerPlan') || authority.includes('PantheonRetrievalAdapter')) {
  throw new Error('Lexara authority research still selects or imports Pantheon retrieval machinery');
}
for (const activeLexaraSource of [semantic, claudeBackground]) {
  for (const forbidden of ['LexaraPantheon', 'PantheonDiscoveryCoordinator', '../services/pantheon/', 'PantheonRetrievalAdapter']) {
    if (activeLexaraSource.includes(forbidden)) throw new Error('New Lexara semantic/Claude background path still depends on Pantheon: ' + forbidden);
  }
}
for (const forbidden of ['PantheonRetrievalAdapter', 'pantheonRetrievalAdapter', '../services/pantheon/', '../services/crawlers/Pantheon']) {
  if (retrieval.includes(forbidden)) throw new Error('Lexara retrieval boundary still depends on Pantheon: ' + forbidden);
  if (background.includes(forbidden)) throw new Error('Lexara background investigator still depends on Pantheon: ' + forbidden);
}
for (const forbidden of ['LexaraPantheonInvestigation', 'PantheonDiscoveryCoordinator', '../services/pantheon/', 'discoverPantheonSourcesParallel']) {
  if (compatibilityBoundary.includes(forbidden)) {
    throw new Error('Legacy Lexara background compatibility boundary can still reconnect Pantheon: ' + forbidden);
  }
}
for (const required of ['LexaraBackgroundInvestigation', 'investigateLexaraBackgroundQuestion', 'formatLexaraBackgroundResearchForSystem', 'discoverLexaraBackgroundSourcesParallel']) {
  if (!compatibilityBoundary.includes(required)) {
    throw new Error('Legacy Lexara background compatibility boundary is not pinned to the native investigator: ' + required);
  }
}
for (const required of ['discoverLegalMeshTier3', 'discoverLegalMeshSupplemental', 'lexaraRetrievalAdapter', 'MAX_RECURSIVE_PASSES', 'directlyAnswers']) {
  if (!background.includes(required)) throw new Error('Lexara native background investigator missing: ' + required);
}
for (const required of ["purpose: 'lexara_legal_research'", 'assertPublicUrl', 'retrieveOne', 'lexaraRetrievalAdapter']) {
  if (!retrieval.includes(required)) throw new Error('Lexara independent retrieval boundary missing: ' + required);
}
for (const required of ['buildPantheonCategoryTargets', 'KEYLESS_CATEGORY_SOURCES']) {
  if (!pantheonRegistry.includes(required)) throw new Error('Pantheon was altered or removed unexpectedly: ' + required);
}
if (!pantheonDiscovery.includes('discoverPantheonSourcesParallel')) {
  throw new Error('Pantheon discovery implementation was removed unexpectedly');
}

console.log('PASS: Pantheon remains intact and is disconnected from Lexara user-request routing.');
