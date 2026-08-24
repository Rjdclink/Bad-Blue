import assert from 'node:assert/strict';
import { computationalBeam } from '../../computationalBeam/index.js';
import { CrawlerStrategy, type ComputeWorkload } from '../../computationalBeam/types.js';
import {
  calculateProgressivePositionSize,
  type PositionSizingContext,
} from '../risk/progressive-position-sizing.js';
import { selectCapitalSource, type ChainCapitalSnapshot } from '../core/capital-hierarchy.js';

function chainSnapshot(nativeSufficient: boolean, assetSufficient: boolean): ChainCapitalSnapshot {
  return {
    chain: 'europa',
    nativeBalance: nativeSufficient ? 300n : 0n,
    assetBalance: assetSufficient ? 2_000n : 0n,
    nativeRequired: 200n,
    assetRequired: 1_000n,
    nativeSufficient,
    assetSufficient,
    reason: nativeSufficient && assetSufficient ? undefined : 'complete lifecycle reserve is insufficient',
  };
}

const favorableContext: PositionSizingContext = {
  stage: { canExecuteTrades: true, stageName: 'Proof-of-Signal Activation', maxPositionSizeUSD: 100, maxDrawdownPercent: 5 },
  state: { totalProfitUSD: 250, currentDrawdownPercent: 1, proofMetrics: { monteCarloPassRate: 0.9, monteCarloSimulations: 3 } },
  directive: { riskBudget: 'balanced', notionalMultiplier: 1.1, maxSlippageBps: 25 },
  ranking: { sampleCount: 5, successRate: 0.8 },
  circuitBreakersTripped: false,
};

const adverseContext: PositionSizingContext = {
  ...favorableContext,
  directive: { ...favorableContext.directive, riskBudget: 'defensive' },
  ranking: { sampleCount: 5, successRate: 0.4 },
};

async function validateThroughBeam(label: string, source: string, approved: boolean): Promise<void> {
  if (!computationalBeam.isOperational()) await computationalBeam.initialize();
  const workload: ComputeWorkload<{ source: string; approved: boolean }, { source: string; approved: boolean }> = {
    id: `capital-hierarchy-verification:${label}`,
    type: 'CAPITAL_HIERARCHY_VERIFICATION',
    input: { source, approved },
    timeoutMs: 5_000,
    execute: input => input,
    validate: result => result.source.length > 0 && typeof result.approved === 'boolean',
  };
  const result = await computationalBeam.executeCrawlerTask(
    CrawlerStrategy.ARBITRAGE,
    { label, source },
    { timeout: workload.timeoutMs, workload },
  );
  assert.equal(result.result.source, source);
  assert.equal(result.result.approved, approved);
}

async function main(): Promise<void> {
  const wallet = selectCapitalSource([chainSnapshot(true, true)], { europaEligible: true, flashbotsEligible: true });
  assert.equal(wallet.source, 'wallet');
  await validateThroughBeam('wallet-sufficient', wallet.source, true);

  const europa = selectCapitalSource([chainSnapshot(false, false)], { europaEligible: true, flashbotsEligible: false });
  assert.equal(europa.source, 'europa-zero-capital');
  await validateThroughBeam('wallet-insufficient-europa', europa.source, true);

  const deferred = selectCapitalSource([chainSnapshot(false, false)], {
    europaEligible: false,
    flashbotsEligible: false,
    europaReason: 'Europa readiness is unavailable',
    flashbotsReason: 'Flashbots sponsorship is unavailable',
  });
  assert.equal(deferred.source, 'defer');
  await validateThroughBeam('neither-capital-path', deferred.source, false);

  const increased = calculateProgressivePositionSize({
    requestedNotionalUsd: 50,
    availableCapitalUsd: 1_000,
    expectedNetProfitUsd: 8,
    expectedCostUsd: 1,
    expectedSlippageBps: 10,
    liquidityScore: 0.9,
    volatilityScore: 0.1,
    providerHealthy: true,
    zeroCapitalAvailable: false,
  }, favorableContext);
  assert.equal(increased.approved, true);
  assert.equal(increased.proposedNotionalUsd, 50);
  await validateThroughBeam('favorable-realized-performance', 'wallet', increased.approved);

  const reduced = calculateProgressivePositionSize({
    requestedNotionalUsd: 50,
    availableCapitalUsd: 1_000,
    expectedNetProfitUsd: 8,
    expectedCostUsd: 1,
    expectedSlippageBps: 10,
    liquidityScore: 0.9,
    volatilityScore: 0.1,
    providerHealthy: true,
    zeroCapitalAvailable: false,
  }, adverseContext);
  assert.equal(reduced.approved, false);
  assert.equal(reduced.proposedNotionalUsd, 0);
  await validateThroughBeam('adverse-performance', 'defer', reduced.approved);

  console.log(JSON.stringify({
    wallet: { source: wallet.source, reason: wallet.reasons },
    europa: { source: europa.source, reason: europa.reasons },
    deferred: { source: deferred.source, reason: deferred.reasons },
    favorable: { proposedNotionalUsd: increased.proposedNotionalUsd, reason: increased.reasons },
    adverse: { proposedNotionalUsd: reduced.proposedNotionalUsd, reason: reduced.reasons },
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
