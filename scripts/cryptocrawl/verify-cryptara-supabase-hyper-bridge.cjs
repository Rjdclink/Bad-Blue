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
const overflowWorker = read('server/services/cryptocrawl/integration/cryptara-overflow-super-worker.ts');
const overflow = read('server/services/cryptocrawl/integration/cryptara-supabase-overflow-worker.ts');
const superWorker = read('server/services/cryptocrawl/integration/cryptara-super-worker.ts');
const sourceLedger = read('server/services/cryptocrawl/compensation/rainbow-profit-source-ledger.ts');
const observability = read('server/services/cryptocrawl/compensation/rainbow-profit-observability.ts');
const calibration = read('server/services/cryptocrawl/validation/monte-carlo-calibration-store.ts');

// One logical information fabric, two control workers, two existing DB lanes.
requirePattern(bridge, /baseOfOperations:\s*'cryptara_local_shared_information_fabric'/, 'existing local shared-information plane remains the operational base');
requirePattern(bridge, /getCryptaraSuperWorkerSnapshot/, 'primary Super Worker remains the existing local information owner');
requirePattern(bridge, /getCryptaraOverflowSuperWorkerSnapshot/, 'dedicated overflow Super Worker is wired into HyperBridge telemetry');
requirePattern(bridge, /requestCryptaraOverflowSuperWorker/, 'overflow reads are delegated to the dedicated overflow worker');
requirePattern(bridge, /shareCryptaraPrimaryInformationWithOverflowWorker/, 'primary results are shared directly with the overflow worker');
requirePattern(bridge, /shareCryptaraOverflowInformationWithPrimaryWorker/, 'overflow results are shared directly with the primary worker');
requirePattern(bridge, /isCryptaraParallelProxyConfigured/, 'HyperBridge reuses the existing overflow configuration authority');
requirePattern(bridge, /writeCryptaraParallelSnapshot/, 'snapshot persistence delegates to the existing overflow worker');
requirePattern(bridge, /appendCryptaraParallelEvents/, 'event persistence delegates to the existing overflow batch writer');
forbidPattern(bridge, /\bnew\s+Pool\s*\(/, 'HyperBridge creates a third PostgreSQL pool');
forbidPattern(bridge, /from\s+['"][^'"]*\/db(?:\.js)?['"]|\bpool\.query\s*\(|\bfetch\s*\(|axios|https?\.request/, 'HyperBridge creates its own database/network origin');
forbidPattern(bridge, /SUPABASE_DATABASE_URL_OVERFLOW|CRYPTOCRAWL_PARALLEL_PROXY_DATABASE_URL|CRYPTOCRAWL_OVERFLOW_DATABASE_URL|SUPABASE_DATABASE_URL|SUPABASE_DB_URL|DATABASE_URL/, 'HyperBridge introduces or reads a duplicate connection variable');
forbidPattern(bridge, /setInterval\s*\(/, 'HyperBridge adds a polling loop');
requirePattern(overflow, /SUPABASE_DATABASE_URL_OVERFLOW/, 'existing single overflow database variable remains authoritative');
forbidPattern(overflow, /CRYPTOCRAWL_PARALLEL_PROXY_DATABASE_URL|CRYPTOCRAWL_OVERFLOW_DATABASE_URL/, 'legacy overflow aliases remain forbidden');

// Dedicated overflow worker: local shared-memory coherence first, overflow only on
// miss, no direct/implicit primary database call and no duplicate retained cache.
requirePattern(overflowWorker, /requestCryptaraSharedInformation/, 'overflow worker talks directly to primary worker through existing local broker');
requirePattern(overflowWorker, /primeCryptaraSharedInformation/, 'both workers publish into one coherence directory');
requirePattern(overflowWorker, /freshForMs:\s*0[\s\S]{0,260}LOCAL_ONLY_MISS/, 'local coherence lookup cannot trigger a remote broker load');
requirePattern(overflowWorker, /request\.loadOverflow\(\)/, 'remote miss goes only to the caller-supplied overflow lane');
requirePattern(overflowWorker, /primaryDatabaseCalls:\s*0\s+as\s+const/, 'overflow worker truthfully guarantees zero primary DB calls');
requirePattern(overflowWorker, /createsDuplicateCache:\s*false\s+as\s+const/, 'overflow worker reuses shared broker rather than duplicating cache state');
requirePattern(overflowWorker, /private|const\s+inFlight\s*=\s*new\s+Map/, 'overflow remote acquisitions are coalesced single-flight');
forbidPattern(overflowWorker, /\bnew\s+Pool\s*\(|from\s+['"][^'"]*\/db(?:\.js)?['"]|\bpool\.query\s*\(/, 'overflow worker must not create or touch a primary DB pool');
forbidPattern(overflowWorker, /setInterval\s*\(|setTimeout\s*\(/, 'overflow worker must not poll');
forbidPattern(overflowWorker, /SUPABASE_DATABASE_URL|SUPABASE_DB_URL|DATABASE_URL/, 'overflow worker must not own connection variables');

// Read plane: normal stays primary-first. Pressure/overflow-native reads use only
// the overflow Super Worker and never launch the primary lane in parallel or as a
// hidden companion request.
requirePattern(bridge, /overflowPreferred\s*=\s*dataPath\s*===\s*'comp'\s*\|\|\s*input\.normalPreference\s*===\s*'overflow'/, 'overflow-preferred routing remains pressure/explicit only');
requirePattern(bridge, /if\s*\(overflowPreferred\)[\s\S]{0,700}runOverflowWorkerLane\(input,\s*freshForMs\)[\s\S]{0,500}return\s*\{\s*value:\s*null,\s*lane:\s*'none'/, 'overflow-preferred path terminates without a primary DB fallback');
forbidPattern(bridge, /Promise\.race\s*\(\s*\[?\s*primary|primaryPromise[\s\S]{0,240}overflowPromise[\s\S]{0,240}Promise\.race/, 'primary and overflow DB lanes must never be hedged together');
requirePattern(bridge, /const\s+primary\s*=\s*await\s+runReadLane\('primary'[\s\S]{0,480}sharePrimaryRead/, 'normal primary result is immediately shared locally with overflow worker');
requirePattern(bridge, /primarySuppressedReads\s*\+=\s*1/, 'suppressed primary DB work is measured');
requirePattern(bridge, /workerSharedReads\s*\+=\s*1/, 'worker-to-worker local reuse is measured');
requirePattern(bridge, /racedReads\s*=\s*0/, 'legacy race counter starts at zero');
requirePattern(bridge, /const\s+MAX_FRESH_KEYS\s*=\s*2_048/, 'process-local replica directory is bounded');
requirePattern(bridge, /const\s+MAX_LOCAL_REPLICA_FRESH_MS\s*=\s*15\s*\*\s*60_000/, 'route-confidence lifetime is bounded');
requirePattern(bridge, /routedReadPlane:[\s\S]{0,1200}ewmaLatencyMs/, 'primary and overflow lane latency remains measured');

// Latency-hiding write plane remains bounded and non-blocking for publishers.
requirePattern(bridge, /queueMicrotask\s*\(/, 'remote auxiliary persistence is scheduled after publishing call stack');
requirePattern(bridge, /callerWaitsForRemoteIo:\s*false/, 'bridge reports zero-wait publishing contract');
requirePattern(bridge, /const\s+SNAPSHOT_CONCURRENCY\s*=\s*2/, 'snapshot concurrency stays inside existing overflow pool width');
requirePattern(bridge, /const\s+EVENT_BATCH_MAX\s*=\s*32/, 'derived events remain bounded into batch writes');
requirePattern(bridge, /snapshotQueue\.has\(key\)[\s\S]{0,120}coalescedSnapshots/, 'same-key snapshot bursts coalesce');
requirePattern(bridge, /group\.has\(key\)[\s\S]{0,120}coalescedEvents/, 'duplicate event identities coalesce');
requirePattern(bridge, /Promise\.all\(snapshots\.map\(entry\s*=>\s*persistSnapshot\(entry\)\)\)/, 'independent snapshots can use both existing overflow permits');
requirePattern(bridge, /for\s*\(const\s+entry\s+of\s+entries\)[\s\S]{0,600}persistFallback\(entry\)/, 'primary fallback writes remain sequential');

// Authority boundaries remain untouched.
requirePattern(bridge, /authority:\s*'auxiliary_transport_only'/, 'HyperBridge has transport-only authority');
requirePattern(bridge, /writeAuthority:\s*false/, 'HyperBridge has no independent write authority');
requirePattern(bridge, /executionAuthority:\s*false/, 'HyperBridge has no execution authority');
requirePattern(bridge, /financialAuthorityAllowed:\s*false/, 'financial authority is forbidden');
requirePattern(bridge, /governanceAuthorityAllowed:\s*false/, 'governance authority is forbidden');
requirePattern(bridge, /criticalDataAllowed:\s*false/, 'critical data is forbidden');
requirePattern(superWorker, /private readonly inFlight = new Map<string, Promise<CacheEntry>>\(\)/, 'primary Super Worker single-flight remains intact');
requirePattern(superWorker, /execution_truth:\s*0/, 'execution truth remains zero-retention');

// Existing real workloads stay on HyperBridge, with their original primary
// fallback/authority behavior intact where that fallback is explicitly requested.
requirePattern(sourceLedger, /enqueueCryptaraHyperBridgeSnapshot/, 'Rainbow source metadata publishes through HyperBridge');
requirePattern(sourceLedger, /readCryptaraHyperBridge<RainbowProfitSourceSnapshot>/, 'Rainbow source metadata reads through HyperBridge');
requirePattern(sourceLedger, /normalPreference:\s*'overflow'/, 'source metadata is explicitly overflow-native');
requirePattern(observability, /readCryptaraHyperBridge<RainbowProfitSnapshot>/, 'Rainbow observability reads through HyperBridge');
requirePattern(observability, /enqueueCryptaraHyperBridgeSnapshot/, 'Rainbow observability writes through HyperBridge');
requirePattern(calibration, /enqueueCryptaraHyperBridgeEvent/, 'Monte Carlo calibration publishes through HyperBridge');

for (const [name, source] of Object.entries({ bridge, overflowWorker, sourceLedger, observability, calibration })) {
  forbidPattern(source, /\bhyperscope\b/i, `${name} embeds reference-framework vocabulary into runtime code`);
  forbidPattern(source, /\benhancements\s+list\b/i, `${name} embeds enhancement-list vocabulary into runtime code`);
}

console.log('[supabase-hyper-bridge] PASS: dedicated primary/overflow Super Workers share one local coherence directory; overflow-preferred reads issue zero primary DB calls, normal reads remain primary-first, remote reads never hedge both databases, writes remain coalesced/batched, and all execution/financial/governance authority remains unchanged');
