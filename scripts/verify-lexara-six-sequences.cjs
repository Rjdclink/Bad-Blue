const fs = require('fs');
const router = fs.readFileSync('server/lexara/LexaraSequenceRouter.ts','utf8');
const orchestrator = fs.readFileSync('server/lexara/LexaraConversationOrchestrator.ts','utf8');
const web = fs.readFileSync('server/webSearchService.ts','utf8');
const pantheon = fs.readFileSync('server/lexara/LexaraPantheonInvestigation.ts','utf8');
const authority = fs.readFileSync('server/lexara/LexaraAuthorityResearch.ts','utf8');
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
if (!web.includes('discoverPantheonSourcesParallel(query') || !web.includes('pantheonRetrievalAdapter.retrieve')) throw new Error('Discovery-first -> crawler retrieval backbone missing');
if (!pantheon.includes('discoverPantheonSourcesParallel(') || !pantheon.includes('pantheonRetrievalAdapter.retrieve')) throw new Error('Recursive Pantheon discovery/retrieval missing');
// Execution contract: a selected Pantheon route must have an executable frontier.
// This specifically prevents the production regression where the router selected
// Pantheon but an undeclared legacy registryUrls identifier crashed before crawler dispatch.
if (pantheon.includes('...registryUrls')) throw new Error('Stale undefined registryUrls can crash Pantheon before crawler dispatch');
if (!pantheon.includes('const targets = [...new Set([...explicitUrls, ...discoveredUrls, ...categorySeedUrls])]')) throw new Error('Pantheon selected route must include safe user-supplied URLs, discovered sources, and scoped seeds');
if (!orchestrator.includes('backgroundResearchRequested\n      ? mixedLegalFactNeed') || !orchestrator.includes(': backgroundInvestigationPromise')) throw new Error('Selected Lexara background route is not awaited through the execution path');
if (!orchestrator.includes('researchEndpointReached: !researchDecision.needed || Boolean(authorityResearch || backgroundEndpoint)')) throw new Error('Research endpoint telemetry must use an explicit Lexara background endpoint rather than a routed investigation object');
if (!authority.includes('discoverLegalMeshTier3') || !authority.includes('enrichAuthoritySourcesWithCrawlerPool')) throw new Error('Lexara legal discovery/crawler sequence missing');
if (!routes.includes('documentIntent') || !routes.includes("send('complete'")) throw new Error('Document/action handoff missing');

console.log('LEXARA six-sequence routing verification passed.');
