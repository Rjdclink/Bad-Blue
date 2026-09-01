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
const gateway = read('server/services/cryptocrawl/integration/cryptara-overflow-primary-gateway.ts');
const overflow = read('server/services/cryptocrawl/integration/cryptara-supabase-overflow-worker.ts');
const superWorker = read('server/services/cryptocrawl/integration/cryptara-super-worker.ts');
const sourceLedger = read('server/services/cryptocrawl/compensation/rainbow-profit-source-ledger.ts');
const observability = read('server/services/cryptocrawl/compensation/rainbow-profit-observability.ts');
const calibration = read('server/services/cryptocrawl/validation/monte-carlo-calibration-store.ts');

// One logical information fabric, two workers, existing overflow DB lane, and one
// process-local primary gateway that creates no additional pool.
requirePattern(bridge, /baseOfOperations:\s*'cryptara_local_shared_information_fabric'/, 'existing local shared-information plane remains the operational base');
requirePattern(bridge, /getCryptaraSuperWorkerSnapshot/, 'primary Super Worker remains in shared telemetry');
requirePattern(bridge, /getCryptaraOverflowSuperWorkerSnapshot/, 'overflow Super Worker is wired into HyperBridge telemetry');
requirePattern(bridge, /requestCryptaraOverflowSuperWorker/, 'all bridge reads are delegated to overflow worker');
requirePattern(bridge, /shareCryptaraOverflowInformationWithPrimaryWorker/, 'overflow results are shared through the common coherence directory');
requirePattern(bridge, /isCryptaraParallelProxyConfigured/, 'HyperBridge reuses existing overflow configuration authority');
requirePattern(bridge, /writeCryptaraParallelSnapshot/, 'snapshot persistence delegates to existing overflow worker');
requirePattern(bridge, /appendCryptaraParallelEvents/, 'event persistence delegates to existing overflow batch writer');
forbidPattern(bridge, /\bnew\s+Pool\s*\(/, 'HyperBridge must not create a third PostgreSQL pool');
forbidPattern(bridge, /from\s+['"][^'"]*\/db(?:\.js)?['"]|\bpool\.query\s*\(|\bfetch\s*\(|axios|https?\.request/, 'HyperBridge must not create its own database/network origin');
forbidPattern(bridge, /SUPABASE_DATABASE_URL_OVERFLOW|CRYPTOCRAWL_PARALLEL_PROXY_DATABASE_URL|CRYPTOCRAWL_OVERFLOW_DATABASE_URL|SUPABASE_DATABASE_URL|SUPABASE_DB_URL|DATABASE_URL/, 'HyperBridge must not introduce or read connection variables');
forbidPattern(bridge, /setInterval\s*\(/, 'HyperBridge must not add a polling loop');
requirePattern(overflow, /SUPABASE_DATABASE_URL_OVERFLOW/, 'existing single overflow database variable remains authoritative');
forbidPattern(overflow, /CRYPTOCRAWL_PARALLEL_PROXY_DATABASE_URL|CRYPTOCRAWL_OVERFLOW_DATABASE_URL/, 'legacy overflow aliases remain forbidden');

// Dedicated overflow worker: local shared-memory first, overflow second, and only
// on a true miss may it obtain primary data through the overflow gateway.
requirePattern(overflowWorker, /requestCryptaraSharedInformation/, 'overflow worker uses existing shared local broker');
requirePattern(overflowWorker, /primeCryptaraSharedInformation/, 'both workers publish into one coherence directory');
requirePattern(overflowWorker, /freshForMs:\s*0[\s\S]{0,260}LOCAL_ONLY_MISS/, 'local coherence lookup cannot trigger a remote broker load');
requirePattern(overflowWorker, /request\.loadOverflow\(\)[\s\S]{0,2200}request\.loadPrimaryUpstream[\s\S]{0,700}runThroughCryptaraOverflowPrimaryGateway/, 'primary upstream is reachable only after overflow attempt and through gateway');
requirePattern(overflowWorker, /directApplicationPrimaryCalls:\s*0\s+as\s+const/, 'overflow worker guarantees zero direct application primary calls');
requirePattern(overflowWorker, /createsDuplicateCache:\s*false\s+as\s+const/, 'overflow worker reuses shared broker rather than duplicating cache state');
requirePattern(overflowWorker, /const\s+inFlight\s*=\s*new\s+Map/, 'overflow and primary-upstream acquisitions are coalesced single-flight');
forbidPattern(overflowWorker, /\bnew\s+Pool\s*\(|from\s+['"][^'"]*\/db(?:\.js)?['"]|\bpool\.query\s*\(/, 'overflow worker must not create or directly own a primary DB pool');
forbidPattern(overflowWorker, /setInterval\s*\(|setTimeout\s*\(/, 'overflow worker must not poll');
forbidPattern(overflowWorker, /SUPABASE_DATABASE_URL|SUPABASE_DB_URL|DATABASE_URL/, 'overflow worker must not own primary connection variables');

// Read plane: every request is overflow-facing. Primary is a worker-managed fill,
// never a direct HyperBridge branch, and remote lanes are never hedged.
requirePattern(bridge, /loadPrimaryUpstream:\s*input\.primary/, 'bridge hands authoritative loader to overflow worker');
requirePattern(bridge, /const\s+overflow\s*=\s*await\s+runOverflowWorkerLane\(input,\s*freshForMs\)/, 'all bridge reads enter overflow worker');
forbidPattern(bridge, /runReadLane\('primary',\s*input\.primary\)/, 'direct bridge-to-primary branch must not exist');
forbidPattern(bridge, /Promise\.race\s*\(\s*\[?\s*primary|primaryPromise[\s\S]{0,240}overflowPromise[\s\S]{0,240}Promise\.race/, 'primary and overflow DB lanes must never be hedged together');
requirePattern(bridge, /primarySuppressedReads\s*\+=\s*1/, 'zero-direct-primary routing is measured');
requirePattern(bridge, /workerSharedReads\s*\+=\s*1/, 'worker-to-worker local reuse is measured');
requirePattern(bridge, /racedReads\s*=\s*0/, 'legacy race counter starts at zero');
requirePattern(bridge, /const\s+MAX_FRESH_KEYS\s*=\s*2_048/, 'process-local replica directory is bounded');
requirePattern(bridge, /const\s+MAX_LOCAL_REPLICA_FRESH_MS\s*=\s*15\s*\*\s*60_000/, 'route-confidence lifetime is bounded');
requirePattern(bridge, /directPrimaryReadLane:\s*false\s+as\s+const/, 'snapshot explicitly records that bridge has no direct primary read lane');

// Primary write fallback is also transport-routed through overflow gateway.
requirePattern(bridge, /runThroughCryptaraOverflowPrimaryGateway[\s\S]{0,500}hyper_bridge_primary_write_fallback/, 'primary fallback writes pass through overflow gateway');
requirePattern(gateway, /routing:\s*'application_to_overflow_bridge_to_primary'/, 'gateway reports intended route');
requirePattern(gateway, /createsDatabasePool:\s*false\s+as\s+const/, 'gateway creates no third database pool');
requirePattern(gateway, /directApplicationPrimaryCalls:\s*0\s+as\s+const/, 'gateway reports zero direct application primary calls');

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
requirePattern(bridge, /criticalDataAllowed:\s*false/, 'critical derived data remains forbidden in this auxiliary read-model surface');
requirePattern(superWorker, /private readonly inFlight = new Map<string, Promise<CacheEntry>>\(\)/, 'primary Super Worker single-flight remains intact');
requirePattern(superWorker, /execution_truth:\s*0/, 'execution truth remains zero-retention');

// Cold Primary source rows are durable read-through fills, not process-only cache.
requirePattern(sourceLedger, /function\s+enqueueOverflowSourceMirror[\s\S]{0,700}enqueueCryptaraHyperBridgeSnapshot/, 'source ledger has one bounded Overflow mirror helper');
requirePattern(sourceLedger, /const\s+source:\s*RainbowProfitSourceSnapshot\s*=\s*\{[\s\S]{0,1100}enqueueOverflowSourceMirror\(source\);[\s\S]{0,120}return\s+source;/, 'Primary cold-read hit is queued back into Overflow before returning');
requirePattern(sourceLedger, /enqueueOverflowSourceMirror\(source,\s*\(\)\s*=>\s*persistPrimarySource\(source\)\)/, 'new terminal source writes retain the established bounded Primary fallback');
forbidPattern(sourceLedger, /enqueueOverflowSourceMirror\(source,\s*\(\)\s*=>\s*persistPrimarySource\(source\)\)[\s\S]{0,900}async\s+function\s+readPrimarySource/, 'cold-read mirror must not inherit a redundant Primary fallback');

requirePattern(sourceLedger, /enqueueCryptaraHyperBridgeSnapshot/, 'Rainbow source metadata publishes through HyperBridge');
requirePattern(sourceLedger, /readCryptaraHyperBridge<RainbowProfitSourceSnapshot>/, 'Rainbow source metadata reads through HyperBridge');
requirePattern(observability, /readCryptaraHyperBridge<RainbowProfitSnapshot>/, 'Rainbow observability reads through HyperBridge');
requirePattern(observability, /enqueueCryptaraHyperBridgeSnapshot/, 'Rainbow observability writes through HyperBridge');
requirePattern(calibration, /enqueueCryptaraHyperBridgeEvent/, 'Monte Carlo calibration publishes through HyperBridge');

for (const [name, source] of Object.entries({ bridge, overflowWorker, sourceLedger, observability, calibration })) {
  forbidPattern(source, /\bhyperscope\b/i, `${name} embeds reference-framework vocabulary into runtime code`);
  forbidPattern(source, /\benhancements\s+list\b/i, `${name} embeds enhancement-list vocabulary into runtime code`);
}

console.log('[supabase-hyper-bridge] PASS: all information reads enter shared/overflow worker first, primary is fetched on-demand only through overflow gateway, Primary-only source rows are durably backfilled into Overflow, duplicate upstream work is coalesced, no direct bridge primary lane exists, writes remain bounded, and authority remains primary');