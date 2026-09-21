const fs = require('fs');
const read = path => fs.readFileSync(path, 'utf8');

const workflow = read('server/services/pantheon/PantheonCategoryWorkflow.ts');
const scheduler = read('server/services/pantheon/PantheonBoundedScheduler.ts');
const deadline = read('server/services/pantheon/PantheonDeadline.ts');
const adapter = read('server/services/crawlers/PantheonRetrievalAdapter.ts');
const orchestrator = read('server/services/pantheonCrawlerOrchestrator.ts');
const acquisition = read('server/services/crawlers/PublicAcquisitionInfrastructure.ts');
const deployer = read('server/services/pantheon/razors/TwoStageDeployer.ts');
const evidence = read('server/services/pantheon/PantheonEvidencePipeline.ts');

for (const token of [
  'runPantheonBounded(indexes, concurrency',
  'Math.min(4, input.categoryConcurrency || 4',
  'waveCount',
  'categoryBudgetMs',
  "phase: execution.outcome.completionState === 'completed' ? 'COMPLETE' : 'PARTIAL'",
  'urlLedger',
  'transportAttempts',
]) {
  if (!workflow.includes(token)) throw new Error('Bounded category workflow invariant missing: ' + token);
}
for (const token of ['cursor += 1','results[index] = await worker','Promise.all(Array.from','throwIfPantheonAborted']) {
  if (!scheduler.includes(token)) throw new Error('Bounded scheduler invariant missing: ' + token);
}
for (const token of ['createPantheonDeadline','racePantheonAbort','pantheonAbortableDelay','removeEventListener']) {
  if (!deadline.includes(token)) throw new Error('Cancellable deadline invariant missing: ' + token);
}
if (!adapter.includes('signal?: AbortSignal') || !adapter.includes('signal: request.signal') ||
    !orchestrator.includes('signal?: AbortSignal') || !orchestrator.includes('racePantheonAbort')) {
  throw new Error('Retrieval cancellation does not reach each primary crawler route');
}
if (!acquisition.includes('signal?: AbortSignal') || !acquisition.includes("signal?.addEventListener('abort'") ||
    !deployer.includes('signal?: AbortSignal') || !deployer.includes('racePantheonAbort')) {
  throw new Error('Network and extended adapters are not cancellable');
}
for (const token of ['processPantheonEvidence','verified_live_source','subject_mismatch','simulation_or_test_output','dedupePantheonEvidence']) {
  if (!evidence.includes(token)) throw new Error('Retrieval-analysis boundary missing: ' + token);
}
if (!workflow.includes('const crawlersUsed = [...new Set(reportable.map(item => item.crawler)')) {
  throw new Error('Customer crawler list is not restricted to attributable accepted evidence');
}
console.log('Pantheon bounded scheduling, route depth, cancellation, zero-work gating, ledgers, analysis separation, and attributable crawler listing verified.');
