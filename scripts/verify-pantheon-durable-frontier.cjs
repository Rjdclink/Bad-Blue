const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const migration = read('server/migrations/061_pantheon_durable_frontier.sql');
const store = read('server/services/pantheon/PantheonFrontierStore.ts');
const workflow = read('server/services/pantheon/PantheonCategoryWorkflow.ts');
const scheduler = read('server/services/pantheon/PantheonBoundedScheduler.ts');
const job = read('server/services/pantheon/PantheonBackgroundReportJob.ts');
const acquisition = read('server/services/crawlers/PublicAcquisitionInfrastructure.ts');
const dockerfile = read('Dockerfile');

for (const token of [
  'pantheon_job_leases',
  'pantheon_frontier_items',
  'pantheon_frontier_outcomes',
  'pantheon_domain_policy',
  'pantheon_domain_leases',
  'UNIQUE (report_id, category_index, canonical_url)',
  "WHERE state IN ('pending', 'retryable', 'rate_limited', 'timed_out')",
  'ENABLE ROW LEVEL SECURITY',
  'REVOKE ALL ON TABLE',
]) {
  if (!migration.includes(token)) throw new Error(`Pantheon durable frontier migration invariant missing: ${token}`);
}

for (const token of [
  'preparePantheonFrontier',
  'claimPantheonFrontierItem',
  'completePantheonFrontierItem',
  'syncPantheonFrontierStates',
  'claimPantheonJobLease',
  'renewPantheonJobLease',
  'acquirePantheonDomainLease',
  'FOR UPDATE OF lease SKIP LOCKED',
  'jsonb_to_recordset',
  "mode: 'local', acquired: true",
]) {
  if (!store.includes(token)) throw new Error(`Pantheon frontier runtime invariant missing: ${token}`);
}

for (const token of [
  'INSERT INTO public.pantheon_frontier_outcomes',
  'provenance?: Record<string, unknown>',
  'final\\n${entry.state}',
]) {
  if (!store.includes(token)) throw new Error(`Pantheon frontier provenance invariant missing: ${token}`);
}

for (const token of [
  'await preparePantheonFrontier',
  'await claimPantheonFrontierItem',
  'await completePantheonFrontierItem',
  'await syncPantheonFrontierStates',
  'runPantheonTransportBounded',
  'workId: frontierClaim!.workKey',
]) {
  if (!workflow.includes(token)) throw new Error(`Pantheon workflow/frontier integration missing: ${token}`);
}

for (const token of [
  'PANTHEON_TRANSPORT_CONCURRENCY_LIMITS',
  "'direct-http': 8",
  'browser: 2',
  "'search-provider': 3",
  "'specialized-adapter': 3",
  'archive: 2',
]) {
  if (!scheduler.includes(token)) throw new Error(`Pantheon transport-pool invariant missing: ${token}`);
}

for (const token of [
  'claimPantheonJobLease',
  'renewPantheonJobLease',
  'releasePantheonJobLease',
  'duplicate cross-replica execution suppressed',
]) {
  if (!job.includes(token)) throw new Error(`Pantheon report lease integration missing: ${token}`);
}

for (const token of [
  'waitForDistributedHost',
  'acquirePantheonDomainLease',
  'releasePantheonDomainLease',
]) {
  if (!acquisition.includes(token)) throw new Error(`Pantheon shared domain admission missing: ${token}`);
}

if (!dockerfile.includes('061_pantheon_durable_frontier.sql')) {
  throw new Error('Pantheon frontier migration is absent from the production image');
}

const combined = [store, workflow, scheduler, job, acquisition].join('\n').toLowerCase();
for (const forbidden of ['crawlbase', "from 'redis'", 'from "redis"', "from 'kafkajs'", 'from "kafkajs"']) {
  if (combined.includes(forbidden)) throw new Error(`Pantheon frontier introduced a forbidden external dependency: ${forbidden}`);
}

console.log('Pantheon durable PostgreSQL frontier, cross-replica leases, transport pools, and shared domain admission verified.');
