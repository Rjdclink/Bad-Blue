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
const migrations = read('server/migrations/reconcileAppSchema.ts');
const dataFabric = read('server/services/quantiComp/dataFabric.ts');

requirePattern(superWorker, /governor:\s*'cryptara'/, 'Cryptara remains the resource policy owner');
requirePattern(superWorker, /authority:\s*'resource_proxy_only'/, 'Super Worker remains proxy/resource authority only');
requirePattern(superWorker, /writeAuthority:\s*false/, 'Super Worker has no write authority');
requirePattern(superWorker, /executionAuthority:\s*false/, 'Super Worker has no execution authority');
requirePattern(superWorker, /installCryptaraSuperWorkerAdmission/, 'Super Worker exposes the DB admission arm');
requirePattern(superWorker, /activateCryptaraSuperWorkerIntelligence/, 'Super Worker exposes the advisory intelligence arm');
forbidPattern(superWorker, /\bnew\s+Pool\s*\(|createClient\s*\(|\bfetch\s*\(|axios|https?\.request|setInterval\s*\(/, 'Super Worker creates its own pool/provider loop/network client');

requirePattern(superWorker, /private readonly inFlight = new Map<string, Promise<CacheEntry>>\(\)/, 'single-flight origin map exists');
requirePattern(superWorker, /this\.inFlight\.get\(request\.key\)/, 'identical in-flight requests share one origin');
requirePattern(superWorker, /this\.coalescedRequests \+= 1/, 'coalesced requests are measured');
requirePattern(superWorker, /upstreamCallsAvoided:\s*this\.cacheHits \+ this\.coalescedRequests/, 'avoided upstream calls are measured');
requirePattern(superWorker, /entry\.readers \+= 1/, 'shared information is reference-counted');
requirePattern(superWorker, /entry\.readers = Math\.max\(0, entry\.readers - 1\)/, 'reader lease release is reference-counted');
requirePattern(superWorker, /entry\.expiresAt <= Date\.now\(\) && entry\.readers === 0/, 'expired information is evicted after the final reader releases');
requirePattern(superWorker, /cleanupExpired/, 'retention cleanup is event/lifecycle driven');
forbidPattern(superWorker, /setTimeout\s*\(|setInterval\s*\(/, 'information retention depends on polling/timers');

requirePattern(superWorker, /execution_truth:\s*0/, 'execution truth is never reused after the originating burst');
requirePattern(superWorker, /connector_readiness:\s*5_000/, 'connector readiness has a hard maximum freshness window');
requirePattern(superWorker, /schema_authority:\s*900_000/, 'schema authority retention is bounded');
requirePattern(superWorker, /maxItems\?/, 'consumer-specific bounded information views are supported');
requirePattern(superWorker, /project\?/, 'consumer-specific projection is supported');
requirePattern(superWorker, /allowedConsumers\?/, 'consumer allow-listing is supported');
requirePattern(superWorker, /MAX_RETAINED_ENTRIES/, 'retained shared-information entries are bounded');
requirePattern(superWorker, /MAX_RETAINED_BYTES/, 'retained shared-information bytes are bounded');

requirePattern(superWorker, /quantiDataFabric\.publishFloat64State/, 'numeric shared state publishes through QuantiComp DataFabric');
requirePattern(superWorker, /quantiDataFabric\.pinFloat64State/, 'numeric consumers pin QuantiComp shared generations');
requirePattern(dataFabric, /SharedArrayBuffer/, 'QuantiComp retains the canonical shared numeric memory primitive');
requirePattern(dataFabric, /pinnedReaders/, 'QuantiComp retains pinned-reader accounting');
requirePattern(dataFabric, /retireGeneration/, 'QuantiComp retires old generations safely');

requirePattern(readiness, /requestCryptaraSharedInformation/, 'connector readiness uses the shared broker');
requirePattern(readiness, /informationClass:\s*'connector_readiness'/, 'connector readiness uses its bounded semantic class');
requirePattern(readiness, /freshForMs:\s*strictLive \? 250 : 1_500/, 'strict readiness reuse is sub-second and relaxed reuse remains short');
requirePattern(readiness, /finally\s*\{[\s\S]{0,120}lease\.release\(\)/, 'connector consumer releases its information lease');

requirePattern(masterPipeline, /getCryptaraSharedConnectorReadiness/, 'MasterPipeline consumes Cryptara shared readiness');
forbidPattern(masterPipeline, /TradingViewEngine\.checkReadiness|alchemyIntegration\.readinessCheck|multiProviderRpcManager\.initialize/, 'MasterPipeline independently repeats Cryptara connector probes');
requirePattern(masterPipeline, /const tradingView = cryptaraReadiness\.tradingView/, 'TradingView diagnostic is fanned out from the canonical result');
requirePattern(masterPipeline, /const alchemy = cryptaraReadiness\.alchemy/, 'Alchemy diagnostic is fanned out from the canonical result');

requirePattern(migrations, /primeResourceLeaseAuthorityReady/, 'startup schema proof primes shared lease truth');
requirePattern(leaseAuthority, /primeCryptaraSharedInformation/, 'runtime lease authority seeds the Super Worker broker');
requirePattern(leaseAuthority, /if \(now < authorityReadyUntil\) return true;/, 'primed schema truth short-circuits before any broker eviction can trigger another DB probe');
requirePattern(leaseAuthority, /requestCryptaraSharedInformation/, 'expired runtime lease authority consumes shared broker truth');

requirePattern(governance, /installCryptaraSuperWorkerAdmission\(\)[\s\S]{0,500}releaseRollingDeploymentPoolHeadroom/, 'Super Worker admission owns DB flow before rollout headroom is released');
requirePattern(governance, /stageManager\.restorePersistence[\s\S]{0,2400}activateCryptaraSuperWorkerIntelligence\(\)/, 'resource intelligence activates only after critical governance persistence enters the governed lane');
requirePattern(governance, /getCryptaraSuperWorkerSnapshot/, 'governance observes Super Worker efficiency telemetry');
forbidPattern(governance, /superWorker[^\n]{0,180}(execute|SUBMIT_TX|executionAuthority\s*:\s*true)/i, 'governance uses the Super Worker as execution authority');

for (const [name, source] of Object.entries({ superWorker, readiness, masterPipeline, governance, leaseAuthority, migrations })) {
  forbidPattern(source, /\bhyperscope\b/i, `${name} embeds Hyperscope into runtime code`);
  forbidPattern(source, /\benhancements\s+list\b/i, `${name} embeds enhancements-list vocabulary into runtime code`);
}

console.log('[cryptara-super-worker] single-flight shared information, bounded leases, QuantiComp reuse, startup schema short-circuit/fan-out, proxy-only authority, and duplicate-free connector readiness invariants passed');
