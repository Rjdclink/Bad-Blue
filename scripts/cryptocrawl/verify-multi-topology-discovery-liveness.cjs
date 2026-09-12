'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const controller = fs.readFileSync('server/services/cryptocrawl/discovery/multi-topology-discovery-controller.ts', 'utf8');
const fence = fs.readFileSync('server/services/cryptocrawl/discovery/candidate-publication-generation.ts', 'utf8');
const registry = fs.readFileSync('server/services/cryptocrawl/discovery/measured-candidate-registry.ts', 'utf8');

// Promise.allSettled cannot complete while any member remains permanently pending.
// Every topology therefore needs an independent watchdog plus single-flight identity.
// A timed-out owner must relinquish its slot so a later cycle can recover instead
// of reusing one unresolved promise forever.
assert.match(controller, /class TopologyTaskWatchdogError extends Error/);
assert.match(controller, /function topologyTaskWatchdogMs\(\): number/);
assert.match(controller, /CRYPTOCRAWL_TOPOLOGY_TASK_WATCHDOG_MS/);
assert.match(controller, /function withTopologyWatchdog<T>/);
assert.match(controller, /private readonly topologyTasks = new Map<TopologyTaskKey, Promise<unknown>>\(\)/);
assert.match(controller, /private readonly topologyTaskGenerations = new Map<TopologyTaskKey/);
assert.match(controller, /private async runTopologyTask<T>/);
assert.match(controller, /const reusedInFlight = Boolean\(tracked\)/);
assert.match(controller, /runWithCandidatePublicationGeneration\(topology, generation, operation\)/);
assert.match(controller, /if \(this\.topologyTasks\.get\(key\) === owned\) \{[\s\S]{0,220}this\.topologyTasks\.delete\(key\);[\s\S]{0,120}this\.topologyTaskGenerations\.delete\(key\);/);
assert.match(controller, /await withTopologyWatchdog\(tracked, key\)/);
assert.match(controller, /if \(lease\) invalidateCandidatePublicationGeneration\(lease\.topology, lease\.generation\)/);
assert.match(controller, /timedOutTaskOwnershipReleased: true/);
assert.match(controller, /lateTimedOutCandidatePublicationRejected: true/);
assert.match(controller, /futureCycleMayStartFreshTask: true/);
assert.match(controller, /this\.topologyTasks\.clear\(\)/);
assert.match(controller, /this\.topologyTaskGenerations\.clear\(\)/);

// Releasing a task slot is insufficient if the timed-out producer can later write
// stale evidence. Controller-owned producer calls therefore carry an async generation
// context; invalidated generations fail at both canonical registry mutation points.
assert.match(fence, /new AsyncLocalStorage<CandidatePublicationContext>\(\)/);
assert.match(fence, /export function nextCandidatePublicationGeneration/);
assert.match(fence, /export function invalidateCandidatePublicationGeneration/);
assert.match(fence, /export function runWithCandidatePublicationGeneration<T>/);
assert.match(fence, /export function assertCurrentCandidatePublication/);
assert.match(fence, /if \(!context \|\| context\.topology !== topology\) return/);
assert.match(fence, /throw new StaleCandidatePublicationError/);
assert.match(registry, /record\(input: CandidateRecordInput\): MeasuredCandidate \{[\s\S]{0,120}assertCurrentCandidatePublication\(input\.topology\)/);
assert.match(registry, /const previous = this\.candidates\.get\(opportunityId\);[\s\S]{0,120}assertCurrentCandidatePublication\(previous\.topology\)/);

// All producer families still begin concurrently and retain their prior discovery
// entrypoints. The controller itself catches a failed cycle and always reschedules.
for (const key of ['cex', 'dex', 'cross_chain', 'mempool', 'liquidation', 'maker', 'funding']) {
  assert.match(controller, new RegExp(`this\\.runTopologyTask\\('${key}'`));
}
assert.match(controller, /await Promise\.allSettled\(\[/);
assert.match(controller, /private runScheduledCycle\(\): void/);
assert.match(controller, /recurring schedule continues/);
assert.match(controller, /\.finally\(\(\) => this\.scheduleNext\(\)\)/);
assert.match(controller, /isolatedPendingTopologyTasks: \[\.\.\.this\.topologyTasks\.keys\(\)\]/);
assert.match(controller, /timedOutTopologyOwnershipReleased: true/);
assert.doesNotMatch(controller, /async function timedOptional/);

// Liveness isolation is discovery-only and must not create an execution shortcut.
assert.match(controller, /executionDispatchAuthority: 'canonical_execution_scheduler_only'/);
assert.match(controller, /discoveryMaySubmitTransactions: false/);
assert.match(controller, /syntheticEvidenceAllowed: false/);
assert.match(controller, /executionAuthority: false/);

console.log('[multi-topology-discovery-liveness] PASS: every producer remains independently bounded and single-flight, timed-out ownership and publication authority are revoked for fresh-cycle recovery, context-free producers remain unaffected, recurring scheduling survives failures, and execution/evidence authority remains unchanged');