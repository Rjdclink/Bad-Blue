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
const sourceLedger = read('server/services/cryptocrawl/compensation/rainbow-profit-source-ledger.ts');
const observability = read('server/services/cryptocrawl/compensation/rainbow-profit-observability.ts');
const calibration = read('server/services/cryptocrawl/validation/monte-carlo-calibration-store.ts');

// One logical fabric, no third database/pool/configuration/network surface.
requirePattern(bridge, /baseOfOperations:\s*'cryptara_local_shared_information_fabric'/, 'existing local shared-information plane remains the operational base');
requirePattern(bridge, /getCryptaraSuperWorkerSnapshot/, 'HyperBridge reuses the existing local read plane instead of creating a duplicate cache');
requirePattern(bridge, /isCryptaraParallelProxyConfigured/, 'HyperBridge reuses the existing overflow configuration authority');
requirePattern(bridge, /writeCryptaraParallelSnapshot/, 'snapshot persistence delegates to the existing overflow worker');
requirePattern(bridge, /appendCryptaraParallelEvents/, 'event persistence delegates to the existing overflow batch writer');
forbidPattern(bridge, /\bnew\s+Pool\s*\(/, 'HyperBridge creates a third PostgreSQL pool');
forbidPattern(bridge, /from\s+['"][^'"]*\/db(?:\.js)?['"]|\bpool\.query\s*\(|\bfetch\s*\(|axios|https?\.request/, 'HyperBridge creates its own primary/network origin instead of coordinating existing lanes');
forbidPattern(bridge, /SUPABASE_DATABASE_URL_OVERFLOW|CRYPTOCRAWL_PARALLEL_PROXY_DATABASE_URL|CRYPTOCRAWL_OVERFLOW_DATABASE_URL|SUPABASE_DATABASE_URL|SUPABASE_DB_URL|DATABASE_URL/, 'HyperBridge introduces or reads a duplicate connection variable');
forbidPattern(bridge, /setInterval\s*\(/, 'HyperBridge adds a polling loop');
requirePattern(overflow, /SUPABASE_DATABASE_URL_OVERFLOW/, 'existing single overflow database variable remains authoritative');
forbidPattern(overflow, /CRYPTOCRAWL_PARALLEL_PROXY_DATABASE_URL|CRYPTOCRAWL_OVERFLOW_DATABASE_URL/, 'legacy overflow aliases remain forbidden');

// Latency-hiding write plane: publishing calls enqueue locally, remote work starts
// after return, snapshots coalesce, events batch, and primary fallback stays serial.
requirePattern(bridge, /queueMicrotask\s*\(/, 'remote auxiliary persistence is scheduled after the publishing call stack');
requirePattern(bridge, /callerWaitsForRemoteIo:\s*false/, 'bridge reports the zero-wait publishing contract');
requirePattern(bridge, /const\s+SNAPSHOT_CONCURRENCY\s*=\s*2/, 'snapshot remote concurrency stays inside the existing overflow pool width');
requirePattern(bridge, /const\s+EVENT_BATCH_MAX\s*=\s*32/, 'derived events are bounded into batch writes');
requirePattern(bridge, /snapshotQueue\.has\(key\)[\s\S]{0,120}coalescedSnapshots/, 'same-key snapshot bursts coalesce before network I/O');
requirePattern(bridge, /group\.has\(key\)[\s\S]{0,120}coalescedEvents/, 'duplicate event identities coalesce before network I/O');
requirePattern(bridge, /Promise\.all\(snapshots\.map\(entry\s*=>\s*persistSnapshot\(entry\)\)\)/, 'bounded independent snapshot writes can use both existing overflow permits');
requirePattern(bridge, /for\s*\(const\s+entry\s+of\s+entries\)[\s\S]{0,600}persistFallback\(entry\)/, 'primary fallback is sequential to avoid a recovery burst');
requirePattern(bridge, /replicaFreshForMs\?:\s*number/, 'write success can seed local read-route confidence without altering persisted TTL');

// Read plane: normal primary behavior remains unchanged unless a workload explicitly
// declares itself overflow-native. Under comp pressure, a known-fresh replica is
// direct; unknown freshness starts both existing lanes together, so an overflow
// miss cannot become a new serial hop in front of primary latency.
requirePattern(bridge, /getCryptaraSupabaseCompSwitchSnapshot\(\)\.path/, 'read routing consumes the established normal/comp switch');
requirePattern(bridge, /overflowPreferred\s*=\s*dataPath\s*===\s*'comp'\s*\|\|\s*input\.normalPreference\s*===\s*'overflow'/, 'overflow-first routing is limited to pressure or explicit auxiliary preference');
requirePattern(bridge, /overflowPreferred\s*&&\s*knownFresh[\s\S]{0,280}runReadLane\('overflow'/, 'known-fresh overflow reads are direct');
requirePattern(bridge, /replicaFreshUntil\.delete\(id\)[\s\S]{0,260}runReadLane\('primary'/, 'failed known-fresh overflow falls back to primary');
requirePattern(bridge, /const\s+primaryPromise\s*=\s*runReadLane\('primary'[\s\S]{0,180}const\s+overflowPromise\s*=\s*runReadLane\('overflow'[\s\S]{0,180}Promise\.race/, 'unknown auxiliary freshness hedges both existing lanes concurrently');
requirePattern(bridge, /const\s+primary\s*=\s*await\s+runReadLane\('primary'[\s\S]{0,520}if\s*\(overflowAvailable\)/, 'normal primary-preferred path stays primary first');
requirePattern(bridge, /const\s+MAX_FRESH_KEYS\s*=\s*2_048/, 'process-local replica directory is bounded');
requirePattern(bridge, /const\s+MAX_LOCAL_REPLICA_FRESH_MS\s*=\s*15\s*\*\s*60_000/, 'route-confidence lifetime is bounded');
requirePattern(bridge, /routedReadPlane:[\s\S]{0,1000}ewmaLatencyMs/, 'primary and overflow read latency are measured truthfully');

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

// Real derived workloads use the same HyperBridge instead of parallel ad-hoc paths.
requirePattern(sourceLedger, /enqueueCryptaraHyperBridgeSnapshot/, 'Rainbow source metadata publishes through HyperBridge');
forbidPattern(sourceLedger, /writeCryptaraParallelSnapshot/, 'Rainbow source metadata bypasses HyperBridge with direct auxiliary writes');
requirePattern(sourceLedger, /fallback:\s*\(\)\s*=>\s*persistPrimarySource\(source\)/, 'Rainbow retains the low-priority primary fallback');
requirePattern(sourceLedger, /withCryptaraSupabasePriority\('low'/, 'Rainbow fallback remains low priority');
requirePattern(sourceLedger, /readCryptaraHyperBridge<RainbowProfitSourceSnapshot>/, 'Rainbow source metadata reads through HyperBridge');
requirePattern(sourceLedger, /normalPreference:\s*'overflow'/, 'overflow-native source metadata explicitly prefers the auxiliary lane');
requirePattern(sourceLedger, /replicaFreshForMs:\s*REPLICA_ROUTE_FRESH_MS/, 'successful source mirrors seed bounded route confidence');

requirePattern(observability, /readCryptaraHyperBridge<RainbowProfitSnapshot>/, 'Rainbow aggregate observability reads through HyperBridge');
requirePattern(observability, /enqueueCryptaraHyperBridgeSnapshot/, 'Rainbow aggregate snapshots use HyperBridge write-behind');
requirePattern(observability, /noteCryptaraHyperBridgeReplicaFresh/, 'real overflow reads seed exact replica freshness');
requirePattern(observability, /primary:\s*\(\)\s*=>\s*this\.readPrimarySnapshot\(\)/, 'observability keeps the original primary aggregate lane');
requirePattern(observability, /overflow:\s*\(\)\s*=>\s*this\.readParallelSnapshot\(\)/, 'observability keeps the existing overflow snapshot lane');
forbidPattern(observability, /readParallelSnapshotUnderPressure/, 'old serial overflow-first pressure path remains');

requirePattern(calibration, /enqueueCryptaraHyperBridgeEvent/, 'Monte Carlo calibration publishes through HyperBridge');
forbidPattern(calibration, /appendCryptaraParallelEvents/, 'calibration bypasses HyperBridge with direct auxiliary event writes');
requirePattern(calibration, /fallback:\s*\(\)\s*=>\s*this\.persistPrimaryObservation\(observation\)/, 'calibration retains the low-priority primary fallback');
requirePattern(calibration, /private async persistPrimaryObservation[\s\S]{0,1200}withCryptaraSupabasePriority\('low'/, 'calibration fallback remains low priority');
requirePattern(calibration, /pendingBridgeWrites/, 'calibration exposes truthful pending write-behind telemetry');

for (const [name, source] of Object.entries({ bridge, sourceLedger, observability, calibration })) {
  forbidPattern(source, /\bhyperscope\b/i, `${name} embeds reference-framework vocabulary into runtime code`);
  forbidPattern(source, /\benhancements\s+list\b/i, `${name} embeds enhancement-list vocabulary into runtime code`);
}

console.log('[supabase-hyper-bridge] PASS: existing Cryptara shared memory remains the front plane; primary+overflow reads avoid serial miss latency, known-fresh auxiliary routing is bounded/measured, derived writes return before remote I/O, snapshot bursts coalesce, event bursts batch, the existing overflow pool/config are reused, primary fallback is sequential/low-priority, and all execution/financial/governance authority remains on original primary paths');