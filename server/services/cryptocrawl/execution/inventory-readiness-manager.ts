import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { cexInventoryLedger, type InventoryVenue } from './cex-inventory-ledger.js';
import { inventoryRebalancer } from './inventory-rebalancer.js';

export interface LearnedInventoryTarget {
  venue: InventoryVenue;
  asset: string;
  sampleCount: number;
  settlementReliability: number;
  realizedNetProfitUsd: number;
  weightedOpportunityDemand: number;
  prepositioningCostUsd: number;
  advisoryTarget: number | null;
  targetConfidence: number;
  executable: false;
  reason: string;
}

export interface InventoryReadinessSnapshot {
  observedAt: number;
  terminalSamples: number;
  minimumSamplesForLearnedTarget: number;
  learnedTargets: LearnedInventoryTarget[];
  rebalancePlans: ReturnType<typeof inventoryRebalancer.getPlans>;
  gasReadinessSeparated: true;
  tokenApprovalPolicy: {
    allowlistRequired: true;
    amountCapRequired: true;
    revocationMonitoringRequired: true;
    contractVersionSpecific: true;
    unlimitedApprovalShortcutAllowed: false;
  };
  liveTransferExecutionEnabled: false;
  executionAuthority: false;
}

const MIN_SAMPLES = Math.max(3, Math.min(100, Number(process.env.CRYPTO_INVENTORY_LEARNING_MIN_SAMPLES || 10)));
const WINDOW_MS = Math.max(60_000, Math.min(30 * 24 * 60 * 60_000, Number(process.env.CRYPTO_INVENTORY_LEARNING_WINDOW_MS || 7 * 24 * 60 * 60_000)));

function splitSpotSymbol(symbol: string): { base: string; quote: string } | null {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? { base: match[1], quote: match[2] } : null;
}

