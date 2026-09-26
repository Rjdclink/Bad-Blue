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
 'PERSON_PROGRESSIVE_CONFIDENCE_THRESHOLD = 0.50',
 'PERSON_HIGH_CONFIDENCE_STOP_THRESHOLD = 0.80',
 "stage: 'evidence-progress'",
 'publishableEvidence:',
 'perPassBudgetMs = Math.min(pass === 0 ? 25_000 : 60_000, remainingMs)',
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
 "type: 'searching' | 'checkpoint' | 'evidence' | 'endpoint'",
 "context.onProgress?.({ type: 'searching'",
 "context.onProgress?.({ type: 'evidence'",
 "context.onProgress?.({ type: 'endpoint'",
]) if(!pantheon.includes(token)) throw new Error('Pantheon progressive event invariant missing '+token);
console.log('Pantheon SSE progress pipeline verification passed.');

for(const token of [
 'readLexaraSseResponse',
 "fetch('/api/lexara/chat/stream'",
 "Accept: 'text/event-stream'",
 "event !== 'research'",
 "payload?.type === 'evidence'",
 "payload?.type === 'evidence' || payload?.type === 'checkpoint'",
 "I'm continuing to verify this.",
]) if(!client.includes(token)) throw new Error('Client SSE consumer invariant missing '+token);
console.log('Pantheon progressive server-to-browser evidence pipe verification passed.');

const learning=fs.readFileSync('server/services/pantheon/PantheonDiscoveryLearning.ts','utf8');
const migration=fs.readFileSync('server/migrations/063_pantheon_generalized_source_learning.sql','utf8');
for(const token of [
 'objective_pattern',
 'entity_type',
 'evidence_confidence',
 'evidence_yield',
 'CASE WHEN category =',
]) if(!learning.includes(token)) throw new Error('Generalized source-learning invariant missing '+token);
for(const token of ['objective_pattern','entity_type','evidence_confidence','evidence_yield']) if(!migration.includes(token)) throw new Error('Generalized source-learning migration missing '+token);
for(const token of [
 'PERSON_SOFT_CHECKPOINTS_MS = [25_000, 60_000, 120_000, 300_000]',
 'A source/pass deadline is route-local',
 'contradictionPenalty = identityMatch.conflicts.length > 0',
 "resolvedEntityType = resolvedOrganization && !resolvedName ? 'organization' : 'person'",
]) if(!pantheon.includes(token)) throw new Error('Progressive research blueprint invariant missing '+token);
console.log('Pantheon full progressive-learning blueprint verification passed.');

for(const token of [
 'const globalDeadlineAt = recursiveStartedAt + PERSON_RECURSIVE_TOTAL_BUDGET_MS',
 'deadlineAt: Math.min(globalDeadlineAt, retrievalStartedAt + perPassBudgetMs)',
 'const surfacedEvidenceKeys = new Set<string>()',
]) if(!pantheon.includes(token)) throw new Error('Deadline/deduplication invariant missing '+token);

for(const token of [
 'const researchLikely =',
 'const canReuseSpeculative = speculative?.text === message && !researchLikely',
]) if(!client.includes(token)) throw new Error('Research SSE authority invariant missing '+token);
for(const token of [
 'const bestEvidence = rankedEntries[0] ? acceptedEvidence.get(rankedEntries[0][0])',
 'const finalBestEvidence = evidenceEntries[0]?.[1]',
]) if(!pantheon.includes(token)) throw new Error('Fact-specific contradiction stop invariant missing '+token);

