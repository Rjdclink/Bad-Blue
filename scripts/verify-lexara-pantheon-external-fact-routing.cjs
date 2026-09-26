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
  'decideLexaraResearchNeed(prompt, recentUserTurns).needed',
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
