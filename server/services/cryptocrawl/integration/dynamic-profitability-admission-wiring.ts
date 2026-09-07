import logger from '../../../logger.js';
import { fundingRateMonitor } from '../discovery/funding-rate-monitor.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import { measuredOpportunityGraph } from '../discovery/opportunity-graph.js';
import { centralizedExchangeExecutor } from '../execution/centralized-exchange-executor.js';
import { evaluateMakerRecoveryCandidate } from '../execution/stablecoin-maker-strategy.js';
import { routeMeasuredOpportunity } from '../execution/unified-execution-router.js';
import { getProfitLadderNotionalAuthority } from '../governance/profit-ladder-notional-authority.js';
import { resolveCexFeeEvidence, type CexFeeVenue } from '../intelligence/cex-fee-resolver.js';
import { ensureBpsDecompositionObservability } from './bps-decomposition-observability.js';
import { ensureBpsFrontierWave3Wiring } from './bps-frontier-wave3-wiring.js';
import { ensureEconomicTransformationWiring } from './economic-transformation-wiring.js';
import { refreshKalshiSystemEvidenceNow } from './kalshi-system-wiring.js';
import { ensureZeroCapitalRecoveryObservability } from './zero-capital-recovery-observability.js';
import { ensureProfitabilityRecoveryCoordinator } from './profitability-recovery-coordinator.js';

const installed = new WeakSet<object>();
const evidenceReacquisitionInFlight = new Map<string, Promise<void>>();
const evidenceReacquisitionCooldownUntil = new Map<string, number>();
const makerEvidenceQueued = new Set<string>();
const makerEvidenceQueue: Array<{
  key: string;
  symbol: string;
  reason: string;
  venues: CexFeeVenue[];
  priority: number;
}> = [];
let makerEvidenceActive = 0;
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

function makerEvidenceConcurrency(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_MAKER_EVIDENCE_CONCURRENCY || 3);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(8, Math.trunc(parsed))) : 3;
}

function makerEvidenceMaxQuoteAgeMs(): number {
  const parsed = Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000);
  return Number.isFinite(parsed) ? Math.max(500, Math.min(15_000, Math.trunc(parsed))) : 5_000;
}

