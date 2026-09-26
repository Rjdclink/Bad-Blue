const fs=require('fs');
const router=fs.readFileSync('server/lexara/LexaraResearchIntentRouter.ts','utf8');
const investigation=fs.readFileSync('server/lexara/LexaraPantheonInvestigation.ts','utf8');
const conversation=fs.readFileSync('server/lexara/LexaraConversationOrchestrator.ts','utf8');

for(const token of [
  "'external-fact-question'",
  "if (question) {",
  "needed: true, reason: 'external-fact-question'",
]) if(!router.includes(token)) throw new Error('External fact routing invariant missing: '+token);

for(const token of [
  'const researchDecision = decideLexaraResearchNeed(prompt, recentUserTurns)',
  "researchDecision.needed && (researchDecision.objectiveKind !== 'legal-authority' || context.delegatedByLexara)",
  'hasEnoughIdentityContext(combined)',
]) if(!investigation.includes(token)) throw new Error('Pantheon intent handoff invariant missing: '+token);

for(const token of [
  'researchNeeded: researchDecision.needed',
  'pantheonTargeted: !!pantheonInvestigation',
  'pantheonSourceCount: pantheonInvestigation?.sources?.length || 0',
]) if(!conversation.includes(token)) throw new Error('Routing telemetry invariant missing: '+token);

const fixtures=[
  "What is Sarah Loretta Graves of Hartley, Iowa's birthday?",
  "Where is Joshua Robert Courier currently incarcerated?",
  "What is William Rodney Lawrence Clinkenbeard of Spirit Lake, Iowa's current mortgage?",
  "When was Ada Lovelace born?",
  "What company currently owns Example Corporation?",
  "Where is the current filing for Example Holdings?",
];
for(const q of fixtures) {
  if(!(/\?|^(?:what|when|where|who|which|how|is|are|was|were|does|do|did|has|have)\b/i.test(q))) {
    throw new Error('Research fixture does not reach external fact lane: '+q);
  }
}
console.log('Lexara external-fact and Pantheon handoff regression verification passed.');

for(const token of [
  'objectiveKind: LexaraResearchObjectiveKind',
  "'record-lookup'",
  "'current-information'",
]) if(!router.includes(token)) throw new Error('Structured research objective invariant missing: '+token);
for(const token of [
  "endpoint?: 'evidence-sufficient' | 'best-available-evidence' | 'partial-evidence' | 'budget-exhausted' | 'sources-exhausted' | 'clarification-required'",
  "'[LEXARA PantheonRoute]'",
  "stage: 'recursion-pass'",
  "stage: 'endpoint'",
  'evidenceAccepted:',
  'discoverPantheonSourcesParallel(',
  'buildLexaraDynamicCrawlerAssignments({',
  'primaryCrawlers:',
  'pendingTargets = [...new Set([...frontier, ...discovered])]',
]) if(!investigation.includes(token)) throw new Error('Pantheon endpoint/telemetry invariant missing: '+token);
for(const token of [
  "pantheonDelegatedByLexara && researchDecision.objectiveKind !== 'legal-authority'\n      ? pantheonInvestigationPromise",
  'pantheonEndpoint:',
  'pantheonRecursionPasses:',
  'researchEndpointReached:',
]) if(!conversation.includes(token)) throw new Error('Research-required synthesis gate missing: '+token);
console.log('Lexara/Pantheon full research architecture verification passed.');

if(router.includes('if (question && externallyVariable)') || router.includes('if (question && legalAuthority)')) {
  throw new Error('Unreachable legacy keyword gates remain after universal factual-question routing');
}
if(!conversation.includes('researchDecision.needed ? researchDecision.objective : cleanPrompt')) {
  throw new Error('Structured research objective is not handed into Pantheon');
}
console.log('No legacy keyword authority or objective-handoff regression detected.');
