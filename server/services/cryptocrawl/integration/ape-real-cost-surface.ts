import type { providers } from 'ethers';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import {
  calculateMeasuredFlashLoanFee,
  measureAaveV3FlashLoanEconomics,
  measureBalancerFlashLoanEconomics,
  measureMorphoBlueFlashLoanEconomics,
  type FlashLoanProviderEconomics,
  type FlashLoanProviderKind,
} from '../execution/adapters/flash-loan-provider-economics.js';

export interface ApeMeasuredFlashSelection {
  provider: FlashLoanProviderKind;
  fee: bigint;
  feeBps: number;
  availableLiquidity: bigint;
  observedAt: number;
  provenance: string[];
}

export interface ApeMeasuredFlashRepriceResult {
  opportunity: ZeroCapitalOpportunity;
  selection: ApeMeasuredFlashSelection | null;
  changed: boolean;
  improvementBps: number;
}

const residentEvidence = new Map<string, Map<FlashLoanProviderKind, FlashLoanProviderEconomics>>();
const prewarmInFlight = new Map<string, Promise<void>>();
let prewarmRequests = 0;
let prewarmStarts = 0;
let prewarmCacheSkips = 0;
let evidenceUpdates = 0;
let evidenceFailures = 0;

const BPS_PRECISION_SCALE = 1_000_000n;

function evidenceKey(chain: SupportedChain, asset: string): string {
  return `${chain}:${asset.toLowerCase()}`;
}

function evidenceTtlMs(): number {
  const parsed = Number(process.env.ZERO_CAPITAL_APE_REAL_COST_EVIDENCE_TTL_MS || 2_500);
  return Number.isFinite(parsed) ? Math.max(250, Math.min(15_000, Math.trunc(parsed))) : 2_500;
}

function prewarmRefreshMs(): number {
  return Math.max(100, Math.floor(evidenceTtlMs() / 2));
}

function bpsFromBaseUnits(value: bigint, notional: bigint): number {
  if (notional <= 0n) return Number.NEGATIVE_INFINITY;
  return Number((value * 10_000n * BPS_PRECISION_SCALE) / notional) / Number(BPS_PRECISION_SCALE);
}

function grossProfit(opportunity: ZeroCapitalOpportunity): bigint {
  return opportunity.grossProfit
    ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
}

function storeEvidence(value: FlashLoanProviderEconomics | null): void {
  if (!value) return;
  const key = evidenceKey(value.chain as SupportedChain, value.asset);
  const byProvider = residentEvidence.get(key) || new Map<FlashLoanProviderKind, FlashLoanProviderEconomics>();
  const previous = byProvider.get(value.provider);
  if (!previous || value.observedAt >= previous.observedAt) {
    byProvider.set(value.provider, value);
    residentEvidence.set(key, byProvider);
    evidenceUpdates += 1;
  }
}

function freshEvidence(chain: SupportedChain, asset: string, now = Date.now()): FlashLoanProviderEconomics[] {
  const key = evidenceKey(chain, asset);
  const byProvider = residentEvidence.get(key);
  if (!byProvider) return [];
  const ttl = evidenceTtlMs();
  const fresh: FlashLoanProviderEconomics[] = [];
  for (const [provider, evidence] of byProvider) {
    if (now - evidence.observedAt > ttl) {
      byProvider.delete(provider);
      continue;
    }
    fresh.push(evidence);
  }
  if (byProvider.size === 0) residentEvidence.delete(key);
  return fresh;
}

function hasRecentlyMeasuredEvidence(chain: SupportedChain, asset: string, now = Date.now()): boolean {
  return freshEvidence(chain, asset, now).some(item => now - item.observedAt <= prewarmRefreshMs());
}

/**
 * Starts a non-blocking, route-local measurement race for the real flash-loan fee
 * surfaces that APE can consume on the next hot-path pass. All applicable providers
 * are measured concurrently so a fast paid provider cannot hide a slower zero-fee
 * Morpho result. Nothing here grants receiver, execution, or profitability authority.
 */
export function prewarmApeRealCostEvidence(input: {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  opportunities: readonly ZeroCapitalOpportunity[];
}): void {
  if (input.chain === 'europa' || input.opportunities.length === 0) return;
  const assets = [...new Set(input.opportunities.map(item => item.inputToken.toLowerCase()))];
  for (const asset of assets) {
    prewarmRequests += 1;
    const key = evidenceKey(input.chain, asset);
    if (prewarmInFlight.has(key)) continue;
    if (hasRecentlyMeasuredEvidence(input.chain, asset)) {
      prewarmCacheSkips += 1;
      continue;
    }

    prewarmStarts += 1;
    const measurements = [
      measureMorphoBlueFlashLoanEconomics({ chain: input.chain as any, provider: input.provider, asset }),
      measureAaveV3FlashLoanEconomics({ chain: input.chain as any, provider: input.provider, asset }),
      measureBalancerFlashLoanEconomics({ chain: input.chain as any, provider: input.provider, asset }),
    ];
    const task = Promise.allSettled(measurements).then(results => {
      for (const result of results) {
        if (result.status === 'fulfilled') storeEvidence(result.value);
        else evidenceFailures += 1;
      }
    }).finally(() => {
      prewarmInFlight.delete(key);
    });
    prewarmInFlight.set(key, task);
  }
}

