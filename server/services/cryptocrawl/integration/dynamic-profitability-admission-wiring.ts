import logger from '../../../logger.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import { measuredOpportunityGraph } from '../discovery/opportunity-graph.js';
import { centralizedExchangeExecutor } from '../execution/centralized-exchange-executor.js';
import { routeMeasuredOpportunity } from '../execution/unified-execution-router.js';
import { resolveCexFeeEvidence, type CexFeeVenue } from '../intelligence/cex-fee-resolver.js';
import { ensureBpsDecompositionObservability } from './bps-decomposition-observability.js';
import { ensureEconomicTransformationWiring } from './economic-transformation-wiring.js';
import { ensureZeroCapitalRecoveryObservability } from './zero-capital-recovery-observability.js';
import { ensureProfitabilityRecoveryCoordinator } from './profitability-recovery-coordinator.js';

const installed = new WeakSet<object>();
const evidenceReacquisitionInFlight = new Map<string, Promise<void>>();
const evidenceReacquisitionCooldownUntil = new Map<string, number>();
let evidenceScannerSubscribed = false;

type CexRuntime = {
  execute: (plan: any) => Promise<any>;
};

type PositiveCexPair = {
  buyVenue: CexFeeVenue;
  sellVenue: CexFeeVenue;
  grossSpreadBps: number;
};

const EXECUTABLE_CEX_VENUES = new Set<CexFeeVenue>(['coinbase', 'kraken', 'okx']);

function cexOpportunityId(plan: { buyVenue: string; sellVenue: string; symbol: string }): string {
  return `${plan.buyVenue}-${plan.sellVenue}-${plan.symbol}`;
}

function evidenceReacquisitionCooldownMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_EVIDENCE_REACQUISITION_COOLDOWN_MS || 500);
  return Number.isFinite(parsed) ? Math.max(100, Math.min(5_000, Math.trunc(parsed))) : 500;
}

function cexCandidateSymbol(candidate: MeasuredCandidate): string {
  const quoteSymbol = candidate.rawQuotes.find(quote => quote.symbol?.trim())?.symbol;
  return String(quoteSymbol || candidate.assets[0] || '').trim().toUpperCase();
}

function positiveCexVenuePairs(candidate: MeasuredCandidate): PositiveCexPair[] {
  if (candidate.topology !== 'CEX_CEX') return [];
  const latest = new Map<CexFeeVenue, { bid: number; ask: number; observedAt: number }>();
  for (const quote of candidate.rawQuotes) {
    const venue = String(quote.venue || '').trim().toLowerCase() as CexFeeVenue;
    if (!EXECUTABLE_CEX_VENUES.has(venue)) continue;
    const bid = Number(quote.bid);
    const ask = Number(quote.ask);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) continue;
    const observedAt = Number(quote.observedAt) || candidate.observedAt;
    const previous = latest.get(venue);
    if (!previous || observedAt >= previous.observedAt) latest.set(venue, { bid, ask, observedAt });
  }

  const pairs: PositiveCexPair[] = [];
  for (const [buyVenue, buy] of latest.entries()) {
    for (const [sellVenue, sell] of latest.entries()) {
      if (buyVenue === sellVenue || sell.bid <= buy.ask) continue;
      const grossSpreadBps = ((sell.bid - buy.ask) / buy.ask) * 10_000;
      if (!Number.isFinite(grossSpreadBps) || grossSpreadBps <= 0) continue;
      pairs.push({ buyVenue, sellVenue, grossSpreadBps });
    }
  }
  return pairs.sort((left, right) => right.grossSpreadBps - left.grossSpreadBps);
}

function cexHardEvidenceMissing(candidate: MeasuredCandidate): boolean {
  if (candidate.topology !== 'CEX_CEX') return false;
  if (candidate.status === 'blocked' || candidate.status === 'expired' || candidate.expiresAt <= Date.now()) return false;
  if (candidate.status === 'observed' || candidate.status === 'enriched') return true;
  return candidate.missingInformation.some(item => /fee|depth|quote|product|deterministic|all_in_economics|execution_path|settlement_safe/i.test(item));
}

