import logger from '../../../logger.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { stageManager } from '../governance/stage-management.js';
import type { UnifiedExecutionDecision } from './unified-execution-router.js';
import { executePreparedZeroXAtomicRoundTrip } from './dex-zerox-atomic-executor.js';

export interface MeasuredTopologyDispatchResult {
  opportunityId: string;
  topology: UnifiedExecutionDecision['topology'];
  path: UnifiedExecutionDecision['path'];
  dispatched: boolean;
  success: boolean;
  settlementConfirmed: boolean;
  transactionHash?: string;
  error?: string;
}

class MeasuredTopologyExecutionScheduler {
  private readonly inFlight = new Set<string>();
  private readonly terminalApplied = new Set<string>();

  private liveExecutionEnabled(): boolean {
    return process.env.NO_EXECUTION !== 'true'
      && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
      && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK'
      && process.env.ZERO_CAPITAL_ENABLE_EXECUTION === 'true'
      && process.env.ZERO_CAPITAL_EXECUTION_CONFIRMATION === 'I_ACCEPT_ZERO_CAPITAL_EXECUTION_RISK';
  }

  async dispatch(decisions: readonly UnifiedExecutionDecision[]): Promise<MeasuredTopologyDispatchResult[]> {
    if (!this.liveExecutionEnabled() || !stageManager.isMarketOperationsAllowed() || !stageManager.canExecuteTrades()) return [];
    const candidates = decisions
      .filter(decision => decision.admitted && decision.topology === 'DEX_ATOMIC' && decision.path === 'FLASH_LOAN')
      .filter(decision => !this.inFlight.has(decision.opportunityId) && !this.terminalApplied.has(decision.opportunityId))
      .sort((left, right) => right.score.profitabilityScore - left.score.profitabilityScore)
      .slice(0, Math.max(1, Math.min(2, Number(process.env.CRYPTOCRAWL_DEX_ATOMIC_MAX_DISPATCH_PER_CYCLE || 1))));

    const results: MeasuredTopologyDispatchResult[] = [];
    for (const decision of candidates) {
      this.inFlight.add(decision.opportunityId);
      try {
        results.push(await this.dispatchDexAtomic(decision));
      } finally {
        this.inFlight.delete(decision.opportunityId);
      }
    }
    return results;
  }

  private async dispatchDexAtomic(decision: UnifiedExecutionDecision): Promise<MeasuredTopologyDispatchResult> {
    const candidate = measuredCandidateRegistry.get(decision.opportunityId);
    if (!candidate || candidate.topology !== 'DEX_ATOMIC' || candidate.status !== 'eligible' || !candidate.executableCapability) {
      return {
        opportunityId: decision.opportunityId,
        topology: decision.topology,
        path: decision.path,
        dispatched: false,
        success: false,
        settlementConfirmed: false,
        error: 'DEX_ATOMIC_CANDIDATE_NOT_CURRENTLY_ELIGIBLE',
      };
    }
    const chain = candidate.chains[0];
    const governance = getCryptocrawlGovernance();
    governance.requireAllowed('EXECUTE_OPPORTUNITY', { chain, venue: '0x' });
    governance.recordExecutionAttempt();

    const startedAt = Date.now();
    const result = await executePreparedZeroXAtomicRoundTrip(decision.opportunityId);
    const dispatch: MeasuredTopologyDispatchResult = {
      opportunityId: decision.opportunityId,
      topology: decision.topology,
      path: decision.path,
      dispatched: true,
      success: result.success,
      settlementConfirmed: result.settlementConfirmed,
      transactionHash: result.transactionHash,
      error: result.error,
    };

    if (result.success && result.settlementConfirmed && result.transactionHash && result.realizedProfitUsd !== undefined && result.realizedProfitUsd > 0) {
      const settledAt = Date.now();
      const expectedProfitUsd = Number(candidate.economics.deterministicNetProfitUsd || 0);
      const realizedGasUsd = Number(result.gasUsd ?? candidate.economics.gasUsd ?? 0);
      const realizedFeeUsd = Math.max(0, Number(candidate.economics.feeUsd || 0) + realizedGasUsd);
      await recordCryptaraExecutionEvidence({
        source: 'flash_loan',
        opportunityId: candidate.opportunityId,
        chain,
        symbol: candidate.assets.join('/'),
        strategy: 'dex_0x_atomic_roundtrip',
        success: true,
        expectedProfitUsd,
        realizedProfitUsd: result.realizedProfitUsd,
        feeUsd: realizedFeeUsd,
        slippageBps: null,
        latencyMs: settledAt - startedAt,
        usedZeroCapital: true,
        timestamp: settledAt,
        settlementStatus: 'filled',
        settlementConfirmed: true,
        provenance: [
          ...candidate.provenance,
          'dex_atomic:canonical_measured_topology_scheduler',
          'dex_atomic:terminal_receiver_profit_event',
        ],
        settlement: {
          status: 'filled',
          terminal: true,
          settlementConfirmed: true,
          submittedAt: startedAt,
          settledAt,
          venueOrRoute: '0x_allowance_holder->0x_allowance_holder@balancer_v2_flash_loan',
          chain,
          predicted: {
            profitUsd: expectedProfitUsd,
            feeUsd: Math.max(0, Number(candidate.economics.feeUsd || 0) + Number(candidate.economics.gasUsd || 0)),
            slippageBps: candidate.economics.expectedSlippageBps,
          },
          realized: {
            acquisitionCostUsd: null,
            proceedsUsd: null,
            exchangeFeeUsd: Number(candidate.economics.feeUsd || 0),
            gasUsd: result.gasUsd ?? candidate.economics.gasUsd,
            gasUsed: null,
            effectiveGasPriceWei: null,
            slippageBps: null,
            netProfitUsd: result.realizedProfitUsd,
          },
          provenance: [
            '0x:v2_firm_quotes',
            'balancer_v2:measured_flash_fee',
            'receiver:exact_pretrade_eth_call',
            'receiver:terminal_profit_event',
            `transaction:${result.transactionHash}`,
            'synthetic_evidence:false',
          ],
          transactionHash: result.transactionHash,
          receiptStatus: 1,
        },
      });
      this.terminalApplied.add(decision.opportunityId);
    }

    logger.info('[MeasuredTopologyExecution] DEX atomic dispatch completed', {
      component: 'MeasuredTopologyExecutionScheduler',
      opportunityId: decision.opportunityId,
      success: dispatch.success,
      settlementConfirmed: dispatch.settlementConfirmed,
      transactionHash: dispatch.transactionHash || null,
      executionAuthority: 'governance_plus_stage_plus_fresh_unified_admission',
      syntheticEvidence: false,
    });
    return dispatch;
  }
}

export const measuredTopologyExecutionScheduler = new MeasuredTopologyExecutionScheduler();
