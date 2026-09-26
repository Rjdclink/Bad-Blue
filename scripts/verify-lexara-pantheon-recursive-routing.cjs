const fs = require('fs');

const investigation = fs.readFileSync('server/lexara/LexaraPantheonInvestigation.ts', 'utf8');
const adapter = fs.readFileSync('server/services/crawlers/PantheonRetrievalAdapter.ts', 'utf8');
const supplemental = fs.readFileSync('server/services/pantheon/PantheonSupplementalDiscovery.ts', 'utf8');

for (const token of [
  'PERSON_RECURSIVE_MAX_PASSES = 3',
  'PERSON_RECURSIVE_MAX_TOTAL_TARGETS = 18',
  'PERSON_RECURSIVE_TOTAL_BUDGET_MS = 4_500',
  'PERSON_RECURSIVE_SUFFICIENT_EVIDENCE = 2',
  'selectLexaraCrawlerPlan',
  'PANTHEON_PRIMARY_CRAWLER_IDS',
  'primaryCrawlers,',
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

for (const token of ['SERPAPI_KEY','SCRAPINGBEE_API_KEY','learnedDiscoveryHosts','rememberPantheonDiscoverySuccess']) {
  if (!supplemental.includes(token)) throw new Error('Supplemental discovery missing invariant: ' + token);
}
if (!investigation.includes("if (!frontier.length && !discovered.length && acceptedEvidence.size === 0)")) {
  throw new Error('Paid discovery must remain last-resort after internal discovery is exhausted');
}
if (!investigation.includes('supplementalPantheonDiscovery(') || !investigation.includes('rememberPantheonDiscoverySuccess(')) {
  throw new Error('Supplemental discovery is not piped through Pantheon retrieval/learning');
}
console.log('Credit-aware supplemental discovery verification passed.');

const conversation = fs.readFileSync('server/lexara/LexaraConversationOrchestrator.ts', 'utf8');
for (const token of [
  'PERSON_PERMISSION_REFUSAL_PATTERN',
  'pantheonInvestigation && isPersonPermissionRefusal(text)',
  'normal turns gain no extra latency',
  'I could not verify the requested fact from the sources Pantheon completed.'
]) {
  if (!conversation.includes(token)) throw new Error('Person-record permission guard missing invariant: ' + token);
}
console.log('Person-record private-subject permission-refusal guard verification passed.');
