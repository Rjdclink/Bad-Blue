const fs = require('fs');
const router = fs.readFileSync('server/lexara/LexaraSequenceRouter.ts','utf8');
const orchestrator = fs.readFileSync('server/lexara/LexaraConversationOrchestrator.ts','utf8');
const background = fs.readFileSync('server/lexara/LexaraStandaloneBackgroundResearch.ts','utf8');
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
if (!background.includes('discoverLexaraBackgroundSourcesParallel') || !background.includes('duckduckgo-instant')) throw new Error('Lexara-owned background discovery backbone missing');
if (/LexaraPantheon|services\/pantheon|discoverPantheon|pantheonRetrievalAdapter/.test(background)) throw new Error('Pantheon dependency remains in Lexara background research');
if (!orchestrator.includes('backgroundResearchRequested\n      ? mixedLegalFactNeed') || !orchestrator.includes(': backgroundInvestigationPromise')) throw new Error('Selected Lexara background route is not awaited through the execution path');
if (!orchestrator.includes('researchEndpointReached: !researchDecision.needed || Boolean(authorityResearch || backgroundEndpoint)')) throw new Error('Research endpoint telemetry must use an explicit Lexara background endpoint rather than a routed investigation object');
if (!authority.includes('discoverLegalMeshTier3') || !authority.includes('enrichAuthoritySourcesWithCrawlerPool')) throw new Error('Lexara legal discovery/crawler sequence missing');
if (!routes.includes('documentIntent') || !routes.includes("send('complete'")) throw new Error('Document/action handoff missing');

console.log('LEXARA six-sequence routing verification passed with standalone background research.');