export function peekApeMeasuredFlashSelection(
  opportunity: ZeroCapitalOpportunity,
  providerProfile?: FlashLoanProviderKind | null,
  now = Date.now(),
): ApeMeasuredFlashSelection | null {
  if (opportunity.flashLoanAmount <= 0n) return null;
  const candidates = freshEvidence(opportunity.chain, opportunity.inputToken, now)
    .filter(item => !providerProfile || item.provider === providerProfile)
    .filter(item =>
      item.executableEvidenceComplete
      && item.availableLiquidity !== null
      && item.availableLiquidity >= opportunity.flashLoanAmount
      && item.feeBps !== null
      && item.feeRateNumerator !== null
      && item.feeRateDenominator !== null,
    )
    .map(item => {
      const fee = calculateMeasuredFlashLoanFee(item, opportunity.flashLoanAmount);
      if (fee === null || item.availableLiquidity === null || item.feeBps === null) return null;
      return {
        provider: item.provider,
        fee,
        feeBps: item.feeBps,
        availableLiquidity: item.availableLiquidity,
        observedAt: item.observedAt,
        provenance: [...item.provenance],
      } satisfies ApeMeasuredFlashSelection;
    })
    .filter((item): item is ApeMeasuredFlashSelection => item !== null)
    .sort((left, right) => {
      if (left.fee !== right.fee) return left.fee < right.fee ? -1 : 1;
      if (left.availableLiquidity !== right.availableLiquidity) {
        return left.availableLiquidity > right.availableLiquidity ? -1 : 1;
      }
      return right.observedAt - left.observedAt;
    });
  return candidates[0] ?? null;
}

/**
 * Reprices an APE-derived overlay from measured funding evidence only. The caller
 * must pass a provider profile that has already been proven compatible by the
 * canonical downstream provider/receiver layer. Unknown/wildcard profiles return
 * no selection rather than falling back to an assumed fee.
 */
export function repriceApeOpportunityFromMeasuredFlashFee(
  opportunity: ZeroCapitalOpportunity,
  providerProfile: FlashLoanProviderKind | null,
): ApeMeasuredFlashRepriceResult {
  const selection = providerProfile
    ? peekApeMeasuredFlashSelection(opportunity, providerProfile)
    : null;
  if (!selection) {
    return { opportunity, selection: null, changed: false, improvementBps: 0 };
  }

  const gas = opportunity.estimatedGasCostInInputToken || 0n;
  const relay = opportunity.relayFeeInInputToken || 0n;
  const allInCost = selection.fee + gas + relay;
  const netProfit = grossProfit(opportunity) - allInCost;
  const netProfitBps = bpsFromBaseUnits(netProfit, opportunity.flashLoanAmount);
  const previousBps = opportunity.netProfitBps;
  const changed = opportunity.flashLoanFeeInInputToken !== selection.fee
    || opportunity.estimatedExecutionCostInInputToken !== allInCost
    || opportunity.expectedProfit !== netProfit
    || opportunity.netProfitBps !== netProfitBps;
  if (!changed) {
    return { opportunity, selection, changed: false, improvementBps: 0 };
  }

  return {
    opportunity: {
      ...opportunity,
      flashLoanFeeInInputToken: selection.fee,
      estimatedExecutionCostInInputToken: allInCost,
      expectedProfit: netProfit,
      netProfitBps,
    },
    selection,
    changed: true,
    improvementBps: Number.isFinite(previousBps) ? netProfitBps - previousBps : 0,
  };
}

export function getApeRealCostSurfaceSnapshot() {
  let freshProviders = 0;
  let zeroFeeMorphoEvidence = 0;
  const now = Date.now();
  for (const [key, byProvider] of residentEvidence) {
    for (const [provider, evidence] of byProvider) {
      if (now - evidence.observedAt > evidenceTtlMs()) {
        byProvider.delete(provider);
        continue;
      }
      freshProviders += 1;
      if (provider === 'morpho_blue' && evidence.feeRateNumerator === 0n && evidence.executableEvidenceComplete) {
        zeroFeeMorphoEvidence += 1;
      }
    }
    if (byProvider.size === 0) residentEvidence.delete(key);
  }
  return {
    observedAt: now,
    residentAssetKeys: residentEvidence.size,
    freshProviders,
    zeroFeeMorphoEvidence,
    prewarmRequests,
    prewarmStarts,
    prewarmCacheSkips,
    prewarmInFlight: prewarmInFlight.size,
    evidenceUpdates,
    evidenceFailures,
    evidenceTtlMs: evidenceTtlMs(),
    feeAuthority: 'fresh_measured_provider_evidence_only' as const,
    assumedFeeFallback: false as const,
    providerMeasurementMode: 'parallel_morpho_aave_balancer' as const,
    executionAuthority: false as const,
    receiverAuthority: false as const,
  };
}
