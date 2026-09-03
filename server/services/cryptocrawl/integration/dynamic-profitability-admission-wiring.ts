import logger from '../../../logger.js';
import { getCryptara } from '../../cryptara/index.js';
import { zeroCapitalEngine, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import { measuredOpportunityGraph } from '../discovery/opportunity-graph.js';
import { centralizedExchangeExecutor } from '../execution/centralized-exchange-executor.js';
import { routeMeasuredOpportunity } from '../execution/unified-execution-router.js';
import { ensureBpsDecompositionObservability } from './bps-decomposition-observability.js';
import { ensureEconomicTransformationWiring } from './economic-transformation-wiring.js';
import { ensureZeroCapitalRecoveryObservability } from './zero-capital-recovery-observability.js';
import { ensureProfitabilityRecoveryCoordinator } from './profitability-recovery-coordinator.js';

const installed = new WeakSet<object>();
const evidenceReacquisitionInFlight = new Map<string, Promise<void>>();
const evidenceReacquisitionCooldownUntil = new Map<string, number>();

type CexRuntime = {
  execute: (plan: any) => Promise<any>;
};

type ZeroCapitalRuntime = {
  isAllowedByCryptara: (opportunity: ZeroCapitalOpportunity) => Promise<boolean>;
};

function cexOpportunityId(plan: { buyVenue: string; sellVenue: string; symbol: string }): string {
  return `${plan.buyVenue}-${plan.sellVenue}-${plan.symbol}`;
}

function evidenceReacquisitionCooldownMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_EVIDENCE_REACQUISITION_COOLDOWN_MS || 500);
  return Number.isFinite(parsed) ? Math.max(100, Math.min(5_000, Math.trunc(parsed))) : 500;
}

function requestCexEvidenceReacquisition(symbolRaw: string, reason: string): void {
  const symbol = String(symbolRaw || '').trim().toUpperCase();
  if (!symbol) return;
  const key = `cex:${symbol}`;
  if (evidenceReacquisitionInFlight.has(key) || (evidenceReacquisitionCooldownUntil.get(key) || 0) > Date.now()) return;

  const task = measuredOpportunityGraph.revalidateSymbols([symbol])
    .then(cycle => {
      logger.info('[EvidenceScanner] Targeted CEX evidence reacquisition completed', {
        component: 'DynamicProfitabilityAdmissionWiring',
        symbol,
        reason,
        cycleId: cycle.cycleId,
        evaluatedSymbols: cycle.evaluatedSymbols,
        deterministicPositive: cycle.deterministicPositive,
        eligibleCandidates: cycle.eligibleCandidates,
        activeEvidenceAcquisition: true,
        hotPathExecutionAuthority: false,
      });
    })
    .catch(error => {
      logger.warn('[EvidenceScanner] Targeted CEX evidence reacquisition degraded', {
        component: 'DynamicProfitabilityAdmissionWiring',
        symbol,
        reason,
        error: error instanceof Error ? error.message : String(error),
        hotPathExecutionAuthority: false,
      });
    })
    .finally(() => {
      evidenceReacquisitionInFlight.delete(key);
      evidenceReacquisitionCooldownUntil.set(key, Date.now() + evidenceReacquisitionCooldownMs());
    });
  evidenceReacquisitionInFlight.set(key, task);
}

function measuredZeroCapitalExecutionReady(
  opportunity: ZeroCapitalOpportunity,
  candidate: MeasuredCandidate,
): { allowed: boolean; reason: string; maxSlippageBps: number } {
  const directive = getCryptara().getAutonomousDirective();
  const configuredMaxSlippage = Math.max(1, Math.min(50, Number(process.env.ZERO_CAPITAL_MAX_SLIPPAGE_BPS || 20)));
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

  const cex = centralizedExchangeExecutor as unknown as CexRuntime;
  if (!installed.has(cex)) {
    installed.add(cex);
    const originalExecute = cex.execute.bind(cex);
    cex.execute = async plan => {
      const candidate = measuredCandidateRegistry.get(cexOpportunityId(plan));
      if (!candidate) {
        requestCexEvidenceReacquisition(plan.symbol, 'measured_candidate_registry_missing_at_hot_path');
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
        requestCexEvidenceReacquisition(plan.symbol, decision.reasons.join('; '));
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
      const cryptaraAllowed = await originalIsAllowedByCryptara(opportunity);
      const current = measuredCandidateRegistry.get(opportunity.id);
      if (!current) return false;

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

      if (!cryptaraAllowed) {
        logger.info('[UnifiedExecutionRouter] Measured zero-capital candidate retained despite advisory Cryptara veto', {
          component: 'DynamicProfitabilityAdmissionWiring',
          opportunityId: opportunity.id,
          chain: opportunity.chain,
          deterministicNetProfitUsd: current.economics.deterministicNetProfitUsd,
          netProfitBps: current.economics.netProfitBps,
          expectedSlippageBps: opportunity.expectedSlippageBps,
          maxSlippageBps: executionReady.maxSlippageBps,
          reason: executionReady.reason,
          cryptaraExecutionAuthority: false,
          tradingViewExecutionAuthority: false,
          terminalSettlementStillRequired: true,
        });
      }

      const eligible = measuredCandidateRegistry.updateStatus(opportunity.id, 'eligible', {
        provenance: [
          'unified_execution_router:measured_positive_execution_authority',
          executionReady.reason,
          cryptaraAllowed ? 'Cryptara:advisory_allow' : 'Cryptara:advisory_veto_ignored_for_execution',
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
    activeMissingEvidenceAcquisition: 'targeted_canonical_revalidation_off_hot_path',
    missingInformationExecutionVetoAuthority: false,
    adaptiveProfitabilityThresholdAuthority: 'ranking_and_sizing_only',
    cryptaraExecutionAuthority: false,
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
