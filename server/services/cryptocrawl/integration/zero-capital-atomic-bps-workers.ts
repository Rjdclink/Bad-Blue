import type { providers } from 'ethers';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import type { FlashLoanProviderEconomics } from '../execution/adapters/flash-loan-provider-economics.js';

export interface AtomicBpsPreparedEvidence {
  inputTokenUsdPrice: number | null;
  providerEvidence: FlashLoanProviderEconomics[];
  providerEvidenceSnapshot: () => FlashLoanProviderEconomics[];
  providerFailures: () => [];
  preparedAt: number;
  freshnessBudgetMs: number;
}

export interface AtomicBpsAuditObservation {
  opportunityId: string;
  chain: SupportedChain;
  sourceExpectedProfit: bigint;
  bestExpectedProfit: bigint | null;
  sourceNetProfitBps: number;
  bestNetProfitBps: number | null;
  quoteCount: number;
  elapsedMs: number;
  profitable: boolean;
  improved: boolean;
  rescueMode?: 'cost' | 'edge' | 'execution';
  routesTried?: number;
}

const auditRing: AtomicBpsAuditObservation[] = [];
const AUDIT_RING_MAX = 512;
let compatibilityReads = 0;
let compatibilityPrewarms = 0;
let auditObservations = 0;

function freshnessBudgetMs(opportunity: ZeroCapitalOpportunity, now = Date.now()): number {
  const remaining = Math.max(0, opportunity.expiresAt - now);
  return Math.max(100, Math.min(1_250, Math.floor(remaining / 4)));
}

/**
 * Compatibility-only accessor retained for callers compiled against the former
 * APE worker surface. It deliberately performs no provider measurement. Canonical
 * provider proof remains in zero-capital-flash-provider-wiring after APE.
 */
export async function getAtomicBpsProviderEvidence(
  _chain: SupportedChain,
  _provider: providers.Provider,
  _asset: string,
  _maxAgeMs = 1_250,
  _forceRefresh = false,
): Promise<FlashLoanProviderEconomics[]> {
  compatibilityReads += 1;
  return [];
}

/** No hot-path refresh exists in APE. Retained only as a non-I/O compatibility shim. */
export function refreshAtomicBpsProviderEvidence(
  chain: SupportedChain,
  provider: providers.Provider,
  asset: string,
  maxAgeMs = 1_250,
): Promise<FlashLoanProviderEconomics[]> {
  return getAtomicBpsProviderEvidence(chain, provider, asset, maxAgeMs, false);
}

/**
 * Compatibility prewarm now snapshots only evidence already attached to Stage 1.
 * It performs zero API/RPC/database/model/persistence work and does not copy the
 * opportunity or route. APE itself no longer requires this worker.
 */
export function prewarmAtomicBpsEvidence(input: {
  chain: SupportedChain;
  provider: providers.Provider;
  opportunities: readonly ZeroCapitalOpportunity[];
}): Map<string, Promise<AtomicBpsPreparedEvidence>> {
  compatibilityPrewarms += input.opportunities.length;
  const result = new Map<string, Promise<AtomicBpsPreparedEvidence>>();
  for (const opportunity of input.opportunities) {
    const quoted = Number(opportunity.inputAssetUsdPrice);
    const inputTokenUsdPrice = Number.isFinite(quoted) && quoted > 0 ? quoted : null;
    const evidence: AtomicBpsPreparedEvidence = {
      inputTokenUsdPrice,
      providerEvidence: [],
      providerEvidenceSnapshot: () => [],
      providerFailures: () => [],
      preparedAt: Date.now(),
      freshnessBudgetMs: freshnessBudgetMs(opportunity),
    };
    result.set(opportunity.id, Promise.resolve(evidence));
  }
  return result;
}

/** Post-decision audit only. Never participates in live ranking or admission. */
export function observeAtomicBpsOutcome(observation: AtomicBpsAuditObservation): void {
  queueMicrotask(() => {
    auditObservations += 1;
    auditRing.push({ ...observation });
    if (auditRing.length > AUDIT_RING_MAX) auditRing.splice(0, auditRing.length - AUDIT_RING_MAX);
  });
}

export function getAtomicBpsWorkerSnapshot() {
  return {
    speedWorker: {
      purpose: 'compatibility_snapshot_only_no_live_io',
      executionAuthority: false,
      economicAuthority: false,
      compatibilityReads,
      compatibilityPrewarms,
      livePriceCalls: 0,
      liveProviderMeasurements: 0,
      providerRefreshCalls: 0,
      rpcCalls: 0,
      apiCalls: 0,
      databaseReads: 0,
      databaseWrites: 0,
      modelCalls: 0,
    },
    auditWorker: {
      purpose: 'post_decision_outcome_audit_only',
      executionAuthority: false,
      economicAuthority: false,
      auditObservations,
      retainedObservations: auditRing.length,
    },
    supabaseHotPathReads: 0,
    supabaseHotPathWrites: 0,
  };
}
