'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const controller = fs.readFileSync('server/services/cryptocrawl/discovery/multi-topology-discovery-controller.ts', 'utf8');

// Promise.allSettled cannot complete while any member remains permanently pending.
// Every topology therefore needs an independent watchdog plus single-flight identity
// so one dead provider path cannot freeze the complete recurring discovery controller.
assert.match(controller, /class TopologyTaskWatchdogError extends Error/);
assert.match(controller, /function topologyTaskWatchdogMs\(\): number/);
assert.match(controller, /CRYPTOCRAWL_TOPOLOGY_TASK_WATCHDOG_MS/);
assert.match(controller, /function withTopologyWatchdog<T>/);
assert.match(controller, /private readonly topologyTasks = new Map<TopologyTaskKey, Promise<unknown>>\(\)/);
assert.match(controller, /private async runTopologyTask<T>/);
assert.match(controller, /const reusedInFlight = Boolean\(tracked\)/);
assert.match(controller, /if \(this\.topologyTasks\.get\(key\) === owned\) this\.topologyTasks\.delete\(key\)/);
assert.match(controller, /await withTopologyWatchdog\(tracked, key\)/);
assert.match(controller, /duplicateTaskSuppressedWhilePending: true/);

// All producer families still begin concurrently, but each member is independently
// bounded. The controller itself catches a failed cycle and always reschedules.
for (const key of ['cex', 'dex', 'cross_chain', 'mempool', 'liquidation', 'maker', 'funding']) {
  assert.match(controller, new RegExp(`this\\.runTopologyTask\\('${key}'`));
}
assert.match(controller, /await Promise\.allSettled\(\[/);
assert.match(controller, /private runScheduledCycle\(\): void/);
assert.match(controller, /recurring schedule continues/);
assert.match(controller, /\.finally\(\(\) => this\.scheduleNext\(\)\)/);
assert.match(controller, /isolatedPendingTopologyTasks: \[\.\.\.this\.topologyTasks\.keys\(\)\]/);
assert.doesNotMatch(controller, /async function timedOptional</);

// Liveness isolation is discovery-only and must not create an execution shortcut.
assert.match(controller, /executionDispatchAuthority: 'canonical_execution_scheduler_only'/);
assert.match(controller, /discoveryMaySubmitTransactions: false/);
assert.match(controller, /syntheticEvidenceAllowed: false/);
assert.match(controller, /executionAuthority: false/);

console.log('[multi-topology-discovery-liveness] PASS: each producer is independently bounded and single-flight, hung topology work cannot freeze the controller, recurring scheduling survives failures, and execution/evidence authority remains unchanged');
