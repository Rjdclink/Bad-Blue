import type { providers } from 'ethers';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import type { ZeroCapitalPriceEvidence } from '../core/zero-capital-price-evidence.js';
import { livePriceMesh } from '../bridge/live-price-mesh.js';
import {
  peekResidentFlashLoanProviderEvidence,
  prewarmFlashLoanProviderEvidence,
  type FlashLoanProviderEconomics,
} from '../execution/adapters/flash-loan-provider-economics.js';

export interface AtomicBpsPreparedEvidence {
  inputTokenUsdPrice: number | null;
  inputTokenPriceEvidence?: Readonly<ZeroCapitalPriceEvidence> | null;
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
let residentPriceEvidenceHits = 0;
let residentPriceEvidenceMisses = 0;
let legacyUnverifiedPriceIgnored = 0;
let residentProviderEvidenceHits = 0;
let residentProviderEvidenceMisses = 0;
let providerPrewarmSignals = 0;

function freshnessBudgetMs(_opportunity: ZeroCapitalOpportunity): number {
  const configured = Number(process.env.ZERO_CAPITAL_APE_EVIDENCE_REFRESH_BUDGET_MS || 1_250);
  return Number.isFinite(configured) ? Math.max(100, Math.min(5_000, Math.trunc(configured))) : 1_250;
}

/**
 * Compatibility accessor now returns only already-resident provider evidence.
 * It never starts network work and therefore remains safe for callers expecting
 * the old APE worker surface.
 */
export async function getAtomicBpsProviderEvidence(
  chain: SupportedChain,
  _provider: providers.Provider,
  asset: string,
  maxAgeMs = 1_250,
  _forceRefresh = false,
): Promise<FlashLoanProviderEconomics[]> {
  compatibilityReads += 1;
  return peekResidentFlashLoanProviderEvidence(chain as any, asset, maxAgeMs);
}

/** Nonblocking refresh signal; callers never wait on provider measurement here. */
export function refreshAtomicBpsProviderEvidence(
  chain: SupportedChain,
  provider: providers.Provider,
  asset: string,
  _maxAgeMs = 1_250,
): Promise<FlashLoanProviderEconomics[]> {
  providerPrewarmSignals += 1;
  return prewarmFlashLoanProviderEvidence({ chain: chain as any, provider, asset });
}

/**
 * Snapshots evidence already resident before APE. Missing provider evidence is
 * prewarmed concurrently without putting I/O onto the current APE decision path.
 * Candidate ownership is independent from every evidence TTL.
 */
export function prewarmAtomicBpsEvidence(input: {
  chain: SupportedChain;
  provider: providers.Provider;
  opportunities: readonly ZeroCapitalOpportunity[];
}): Map<string, Promise<AtomicBpsPreparedEvidence>> {
  compatibilityPrewarms += input.opportunities.length;
  const result = new Map<string, Promise<AtomicBpsPreparedEvidence>>();
  for (const opportunity of input.opportunities) {
    const priceEvidence = livePriceMesh.peekLiveSymbolPriceEvidence(opportunity.inputAssetSymbol);
    if (priceEvidence) residentPriceEvidenceHits += 1;
    else {
      residentPriceEvidenceMisses += 1;
      const legacy = Number(opportunity.inputAssetUsdPrice);
      if (Number.isFinite(legacy) && legacy > 0) legacyUnverifiedPriceIgnored += 1;
    }

    const providerEvidence = peekResidentFlashLoanProviderEvidence(
      input.chain as any,
      opportunity.inputToken,
    );
    if (providerEvidence.length > 0) residentProviderEvidenceHits += 1;
    else {
      residentProviderEvidenceMisses += 1;
      providerPrewarmSignals += 1;
      void prewarmFlashLoanProviderEvidence({
        chain: input.chain as any,
        provider: input.provider,
        asset: opportunity.inputToken,
      }).catch(() => undefined);
    }

    const evidence: AtomicBpsPreparedEvidence = {
      inputTokenUsdPrice: priceEvidence?.priceUsd ?? null,
      inputTokenPriceEvidence: priceEvidence,
      providerEvidence,
      providerEvidenceSnapshot: () => peekResidentFlashLoanProviderEvidence(
        input.chain as any,
        opportunity.inputToken,
      ),
      providerFailures: () => [],
      preparedAt: Date.now(),
      freshnessBudgetMs: freshnessBudgetMs(opportunity),
    };
    result.set(opportunity.id, Promise.resolve(evidence));
  }
  return result;
}

/**
 * Post-decision audit only. setImmediate deliberately places this behind promise
 * continuations so a caller waiting on APE/provider progression resumes first.
 */
export function observeAtomicBpsOutcome(observation: AtomicBpsAuditObservation): void {
  setImmediate(() => {
    auditObservations += 1;
    auditRing.push({ ...observation });
    if (auditRing.length > AUDIT_RING_MAX) auditRing.splice(0, auditRing.length - AUDIT_RING_MAX);
  });
}

export function getAtomicBpsWorkerSnapshot() {
  return {
    speedWorker: {
      purpose: 'resident_evidence_snapshot_and_nonblocking_prewarm',
      executionAuthority: false,
      economicAuthority: false,
      compatibilityReads,
      compatibilityPrewarms,
      residentPriceEvidenceHits,
      residentPriceEvidenceMisses,
      legacyUnverifiedPriceIgnored,
      residentProviderEvidenceHits,
      residentProviderEvidenceMisses,
      providerPrewarmSignals,
      livePriceCalls: 0,
      liveProviderMeasurementsOnDecisionPath: 0,
      providerRefreshCallsBlockingDecisionPath: 0,
      rpcCallsOnDecisionPath: 0,
      apiCallsOnDecisionPath: 0,
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
      scheduler: 'setImmediate_after_downstream_promise_continuations',
    },
    supabaseHotPathReads: 0,
    supabaseHotPathWrites: 0,
  };
}
