'use strict';

const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const requirePattern = (source, pattern, description) => {
  if (!pattern.test(source)) throw new Error(`[supabase-hyper-bridge] missing invariant: ${description}`);
};
const forbidPattern = (source, pattern, description) => {
  if (pattern.test(source)) throw new Error(`[supabase-hyper-bridge] forbidden regression: ${description}`);
};

const bridge = read('server/services/cryptocrawl/integration/cryptara-supabase-hyper-bridge.ts');
const overflow = read('server/services/cryptocrawl/integration/cryptara-supabase-overflow-worker.ts');
const superWorker = read('server/services/cryptocrawl/integration/cryptara-super-worker.ts');
const rainbow = read('server/services/cryptocrawl/compensation/rainbow-profit-source-ledger.ts');
const calibration = read('server/services/cryptocrawl/validation/monte-carlo-calibration-store.ts');

// One logical fabric, no third database/pool/configuration surface.
requirePattern(bridge, /baseOfOperations:\s*'cryptara_local_shared_information_fabric'/, 'existing local shared-information plane remains the operational base');
requirePattern(bridge, /getCryptaraSuperWorkerSnapshot/, 'HyperBridge reuses the existing local read plane instead of creating a duplicate cache');
requirePattern(bridge, /isCryptaraParallelProxyConfigured/, 'HyperBridge reuses the existing overflow configuration authority');
requirePattern(bridge, /writeCryptaraParallelSnapshot/, 'snapshot persistence delegates to the existing overflow worker');
requirePattern(bridge, /appendCryptaraParallelEvents/, 'event persistence delegates to the existing overflow batch writer');
forbidPattern(bridge, /\bnew\s+Pool\s*\(/, 'HyperBridge creates a third PostgreSQL pool');
forbidPattern(bridge, /SUPABASE_DATABASE_URL_OVERFLOW|CRYPTOCRAWL_PARALLEL_PROXY_DATABASE_URL|CRYPTOCRAWL_OVERFLOW_DATABASE_URL/, 'HyperBridge introduces or reads a duplicate connection variable');
forbidPattern(bridge, /setInterval\s*\(/, 'HyperBridge adds a polling loop');
requirePattern(overflow, /SUPABASE_DATABASE_URL_OVERFLOW/, 'existing single overflow database variable remains authoritative');
forbidPattern(overflow, /CRYPTOCRAWL_PARALLEL_PROXY_DATABASE_URL|CRYPTOCRAWL_OVERFLOW_DATABASE_URL/, 'legacy overflow aliases remain forbidden');

// Latency hiding: publishing calls enqueue locally, remote work starts after return.
requirePattern(bridge, /queueMicrotask\s*\(/, 'remote auxiliary persistence is scheduled after the publishing call stack');
requirePattern(bridge, /callerWaitsForRemoteIo:\s*false/, 'bridge reports the zero-wait publishing contract');
requirePattern(bridge, /const\s+SNAPSHOT_CONCURRENCY\s*=\s*2/, 'snapshot remote concurrency stays inside the existing overflow pool width');
requirePattern(bridge, /const\s+EVENT_BATCH_MAX\s*=\s*32/, 'derived events are bounded into batch writes');
requirePattern(bridge, /snapshotQueue\.has\(key\)[\s\S]{0,120}coalescedSnapshots/, 'same-key snapshot bursts coalesce before network I/O');
requirePattern(bridge, /group\.has\(key\)[\s\S]{0,120}coalescedEvents/, 'duplicate event identities coalesce before network I/O');
requirePattern(bridge, /Promise\.all\(snapshots\.map\(entry\s*=>\s*persistSnapshot\(entry\)\)\)/, 'bounded independent snapshot writes can use both existing overflow permits');
requirePattern(bridge, /for\s*\(const\s+entry\s+of\s+entries\)[\s\S]{0,600}persistFallback\(entry\)/, 'primary fallback is sequential to avoid a recovery burst');

// The bridge may transport only non-authoritative derived state.
requirePattern(bridge, /authority:\s*'auxiliary_transport_only'/, 'HyperBridge has transport-only authority');
requirePattern(bridge, /writeAuthority:\s*false/, 'HyperBridge has no independent write authority');
requirePattern(bridge, /executionAuthority:\s*false/, 'HyperBridge has no execution authority');
requirePattern(bridge, /financialAuthorityAllowed:\s*false/, 'financial authority is forbidden');
requirePattern(bridge, /governanceAuthorityAllowed:\s*false/, 'governance authority is forbidden');
requirePattern(bridge, /criticalDataAllowed:\s*false/, 'critical data is forbidden');

// Existing local single-flight read fabric is preserved as the front plane.
requirePattern(superWorker, /private readonly inFlight = new Map<string, Promise<CacheEntry>>\(\)/, 'Super Worker single-flight remains intact');
requirePattern(superWorker, /execution_truth:\s*0/, 'execution truth remains zero-retention');

// Two real derived workloads now use write-behind instead of awaiting overflow I/O.
requirePattern(rainbow, /enqueueCryptaraHyperBridgeSnapshot/, 'Rainbow source metadata publishes through HyperBridge');
forbidPattern(rainbow, /writeCryptaraParallelSnapshot/, 'Rainbow source metadata bypasses HyperBridge with direct auxiliary writes');
requirePattern(rainbow, /fallback:\s*\(\)\s*=>\s*persistPrimarySource\(source\)/, 'Rainbow retains the low-priority primary fallback');
requirePattern(rainbow, /withCryptaraSupabasePriority\('low'/, 'Rainbow fallback remains low priority');

requirePattern(calibration, /enqueueCryptaraHyperBridgeEvent/, 'Monte Carlo calibration publishes through HyperBridge');
forbidPattern(calibration, /appendCryptaraParallelEvents/, 'calibration bypasses HyperBridge with direct auxiliary event writes');
requirePattern(calibration, /fallback:\s*\(\)\s*=>\s*this\.persistPrimaryObservation\(observation\)/, 'calibration retains the low-priority primary fallback');
requirePattern(calibration, /private async persistPrimaryObservation[\s\S]{0,1200}withCryptaraSupabasePriority\('low'/, 'calibration fallback remains low priority');
requirePattern(calibration, /pendingBridgeWrites/, 'calibration exposes truthful pending write-behind telemetry');

for (const [name, source] of Object.entries({ bridge, rainbow, calibration })) {
  forbidPattern(source, /\bhyperscope\b/i, `${name} embeds reference-framework vocabulary into runtime code`);
  forbidPattern(source, /\benhancements\s+list\b/i, `${name} embeds enhancement-list vocabulary into runtime code`);
}

console.log('[supabase-hyper-bridge] PASS: existing Cryptara local shared memory is the front plane; derived writes return before remote I/O, snapshot bursts coalesce, event bursts batch, existing overflow pool/config are reused, primary fallback is sequential/low-priority, and all execution/financial/governance authority remains on the original primary paths');
