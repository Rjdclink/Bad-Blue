'use strict';

const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function requirePattern(source, pattern, description) {
  if (!pattern.test(source)) throw new Error(`[cryptara-resource-intelligence] missing invariant: ${description}`);
}

function forbidPattern(source, pattern, description) {
  if (pattern.test(source)) throw new Error(`[cryptara-resource-intelligence] forbidden regression: ${description}`);
}

const intelligence = read('server/services/cryptocrawl/integration/cryptara-resource-intelligence.ts');
const worker = read('server/services/cryptocrawl/integration/cryptara-supabase-admission-worker.ts');
const superWorker = read('server/services/cryptocrawl/integration/cryptara-super-worker.ts');
const antenna = read('server/services/cryptocrawl/intelligence/sovereign-antenna-quality.ts');
const auction = read('server/services/cryptocrawl/intelligence/provider-quality-auction.ts');
const quanti = read('server/services/quantiComp/index.ts');
const beam = read('server/services/computationalBeam/directionalBeamLayer.ts');
const governance = read('server/services/cryptocrawl/governance/index.ts');

// Reuse measured local state instead of generating new provider or DB calls.
requirePattern(intelligence, /getCryptaraSupabaseAdmissionSnapshot/, 'Cryptara DB admission telemetry is reused');
requirePattern(intelligence, /quantiParallelismGovernor\.getStatus\(\)/, 'Quanti Comp parallelism telemetry is reused');
requirePattern(intelligence, /quantiComp\.getStatus\(\)/, 'Quanti Comp resource telemetry is reused');
requirePattern(intelligence, /getProviderQualityAuctionSnapshot\(\)/, 'Antenna-derived provider quality is reused');
forbidPattern(intelligence, /from\s+['"]\.\.\/\.\.\/\.\.\/db(?:\.js)?['"]|coordinationPool|\bnew\s+Pool\s*\(|\.query\s*\(|\bfetch\s*\(|axios|https?\.request/, 'resource intelligence performs DB/provider/network work instead of reusing snapshots');

// Resource fusion is advisory only and cannot become a trading authority.
requirePattern(intelligence, /authority:\s*'resource_intelligence_advisory_only'/, 'resource fusion authority remains advisory');
requirePattern(intelligence, /writeAuthority:\s*false/, 'resource intelligence has no write authority');
requirePattern(intelligence, /executionAuthority:\s*false/, 'resource intelligence has no execution authority');
requirePattern(intelligence, /database\.mode\s*===\s*'recovering'/, 'compute/provider signals can accelerate only an already recovering DB lane');
requirePattern(intelligence, /databasePressure\s*<\s*0\.35/, 'resource intelligence cannot accelerate DB recovery while measured DB pressure is elevated');
requirePattern(intelligence, /database\.pool\.waiting\s*===\s*0/, 'resource intelligence cannot accelerate while node-postgres has DB waiters');
requirePattern(intelligence, /poolWaiting:\s*database\.pool\.waiting/, 'normalized resource snapshot exposes the same raw waiter count');
requirePattern(intelligence, /database\.queued\s*\/\s*Math\.max\(1,\s*database\.pool\.max\s*\*\s*4\)/, 'small worker backlog is treated as bounded demand rather than automatic overload');

// Comp/Antenna may only shorten already-healthy additive recovery. The worker owns
// all contraction, cooldown, and ceiling decisions and clamps the advisory tightly.
requirePattern(intelligence, /installCryptaraResourceIntelligenceAdvisor/, 'resource intelligence installs a local recovery advisor');
requirePattern(intelligence, /setCryptaraSupabaseRecoveryAdvisor/, 'resource intelligence connects to the existing Cryptara governor');
requirePattern(worker, /export\s+function\s+setCryptaraSupabaseRecoveryAdvisor/, 'worker exposes advisory-only recovery input');
requirePattern(worker, /Math\.max\(1,\s*Math\.min\(1\.5,\s*value\)\)/, 'recovery advice is clamped to 1.0x..1.5x');
requirePattern(worker, /const\s+healthy\s*=\s*stats\.waiting\s*===\s*0\s*&&\s*acquireMs\s*<=\s*HEALTHY_ACQUIRE_MS/, 'worker first requires its own healthy DB evidence');
requirePattern(worker, /Math\.max\(2,\s*Math\.ceil\(HEALTHY_SUCCESSES_TO_GROW\s*\/\s*recoveryAcceleration\)\)/, 'advisor can only shorten the healthy-evidence count with a floor of two');
requirePattern(worker, /Math\.min\(ceiling,\s*this\.targetConcurrency\s*\+\s*1\)/, 'recovery still grows by exactly one permit and never above the live ceiling');
requirePattern(worker, /Math\.floor\(this\.targetConcurrency\s*\/\s*2\)/, 'measured DB pressure still controls multiplicative contraction');

// Existing authority split remains intact: Antenna senses, Beam routes, Quanti Comp computes.
requirePattern(antenna, /executionAuthority:\s*false/, 'Sovereign Antenna remains non-executing');
requirePattern(antenna, /p95LatencyMs/, 'Antenna measures latency');
requirePattern(antenna, /failureRate/, 'Antenna measures failure pressure');
requirePattern(auction, /authority:\s*'provider_priority_advisory_only'/, 'provider auction remains advisory');
requirePattern(auction, /executionAuthority:\s*false/, 'provider auction remains non-executing');
requirePattern(quanti, /QuantiParallelismGovernor/, 'Quanti Comp retains heavy-compute parallelism authority');
requirePattern(beam, /computeAuthority:\s*'quanti-comp'/, 'Beam delegates compute execution to Quanti Comp');

// The Super Worker is the sole governance-facing resource-control surface. It
// delegates Antenna/QuantiComp intelligence to the existing bounded advisor.
requirePattern(superWorker, /activateCryptaraSuperWorkerIntelligence/, 'Super Worker exposes resource-intelligence activation');
requirePattern(superWorker, /installCryptaraResourceIntelligenceAdvisor/, 'Super Worker delegates to the existing bounded resource advisor');
requirePattern(superWorker, /authority:\s*'resource_proxy_only'/, 'Super Worker remains proxy-only');
requirePattern(superWorker, /executionAuthority:\s*false/, 'Super Worker remains non-executing');
requirePattern(governance, /stageManager\.restorePersistence[\s\S]{0,2600}activateCryptaraSuperWorkerIntelligence\(\)/, 'resource advisor activates after critical governance restoration');
requirePattern(governance, /getCryptaraResourceIntelligenceSnapshot/, 'governance still observes fused resource intelligence');
requirePattern(governance, /getCryptaraSuperWorkerSnapshot/, 'governance observes the unified Super Worker surface');
forbidPattern(governance, /resourceIntelligence[^\n]{0,160}(execute|SUBMIT_TX|executionAuthority\s*:\s*true)/i, 'resource intelligence grants execution authority');

// Reference frameworks remain reference-only, never runtime vocabulary.
for (const [name, source] of Object.entries({ intelligence, worker, superWorker, antenna, auction, quanti, beam, governance })) {
  forbidPattern(source, /\bhyperscope\b/i, `${name} embeds Hyperscope into runtime code`);
  forbidPattern(source, /\benhancements\s+list\b/i, `${name} embeds enhancements-list vocabulary into runtime code`);
}

console.log('[cryptara-resource-intelligence] call-free Antenna + Quanti Comp telemetry drives only bounded already-healthy additive DB recovery through the unified Cryptara Super Worker; authority boundaries preserved');
