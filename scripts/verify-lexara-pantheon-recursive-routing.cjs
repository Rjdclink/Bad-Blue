const fs = require('fs');

const investigation = fs.readFileSync('server/lexara/LexaraPantheonInvestigation.ts', 'utf8');
const adapter = fs.readFileSync('server/services/crawlers/PantheonRetrievalAdapter.ts', 'utf8');

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