function requestCexEvidenceReacquisition(
  symbolRaw: string,
  reason: string,
  requiredFeeVenues: readonly CexFeeVenue[] = [],
): void {
  const symbol = String(symbolRaw || '').trim().toUpperCase();
  if (!symbol) return;
  const key = `cex:${symbol}`;
  if (evidenceReacquisitionInFlight.has(key) || (evidenceReacquisitionCooldownUntil.get(key) || 0) > Date.now()) return;

  const venues = [...new Set(requiredFeeVenues)].filter(venue => EXECUTABLE_CEX_VENUES.has(venue));
  const task = (async () => {
    const feeResults = venues.length > 0
      ? await Promise.allSettled(venues.map(async venue => ({
          venue,
          evidence: await resolveCexFeeEvidence(venue, symbol, { forceRefresh: true }),
        })))
      : [];
    const authenticatedFeeVenues = feeResults.flatMap(result => {
      if (result.status !== 'fulfilled') return [];
      const evidence = result.value.evidence;
      if (!evidence || evidence.source === 'configured_override' || !Number.isFinite(evidence.takerFeeBps) || evidence.takerFeeBps < 0) return [];
      return [result.value.venue];
    });

    const cycle = await measuredOpportunityGraph.revalidateSymbols([symbol]);
    logger.info('[EvidenceScanner] Targeted CEX minimum execution evidence acquisition completed', {
      component: 'DynamicProfitabilityAdmissionWiring',
      symbol,
      reason,
      requiredFeeVenues: venues,
      authenticatedFeeVenues,
      minimumFeeEvidenceSatisfied: venues.length === 0 || authenticatedFeeVenues.length === venues.length,
      cycleId: cycle.cycleId,
      evaluatedSymbols: cycle.evaluatedSymbols,
      deterministicPositive: cycle.deterministicPositive,
      eligibleCandidates: cycle.eligibleCandidates,
      acquisitionMode: 'exact_required_fee_legs_then_canonical_revalidation',
      activeEvidenceAcquisition: true,
      hotPathExecutionAuthority: false,
      vetoAuthority: false,
    });
  })()
    .catch(error => {
      logger.warn('[EvidenceScanner] Targeted CEX minimum evidence acquisition degraded', {
        component: 'DynamicProfitabilityAdmissionWiring',
        symbol,
        reason,
        requiredFeeVenues: venues,
        error: error instanceof Error ? error.message : String(error),
        missingEvidenceIsVerifiedVeto: false,
        hotPathExecutionAuthority: false,
      });
    })
    .finally(() => {
      evidenceReacquisitionInFlight.delete(key);
      evidenceReacquisitionCooldownUntil.set(key, Date.now() + evidenceReacquisitionCooldownMs());
    });
  evidenceReacquisitionInFlight.set(key, task);
}

function requestMinimumExecutionEvidence(candidate: MeasuredCandidate): void {
  if (!cexHardEvidenceMissing(candidate)) return;
  const symbol = cexCandidateSymbol(candidate);
  if (!symbol) return;
  const positivePairs = positiveCexVenuePairs(candidate);
  const requiredFeeVenues = positivePairs.length > 0
    ? [...new Set(positivePairs.flatMap(pair => [pair.buyVenue, pair.sellVenue]))]
    : [];
  const bestGrossSpreadBps = positivePairs[0]?.grossSpreadBps ?? null;

  requestCexEvidenceReacquisition(
    symbol,
    positivePairs.length > 0
      ? `positive_raw_edge_hot_lane:gross_bps=${bestGrossSpreadBps?.toFixed(4)}`
      : `missing_hard_execution_evidence:${candidate.missingInformation.join(',')}`,
    requiredFeeVenues,
  );
}

