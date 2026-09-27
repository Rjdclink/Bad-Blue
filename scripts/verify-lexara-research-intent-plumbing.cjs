const fs=require('fs');
const router=fs.readFileSync('server/lexara/LexaraResearchIntentRouter.ts','utf8');
const conversation=fs.readFileSync('server/lexara/LexaraConversationOrchestrator.ts','utf8');
const authority=fs.readFileSync('server/lexara/LexaraAuthorityResearch.ts','utf8');
for(const token of [
  'decideLexaraResearchNeed',
  "'explicit-research'",
  "'current-external-fact'",
  "'legal-authority'",
  "'research-follow-up'",
  'previousUserTurns].reverse().find',
]) if(!router.includes(token)) throw new Error('Research intent router missing '+token);
for(const token of [
  'sequencePlan = planLexaraSequence(cleanPrompt, previousUserTurns)',
  'const researchDecision = sequencePlan.researchDecision',
  "'[LEXARA ResearchRoute]'",
  'sequence: sequencePlan.sequence',
  'researchNeeded: researchDecision.needed',
  'researchDecision.needed ? researchDecision.objective : cleanPrompt',
]) if(!conversation.includes(token)) throw new Error('Conversation research plumbing missing '+token);
if(!authority.includes('return decideLexaraResearchNeed(text).needed')) {
  throw new Error('Grounded authority research is not intent-routed');
}
console.log('Lexara research-intent Pantheon plumbing verification passed.');
