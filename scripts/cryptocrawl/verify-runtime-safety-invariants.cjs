const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) throw new Error(`required source missing: ${relativePath}`);
  return fs.readFileSync(fullPath, 'utf8');
}

function requireAll(relativePath, requiredFragments) {
  const source = read(relativePath);
  const missing = requiredFragments.filter(fragment => !source.includes(fragment));
  if (missing.length > 0) {
    throw new Error(`${relativePath} is missing required invariant(s): ${missing.join(' | ')}`);
  }
  return source;
}

function forbid(relativePath, forbiddenFragments) {
  const source = read(relativePath);
  const found = forbiddenFragments.filter(fragment => source.includes(fragment));
  if (found.length > 0) {
    throw new Error(`${relativePath} contains forbidden regression marker(s): ${found.join(' | ')}`);
  }
}

// 1) Unified execution remains fail-closed and strictly positive on measured all-in economics.
requireAll('server/services/cryptocrawl/execution/unified-execution-router.ts', [
  "const deterministicPositive = Number(candidate.economics.deterministicNetProfitUsd) > 0;",
  "candidate.status === 'eligible'",
  'candidate.executableCapability',
  'candidate.missingInformation.length === 0',
  "candidate.depth.status !== 'unavailable'",
  'candidate.expiresAt > Date.now()',
  "admitted: deterministicPositive && completeCurrentEvidence && aboveAdaptiveThreshold && path !== 'UNAVAILABLE'",
]);

// 2) Cryptara CEX topology correction is limited to implemented execution venues.
requireAll('server/services/cryptocrawl/integration/cryptara-cex-evidence-wiring.ts', [
  "const CEX_EXECUTION_VENUES = new Set(['kraken', 'okx']);",
  "'not_applicable:mempool_evidence'",
  'canonicalMonteCarloPreserved: true',
  'economicsChanged: false',
]);
forbid('server/services/cryptocrawl/integration/cryptara-cex-evidence-wiring.ts', [
  "new Set(['coinbase', 'kraken', 'okx'])",
]);

// 3) Antenna/provider auction remains measured advisory intelligence, not execution authority.
requireAll('server/services/cryptocrawl/intelligence/sovereign-antenna-quality.ts', [
  'observationAgeMs',
  'recencyScore',
  'p95LatencyMs',
  'executionAuthority: false',
]);
requireAll('server/services/cryptocrawl/intelligence/provider-quality-auction.ts', [
  "authority: 'provider_priority_advisory_only'",
  'executionAuthority: false',
  'quality.failureRate',
  'quality.observationAgeMs',
]);
const orderBookSource = requireAll('server/services/cryptocrawl/integration/order-book-evolution-wiring.ts', [
  'allExecutableVenuesStillObservedSimultaneously: true',
  "providerAuction: 'measured_quality_weighted_attention_advisory_only'",
  'executionAuthority: false',
]);
const legacySimultaneousShape = orderBookSource.includes('Promise.all(venues.flatMap(venue => symbols.map(async symbol => {');
const interleavedSimultaneousShape = orderBookSource.includes('symbols.flatMap(symbol => venues.map')
  && orderBookSource.includes('Promise.allSettled')
  && orderBookSource.includes('getActiveExecutableQuoteVenues()');
if (!legacySimultaneousShape && !interleavedSimultaneousShape) {
  throw new Error('server/services/cryptocrawl/integration/order-book-evolution-wiring.ts is missing simultaneous executable-venue observation invariant');
}

// 4) BPS rescue remains a bounded search scheduler and requires exact re-quote.
requireAll('server/services/cryptocrawl/integration/economic-transformation-wiring.ts', [
  'maxPerTopologyDriver()',
  "portfolioDiversityAuthority: 'search_scheduling_only'",
  'exactRequoteRequired: true',
  'executionAuthority: false',
]);
requireAll('server/services/cryptocrawl/optimization/economic-transformation-engine.ts', [
  "authority: 'optimization_advisory_only'",
  'executionAuthority: false',
  "'exact_requote_required'",
  "'synthetic_profit:false'",
]);

// 5) Settlement calibration learns only from terminal confirmed realized outcomes.
requireAll('server/services/cryptocrawl/learning/settlement-profit-calibrator.ts', [
  'outcome.settlement?.terminal',
  'outcome.settlement.settlementConfirmed',
  "authority: 'learning_only'",
  'executionAuthority: false',
]);
requireAll('server/services/cryptocrawl/integration/learning-lifecycle-wiring.ts', [
  'recordSettlementProfitCalibration(outcome);',
  "settlementProfitCalibration: 'terminal_confirmed_expected_vs_realized_only'",
  'settlementCalibrationExecutionAuthority: false',
]);

// 6) Zero-capital provider repricing keeps strict positivity and rechecks Cryptara.
requireAll('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts', [
  'if (netProfit <= 0n)',
  'const cryptaraAllowed = !target.executionEnabled || await originalCryptaraAdmission(opportunity);',
  "'strict_positive_repriced_net'",
  'positiveProviderRescueRechecksCryptara: true',
  'nonPositiveProviderRepriceExecutable: false',
]);

console.log('[runtime-safety-invariants] PASS: strict positive economics, governance boundaries, advisory-only optimizer/provider intelligence, terminal settlement learning, and zero-capital repricing invariants preserved');
