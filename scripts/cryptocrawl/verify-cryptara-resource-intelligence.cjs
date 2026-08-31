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
forbidPattern(intelligence, /\bpool\b|coordinationPool|\.query\s*\(|\bfetch\s*\(|axios|https?\.request|new\s+Pool\s*\(/, 'resource intelligence performs DB/provider/network work instead of reusing snapshots');

// Resource fusion is advisory only and cannot become a trading authority.
requirePattern(intelligence, /authority:\s*'resource_intelligence_advisory_only'/, 'resource fusion authority remains advisory');
requirePattern(intelligence, /writeAuthority:\s*false/, 'resource intelligence has no write authority');
requirePattern(intelligence, /executionAuthority:\s*false/, 'resource intelligence has no execution authority');
requirePattern(intelligence, /database\.mode\s*===\s*'recovering'/, 'compute/provider signals can accelerate only an already recovering DB lane');
requirePattern(intelligence, /databasePressure\s*<\s*0\.35/, 'resource intelligence cannot accelerate DB recovery while measured DB pressure is elevated');

// Existing authority split remains intact: Antenna senses, Beam routes, Quanti Comp computes.
requirePattern(antenna, /executionAuthority:\s*false/, 'Sovereign Antenna remains non-executing');
requirePattern(antenna, /p95LatencyMs/, 'Antenna measures latency');
requirePattern(antenna, /failureRate/, 'Antenna measures failure pressure');
requirePattern(auction, /authority:\s*'provider_priority_advisory_only'/, 'provider auction remains advisory');
requirePattern(auction, /executionAuthority:\s*false/, 'provider auction remains non-executing');
requirePattern(quanti, /QuantiParallelismGovernor/, 'Quanti Comp retains heavy-compute parallelism authority');
requirePattern(beam, /computeAuthority:\s*'quanti-comp'/, 'Beam delegates compute execution to Quanti Comp');

// Governance may observe the fused snapshot but cannot derive execution authority from it.
requirePattern(governance, /getCryptaraResourceIntelligenceSnapshot/, 'governance installs/observes fused resource intelligence');
forbidPattern(governance, /resourceIntelligence[^\n]{0,160}(execute|SUBMIT_TX|executionAuthority\s*:\s*true)/i, 'resource intelligence grants execution authority');

// Reference frameworks remain reference-only, never runtime vocabulary.
for (const [name, source] of Object.entries({ intelligence, antenna, auction, quanti, beam, governance })) {
  forbidPattern(source, /\bhyperscope\b/i, `${name} embeds Hyperscope into runtime code`);
  forbidPattern(source, /\benhancements\s+list\b/i, `${name} embeds enhancements-list vocabulary into runtime code`);
}

console.log('[cryptara-resource-intelligence] Antenna sensing + Quanti Comp resource telemetry + Cryptara DB admission fusion verified as call-free advisory intelligence');
