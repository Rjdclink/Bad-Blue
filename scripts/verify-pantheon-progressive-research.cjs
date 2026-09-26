const fs=require('fs');
const pantheon=fs.readFileSync('server/lexara/LexaraPantheonInvestigation.ts','utf8');
const authority=fs.readFileSync('server/lexara/LexaraAuthorityResearch.ts','utf8');
const client=fs.readFileSync('client/src/components/LexaraConversation.tsx','utf8');
const routes=fs.readFileSync('server/routes/lexara.chat.routes.ts','utf8');
const orchestrator=fs.readFileSync('server/lexara/LexaraConversationOrchestrator.ts','utf8');
for(const token of [
 'PERSON_RECURSIVE_MAX_PASSES = 30',
 'PERSON_RECURSIVE_MAX_TARGETS_PER_PASS = 10',
 'PERSON_RECURSIVE_MAX_TOTAL_TARGETS = 30',
 'PERSON_RECURSIVE_TOTAL_BUDGET_MS = 10 * 60_000',
 'STRUCTURED_CUSTODY_BUDGET_MS = 5 * 60_000',
 'PERSON_PROGRESSIVE_CONFIDENCE_THRESHOLD = 0.80',
 'PERSON_HIGH_CONFIDENCE_STOP_THRESHOLD = 0.93',
 "stage: 'evidence-progress'",
 'publishableEvidence:',
 'perPassBudgetMs = Math.min(20_000, remainingMs)',
]) if(!pantheon.includes(token)) throw new Error('Progressive Pantheon invariant missing '+token);
if(!authority.includes('RESEARCH_TIMEOUT_MS = 3 * 60_000')) throw new Error('Authority research is not capped at three minutes');
for(const token of [
 'CHAT_TURN_TIMEOUT_MS = 10 * 60_000',
 'RESEARCH_PROGRESS_FIRST_MS = 8_000',
 'RESEARCH_PROGRESS_REPEAT_MS = 30_000',
 "I'm still looking for that information.",
 "I'm still researching that and checking additional sources.",
 'nonSemanticLexaraMessageIdsRef.current.add(progressMessageId)',
]) if(!client.includes(token)) throw new Error('Lexara progressive UX invariant missing '+token);
console.log('Pantheon progressive research lifecycle verification passed.');

for(const token of [
 "router.post('/chat/stream'",
 "'Content-Type', 'text/event-stream'",
 "send('research', event)",
 "send('complete'",
 "': keepalive",
]) if(!routes.includes(token)) throw new Error('SSE route invariant missing '+token);
for(const token of [
 'onResearchProgress?:',
 'onProgress: context.onResearchProgress',
]) if(!orchestrator.includes(token)) throw new Error('Pantheon progress pipe missing '+token);
for(const token of [
 "type: 'searching' | 'evidence' | 'endpoint'",
 "context.onProgress?.({ type: 'searching'",
 "context.onProgress?.({ type: 'evidence'",
 "context.onProgress?.({ type: 'endpoint'",
]) if(!pantheon.includes(token)) throw new Error('Pantheon progressive event invariant missing '+token);
console.log('Pantheon SSE progress pipeline verification passed.');