const registry=fs.readFileSync('server/lexara/LexaraCrawlerCapabilityRegistry.ts','utf8');
const adapter=fs.readFileSync('server/services/crawlers/PantheonRetrievalAdapter.ts','utf8');
const razors=fs.readFileSync('server/services/pantheon/razors/implementations.ts','utf8');
for(const token of [
 "desired.add('vital-records')",
 "desired.add('occupation')",
 "desired.add('incarceration')",
 "desired.add('structured-extraction')",
]) if(!registry.includes(token)) throw new Error('Fact-specific crawler selection invariant missing '+token);
for(const token of [
 'buildLexaraDynamicCrawlerAssignments',
 'const explorationPrimaryQueue =',
 "crawlerMode: pass === 0 ? 'selected' : 'mandatory-capability-exploration'",
]) if(!pantheon.includes(token)) throw new Error('Crawler escalation invariant missing '+token);
for(const token of [
 'Conversational research also gets the full extraction/analysis skill',
 'PANTHEON_RAZOR_SKILL_IDS',
 'PANTHEON_SECONDARY_CRAWLER_IDS',
 'PANTHEON_PORTABLE_CAPABILITY_IDS',
 "'[PANTHEON][CONVERSATIONAL-CAPABILITY-BATCH]'",
]) if(!adapter.includes(token)) throw new Error('Conversational crawler-skill execution invariant missing '+token);
for(const token of ['occupationMatch','employerMatch','custodyMatch','facilityMatch','inmateNumberMatch']) if(!razors.includes(token)) throw new Error('Fact extraction invariant missing '+token);
console.log('Pantheon crawler capability escalation and fact extraction verification passed.');

const matrix=fs.readFileSync('server/services/pantheon/PantheonCrawlerCapabilityMatrix.ts','utf8');
for(const token of [
 'PANTHEON_CATEGORY_EXTRACTION_SCHEMAS',
 'getPantheonCategoryExtractionSchema',
 "Pantheon category has no complete extraction schema",
 "Employment History': { objectiveFields:",
 "Incarceration & Corrections': { objectiveFields:",
 "Bankruptcies, Liens & Financial Public Records': { objectiveFields:",
 "Relationship & Timeline Intelligence': { objectiveFields:",
]) if(!matrix.includes(token)) throw new Error('30-category extraction-schema invariant missing '+token);
for(const token of [
 'getPantheonCategoryExtractionSchema',
 'extractionSchema?.preferredRazors',
 'extractionObjectiveFields:',
]) if(!adapter.includes(token)) throw new Error('Schema-driven extraction pipe invariant missing '+token);
console.log('Pantheon 30-category schema-driven extraction verification passed.');

for(const token of [
 'REPORT_LABEL_BY_BACKGROUND_CATEGORY',
 'function conversationalReportCategoryLabel(prompt: string',
 "categoryLabel: conversationalReportCategoryLabel(prompt, categories)",
 "'Phone Numbers'",
 "'Email Addresses'",
 "'Address History'",
 "'Employment History'",
 "'Incarceration & Corrections'",
 "'Relationship & Timeline Intelligence'",
]) if(!pantheon.includes(token)) throw new Error('Conversational 30-category schema-routing invariant missing '+token);
console.log('Pantheon conversational category-to-schema routing verification passed.');

for(const token of [
 "export type LexaraDynamicCrawlerRole = 'primary' | 'secondary' | 'tertiary'",
 'rolesForCrawler',
 'buildLexaraDynamicCrawlerAssignments',
 'explorationRequired: matchedCapabilities.length > 0',
]) if(!registry.includes(token)) throw new Error('Dynamic overlapping roster invariant missing '+token);
for(const token of [
 "stage: 'dynamic-rosters'",
 'matchedCapabilities: assignment.matchedCapabilities',
 'explorationRequired: assignment.explorationRequired',
 'const explorationPrimaryQueue =',
]) if(!pantheon.includes(token)) throw new Error('Dynamic roster orchestration invariant missing '+token);
console.log('Pantheon dynamic overlapping crawler-roster verification passed.');

if (pantheon.includes("selectLexaraCrawlerPlan({")) throw new Error('Duplicate crawler selection authority remains in Pantheon investigation');
for(const token of [
 'Dynamic assignment deliberately considers the complete configured pool',
 'it must never starve mandatory exploration',
]) if(!registry.includes(token)) throw new Error('Mandatory exploration eligibility invariant missing '+token);
console.log('Pantheon single-authority dynamic routing and non-starvation verification passed.');

if(!adapter.includes("if (request.purpose === 'background_report') {\n        const capabilityOutcomes")) throw new Error('Background-only capability telemetry is not guarded from conversational requests');
console.log('Pantheon conversational supplemental telemetry null-authority guard verification passed.');