function targetKey(venue: InventoryVenue, asset: string): string {
  return `${venue}:${asset.toUpperCase()}`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function getGovernedInventoryReadiness(now = Date.now()): InventoryReadinessSnapshot {
  const cutoff = now - WINDOW_MS;
  const terminal = canonicalOpportunityState.getRecent(512).filter(snapshot =>
    snapshot.updatedAt >= cutoff &&
    snapshot.plan !== null &&
    snapshot.settlement?.terminal === true,
  );

  const aggregates = new Map<string, {
    venue: InventoryVenue;
    asset: string;
    samples: number;
    settled: number;
    realizedNetProfitUsd: number;
    weightedDemand: number;
    prepositioningCostUsd: number;
  }>();

  const add = (input: {
    venue: InventoryVenue;
    asset: string;
    settled: boolean;
    realizedNetProfitUsd: number;
    demand: number;
    prepositioningCostUsd: number;
  }) => {
    const key = targetKey(input.venue, input.asset);
    const current = aggregates.get(key) || {
      venue: input.venue,
      asset: input.asset.toUpperCase(),
      samples: 0,
      settled: 0,
      realizedNetProfitUsd: 0,
      weightedDemand: 0,
      prepositioningCostUsd: 0,
    };
    current.samples += 1;
    current.settled += input.settled ? 1 : 0;
    current.realizedNetProfitUsd += input.realizedNetProfitUsd;
    current.weightedDemand += input.demand;
    current.prepositioningCostUsd += input.prepositioningCostUsd;
    aggregates.set(key, current);
  };

  for (const snapshot of terminal) {
    const plan = snapshot.plan!;
    if (!['coinbase', 'kraken', 'okx'].includes(plan.buyVenue) || !['coinbase', 'kraken', 'okx'].includes(plan.sellVenue)) continue;
    const pair = splitSpotSymbol(plan.symbol);
    if (!pair) continue;
    const settled = snapshot.realized.settlementConfirmed === true;
    const realizedNetProfitUsd = Number.isFinite(snapshot.realized.realizedProfitUsd) ? Number(snapshot.realized.realizedProfitUsd) : 0;
    const positiveEdgeWeight = Math.max(0, realizedNetProfitUsd) + Math.max(0, plan.netProfitUsd) * 0.25;
    const reliabilityWeight = settled ? 1 : 0.25;
    const bridgeCost = Math.max(0, plan.costs.bridgeFeeUsd || 0) + Math.max(0, plan.costs.transferFeeUsd || 0);
    const latencyCost = Math.max(0, plan.bridge?.estimatedTimeSec || 0) * Math.max(0, plan.netProfitUsd) / 3600;
    const prepositioningCostUsd = bridgeCost + latencyCost;

    add({
      venue: plan.buyVenue as InventoryVenue,
      asset: pair.quote,
      settled,
      realizedNetProfitUsd,
      demand: Math.max(plan.notionalUsd, plan.executableNotionalUsd) * Math.max(0.01, positiveEdgeWeight) * reliabilityWeight,
      prepositioningCostUsd,
    });
    add({
      venue: plan.sellVenue as InventoryVenue,
      asset: pair.base,
      settled,
      realizedNetProfitUsd,
      demand: Math.max(plan.baseQty, 0) * Math.max(0.01, positiveEdgeWeight) * reliabilityWeight,
      prepositioningCostUsd,
    });
  }

  const ledger = cexInventoryLedger.getSnapshots();
  const targets: LearnedInventoryTarget[] = [...aggregates.values()].map(item => {
    const settlementReliability = item.samples > 0 ? item.settled / item.samples : 0;
    const averagePrepositionCost = item.samples > 0 ? item.prepositioningCostUsd / item.samples : 0;
    const evidenceConfidence = clamp01(item.samples / MIN_SAMPLES) * settlementReliability;
    const current = ledger.find(snapshot => snapshot.venue === item.venue && snapshot.asset === item.asset);
    const maximumExposure = current?.maximumVenueExposure ?? null;
    const minimumReserve = current?.minimumReserve ?? 0;
    const rawTarget = item.samples >= MIN_SAMPLES && settlementReliability > 0
      ? Math.max(0, item.weightedDemand / item.samples - averagePrepositionCost)
      : null;
    const cappedTarget = rawTarget === null
      ? null
      : maximumExposure === null
        ? Math.max(minimumReserve, rawTarget)
        : Math.min(maximumExposure, Math.max(minimumReserve, rawTarget));
    return {
      venue: item.venue,
      asset: item.asset,
      sampleCount: item.samples,
      settlementReliability,
      realizedNetProfitUsd: item.realizedNetProfitUsd,
      weightedOpportunityDemand: item.weightedDemand,
      prepositioningCostUsd: averagePrepositionCost,
      advisoryTarget: cappedTarget,
      targetConfidence: evidenceConfidence,
      executable: false as const,
      reason: item.samples < MIN_SAMPLES
        ? `Advisory only: ${item.samples}/${MIN_SAMPLES} terminal samples; retain configured target until evidence matures`
        : 'Learned target is advisory only and remains subject to governance, inventory exposure limits, measured transfer cost, custody risk, and settlement-safe rebalancing',
    };
  }).sort((left, right) => right.targetConfidence - left.targetConfidence || right.weightedOpportunityDemand - left.weightedOpportunityDemand);

  return {
    observedAt: now,
    terminalSamples: terminal.length,
    minimumSamplesForLearnedTarget: MIN_SAMPLES,
    learnedTargets: targets,
    rebalancePlans: inventoryRebalancer.getPlans(),
    gasReadinessSeparated: true,
    tokenApprovalPolicy: {
      allowlistRequired: true,
      amountCapRequired: true,
      revocationMonitoringRequired: true,
      contractVersionSpecific: true,
      unlimitedApprovalShortcutAllowed: false,
    },
    liveTransferExecutionEnabled: false,
    executionAuthority: false,
  };
}
