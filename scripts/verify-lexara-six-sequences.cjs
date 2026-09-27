const fs = require('fs');
const router = fs.readFileSync('server/lexara/LexaraSequenceRouter.ts','utf8');
const orchestrator = fs.readFileSync('server/lexara/LexaraConversationOrchestrator.ts','utf8');
const web = fs.readFileSync('server/webSearchService.ts','utf8');
const pantheon = fs.readFileSync('server/lexara/LexaraPantheonInvestigation.ts','utf8');
const authority = fs.readFileSync('server/lexara/LexaraAuthorityResearch.ts','utf8');
const routes = fs.readFileSync('server/routes/lexara.chat.routes.ts','utf8');

for (const id of [
  "'simple-factual'",
  "'pantheon-background'",
  "'lexara-legal'",
  "'combined-legal-background'",
  "'deep-recursive'",
  "'document-action'",
]) {
  if (!router.includes(id)) throw new Error('Missing explicit sequence '+id);
}
for (const token of [
  'useLegalResearch',
  'usePantheon',
  'recursive',
  'classifyPantheon',
  'documentAction',
]) if (!router.includes(token)) throw new Error('Sequence contract missing '+token);

if (!orchestrator.includes('planLexaraSequence(cleanPrompt, previousUserTurns)')) throw new Error('Conversation orchestrator does not use six-sequence router');
if (!orchestrator.includes("sequencePlan.sequence === 'combined-legal-background'")) throw new Error('Mixed legal/background route is not explicit');
if (!orchestrator.includes('const pantheonDelegatedByLexara = sequencePlan.usePantheon') || !orchestrator.includes('pantheonDelegatedByLexara ? investigatePersonQuestion')) throw new Error('Pantheon handoff is not sequence-owned');
if (!orchestrator.includes('sequencePlan.useLegalResearch')) throw new Error('Legal research handoff is not sequence-owned');
if (!web.includes('discoverPantheonSourcesParallel(query') || !web.includes('pantheonRetrievalAdapter.retrieve')) throw new Error('Discovery-first -> crawler retrieval backbone missing');
if (!pantheon.includes('discoverPantheonSourcesParallel(') || !pantheon.includes('pantheonRetrievalAdapter.retrieve')) throw new Error('Recursive Pantheon discovery/retrieval missing');
if (!authority.includes('discoverLegalMeshTier3') || !authority.includes('enrichAuthoritySourcesWithCrawlerPool')) throw new Error('Lexara legal discovery/crawler sequence missing');
if (!routes.includes('documentIntent') || !routes.includes("send('complete'")) throw new Error('Document/action handoff missing');

console.log('LEXARA/Pantheon six-sequence routing verification passed.');
