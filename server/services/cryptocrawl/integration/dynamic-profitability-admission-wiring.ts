import logger from '../../../logger.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { centralizedExchangeExecutor } from '../execution/centralized-exchange-executor.js';
import { routeMeasuredOpportunity } from '../execution/unified-execution-router.js';
import { zeroCapitalEngine, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';

const installed = new WeakSet<object>();

type CexRuntime = {
  execute: (plan: any) => Promise<any>;
};

type ZeroCapitalRuntime = {
  isAllowedByCryptara: (opportunity: ZeroCapitalOpportunity) => Promise<boolean>;
};

function cexOpportunityId(plan: { buyVenue: string; sellVenue: string; symbol: string }): string {
  return `${plan.buyVenue}-${plan.sellVenue}-${plan.symbol}`;
}

export function ensureDynamicProfitabilityAdmissionWiring(): void {
  const cex = centralizedExchangeExecutor as unknown as CexRuntime;
  if (!installed.has(cex)) {
    installed.add(cex);
    const originalExecute = cex.execute.bind(cex);
    cex.execute = async plan => {
      const candidate = measuredCandidateRegistry.get(cexOpportunityId(plan));
      if (!candidate) {
        return {
          success: false,
          status: 'rejected',
          settlementConfirmed: false,
          error: 'REJECT_DYNAMIC_ADMISSION_EVIDENCE: measured candidate is unavailable at execution admission',
        };
      }
      const decision = routeMeasuredOpportunity(candidate);
      if (!decision.admitted) {
        logger.info('[UnifiedExecutionRouter] CEX opportunity rejected by adaptive admission', {
          component: 'DynamicProfitabilityAdmissionWiring',
          opportunityId: candidate.opportunityId,
          path: decision.path,
          profitabilityScore: decision.score.profitabilityScore,
          executionRisk: decision.score.executionRisk,
          confidenceLevel: decision.score.confidenceLevel,
          threshold: decision.threshold,
          reasons: decision.reasons,
        });
        return {
          success: false,
          status: 'rejected',
          settlementConfirmed: false,
          error: `REJECT_DYNAMIC_PROFITABILITY_SCORE: ${decision.reasons.join('; ')}`,
        };
      }
      return originalExecute(plan);
    };
  }

  const zeroCapital = zeroCapitalEngine as unknown as ZeroCapitalRuntime;
  if (!installed.has(zeroCapital)) {
    installed.add(zeroCapital);
    const originalIsAllowedByCryptara = zeroCapital.isAllowedByCryptara.bind(zeroCapital);
    zeroCapital.isAllowedByCryptara = async opportunity => {
      const cryptaraAllowed = await originalIsAllowedByCryptara(opportunity);
      if (!cryptaraAllowed) return false;

      const current = measuredCandidateRegistry.get(opportunity.id);
      if (!current) return false;
      // Cryptara/Monte Carlo approval is the point at which the measured candidate
      // may become eligible. This is current evidence, not historical proof.
      const eligible = measuredCandidateRegistry.updateStatus(opportunity.id, 'eligible', {
        provenance: ['unified_execution_router:cryptara_current_evidence_approved'],
      });
      if (!eligible) return false;

      const decision = routeMeasuredOpportunity(eligible);
      if (!decision.admitted) {
        logger.info('[UnifiedExecutionRouter] Zero-capital opportunity rejected by adaptive admission', {
          component: 'DynamicProfitabilityAdmissionWiring',
          opportunityId: opportunity.id,
          path: decision.path,
          profitabilityScore: decision.score.profitabilityScore,
          executionRisk: decision.score.executionRisk,
          confidenceLevel: decision.score.confidenceLevel,
          threshold: decision.threshold,
          reasons: decision.reasons,
        });
        return false;
      }
      return true;
    };
  }

  logger.info('[UnifiedExecutionRouter] Dynamic profitability admission wiring installed', {
    component: 'DynamicProfitabilityAdmissionWiring',
    formula: '(NetProfitUSD / ExecutionRisk) * ConfidenceLevel',
    coldStartHistoricalProofRequired: false,
    thresholdAuthority: 'adaptive_terminal_outcomes',
    terminalSettlementStillRequiredAfterExecution: true,
    livePaths: ['CEX_TAKER_IOC', 'FLASH_LOAN'],
    incompletePathsRemainFailClosed: ['CEX_MAKER', 'BRIDGE_FLASH_LOAN', 'FLASH_LOAN_LIQUIDATION', 'SPOT_PERP_FUNDING'],
  });
}
