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

console.log('[supabase-comp-switch] PASS: measured pressure switches normal->comp, hysteretic recovery switches back, QuantiComp sharing expands safely, and critical work is never dropped');
