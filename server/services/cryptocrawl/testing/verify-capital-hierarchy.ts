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
  const protectedExternalWallet = selectCapitalSource([chainSnapshot(true, true)], {
    selfFundedEligible: false,
    selfFundedReason: 'no durable SELF_FUNDED provenance',
    europaEligible: true,
    flashbotsEligible: true,
  });
  assert.equal(protectedExternalWallet.source, 'europa-zero-capital');
  assert.equal(protectedExternalWallet.walletSufficient, true);
  assert.match(protectedExternalWallet.reasons.join(' '), /external\/operator capital remains protected/i);
  await validateThroughBeam('funded-wallet-without-provenance', protectedExternalWallet.source, true);

  const selfFunded = selectCapitalSource([chainSnapshot(true, true)], {
    selfFundedEligible: true,
    europaEligible: true,
    flashbotsEligible: true,
  });
  assert.equal(selfFunded.source, 'self-funded');
  await validateThroughBeam('verified-self-funded-capital', selfFunded.source, true);

  const europa = selectCapitalSource([chainSnapshot(false, false)], {
    selfFundedEligible: false,
    europaEligible: true,
    flashbotsEligible: false,
  });
  assert.equal(europa.source, 'europa-zero-capital');
  await validateThroughBeam('wallet-insufficient-europa', europa.source, true);

  const flashbots = selectCapitalSource([chainSnapshot(false, false)], {
    selfFundedEligible: false,
    europaEligible: false,
    flashbotsEligible: true,
  });
  assert.equal(flashbots.source, 'flashbots-zero-capital');
  await validateThroughBeam('wallet-insufficient-flashbots', flashbots.source, true);

  const deferred = selectCapitalSource([chainSnapshot(true, true)], {
    selfFundedEligible: false,
    selfFundedReason: 'no durable SELF_FUNDED provenance',
    europaEligible: false,
    flashbotsEligible: false,
    europaReason: 'Europa readiness is unavailable',
    flashbotsReason: 'Flashbots sponsorship is unavailable',
  });
  assert.equal(deferred.source, 'defer');
  assert.equal(deferred.walletSufficient, true);
  await validateThroughBeam('unproven-wallet-and-no-zero-capital-path', deferred.source, false);

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
  await validateThroughBeam('favorable-realized-performance', 'self-funded', increased.approved);

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
    protectedExternalWallet: { source: protectedExternalWallet.source, reasons: protectedExternalWallet.reasons },
    selfFunded: { source: selfFunded.source, reasons: selfFunded.reasons },
    europa: { source: europa.source, reasons: europa.reasons },
    deferred: { source: deferred.source, reasons: deferred.reasons },
    favorable: { proposedNotionalUsd: increased.proposedNotionalUsd, reason: increased.reasons },
    adverse: { proposedNotionalUsd: reduced.proposedNotionalUsd, reason: reduced.reasons },
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
