const fs = require('fs');
const router = fs.readFileSync('server/lexara/LexaraSequenceRouter.ts','utf8');
const orchestrator = fs.readFileSync('server/lexara/LexaraConversationOrchestrator.ts','utf8');
const boundary = fs.readFileSync('server/lexara/LexaraBackgroundResearchBoundary.ts','utf8');
const authority = fs.readFileSync('server/lexara/LexaraAuthorityResearch.ts','utf8');
const legalMesh = fs.readFileSync('server/lexara/LegalProviderMesh.ts','utf8');
const routes = fs.readFileSync('server/routes/lexara.chat.routes.ts','utf8');

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

if (!orchestrator.includes('planLexaraSequence(cleanPrompt, previousUserTurns)')) throw new Error('Conversation orchestrator does not use six-sequence router');
if (!orchestrator.includes('sequencePlan.useBackgroundResearch && sequencePlan.useLegalResearch')) throw new Error('Mixed legal/background route is not explicit');
if (!orchestrator.includes('const backgroundResearchRequested = sequencePlan.useBackgroundResearch') || !orchestrator.includes('investigateLexaraBackgroundQuestion(backgroundPrompt')) throw new Error('Lexara background route is not sequence-owned');
if (!orchestrator.includes('sequencePlan.useLegalResearch')) throw new Error('Legal research handoff is not sequence-owned');
if (!boundary.includes('discoverLexaraBackgroundSourcesParallel') || !boundary.includes('duckduckgo-instant') || !boundary.includes('duckduckgo-html')) throw new Error('Lexara-owned discovery backbone missing');
if (!orchestrator.includes('backgroundResearchRequested\n      ? mixedLegalFactNeed') || !orchestrator.includes(': backgroundInvestigationPromise')) throw new Error('Selected Lexara background route is not awaited through the execution path');
if (!orchestrator.includes('researchEndpointReached: !researchDecision.needed || Boolean(authorityResearch || backgroundEndpoint)')) throw new Error('Research endpoint telemetry must use an explicit Lexara background endpoint');
if (!authority.includes('discoverLegalMeshTier3') || !authority.includes('enrichAuthoritySourcesWithCrawlerPool')) throw new Error('Lexara legal discovery/crawler sequence missing');
if (!legalMesh.includes('discoverLexaraBackgroundSourcesParallel') || legalMesh.includes('discoverPantheonSourcesParallel')) throw new Error('Lexara legal discovery is not isolated from Pantheon');
if (!routes.includes('documentIntent') || !routes.includes("send('complete'")) throw new Error('Document/action handoff missing');

for (const [name, source] of [
  ['Lexara background boundary', boundary],
  ['Lexara orchestrator', orchestrator],
  ['Lexara legal mesh', legalMesh],
]) {
  if (/LexaraPantheon|services\/pantheon|discoverPantheon|pantheonRetrievalAdapter/.test(source)) {
    throw new Error(name + ' still depends on Pantheon');
  }
}

console.log('LEXARA six-sequence routing verification passed with Pantheon fully detached.');
