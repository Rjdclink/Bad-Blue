'use strict';

const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function requirePattern(source, pattern, description) {
  if (!pattern.test(source)) throw new Error(`[cryptara-super-worker] missing invariant: ${description}`);
}

function forbidPattern(source, pattern, description) {
  if (pattern.test(source)) throw new Error(`[cryptara-super-worker] forbidden regression: ${description}`);
}

const superWorker = read('server/services/cryptocrawl/integration/cryptara-super-worker.ts');
const readiness = read('server/services/cryptocrawl/integration/cryptara-shared-readiness.ts');
const masterPipeline = read('server/services/cryptocrawl/integration/master-pipeline.ts');
const governance = read('server/services/cryptocrawl/governance/index.ts');
const leaseAuthority = read('server/services/cryptocrawl/execution/resource-lease-authority.ts');
const dataFabric = read('server/services/quantiComp/dataFabric.ts');

// One logical Cryptara worker owns resource flow by proxy, never trading authority.
requirePattern(superWorker, /governor:\s*'cryptara'/, 'Cryptara remains the resource policy owner');
requirePattern(superWorker, /authority:\s*'resource_proxy_only'/, 'Super Worker remains proxy/resource authority only');
requirePattern(superWorker, /writeAuthority:\s*false/, 'Super Worker has no write authority');
requirePattern(superWorker, /executionAuthority:\s*false/, 'Super Worker has no execution authority');
requirePattern(superWorker, /installCryptaraSuperWorkerAdmission/, 'Super Worker exposes the DB admission arm');
requirePattern(superWorker, /activateCryptaraSuperWorkerIntelligence/, 'Super Worker exposes the advisory intelligence arm');
forbidPattern(superWorker, /\bnew\s+Pool\s*\(|createClient\s*\(|\bfetch\s*\(|axios|https?\.request|setInterval\s*\(/, 'Super Worker creates its own pool/provider loop/network client');

// Duplicate requests collapse to one origin request, then fan out through leases.
requirePattern(superWorker, /private readonly inFlight = new Map<string, Promise<CacheEntry>>\(\)/, 'single-flight origin map exists');
requirePattern(superWorker, /this\.inFlight\.get\(request\.key\)/, 'identical in-flight requests share one origin');
requirePattern(superWorker, /this\.coalescedRequests \+= 1/, 'coalesced requests are measured');
requirePattern(superWorker, /upstreamCallsAvoided:\s*this\.cacheHits \+ this\.coalescedRequests/, 'avoided upstream calls are measured');
requirePattern(superWorker, /entry\.readers \+= 1/, 'shared information is reference-counted');
requirePattern(superWorker, /entry\.readers = Math\.max\(0, entry\.readers - 1\)/, 'reader lease release is reference-counted');
requirePattern(superWorker, /entry\.expiresAt <= Date\.now\(\) && entry\.readers === 0/, 'expired information is evicted after the final reader releases');
requirePattern(superWorker, /previous\.readers === 0/, 'a fresh generation never overwrites an older pinned generation');
requirePattern(superWorker, /cleanupExpired/, 'retention cleanup is event/lifecycle driven');
forbidPattern(superWorker, /setTimeout\s*\(|setInterval\s*\(/, 'information retention depends on polling/timers');

// Information quantity/freshness is bounded by semantic class and consumer request.
requirePattern(superWorker, /execution_truth:\s*0/, 'execution truth is never reused after the originating burst');
requirePattern(superWorker, /connector_readiness:\s*5_000/, 'connector readiness has a hard maximum freshness window');
requirePattern(superWorker, /schema_authority:\s*900_000/, 'schema authority retention is bounded');
requirePattern(superWorker, /maxItems\?/, 'consumer-specific bounded information views are supported');
requirePattern(superWorker, /project\?/, 'consumer-specific projection is supported');
requirePattern(superWorker, /allowedConsumers\?/, 'consumer allow-listing is supported');
requirePattern(superWorker, /MAX_RETAINED_ENTRIES/, 'retained shared-information entries are bounded');
requirePattern(superWorker, /MAX_RETAINED_BYTES/, 'retained shared-information bytes are bounded');
requirePattern(superWorker, /primeCryptaraSharedInformation/, 'verified existing truth can prime the same broker without a new upstream call');

// QuantiComp DataFabric is reused instead of creating a second numeric-memory authority.
requirePattern(superWorker, /quantiDataFabric\.publishFloat64State/, 'numeric shared state publishes through QuantiComp DataFabric');
requirePattern(superWorker, /quantiDataFabric\.pinFloat64State/, 'numeric consumers pin QuantiComp shared generations');
requirePattern(dataFabric, /SharedArrayBuffer/, 'QuantiComp retains the canonical shared numeric memory primitive');
requirePattern(dataFabric, /pinnedReaders/, 'QuantiComp retains pinned-reader accounting');
requirePattern(dataFabric, /retireGeneration/, 'QuantiComp retires old generations safely');

// Connector readiness is a first real consumer: strict checks coalesce only across
// a very short burst and never become long-lived execution evidence.
requirePattern(readiness, /requestCryptaraSharedInformation/, 'connector readiness uses the shared broker');
requirePattern(readiness, /informationClass:\s*'connector_readiness'/, 'connector readiness uses its bounded semantic class');
requirePattern(readiness, /freshForMs:\s*strictLive \? 250 : 1_500/, 'strict readiness reuse is sub-second and relaxed reuse remains short');
requirePattern(readiness, /finally\s*\{[\s\S]{0,120}lease\.release\(\)/, 'connector consumer releases its information lease');
requirePattern(readiness, /ORIGINAL_READINESS\s*=\s*Symbol\.for/, 'the proxy preserves the original Cryptara readiness origin');
requirePattern(readiness, /PATCHED_READINESS\s*=\s*Symbol\.for/, 'readiness proxy installation is idempotent');
requirePattern(readiness, /if\s*\(target\[PATCHED_READINESS\]\s*===\s*true\)\s*return/, 'readiness proxy cannot stack recursively');
requirePattern(governance, /installCryptaraSharedConnectorReadinessProxy\(cryptara\)/, 'governance installs the proxy on the authoritative Cryptara singleton');

// MasterPipeline no longer independently repeats the three checks Cryptara already owns.
requirePattern(masterPipeline, /getCryptaraSharedConnectorReadiness/, 'MasterPipeline consumes Cryptara shared readiness');
forbidPattern(masterPipeline, /TradingViewEngine\.checkReadiness|alchemyIntegration\.readinessCheck|multiProviderRpcManager\.initialize/, 'MasterPipeline independently repeats Cryptara connector probes');
requirePattern(masterPipeline, /const tradingView = cryptaraReadiness\.tradingView/, 'TradingView diagnostic is fanned out from the canonical result');
requirePattern(masterPipeline, /const alchemy = cryptaraReadiness\.alchemy/, 'Alchemy diagnostic is fanned out from the canonical result');

// Existing startup schema proof and later CEX/zero-capital/quota consumers use the
// same broker key instead of maintaining a second readiness value cache.
requirePattern(leaseAuthority, /RESOURCE_LEASE_AUTHORITY_INFO_KEY\s*=\s*'cryptara:schema-authority:resource-leases'/, 'lease authority has one canonical broker key');
requirePattern(leaseAuthority, /primeCryptaraSharedInformation\s*\(\{[\s\S]{0,260}RESOURCE_LEASE_AUTHORITY_INFO_KEY/, 'startup verification primes that broker key');
requirePattern(leaseAuthority, /requestCryptaraSharedInformation<boolean>\s*\(\{[\s\S]{0,260}RESOURCE_LEASE_AUTHORITY_INFO_KEY/, 'runtime readiness consumes the same broker key');
requirePattern(leaseAuthority, /withCryptaraSupabasePriority\(priority,\s*\(\)\s*=>\s*pool\.query/, 'the single DB origin still enters Cryptara priority admission');
requirePattern(leaseAuthority, /throw new Error\('RESOURCE_LEASE_AUTHORITY_MISSING'\)/, 'missing schema fails closed and is not cached as readiness');
forbidPattern(leaseAuthority, /\bnew\s+Pool\s*\(/, 'lease authority creates a second DB pool');

// Governance controls the worker by proxy and preserves critical ordering.
requirePattern(governance, /installCryptaraSuperWorkerAdmission\(\)[\s\S]{0,500}releaseRollingDeploymentPoolHeadroom/, 'Super Worker admission owns DB flow before rollout headroom is released');
requirePattern(governance, /stageManager\.restorePersistence[\s\S]{0,2600}activateCryptaraSuperWorkerIntelligence\(\)/, 'resource intelligence activates only after critical governance persistence enters the governed lane');
requirePattern(governance, /getCryptaraSuperWorkerSnapshot/, 'governance observes Super Worker efficiency telemetry');
forbidPattern(governance, /superWorker[^\n]{0,180}(execute|SUBMIT_TX|executionAuthority\s*:\s*true)/i, 'governance uses the Super Worker as execution authority');

for (const [name, source] of Object.entries({ superWorker, readiness, masterPipeline, governance, leaseAuthority })) {
  forbidPattern(source, /\bhyperscope\b/i, `${name} embeds Hyperscope into runtime code`);
  forbidPattern(source, /\benhancements\s+list\b/i, `${name} embeds enhancements-list vocabulary into runtime code`);
}

console.log('[cryptara-super-worker] single-flight shared information, bounded leases, safe generation retirement, QuantiComp reuse, global readiness proxy, shared schema truth, proxy-only authority, and duplicate-free connector readiness invariants passed');