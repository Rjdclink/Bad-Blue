const fs = require('node:fs');

const boundary = fs.readFileSync('server/lexara/LexaraBackgroundResearchBoundary.ts', 'utf8');
const orchestrator = fs.readFileSync('server/lexara/LexaraConversationOrchestrator.ts', 'utf8');
const legalMesh = fs.readFileSync('server/lexara/LegalProviderMesh.ts', 'utf8');

for (const [name, source] of [
  ['Lexara background boundary', boundary],
  ['Lexara conversation orchestrator', orchestrator],
  ['Lexara legal provider mesh', legalMesh],
]) {
  if (/LexaraPantheon|services\/pantheon|PantheonDiscovery|PantheonRetrieval|discoverPantheon|pantheonRetrievalAdapter/.test(source)) {
    throw new Error(name + ' still depends on Pantheon');
  }
}

for (const token of [
  'discoverLexaraBackgroundSourcesParallel',
  'duckduckgo-instant',
  'duckduckgo-html',
  'APPLICATION-SUPPLIED LEXARA BACKGROUND RESEARCH',
  'investigateLexaraBackgroundQuestion',
  'formatLexaraBackgroundResearchForSystem',
]) {
  if (!boundary.includes(token)) throw new Error('Lexara-native background research invariant missing: ' + token);
}

for (const token of [
  'investigateLexaraBackgroundQuestion(backgroundPrompt',
  'formatLexaraBackgroundResearchForSystem(backgroundInvestigation)',
  'const backgroundResearchRequested = sequencePlan.useBackgroundResearch',
  'const authorityResearchPromise = sequencePlan.useLegalResearch',
]) {
  if (!orchestrator.includes(token)) throw new Error('Lexara routing invariant missing: ' + token);
}

if (!legalMesh.includes('discoverLexaraBackgroundSourcesParallel')) {
  throw new Error('Lexara legal provider mesh is not using the Lexara-owned discovery boundary');
}
if (legalMesh.includes('discoverPantheonSourcesParallel')) {
  throw new Error('Lexara legal provider mesh still imports Pantheon discovery');
}

console.log('PASS Lexara research routing is Pantheon-independent');
