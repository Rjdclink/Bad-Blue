const fs=require('fs');

const escalation=fs.readFileSync('server/services/pantheon/PantheonRetrievalEscalation.ts','utf8');
const acquisition=fs.readFileSync('server/services/crawlers/PublicAcquisitionInfrastructure.ts','utf8');
const registry=fs.readFileSync('server/lexara/LexaraCrawlerCapabilityRegistry.ts','utf8');

for(const token of [
  "'javascript_required'",
  "'captcha_challenge'",
  "'browser-render'",
  "'structured-extraction'",
  "lanes: ['stop']",
]) {
  if(!escalation.includes(token)) throw new Error('Pantheon escalation planner missing invariant: '+token);
}
if(!acquisition.includes("'challenge_detected'") ||
   !acquisition.includes("errorType: 'challenge_detected'")) {
  throw new Error('Pantheon canonical acquisition does not distinguish challenge pages');
}
if(!registry.includes("c('puppeteer'") ||
   !registry.includes("['web-discovery', 'deep-crawl']")) {
  throw new Error('Existing browser retrieval capability is no longer represented');
}
console.log('Pantheon resilient retrieval escalation verification passed.');
