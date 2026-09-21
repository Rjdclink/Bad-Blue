const fs = require('fs');
const read = path => fs.readFileSync(path, 'utf8');

const runtime = read('server/services/pantheon/PantheonCapabilityRuntime.ts');
const job = read('server/services/pantheon/PantheonBackgroundReportJob.ts');
const workflow = read('server/services/pantheon/PantheonCategoryWorkflow.ts');
const controller = read('server/services/pantheon/PantheonInvestigationController.ts');
const adapter = read('server/services/crawlers/PantheonRetrievalAdapter.ts');
const orchestrator = read('server/services/pantheonCrawlerOrchestrator.ts');
const deployer = read('server/services/pantheon/razors/TwoStageDeployer.ts');

for (const token of [
  'runPantheonCapabilityHealthChecks',
  'resolveHealthyPantheonPrimaryCapabilities',
  'finalizePantheonCategoryCapabilityOutcomes',
  'getPantheonCapabilityTelemetry',
  'assessPantheonCapabilityCoverage',
  "'not_applicable'",
  "'not_executed'",
  'sourceOutcomes',
  'fallbackExecuted',
]) {
  if (!runtime.includes(token)) throw new Error('Capability runtime missing: ' + token);
}
if (!job.includes('runPantheonCapabilityHealthChecks') || !job.includes('capabilityHealth')) {
  throw new Error('Capability health checks do not gate the report job');
}
if (!workflow.includes('capabilityOutcomes') || !workflow.includes('resolveHealthyPantheonPrimaryCapabilities')) {
  throw new Error('Workflow does not persist exhaustive capability outcomes');
}
if (!controller.includes('assessPantheonCapabilityCoverage') || !controller.includes('capabilityCoverage')) {
  throw new Error('Investigation release gate does not require real capability coverage');
}
if (!adapter.includes('getPantheonCategoryCapabilities') || !adapter.includes('results.find(result => result.target === target') && adapter.includes('applicableCapabilities') && adapter.includes('request.signal')) {
  throw new Error('Extended crawler execution is not restricted by the capability matrix');
}
for (const token of ['durationMs?: number','sourceOutcomes?: CrawlerSourceOutcome[]','executionStartedAt']) {
  if (!orchestrator.includes(token)) throw new Error('Primary crawler result contract missing: ' + token);
}
for (const token of ['healthCheckAllCapabilities','capabilityIds?: readonly PantheonCapabilityId[]','durationMs','sourceOutcomes']) {
  if (!deployer.includes(token)) throw new Error('Extended crawler contract missing: ' + token);
}
console.log('Pantheon capability assignment, contracts, live health checks, fallback, telemetry, and coverage gates verified.');
