import logger from '../../../logger.js';
import { getCryptara } from '../../cryptara/index.js';
import { zeroCapitalEngine, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
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

type ZeroCapitalRuntime = {
  isAllowedByCryptara: (opportunity: ZeroCapitalOpportunity) => Promise<boolean>;
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

  // Profitable raw edges get the hot lane: acquire only the fee facts required by
  // the actual positive venue legs, not every venue/symbol combination in the universe.
  // If multiple positive pairs exist, the union is at most Coinbase/Kraken/OKX.
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

function configuredZeroCapitalMaxSlippageBps(): number {
  const parsed = Number(process.env.ZERO_CAPITAL_MAX_SLIPPAGE_BPS || 20);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(50, parsed)) : 20;
}

function zeroCapitalRegistryBootstrapReady(opportunity: ZeroCapitalOpportunity): boolean {
  return opportunity.expectedProfit > 0n
    && Number.isFinite(opportunity.netProfitBps)
    && opportunity.netProfitBps > 0
    && opportunity.expiresAt > Date.now()
    && opportunity.expectedSlippageBps <= configuredZeroCapitalMaxSlippageBps();
}

function measuredZeroCapitalExecutionReady(
  opportunity: ZeroCapitalOpportunity,
  candidate: MeasuredCandidate,
): { allowed: boolean; reason: string; maxSlippageBps: number } {
  const directive = getCryptara().getAutonomousDirective();
  const configuredMaxSlippage = configuredZeroCapitalMaxSlippageBps();
  const directiveMaxSlippage = Number.isFinite(directive.maxSlippageBps) && directive.maxSlippageBps > 0
    ? directive.maxSlippageBps
    : configuredMaxSlippage;
  const maxSlippageBps = Math.max(1, Math.min(configuredMaxSlippage, directiveMaxSlippage));
  const deterministicNetProfitUsd = Number(candidate.economics.deterministicNetProfitUsd);
  const netProfitBps = Number(candidate.economics.netProfitBps);
  const provenance = new Set(candidate.provenance);

  if (candidate.topology !== 'ZERO_CAPITAL_ATOMIC') return { allowed: false, reason: 'wrong_topology', maxSlippageBps };
  if (candidate.status !== 'deterministic_positive' && candidate.status !== 'eligible') return { allowed: false, reason: 'not_deterministic_positive', maxSlippageBps };
  if (!candidate.executableCapability) return { allowed: false, reason: 'execution_capability_unavailable', maxSlippageBps };
  if (candidate.depth.status !== 'measured') return { allowed: false, reason: 'depth_not_measured', maxSlippageBps };
  if (candidate.expiresAt <= Date.now()) return { allowed: false, reason: 'candidate_expired', maxSlippageBps };
  if (candidate.chains.length !== 1 || candidate.chains[0] !== opportunity.chain) return { allowed: false, reason: 'chain_binding_mismatch', maxSlippageBps };
  if (candidate.rawQuotes.length < 2 || candidate.rawQuotes.some(quote => quote.executable !== true)) {
    return { allowed: false, reason: 'executable_route_quotes_incomplete', maxSlippageBps };
  }
  if (!Number.isFinite(deterministicNetProfitUsd) || deterministicNetProfitUsd <= 0) {
    return { allowed: false, reason: deterministicNetProfitUsd === 0 ? 'deterministic_net_zero_reacquire' : 'deterministic_net_not_positive', maxSlippageBps };
  }
  if (!Number.isFinite(netProfitBps) || netProfitBps <= 0 || opportunity.expectedProfit <= 0n) {
    return { allowed: false, reason: 'net_bps_not_positive', maxSlippageBps };
  }
  if (!provenance.has('direct_contract_quotes') || !provenance.has('measured_all_in_economics') || !provenance.has('synthetic_evidence:false')) {
    return { allowed: false, reason: 'measured_route_provenance_incomplete', maxSlippageBps };
  }
  if (opportunity.expectedSlippageBps > maxSlippageBps) {
    return { allowed: false, reason: 'bounded_slippage_limit_exceeded', maxSlippageBps };
  }

  return {
    allowed: true,
    reason: 'measured_atomic_execution_evidence_complete_positive_all_in_net',
    maxSlippageBps,
  };
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
        requestCexEvidenceReacquisition(plan.symbol, 'measured_candidate_registry_missing_at_hot_path', [plan.buyVenue, plan.sellVenue]
          .map(value => String(value).toLowerCase() as CexFeeVenue)
          .filter(venue => EXECUTABLE_CEX_VENUES.has(venue)));
        logger.info('[UnifiedExecutionRouter] Canonical CEX plan bypassed duplicate registry veto while evidence is reacquired in parallel', {
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
        logger.info('[UnifiedExecutionRouter] Registry evidence disagreement retained as advisory while canonical CEX plan proceeds to strategy hard gates', {
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

      // The canonical verified plan and the strategy-specific executor own hard
      // execution admission. This parallel layer scores/reacquires evidence only.
      return originalExecute(plan);
    };
  }

  const zeroCapital = zeroCapitalEngine as unknown as ZeroCapitalRuntime;
  if (!installed.has(zeroCapital)) {
    installed.add(zeroCapital);
    const originalIsAllowedByCryptara = zeroCapital.isAllowedByCryptara.bind(zeroCapital);
    zeroCapital.isAllowedByCryptara = async opportunity => {
      let cryptaraAllowed = false;
      let cryptaraAdvisoryError: string | undefined;
      try {
        cryptaraAllowed = await originalIsAllowedByCryptara(opportunity);
      } catch (error) {
        cryptaraAdvisoryError = error instanceof Error ? error.message : String(error);
      }

      const current = measuredCandidateRegistry.get(opportunity.id);
      if (!current) {
        // Configured routes pass through the base scanner before ZeroCapitalResourceWiring
        // can register their measured candidate. Do not create a circular cold-start
        // dependency: a freshly positive bounded route may advance to the outer scanner,
        // which immediately records it before it can enter the execution queue.
        const bootstrapReady = zeroCapitalRegistryBootstrapReady(opportunity);
        logger.info('[UnifiedExecutionRouter] Zero-capital registry bootstrap evaluated without duplicate pre-registration veto', {
          component: 'DynamicProfitabilityAdmissionWiring',
          opportunityId: opportunity.id,
          chain: opportunity.chain,
          bootstrapReady,
          deterministicPositive: opportunity.expectedProfit > 0n && opportunity.netProfitBps > 0,
          fresh: opportunity.expiresAt > Date.now(),
          expectedSlippageBps: opportunity.expectedSlippageBps,
          configuredMaxSlippageBps: configuredZeroCapitalMaxSlippageBps(),
          cryptaraAllowed,
          cryptaraAdvisoryError,
          registryExpectedImmediatelyAfterBaseScan: true,
          executionAuthority: false,
        });
        return bootstrapReady;
      }

      const executionReady = measuredZeroCapitalExecutionReady(opportunity, current);
      if (!executionReady.allowed) return false;

      if (current.missingInformation.length > 0) {
        logger.info('[UnifiedExecutionRouter] Zero-capital optional evidence gaps retained as advisory', {
          component: 'DynamicProfitabilityAdmissionWiring',
          opportunityId: opportunity.id,
          chain: opportunity.chain,
          missingInformation: current.missingInformation,
          strategyHardEvidenceSatisfied: true,
          missingInformationVetoAuthority: false,
        });
      }

      if (!cryptaraAllowed || cryptaraAdvisoryError) {
        logger.info('[UnifiedExecutionRouter] Measured zero-capital candidate retained despite advisory Cryptara/TradingView veto or error', {
          component: 'DynamicProfitabilityAdmissionWiring',
          opportunityId: opportunity.id,
          chain: opportunity.chain,
          deterministicNetProfitUsd: current.economics.deterministicNetProfitUsd,
          netProfitBps: current.economics.netProfitBps,
          expectedSlippageBps: opportunity.expectedSlippageBps,
          maxSlippageBps: executionReady.maxSlippageBps,
          reason: executionReady.reason,
          cryptaraAllowed,
          cryptaraAdvisoryError,
          cryptaraExecutionAuthority: false,
          tradingViewExecutionAuthority: false,
          terminalSettlementStillRequired: true,
        });
      }

      const eligible = measuredCandidateRegistry.updateStatus(opportunity.id, 'eligible', {
        provenance: [
          'unified_execution_router:measured_positive_execution_authority',
          executionReady.reason,
          cryptaraAllowed ? 'Cryptara:advisory_allow' : 'Cryptara:advisory_veto_or_error_ignored_for_execution',
        ],
      });
      if (!eligible) return false;

      const decision = routeMeasuredOpportunity(eligible);
      if (!decision.admitted) {
        logger.info('[UnifiedExecutionRouter] Zero-capital candidate held by concrete strategy readiness, not advisory confidence', {
          component: 'DynamicProfitabilityAdmissionWiring',
          opportunityId: opportunity.id,
          path: decision.path,
          evidence: decision.evidence,
          hardVetoVerified: decision.hardVetoVerified,
          reasons: decision.reasons,
        });
        return false;
      }
      return true;
    };
  }

  logger.info('[UnifiedExecutionRouter] Positive-net execution admission wiring installed', {
    component: 'DynamicProfitabilityAdmissionWiring',
    hardAdmissionAuthority: 'canonical_strategy_executor_verified_hard_facts_only',
    evidenceScoringAuthority: 'parallel_advisory_only',
    activeMissingEvidenceAcquisition: 'exact_positive_fee_legs_then_targeted_canonical_revalidation_off_hot_path',
    minimumNecessaryExecutionEvidence: true,
    missingInformationExecutionVetoAuthority: false,
    adaptiveProfitabilityThresholdAuthority: 'ranking_and_sizing_only',
    cryptaraExecutionAuthority: false,
    tradingViewExecutionAuthority: false,
    zeroCapitalPreRegistrationBootstrap: 'fresh_positive_bounded_route_then_immediate_measured_registry_record',
    coldStartHistoricalProofRequired: false,
    bpsRescuePortfolio: 'measured_cost_decomposition_plus_decay_scheduling',
    bpsDecomposition: 'exact_measured_cross_topology_telemetry',
    zeroCapitalRecoveryTelemetry: 'exact_measured_gap_distribution',
    profitabilityRecoveryIntelligence: 'fifty_signal_measured_recovery_coordinator',
    bpsSubsystemExecutionAuthority: false,
    terminalSettlementStillRequiredAfterExecution: true,
    canonicalCexPlanModes: ['TT', 'MM', 'MT', 'TM'],
    hybridCexLifecycle: 'maker_terminal_fill_then_fresh_depth_aware_taker_hedge',
    livePaths: ['CEX_CEX_CANONICAL', 'FLASH_LOAN'],
    incompleteTopologyPathsRemainFailClosed: ['MAKER_CEX_SHADOW', 'BRIDGE_FLASH_LOAN', 'FLASH_LOAN_LIQUIDATION', 'SPOT_PERP_FUNDING'],
  });
}
