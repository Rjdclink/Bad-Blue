'use strict';

const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const requirePattern = (source, pattern, description) => {
  if (!pattern.test(source)) throw new Error(`[supabase-comp-switch] missing invariant: ${description}`);
};
const forbidPattern = (source, pattern, description) => {
  if (pattern.test(source)) throw new Error(`[supabase-comp-switch] forbidden regression: ${description}`);
};

const dataSwitch = read('server/services/cryptocrawl/integration/cryptara-supabase-comp-switch.ts');
const superWorker = read('server/services/cryptocrawl/integration/cryptara-super-worker.ts');
const resource = read('server/services/cryptocrawl/integration/cryptara-resource-intelligence.ts');
const outbox = read('server/services/cryptocrawl/intelligence/canonical-intelligence-outbox.ts');
const rainbow = read('server/services/cryptocrawl/compensation/rainbow-profit-observability.ts');
const runtimeObservability = read('server/services/cryptocrawl/integration/runtime-observability.ts');
const distributedQuota = read('server/services/cryptocrawl/execution/distributed-api-quota.ts');
const treasury = read('server/services/cryptocrawl/runtime/terminal-treasury-lifecycle.ts');

requirePattern(dataSwitch, /CryptaraSupabaseDataPath\s*=\s*'normal'\s*\|\s*'comp'/, 'switch has explicit normal and comp paths');
requirePattern(dataSwitch, /signal\.mode\s*===\s*'pressure'/, 'admission pressure enters the comp path');
requirePattern(dataSwitch, /signal\.pool\.waiting/, 'pool waiters are a switch signal');
requirePattern(dataSwitch, /ewmaAcquireMs/, 'measured DB admission latency is a switch signal');
requirePattern(dataSwitch, /admissionFailures/, 'admission failures are a switch signal');
requirePattern(dataSwitch, /MIN_COMP_RESIDENCY_MS/, 'mode switching has time hysteresis');
requirePattern(dataSwitch, /HEALTHY_OBSERVATIONS_TO_EXIT/, 'recovery requires repeated healthy evidence');
requirePattern(dataSwitch, /quantiDataFabric\.publishFloat64State/, 'mode state is published through QuantiComp DataFabric');
requirePattern(dataSwitch, /dropWork:\s*false/, 'comp mode never drops queued work');
requirePattern(dataSwitch, /criticalDurabilityAlwaysDirect:\s*true/, 'critical durability remains direct');
requirePattern(dataSwitch, /writeAuthority:\s*false/, 'switch has no write authority');
requirePattern(dataSwitch, /executionAuthority:\s*false/, 'switch has no execution authority');
forbidPattern(dataSwitch, /pool\.query|db\.execute|fetch\s*\(|axios|https?\.request|new\s+Pool\s*\(/, 'switch performs origin I/O or creates a DB pool');
forbidPattern(dataSwitch, /setInterval\s*\(|setTimeout\s*\(/, 'switch relies on polling instead of observed work');

requirePattern(superWorker, /getCryptaraSupabaseCompSwitchSnapshot/, 'Super Worker consumes switch state');
requirePattern(superWorker, /informationClass\s*===\s*'execution_truth'/, 'execution truth remains zero-retention protected');
requirePattern(superWorker, /sharedFreshnessMultiplier/, 'comp path extends only bounded reusable information freshness');
requirePattern(superWorker, /Math\.min\(maximum/, 'comp freshness remains under semantic class maximum');
requirePattern(superWorker, /compFreshnessExtensions/, 'Super Worker measures comp-mode reuse');

requirePattern(resource, /observeCryptaraSupabaseCompSwitch\(database\)/, 'Antenna/QuantiComp resource fusion feeds the switch from measured admission telemetry');
requirePattern(resource, /dataPath\.path\s*===\s*'normal'[\s\S]{0,200}database\.mode\s*===\s*'recovering'/, 'recovery acceleration cannot outrun comp-mode DB recovery');

requirePattern(outbox, /refreshCryptaraSupabaseCompSwitch/, 'background persistence refreshes the switch without a DB probe');
requirePattern(outbox, /policy\.backgroundPollMultiplier/, 'comp mode reduces background polling frequency');
requirePattern(outbox, /claimBatch\(batchSize\)/, 'outbox claims bounded work as one batch');
requirePattern(outbox, /for update skip locked[\s\S]{0,500}limit \$2/i, 'batched claim preserves multi-worker SKIP LOCKED semantics');
requirePattern(outbox, /with persisted as[\s\S]{0,2600}update private\.cryptara_outbox/i, 'learning persistence and completion share one atomic statement');
requirePattern(outbox, /New terminal truth is never deferred by comp mode/, 'terminal truth wakes immediately even in comp mode');

requirePattern(rainbow, /refreshCryptaraSupabaseCompSwitch/, 'Rainbow observability refreshes switch state from local DB telemetry');
requirePattern(rainbow, /policy\.observabilityMultiplier/, 'Rainbow becomes less chatty only in comp mode');
requirePattern(rainbow, /withCryptaraSupabasePriority\('low'/, 'Rainbow remains low-priority observability');

requirePattern(runtimeObservability, /supabasePath\.path\s*===\s*'comp'[\s\S]{0,180}canonicalIntelligenceOutbox\.getMetrics\(\)/, 'runtime heartbeat reuses cached DB metrics in comp mode');
requirePattern(runtimeObservability, /canonicalIntelligenceOutbox\.refreshMetrics\(\)/, 'normal mode retains live outbox metrics refresh');
requirePattern(runtimeObservability, /outboxMetricsSource:\s*supabasePath\.path\s*===\s*'comp'\s*\?\s*'cached'\s*:\s*'live_refresh'/, 'runtime telemetry proves which data path supplied DB metrics');

requirePattern(distributedQuota, /refreshCryptaraSupabaseCompSwitch/, 'distributed quota consumes the same pressure switch');
requirePattern(distributedQuota, /dataPath\.path\s*===\s*'normal'[\s\S]{0,1200}MIN\(expires_at\)/i, 'healthy quota path retains exact earliest-expiry timing');
requirePattern(distributedQuota, /else\s*\{[\s\S]{0,180}compLocalWaits\s*\+=\s*1[\s\S]{0,120}avoidedDbReads\s*\+=\s*1/, 'comp quota path uses local timing and records avoided DB reads');
requirePattern(distributedQuota, /Math\.ceil\(windowMs\s*\/\s*capacity\)/, 'comp quota fallback uses bounded fair local wait estimate');

requirePattern(treasury, /const\s+HEARTBEAT_MS\s*=\s*60_000/, 'treasury safety heartbeat remains one minute regardless of comp mode');
forbidPattern(treasury, /observabilityMultiplier|backgroundPollMultiplier|sharedFreshnessMultiplier/, 'comp-mode cadence leaks into treasury safety timing');

console.log('[supabase-comp-switch] PASS: pressure switches normal->comp across shared reads, quota and noncritical DB workers; healthy hysteresis restores normal mode; treasury/critical durability remain fixed and independent of comp cadence');
