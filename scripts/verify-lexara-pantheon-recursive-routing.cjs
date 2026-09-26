const fs = require('fs');

const investigation = fs.readFileSync('server/lexara/LexaraPantheonInvestigation.ts', 'utf8');
const adapter = fs.readFileSync('server/services/crawlers/PantheonRetrievalAdapter.ts', 'utf8');
const supplemental = fs.readFileSync('server/services/pantheon/PantheonSupplementalDiscovery.ts', 'utf8');
const coordinator = fs.readFileSync('server/services/pantheon/PantheonDiscoveryCoordinator.ts', 'utf8');
const learning = fs.readFileSync('server/services/pantheon/PantheonDiscoveryLearning.ts', 'utf8');
const searxSettings = fs.readFileSync('infrastructure/pantheon/searxng/settings.yml', 'utf8');
const ddgsDockerfile = fs.readFileSync('infrastructure/pantheon/ddgs/Dockerfile', 'utf8');
const openserpDockerfile = fs.readFileSync('infrastructure/pantheon/openserp/Dockerfile', 'utf8');
const learningMigration = fs.readFileSync('server/migrations/062_pantheon_discovery_learning.sql', 'utf8');
const dockerfile = fs.readFileSync('Dockerfile', 'utf8');

for (const token of [
  'PERSON_RECURSIVE_MAX_PASSES = 30',
  'PERSON_RECURSIVE_MAX_TARGETS_PER_PASS = 10',
  'PERSON_RECURSIVE_MAX_TOTAL_TARGETS = 30',
  'PERSON_RECURSIVE_TOTAL_BUDGET_MS = 10 * 60_000',
  'PERSON_PROGRESSIVE_CONFIDENCE_THRESHOLD = 0.80',
  'PERSON_RECURSIVE_SUFFICIENT_EVIDENCE = 2',
  'buildLexaraDynamicCrawlerAssignments',
  'PANTHEON_PRIMARY_CRAWLER_IDS',
  'primaryCrawlers:',
  'retrieval.frontierCandidates?.discoveredCandidates',
  'retrieval.frontierCandidates?.sourceNavigationCandidates',
]) {
  if (!investigation.includes(token)) throw new Error('Missing bounded recursive routing invariant: ' + token);
}
if (/depth:\s*1[\s\S]{0,250}purpose:\s*'lexara_legal_research'/.test(investigation)) {
  throw new Error('Lexara person retrieval regressed to single-crawler depth-1 routing');
}
for (const token of [
  'primaryCrawlers?: PantheonPrimaryCrawlerId[]',
  "request.purpose !== 'background_report' && request.primaryCrawlers?.length",
  "plan.crawlers = [...new Set(request.primaryCrawlers)]",
]) {
  if (!adapter.includes(token)) throw new Error('Retrieval adapter missing capability-routing invariant: ' + token);
}
console.log('Lexara/Pantheon bounded recursive capability routing verification passed.');

for (const token of ['SERPAPI_KEY','SCRAPINGBEE_API_KEY','rememberPantheonDiscoveryOutcome']) {
  if (!supplemental.includes(token)) throw new Error('Supplemental discovery missing invariant: ' + token);
}
for (const token of [
  'SEARXNG_URL',
  'DDGS_URL',
  "method: 'POST'",
  "body: JSON.stringify({ query, max_results: limit, safesearch: 'off' })",
  'OPENSERP_URL',
  "'commoncrawl'",
  'Promise.all([',
  'Credit-bearing providers remain a true fallback',
  'supplementalPantheonDiscovery(effectiveQuery',
]) {
  if (!coordinator.includes(token)) throw new Error('Parallel discovery coordinator missing invariant: ' + token);
}
for (const token of [
  'pantheon_discovery_learning',
  'CREATE TABLE IF NOT EXISTS',
  'successes',
  'failures',
  'avg_latency_ms',
  'getPantheonLearnedSources',
  'rankPantheonDiscoveryUrls',
  'getPantheonLearnedQueryPatterns',
  'ENABLE ROW LEVEL SECURITY',
]) {
  if (!learning.includes(token)) throw new Error('Persistent discovery learning missing invariant: ' + token);
}
if (!investigation.includes('discoverPantheonSourcesParallel(') || !investigation.includes('rememberPantheonDiscoveryOutcome(')) {
  throw new Error('Parallel discovery/learning is not piped through Pantheon person retrieval');
}
if (!coordinator.includes('learnedPatternPromise') || !coordinator.includes('if (freeUrls.length || options.includePaidFallback === false)')) {
  throw new Error('Persisted query learning must stay off the normal successful discovery latency path');
}
if (!searxSettings.includes('- json') || !ddgsDockerfile.includes('ddgs[api]') || !openserpDockerfile.includes('karust/openserp')) {
  throw new Error('Self-hosted keyless discovery service definitions are incomplete');
}
if (!learningMigration.includes('pantheon_discovery_learning') ||
    !learningMigration.includes('ENABLE ROW LEVEL SECURITY') ||
    !dockerfile.includes('062_pantheon_discovery_learning.sql')) {
  throw new Error('Durable discovery learning migration is not secured and shipped end to end');
}
console.log('Parallel keyless discovery, credit fallback, persistent learning, and self-host definitions verification passed.');

const conversation = fs.readFileSync('server/lexara/LexaraConversationOrchestrator.ts', 'utf8');
for (const token of [
  'PERSON_PERMISSION_REFUSAL_PATTERN',
  'pantheonInvestigation && isPersonPermissionRefusal(text)',
  'answer contains that prohibited refusal pattern, so normal turns gain no',
  'extra latency.',
  'I could not verify the requested fact from the sources Pantheon completed.'
]) {
  if (!conversation.includes(token)) throw new Error('Person-record permission guard missing invariant: ' + token);
}
console.log('Person-record private-subject permission-refusal guard verification passed.');