export function ensureDynamicProfitabilityAdmissionWiring(): void {
  ensureEconomicTransformationWiring();
  ensureBpsDecompositionObservability();
  ensureZeroCapitalRecoveryObservability();
  ensureProfitabilityRecoveryCoordinator();

  if (!evidenceScannerSubscribed) {
    evidenceScannerSubscribed = true;
    measuredCandidateRegistry.onUpdate(candidate => requestMinimumExecutionEvidence(candidate));
    for (const candidate of measuredCandidateRegistry.getRecent(256)) requestMinimumExecutionEvidence(candidate);
    logger.info('[EvidenceScanner] Parallel minimum-execution-evidence scanner installed', {
      component: 'DynamicProfitabilityAdmissionWiring',
      positiveRawEdgePriority: 'highest_gross_bps_first_via_existing_candidate_update_order',
      feeAcquisition: 'exact_positive_venue_legs_force_authenticated_refresh',
      remainingEvidenceAcquisition: 'canonical_exact_symbol_revalidation',
      missingEvidenceIsVeto: false,
      advisoryOnly: true,
      executionAuthority: false,
    });
  }

  const cex = centralizedExchangeExecutor as unknown as CexRuntime;
  if (!installed.has(cex)) {
    installed.add(cex);
    const originalExecute = cex.execute.bind(cex);
    cex.execute = async plan => {
      const candidate = measuredCandidateRegistry.get(cexOpportunityId(plan));
      if (!candidate) {
        requestCexEvidenceReacquisition(
          plan.symbol,
          'measured_candidate_registry_missing_at_hot_path',
          [plan.buyVenue, plan.sellVenue]
            .map(value => String(value).toLowerCase() as CexFeeVenue)
            .filter(venue => EXECUTABLE_CEX_VENUES.has(venue)),
        );
        logger.info('[UnifiedExecutionRouter] Canonical CEX plan proceeds while registry evidence is reacquired in parallel', {
          component: 'DynamicProfitabilityAdmissionWiring',
          symbol: plan.symbol,
          venuePair: `${plan.buyVenue}->${plan.sellVenue}`,
          canonicalPlanEconomicsAuthorityPreserved: true,
          downstreamHardGatesPreserved: true,
          duplicateRegistryExecutionAuthority: false,
        });
        return originalExecute(plan);
      }

      const decision = routeMeasuredOpportunity(candidate);
      if (decision.evidenceReacquisitionRequired) {
        requestCexEvidenceReacquisition(
          plan.symbol,
          decision.reasons.join('; '),
          [plan.buyVenue, plan.sellVenue]
            .map(value => String(value).toLowerCase() as CexFeeVenue)
            .filter(venue => EXECUTABLE_CEX_VENUES.has(venue)),
        );
      }
      if (!decision.admitted || decision.hardVetoVerified) {
        logger.info('[UnifiedExecutionRouter] Registry disagreement remains advisory while canonical CEX plan proceeds', {
          component: 'DynamicProfitabilityAdmissionWiring',
          opportunityId: candidate.opportunityId,
          symbol: plan.symbol,
          path: decision.path,
          profitabilityScore: decision.score.profitabilityScore,
          executionRisk: decision.score.executionRisk,
          confidenceLevel: decision.score.confidenceLevel,
          evidence: decision.evidence,
          hardVetoVerifiedByAdvisoryRouter: decision.hardVetoVerified,
          reasons: decision.reasons,
          canonicalPlanEconomicsAuthorityPreserved: true,
          downstreamHardGatesPreserved: true,
          independentEvidenceVetoAuthority: false,
        });
      }
      return originalExecute(plan);
    };
  }

  logger.info('[UnifiedExecutionRouter] Profitability evidence wiring installed', {
    component: 'DynamicProfitabilityAdmissionWiring',
    hotPathExecutionAuthority: 'canonical_strategy_executor_only',
    evidenceScoringAuthority: 'parallel_advisory_only',
    activeMissingEvidenceAcquisition: 'exact_positive_fee_legs_then_targeted_canonical_revalidation_off_hot_path',
    missingInformationExecutionVetoAuthority: false,
    adaptiveProfitabilityThresholdAuthority: 'ranking_and_sizing_only',
    cryptaraExecutionAuthority: false,
    tradingViewExecutionAuthority: false,
    zeroCapitalAdmissionMonkeyPatchInstalled: false,
    bpsSubsystemExecutionAuthority: false,
    terminalSettlementStillRequiredAfterExecution: true,
  });
}