function makerEvidenceNotionalUsd(): number {
  const ladder = getProfitLadderNotionalAuthority();
  const fallback = Number(process.env.CRYPTOCRAWL_MAKER_PAPER_NOTIONAL_USD || 1_000);
  const value = ladder.maxNotionalUsd > 0 ? ladder.maxNotionalUsd : fallback;
  return Number.isFinite(value) ? Math.max(10, value) : 1_000;
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

function makerEvidenceMissing(candidate: MeasuredCandidate): boolean {
  if (candidate.topology !== 'MAKER_CEX') return false;
  if (candidate.status === 'expired' || candidate.expiresAt <= Date.now()) return false;
  if (!candidate.missingInformation.some(item => /authenticated_maker_fee_evidence|fully_measured_canonical_maker_plan/i.test(item))) return false;
  // Paper maker candidates are intentionally stored as blocked so paper evidence
  // can never execute. That blocked state must not also make evidence acquisition a
  // dead end. Only this exact paper-evidence block is eligible for reacquisition.
  return candidate.executionCapabilityReason.includes('Paper maker proof accelerates calibration');
}

function kalshiEvidenceMissing(candidate: MeasuredCandidate): boolean {
  if (candidate.status === 'expired' || candidate.expiresAt <= Date.now()) return false;
  const venues = candidate.venues.map(value => String(value).trim().toLowerCase());
  const kalshiFunding = candidate.topology === 'FUNDING_ARBITRAGE' && venues.includes('kalshi_perps');
  const kalshiEvent = candidate.topology === 'PREDICTION_EVENT'
    && venues.some(venue => venue === 'kalshi' || venue === 'kalshi_event' || venue === 'kalshi_prediction' || venue === 'kalshi_perps');
  if (!kalshiFunding && !kalshiEvent) return false;
  if (candidate.status === 'observed' || candidate.status === 'enriched') return true;
  return candidate.missingInformation.some(item => /^(required|critical):|fee|depth|entitlement|access|semantic|equivalence|settlement|system.?capital|borrow|liability|margin|collateral|order|fill|redemption/i.test(item.trim()));
}

function makerPaperNetProfitUsd(candidate: MeasuredCandidate): number | null {
  for (const item of candidate.provenance) {
    const match = /^paper_net_profit_usd:([-+]?\d+(?:\.\d+)?)$/i.exec(item.trim());
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function makerEvidencePriority(candidate: MeasuredCandidate): number {
  const paperNet = makerPaperNetProfitUsd(candidate);
  const ageMs = Math.max(0, Date.now() - candidate.observedAt);
  const lifetimeMs = Math.max(1, candidate.expiresAt - candidate.observedAt);
  const freshness = Math.max(0, 1 - ageMs / lifetimeMs);
  const authenticatedFeeKnown = candidate.missingInformation.includes('authenticated_maker_fee_evidence') ? 0 : 1;
  // Paper economics remain advisory only. This score chooses which evidence to
  // measure first and has no admission, sizing, profitability or execution power.
  return (paperNet !== null && paperNet > 0 ? 100 + Math.min(25, paperNet) : 0)
    + authenticatedFeeKnown * 10
    + freshness;
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

function requestKalshiEvidenceReacquisition(candidate: MeasuredCandidate): void {
  if (!kalshiEvidenceMissing(candidate)) return;
  const funding = candidate.topology === 'FUNDING_ARBITRAGE';
  const key = funding ? 'kalshi:funding' : 'kalshi:event';
  if (evidenceReacquisitionInFlight.has(key) || (evidenceReacquisitionCooldownUntil.get(key) || 0) > Date.now()) return;
  const reason = candidate.missingInformation.length > 0
    ? candidate.missingInformation.join(',')
    : `${candidate.status}:minimum_execution_evidence_incomplete`;

  const task = (async () => {
    if (funding) await fundingRateMonitor.scanOnce();
    else await refreshKalshiSystemEvidenceNow();
    logger.info('[EvidenceScanner] Targeted Kalshi evidence acquisition completed', {
      component: 'DynamicProfitabilityAdmissionWiring',
      opportunityId: candidate.opportunityId,
      topology: candidate.topology,
      reason,
      acquisitionMode: funding
        ? 'canonical_funding_monitor_exact_directional_fee_depth_borrow_margin_remeasurement'
        : 'canonical_kalshi_event_semantic_fee_depth_capital_cross_venue_refresh',
      activeEvidenceAcquisition: true,
      readOnlyCollection: true,
      hotPathExecutionAuthority: false,
      profitabilityAuthority: false,
      accountBalanceCreatesOwnership: false,
      missingEvidenceIsPermanentVeto: false,
    });
  })()
    .catch(error => {
      logger.warn('[EvidenceScanner] Targeted Kalshi evidence acquisition degraded', {
        component: 'DynamicProfitabilityAdmissionWiring',
        opportunityId: candidate.opportunityId,
        topology: candidate.topology,
        reason,
        error: error instanceof Error ? error.message : String(error),
        readOnlyCollection: true,
        hotPathExecutionAuthority: false,
        missingEvidenceIsPermanentVeto: false,
      });
    })
    .finally(() => {
      evidenceReacquisitionInFlight.delete(key);
      evidenceReacquisitionCooldownUntil.set(key, Date.now() + evidenceReacquisitionCooldownMs());
    });
  evidenceReacquisitionInFlight.set(key, task);
}

function drainMakerEvidenceQueue(): void {
  while (makerEvidenceActive < makerEvidenceConcurrency() && makerEvidenceQueue.length > 0) {
    makerEvidenceQueue.sort((left, right) => right.priority - left.priority);
    const request = makerEvidenceQueue.shift()!;
    makerEvidenceQueued.delete(request.key);
    if ((evidenceReacquisitionCooldownUntil.get(request.key) || 0) > Date.now()) continue;
    if (evidenceReacquisitionInFlight.has(request.key)) continue;

    makerEvidenceActive += 1;
    const task = (async () => {
      const feeResults = await Promise.allSettled(request.venues.map(async venue => ({
        venue,
        evidence: await resolveCexFeeEvidence(venue, request.symbol, { forceRefresh: true }),
      })));
      const authenticatedMakerFeeVenues = feeResults.flatMap(result => {
        if (result.status !== 'fulfilled') return [];
        const evidence = result.value.evidence;
        if (!evidence || evidence.source === 'configured_override') return [];
        const makerKnown = (evidence.makerFeeBps !== null && Number.isFinite(evidence.makerFeeBps))
          || (evidence.makerRebateBps !== null && Number.isFinite(evidence.makerRebateBps));
        return makerKnown ? [result.value.venue] : [];
      });

      const plan = await evaluateMakerRecoveryCandidate({
        symbol: request.symbol,
        notionalUsd: makerEvidenceNotionalUsd(),
        maxQuoteAgeMs: makerEvidenceMaxQuoteAgeMs(),
      });
      const measuredPositive = Boolean(plan && Number.isFinite(plan.netProfitUsd) && plan.netProfitUsd > 0);
      const telemetry = {
        component: 'DynamicProfitabilityAdmissionWiring',
        symbol: request.symbol,
        reason: request.reason,
        requestedFeeVenues: request.venues,
        authenticatedMakerFeeVenues,
        canonicalMakerPlanMeasured: Boolean(plan),
        canonicalMakerPlanPositive: measuredPositive,
        measuredNetProfitUsd: measuredPositive ? plan!.netProfitUsd : null,
        measuredNotionalUsd: measuredPositive ? plan!.notionalUsd : null,
        acquisitionMode: 'bounded_single_flight_authenticated_fee_then_canonical_maker_evaluation',
        paperEvidenceExecutionAuthority: false,
        shadowPriorityExecutionAuthority: false,
        hotPathExecutionAuthority: false,
        terminalSettlementStillRequired: true,
      };
      if (measuredPositive) {
        logger.info('[EvidenceScanner] Blocked maker evidence converted to a measured positive canonical plan', telemetry);
      } else {
        logger.debug('[EvidenceScanner] Blocked maker evidence reacquired without a positive canonical plan', telemetry);
      }
    })()
      .catch(error => {
        logger.warn('[EvidenceScanner] Targeted maker evidence acquisition degraded', {
          component: 'DynamicProfitabilityAdmissionWiring',
          symbol: request.symbol,
          reason: request.reason,
          requestedFeeVenues: request.venues,
          error: error instanceof Error ? error.message : String(error),
          paperEvidenceExecutionAuthority: false,
          hotPathExecutionAuthority: false,
        });
      })
      .finally(() => {
        evidenceReacquisitionInFlight.delete(request.key);
        evidenceReacquisitionCooldownUntil.set(request.key, Date.now() + evidenceReacquisitionCooldownMs());
        makerEvidenceActive = Math.max(0, makerEvidenceActive - 1);
        drainMakerEvidenceQueue();
      });
    evidenceReacquisitionInFlight.set(request.key, task);
  }
}

function requestMakerEvidenceReacquisition(candidate: MeasuredCandidate): void {
  if (!makerEvidenceMissing(candidate)) return;
  const symbol = cexCandidateSymbol(candidate);
  if (!symbol) return;
  const key = `maker:${symbol}`;
  if (makerEvidenceQueued.has(key) || evidenceReacquisitionInFlight.has(key) || (evidenceReacquisitionCooldownUntil.get(key) || 0) > Date.now()) return;
  const venues = [...new Set(candidate.venues
    .map(value => String(value).trim().toLowerCase() as CexFeeVenue)
    .filter(venue => EXECUTABLE_CEX_VENUES.has(venue)))];
  if (venues.length < 2) return;

  makerEvidenceQueued.add(key);
  makerEvidenceQueue.push({
    key,
    symbol,
    reason: `blocked_paper_maker_requires_live_plan:${candidate.missingInformation.join(',')}`,
    venues,
    priority: makerEvidencePriority(candidate),
  });
  drainMakerEvidenceQueue();
}

function requestMinimumExecutionEvidence(candidate: MeasuredCandidate): void {
  if (kalshiEvidenceMissing(candidate)) {
    requestKalshiEvidenceReacquisition(candidate);
    return;
  }
  if (makerEvidenceMissing(candidate)) {
    requestMakerEvidenceReacquisition(candidate);
    return;
  }
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
  ensureBpsFrontierWave3Wiring();
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
      makerEvidenceAcquisition: 'blocked_paper_candidates_bounded_single_flight_to_existing_canonical_maker_evaluator',
      kalshiFundingEvidenceAcquisition: 'canonical_bidirectional_funding_monitor_remeasurement_including_authenticated_inverse_borrow_liability_and_system_capital',
      kalshiEventEvidenceAcquisition: 'canonical_prediction_event_maker_semantic_cross_venue_and_system_cash_refresh',
      makerPaperExecutionAuthority: false,
      makerShadowPriorityExecutionAuthority: false,
      kalshiDataCollectionExecutionAuthority: false,
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
    activeMissingEvidenceAcquisition: 'exact_cex_fee_depth_plus_bounded_maker_plus_kalshi_funding_event_cross_venue_reacquisition_then_canonical_revalidation_off_hot_path',
    missingInformationExecutionVetoAuthority: false,
    adaptiveProfitabilityThresholdAuthority: 'ranking_and_sizing_only',
    bpsFrontierWave3: 'measured_like_notional_total_cost_frontier_plus_keyless_lighter_public_benchmark',
    bpsFrontierSyntheticSavingsAllowed: false,
    cryptaraExecutionAuthority: false,
    tradingViewExecutionAuthority: false,
    zeroCapitalAdmissionMonkeyPatchInstalled: false,
    bpsSubsystemExecutionAuthority: false,
    terminalSettlementStillRequiredAfterExecution: true,
  });
}