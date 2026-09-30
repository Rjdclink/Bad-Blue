const fs = require('fs');

const router = fs.readFileSync('server/lexara/LexaraSequenceRouter.ts', 'utf8');
const orchestrator = fs.readFileSync('server/lexara/LexaraConversationOrchestrator.ts', 'utf8');
const legalMesh = fs.readFileSync('server/lexara/LegalProviderMesh.ts', 'utf8');
const authority = fs.readFileSync('server/lexara/LexaraAuthorityResearch.ts', 'utf8');
const retrieval = fs.readFileSync('server/lexara/LexaraRetrievalBoundary.ts', 'utf8');
const pantheonRegistry = fs.readFileSync('server/services/pantheon/PantheonSovereignSourceRegistry.ts', 'utf8');
const pantheonDiscovery = fs.readFileSync('server/services/pantheon/PantheonDiscoveryCoordinator.ts', 'utf8');

if (router.includes('useBackgroundResearch: true')) {
  throw new Error('Lexara sequence routing still enables Pantheon/background research');
}
if (!router.includes('useLegalResearch: true, useBackgroundResearch: false')) {
  throw new Error('Lexara factual/research sequences do not select legal reasoning');
}
if (orchestrator.includes("from './LexaraBackgroundResearchBoundary'")
  || orchestrator.includes("from './LexaraPantheonInvestigation'")
  || orchestrator.includes("from '../services/pantheon/")) {
  throw new Error('Lexara conversation runtime still imports Pantheon');
}
if (!orchestrator.includes('const backgroundResearchRequested = false')
  || !orchestrator.includes('(sequencePlan.useLegalResearch || researchDecision.needed)')) {
  throw new Error('Lexara user research is not hard-routed to the legal research service');
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
for (const forbidden of ['PantheonRetrievalAdapter', 'pantheonRetrievalAdapter', '../services/pantheon/', '../services/crawlers/Pantheon']) {
  if (retrieval.includes(forbidden)) throw new Error('Lexara retrieval boundary still depends on Pantheon: ' + forbidden);
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
