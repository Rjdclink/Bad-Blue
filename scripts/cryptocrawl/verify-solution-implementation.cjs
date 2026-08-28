const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

const monitor = read('server/services/cryptocrawl/runtime/runtime-invariant-monitor.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const observability = read('server/services/cryptocrawl/integration/runtime-observability.ts');

// S-92 — runtime invariant monitors and drift quarantine.
requireText(monitor, "'ELIGIBLE_WITHOUT_POSITIVE_NET'", 'runtime monitor checks deterministic-positive eligibility');
requireText(monitor, "'INVALID_DETERMINISTIC_COSTS'", 'runtime monitor checks finite/nonnegative required costs');
requireText(monitor, "'DETERMINISTIC_ECONOMICS_MISMATCH'", 'runtime monitor reconciles gross/cost/net economics');
requireText(monitor, "'SETTLED_WITHOUT_TERMINAL_SETTLEMENT'", 'runtime monitor protects terminal settlement truth');
requireText(monitor, 'snapshot.updatedAt > existing.sourceUpdatedAt', 'quarantine recovery requires newer canonical evidence');
requireText(monitor, "authority: 'safety_monitor_only'", 'runtime monitor declares safety-only authority');
requireText(monitor, 'executionAuthority: false', 'runtime monitor cannot claim execution authority');
forbidText(monitor, 'Math.random', 'runtime monitor cannot fabricate evidence');
forbidText(monitor, 'process.env.NO_EXECUTION =', 'runtime monitor cannot mutate global execution posture');

requireText(scheduler, "from '../runtime/runtime-invariant-monitor.js'", 'canonical scheduler consumes runtime invariant monitor');
requireText(scheduler, 'runtimeInvariantMonitor.evaluate(snapshot).allowed', 'canonical dispatch quarantines invalid candidate state before resource admission');
requireText(scheduler, 'executionResourceScheduler.acquireCexPlan', 'resource lease admission remains authoritative after invariant check');
requireText(scheduler, 'stageManager.canExecuteTrades()', 'governance stage authority remains intact');
requireText(scheduler, 'snapshot.plan.netProfitUsd > 0', 'strict positive-net scheduler gate remains intact');

requireText(observability, 'runtimeInvariantMonitor.scan(recentSnapshots)', 'heartbeat scans canonical state for invariant drift');
requireText(observability, 'runtimeInvariants: invariantMonitor', 'heartbeat exposes typed quarantine state');

if (failures.length > 0) {
  console.error('[solution-implementation] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[solution-implementation] PASS — S-92 runtime invariant quarantine is wired without replacing canonical execution/governance/resource authorities');
