import { createHash } from 'node:crypto';
import { quantiComp, type QuantiLane } from '../../../quantiComp/index.js';
import { buildNixGenCapitalRoutingAdvisory, type NixGenCapitalRoutingSnapshot } from './capital-routing-advisory.js';
import { discoverNixGenDualResourcePrices, type NixGenDualPriceSnapshot } from './dual-resource-pricing.js';
import { optimizeNixGenBids } from './global-optimizer.js';
import { priceNixGenResourceOpportunities, type NixGenResourceOpportunityPriceSnapshot } from './resource-opportunity-pricing.js';
import type { NixGenOptimizationResult, NixGenResourceBudget, NixGenStrategyBid } from './types.js';

export interface NixGenQuantiAnalysisInput {
  bids: readonly NixGenStrategyBid[];
  budgets: readonly NixGenResourceBudget[];
  now?: number;
  exactBidLimit?: number;
  timeoutMs?: number;
  lane?: QuantiLane;
}

export interface NixGenQuantiAnalysisSnapshot {
  generatedAt: number;
  authority: 'nix_gen_advisory_analysis';
  computePath: 'quanti_comp' | 'inline_fallback';
  computeAuthority: 'quanti_comp' | 'nix_gen_inline_fallback';
  executionAuthority: false;
  resourceAuthority: false;
  treasuryAuthority: false;
  canonicalEconomicsAuthority: false;
  optimization: NixGenOptimizationResult;
  dualPrices: NixGenDualPriceSnapshot;
  resourceOpportunityPrices: NixGenResourceOpportunityPriceSnapshot;
  capitalRouting: NixGenCapitalRoutingSnapshot;
  quantiError: string | null;
}

function boundedInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed))) : fallback;
}

function canonicalFingerprint(input: NixGenQuantiAnalysisInput, now: number): string {
  const bids = [...input.bids]
    .sort((left, right) => left.bidId.localeCompare(right.bidId))
    .map(bid => ({
      bidId: bid.bidId,
      opportunityId: bid.opportunityId,
      strategyId: bid.strategyId,
      strategyClass: bid.strategyClass,
      observedAt: bid.observedAt,
      expiresAt: bid.expiresAt,
      economics: bid.economics,
      execution: bid.execution,
      advisory: bid.advisory,
      resources: [...bid.resources].sort((left, right) => left.resourceKey.localeCompare(right.resourceKey)),
      mutualExclusionGroup: bid.mutualExclusionGroup ?? null,
    }));
  const budgets = [...input.budgets].sort((left, right) => left.resourceKey.localeCompare(right.resourceKey));
  return createHash('sha256')
    .update(JSON.stringify({ bids, budgets, now, exactBidLimit: input.exactBidLimit ?? null }))
    .digest('hex');
}

export function buildNixGenAnalysisInline(
  input: NixGenQuantiAnalysisInput,
  computePath: NixGenQuantiAnalysisSnapshot['computePath'] = 'inline_fallback',
  quantiError: string | null = null,
): NixGenQuantiAnalysisSnapshot {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const optimization = optimizeNixGenBids(input.bids, input.budgets, {
    now,
    exactBidLimit: input.exactBidLimit,
  });
  const dualPrices = discoverNixGenDualResourcePrices(input.bids, input.budgets, {
    now,
    exactBidLimit: input.exactBidLimit,
  });
  const resourceOpportunityPrices = priceNixGenResourceOpportunities(input.bids, input.budgets, {
    now,
    exactBidLimit: input.exactBidLimit,
  });
  const capitalRouting = buildNixGenCapitalRoutingAdvisory(input.bids, input.budgets);
  return {
    generatedAt: now,
    authority: 'nix_gen_advisory_analysis',
    computePath,
    computeAuthority: computePath === 'quanti_comp' ? 'quanti_comp' : 'nix_gen_inline_fallback',
    executionAuthority: false,
    resourceAuthority: false,
    treasuryAuthority: false,
    canonicalEconomicsAuthority: false,
    optimization,
    dualPrices,
    resourceOpportunityPrices,
    capitalRouting,
    quantiError,
  };
}

function validAnalysis(snapshot: NixGenQuantiAnalysisSnapshot): boolean {
  return snapshot.authority === 'nix_gen_advisory_analysis'
    && snapshot.executionAuthority === false
    && snapshot.resourceAuthority === false
    && snapshot.treasuryAuthority === false
    && snapshot.canonicalEconomicsAuthority === false
    && snapshot.optimization.executionAuthority === false
    && snapshot.dualPrices.executionAuthority === false
    && snapshot.dualPrices.exactDualOptimalityClaim === false
    && snapshot.resourceOpportunityPrices.capitalMovementAuthority === false
    && snapshot.capitalRouting.capitalMovementAuthority === false;
}

/**
 * Optional heavy-analysis path through the canonical QuantiComp scheduler.
 * Ordinary Nix-Gen hot-path ordering remains dependency-free. If QuantiComp is
 * unavailable, times out, rejects, or fails validation, the exact same side-effect-
 * free analysis runs inline and is explicitly labeled as the fallback path.
 */
export async function analyzeNixGenWithQuantiComp(
  input: NixGenQuantiAnalysisInput,
): Promise<NixGenQuantiAnalysisSnapshot> {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const timeoutMs = boundedInt(input.timeoutMs, 750, 25, 5_000);
  const fingerprint = canonicalFingerprint(input, now);
  const earliestExpiry = input.bids
    .map(bid => Number(bid.expiresAt))
    .filter(expiry => Number.isFinite(expiry) && expiry > now)
    .sort((left, right) => left - right)[0];
  const deadlineAt = earliestExpiry ? Math.max(now + 1, earliestExpiry - 10) : undefined;
  const lane: QuantiLane = input.lane ?? 'warm';
  const usefulWorkUnits = Math.max(1, input.bids.length * Math.max(1, input.budgets.length));
  const maximumProfit = input.bids.reduce((best, bid) => Math.max(best, Number(bid.economics.netProfitUsd) || 0), 0);

  try {
    const execution = await quantiComp.submit({
      id: `nix-gen-analysis:${fingerprint.slice(0, 16)}`,
      kind: 'cryptocrawl_nix_gen_advisory_analysis',
      lane,
      priority: Math.max(0, Math.min(1_000_000, maximumProfit * 100)),
      createdAt: now,
      input: { ...input, now },
      features: {
        bidCount: input.bids.length,
        resourceCount: input.budgets.length,
        usefulWorkUnits,
      },
      resourceHints: {
        cpuWeight: Math.max(1, Math.min(16, Math.ceil(input.bids.length / 8))),
        memoryMB: Math.max(16, Math.min(256, Math.ceil(usefulWorkUnits / 4))),
        expectedDurationMs: Math.min(timeoutMs, Math.max(10, input.bids.length * 2)),
        preferredBackend: 'inline',
        parallelismHint: 1,
      },
      policy: {
        timeoutMs,
        deadlineAt,
        deterministic: true,
        sideEffectFree: true,
        backendEligible: false,
        allowDeduplication: true,
        dedupeKey: `nix-gen:${fingerprint}`,
        usefulWorkUnits,
        strictValidation: true,
      },
      execute: payload => buildNixGenAnalysisInline(payload, 'quanti_comp', null),
      validate: result => validAnalysis(result),
    });
    return execution.result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildNixGenAnalysisInline({ ...input, now }, 'inline_fallback', message);
  }
}
