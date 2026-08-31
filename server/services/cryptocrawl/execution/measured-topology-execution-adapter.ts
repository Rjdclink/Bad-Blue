import { BigNumber, ethers } from 'ethers';
import logger from '../../../logger.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import type { ChainId } from '../bridge/types.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { stageManager } from '../governance/stage-management.js';
import { getGasSponsorManager } from '../strategies/gas-sponsorship.js';
import {
  executePreparedAaveLiquidation,
  reconcilePendingAaveLiquidationInfrastructure,
  type AaveLiquidationExecutionResult,
  type ExecutableAaveLiquidationChain,
} from './aave-liquidation-atomic-executor.js';
import {
  executePreparedZeroXAtomicRoundTrip,
  reconcilePendingZeroXAtomicInfrastructure,
  type ZeroXAtomicExecutionResult,
} from './dex-zerox-atomic-executor.js';
import type { UnifiedExecutionDecision } from './unified-execution-router.js';
import { zeroCapitalResourceScheduler } from './zero-capital-resource-scheduler.js';

export interface MeasuredTopologyDispatchResult {
  opportunityId: string;
  topology: UnifiedExecutionDecision['topology'];
  path: UnifiedExecutionDecision['path'];
  dispatched: boolean;
  success: boolean;
  settlementConfirmed: boolean;
  transactionHash?: string;
  realizedNetProfitUsd?: number | null;
  error?: string;
}

interface ActualGasObservation {
  gasUsd: number | null;
  gasUsed: string | null;
  effectiveGasPriceWei: string | null;
  receiptStatus: 0 | 1 | null;
  provenance: string[];
}

type ReceiptBearingExecution = {
  fundingModeUsed?: 'sponsored' | 'native';
  gasUsed?: string;
  effectiveGasPriceWei?: string;
  receiptStatus?: 0 | 1;
};

function asSupportedChain(raw: string | undefined): ChainId | null {
  const chain = String(raw || '').trim().toLowerCase() as ChainId;
  return Object.prototype.hasOwnProperty.call(SUPPORTED_CHAINS, chain) ? chain : null;
}

function asLiquidationChain(raw: string | undefined): ExecutableAaveLiquidationChain | null {
  const chain = String(raw || '').trim().toLowerCase();
  return chain === 'ethereum' || chain === 'polygon' ? chain : null;
}

async function actualGasFromCurrency(
  currency: string,
  result: ReceiptBearingExecution,
): Promise<ActualGasObservation> {
  const gasUsed = result.gasUsed || null;
  const effectiveGasPriceWei = result.effectiveGasPriceWei || null;
  const receiptStatus = result.receiptStatus ?? null;
  if (result.fundingModeUsed === 'sponsored') {
    return {
      gasUsd: 0,
      gasUsed,
      effectiveGasPriceWei,
      receiptStatus,
      provenance: ['gas:sponsored_zero_user_monetary_cost', ...(gasUsed ? ['receipt:gas_measured'] : [])],
    };
  }
  if (result.fundingModeUsed !== 'native') {
    return {
      gasUsd: null,
      gasUsed,
      effectiveGasPriceWei,
      receiptStatus,
      provenance: ['gas:actual_funding_mode_unknown'],
    };
  }
  if (!gasUsed || !effectiveGasPriceWei || !/^\d+$/.test(gasUsed) || !/^\d+$/.test(effectiveGasPriceWei)) {
    return {
      gasUsd: null,
      gasUsed,
      effectiveGasPriceWei,
      receiptStatus,
      provenance: ['gas:receipt_cost_fields_incomplete'],
    };
  }
  const normalizedCurrency = currency.toUpperCase();
  const prices = await coinGeckoPriceClient.getLiveSymbolPrices([normalizedCurrency]).catch(() => new Map<string, number>());
  const nativePriceUsd = prices.get(normalizedCurrency);
  if (!Number.isFinite(nativePriceUsd) || Number(nativePriceUsd) <= 0) {
    return {
      gasUsd: null,
      gasUsed,
      effectiveGasPriceWei,
      receiptStatus,
      provenance: ['gas:receipt_measured', 'gas:live_native_price_unavailable', 'static_price_fallback_forbidden'],
    };
  }
  const feeWei = BigNumber.from(gasUsed).mul(BigNumber.from(effectiveGasPriceWei));
  const nativeFee = Number(ethers.utils.formatEther(feeWei));
  const gasUsd = Number.isFinite(nativeFee) ? nativeFee * Number(nativePriceUsd) : NaN;
  return {
    gasUsd: Number.isFinite(gasUsd) && gasUsd >= 0 ? gasUsd : null,
    gasUsed,
    effectiveGasPriceWei,
    receiptStatus,
    provenance: ['gas:receipt_measured', 'gas:coingecko_live_native_price'],
  };
}

async function actualGasFromExecution(
  chain: ChainId,
  result: ZeroXAtomicExecutionResult,
): Promise<ActualGasObservation> {
  return actualGasFromCurrency(SUPPORTED_CHAINS[chain].currency, result);
}

async function actualGasFromLiquidation(
  chain: ExecutableAaveLiquidationChain,
  result: AaveLiquidationExecutionResult,
): Promise<ActualGasObservation> {
  return actualGasFromCurrency(chain === 'ethereum' ? 'ETH' : 'POL', result);
}

function predictedFeeUsd(candidate: ReturnType<typeof measuredCandidateRegistry.get>): number {
  if (!candidate) return 0;
  return [candidate.economics.feeUsd, candidate.economics.gasUsd]
    .map(value => Number(value))
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + Math.max(0, value), 0);
}

class MeasuredTopologyExecutionAdapter {
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

    // Discovery can only queue readiness needs. Infrastructure mutation happens
    // here, beneath the canonical scheduler, and neither reconciler can submit an
    // opportunity transaction.
    try {
      const [dexInfrastructure, liquidationInfrastructure] = await Promise.all([
        reconcilePendingZeroXAtomicInfrastructure(1),
        reconcilePendingAaveLiquidationInfrastructure(1),
      ]);
      if (dexInfrastructure.attempted > 0 || liquidationInfrastructure.attempted > 0) {
        logger.info('[MeasuredTopologyAdapter] Bounded infrastructure readiness reconciliation completed', {
          component: 'MeasuredTopologyExecutionAdapter',
          dex: dexInfrastructure,
          liquidation: liquidationInfrastructure,
          opportunitySubmitted: false,
          canonicalSchedulerAuthorityPreserved: true,
        });
      }
    } catch (error) {
      logger.warn('[MeasuredTopologyAdapter] Infrastructure readiness reconciliation failed closed', {
        component: 'MeasuredTopologyExecutionAdapter',
        error: error instanceof Error ? error.message : String(error),
        opportunitySubmitted: false,
      });
    }

    const dexCandidates = decisions
      .filter(decision => decision.admitted && decision.topology === 'DEX_ATOMIC' && decision.path === 'FLASH_LOAN')
      .filter(decision => !this.inFlight.has(decision.opportunityId) && !this.terminalApplied.has(decision.opportunityId))
      .sort((left, right) => right.score.profitabilityScore - left.score.profitabilityScore)
      .slice(0, Math.max(1, Math.min(2, Number(process.env.CRYPTOCRAWL_DEX_ATOMIC_MAX_DISPATCH_PER_CYCLE || 1))));
    const liquidationCandidates = decisions
      .filter(decision => decision.admitted && decision.topology === 'LIQUIDATION' && decision.path === 'FLASH_LOAN_LIQUIDATION')
      .filter(decision => !this.inFlight.has(decision.opportunityId) && !this.terminalApplied.has(decision.opportunityId))
      .sort((left, right) => right.score.profitabilityScore - left.score.profitabilityScore)
      .slice(0, Math.max(1, Math.min(2, Number(process.env.CRYPTOCRAWL_LIQUIDATION_MAX_DISPATCH_PER_CYCLE || 1))));

    // Both topology quotas are preserved; within the combined bounded set the
    // measured profitability score determines order. This is scheduling only.
    const candidates = [...dexCandidates, ...liquidationCandidates]
      .sort((left, right) => right.score.profitabilityScore - left.score.profitabilityScore);
    const results: MeasuredTopologyDispatchResult[] = [];
    for (const decision of candidates) {
      this.inFlight.add(decision.opportunityId);
      try {
        results.push(decision.topology === 'LIQUIDATION'
          ? await this.dispatchAaveLiquidation(decision)
          : await this.dispatchDexAtomic(decision));
      } finally {
        this.inFlight.delete(decision.opportunityId);
      }
    }
    return results;
  }

  private async recordDexTerminal(
    input: {
      decision: UnifiedExecutionDecision;
      chain: ChainId;
      startedAt: number;
      expectedProfitUsd: number;
      result: ZeroXAtomicExecutionResult;
      actualGas: ActualGasObservation;
    },
  ): Promise<{ economicallySuccessful: boolean; realizedNetProfitUsd: number | null }> {
    const candidate = measuredCandidateRegistry.get(input.decision.opportunityId);
    if (!candidate || !input.result.transactionHash || !input.result.terminal || input.result.receiptStatus === undefined) {
      return { economicallySuccessful: false, realizedNetProfitUsd: null };
    }
    const receiverProfitUsd = input.result.success && input.result.realizedProfitUsd !== undefined
      ? input.result.realizedProfitUsd
      : null;
    const realizedNetProfitUsd = receiverProfitUsd !== null && input.actualGas.gasUsd !== null
      ? receiverProfitUsd - input.actualGas.gasUsd
      : input.result.receiptStatus === 0 && input.actualGas.gasUsd !== null
        ? -input.actualGas.gasUsd
        : null;
    const economicallySuccessful = input.result.success
      && input.result.receiptStatus === 1
      && realizedNetProfitUsd !== null
      && realizedNetProfitUsd > 0;
    const notionalUsd = Number(candidate.economics.notionalUsd);
    const realizedNetProfitBps = realizedNetProfitUsd !== null && Number.isFinite(notionalUsd) && notionalUsd > 0
      ? realizedNetProfitUsd / notionalUsd * 10_000
      : null;
    const settledAt = Date.now();
    const terminalSettlementConfirmed = input.result.settlementConfirmed === true;

    measuredCandidateRegistry.updateStatus(candidate.opportunityId, economicallySuccessful ? candidate.status : 'blocked', {
      economics: { ...candidate.economics, realizedNetProfitBps },
      executionCapabilityReason: economicallySuccessful
        ? candidate.executionCapabilityReason
        : input.result.error || 'Terminal DEX atomic result was not all-in profitable',
      provenance: [
        `dex_atomic:terminal_status:${input.result.status}`,
        `dex_atomic:settlement_confirmed:${terminalSettlementConfirmed}`,
        ...input.actualGas.provenance,
        `dex_atomic:tx:${input.result.transactionHash}`,
      ],
    });

    await recordCryptaraExecutionEvidence({
      source: 'flash_loan',
      opportunityId: candidate.opportunityId,
      chain: input.chain,
      symbol: candidate.assets.join('/'),
      strategy: 'dex_0x_atomic_roundtrip',
      success: economicallySuccessful,
      expectedProfitUsd: input.expectedProfitUsd,
      realizedProfitUsd: realizedNetProfitUsd,
      feeUsd: input.actualGas.gasUsd,
      slippageBps: null,
      latencyMs: settledAt - input.startedAt,
      usedZeroCapital: true,
      timestamp: settledAt,
      notes: realizedNetProfitUsd === null
        ? `Terminal DEX receipt observed but realized all-in USD P&L is incomplete: ${input.result.error || 'live gas pricing unavailable'}`
        : economicallySuccessful
          ? undefined
          : input.result.error || 'Terminal DEX execution was non-profitable after actual gas',
      settlementStatus: economicallySuccessful ? 'filled' : 'failed',
      settlementConfirmed: terminalSettlementConfirmed,
      provenance: [
        ...candidate.provenance,
        'dex_atomic:canonical_execution_scheduler_adapter',
        `dex_atomic:terminal_status:${input.result.status}`,
        `dex_atomic:settlement_confirmed:${terminalSettlementConfirmed}`,
        ...input.actualGas.provenance,
      ],
      settlement: {
        status: economicallySuccessful ? 'filled' : 'failed',
        terminal: true,
        settlementConfirmed: terminalSettlementConfirmed,
        submittedAt: input.startedAt,
        settledAt,
        venueOrRoute: '0x_allowance_holder->0x_allowance_holder@balancer_v2_flash_loan',
        chain: input.chain,
        predicted: {
          profitUsd: input.expectedProfitUsd,
          feeUsd: predictedFeeUsd(candidate),
          slippageBps: candidate.economics.expectedSlippageBps,
        },
        realized: {
          acquisitionCostUsd: null,
          proceedsUsd: receiverProfitUsd,
          exchangeFeeUsd: null,
          gasUsd: input.actualGas.gasUsd,
          gasUsed: input.actualGas.gasUsed,
          effectiveGasPriceWei: input.actualGas.effectiveGasPriceWei,
          slippageBps: null,
          netProfitUsd: realizedNetProfitUsd,
        },
        provenance: [
          '0x:v2_allowance_holder_firm_quotes',
          'balancer_v2:flash_fee_repaid_before_receiver_profit_event',
          'receiver:exact_pretrade_eth_call',
          ...(input.result.success ? ['receiver:terminal_profit_event'] : ['receiver:terminal_profit_event_unavailable_or_nonpositive']),
          ...input.actualGas.provenance,
          `transaction:${input.result.transactionHash}`,
          'synthetic_evidence:false',
        ],
        transactionHash: input.result.transactionHash,
        receiptStatus: input.result.receiptStatus,
        error: input.result.error,
      },
    });
    this.terminalApplied.add(input.decision.opportunityId);
    return { economicallySuccessful, realizedNetProfitUsd };
  }

  private async recordLiquidationTerminal(
    input: {
      decision: UnifiedExecutionDecision;
      chain: ExecutableAaveLiquidationChain;
      startedAt: number;
      expectedProfitUsd: number;
      result: AaveLiquidationExecutionResult;
      actualGas: ActualGasObservation;
    },
  ): Promise<{ economicallySuccessful: boolean; realizedNetProfitUsd: number | null }> {
    const candidate = measuredCandidateRegistry.get(input.decision.opportunityId);
    if (!candidate || !input.result.transactionHash || !input.result.terminal || input.result.receiptStatus === undefined) {
      return { economicallySuccessful: false, realizedNetProfitUsd: null };
    }
    const receiverProfitUsd = input.result.success && input.result.realizedReceiverProfitUsd !== undefined
      ? input.result.realizedReceiverProfitUsd
      : null;
    const realizedNetProfitUsd = receiverProfitUsd !== null && input.actualGas.gasUsd !== null
      ? receiverProfitUsd - input.actualGas.gasUsd
      : input.result.receiptStatus === 0 && input.actualGas.gasUsd !== null
        ? -input.actualGas.gasUsd
        : null;
    const economicallySuccessful = input.result.success
      && input.result.receiptStatus === 1
      && realizedNetProfitUsd !== null
      && realizedNetProfitUsd > 0;
    const notionalUsd = Number(candidate.economics.notionalUsd);
    const realizedNetProfitBps = realizedNetProfitUsd !== null && Number.isFinite(notionalUsd) && notionalUsd > 0
      ? realizedNetProfitUsd / notionalUsd * 10_000
      : null;
    const settledAt = Date.now();
    const terminalSettlementConfirmed = input.result.settlementConfirmed === true;

    measuredCandidateRegistry.updateStatus(candidate.opportunityId, economicallySuccessful ? candidate.status : 'blocked', {
      economics: { ...candidate.economics, realizedNetProfitBps },
      executionCapabilityReason: economicallySuccessful
        ? candidate.executionCapabilityReason
        : input.result.error || 'Terminal Aave liquidation was not all-in profitable after actual gas',
      provenance: [
        `aave_liquidation:terminal_status:${input.result.status}`,
        `aave_liquidation:settlement_confirmed:${terminalSettlementConfirmed}`,
        ...input.actualGas.provenance,
        `aave_liquidation:tx:${input.result.transactionHash}`,
      ],
    });

    await recordCryptaraExecutionEvidence({
      source: 'flash_loan',
      opportunityId: candidate.opportunityId,
      chain: input.chain,
      symbol: candidate.assets.join('/'),
      strategy: 'aave_v3_atomic_liquidation_0x_unwind',
      success: economicallySuccessful,
      expectedProfitUsd: input.expectedProfitUsd,
      realizedProfitUsd: realizedNetProfitUsd,
      feeUsd: input.actualGas.gasUsd,
      slippageBps: candidate.economics.expectedSlippageBps,
      latencyMs: settledAt - input.startedAt,
      usedZeroCapital: true,
      timestamp: settledAt,
      notes: realizedNetProfitUsd === null
        ? `Terminal Aave liquidation receipt observed but actual all-in USD P&L is incomplete: ${input.result.error || 'live gas pricing unavailable'}`
        : economicallySuccessful
          ? undefined
          : input.result.error || 'Terminal Aave liquidation was non-profitable after actual gas',
      settlementStatus: economicallySuccessful ? 'filled' : 'failed',
      settlementConfirmed: terminalSettlementConfirmed,
      provenance: [
        ...candidate.provenance,
        'aave_liquidation:canonical_execution_scheduler_adapter',
        `aave_liquidation:terminal_status:${input.result.status}`,
        `aave_liquidation:settlement_confirmed:${terminalSettlementConfirmed}`,
        ...input.actualGas.provenance,
      ],
      settlement: {
        status: economicallySuccessful ? 'filled' : 'failed',
        terminal: true,
        settlementConfirmed: terminalSettlementConfirmed,
        submittedAt: input.startedAt,
        settledAt,
        venueOrRoute: 'aave_v3_liquidationCall->0x_allowance_holder_unwind@aave_v3_flash_loan',
        chain: input.chain,
        predicted: {
          profitUsd: input.expectedProfitUsd,
          feeUsd: predictedFeeUsd(candidate),
          slippageBps: candidate.economics.expectedSlippageBps,
        },
        realized: {
          acquisitionCostUsd: null,
          proceedsUsd: receiverProfitUsd,
          exchangeFeeUsd: null,
          gasUsd: input.actualGas.gasUsd,
          gasUsed: input.actualGas.gasUsed,
          effectiveGasPriceWei: input.actualGas.effectiveGasPriceWei,
          slippageBps: null,
          netProfitUsd: realizedNetProfitUsd,
        },
        provenance: [
          'aave_v3:terminal_liquidation_receipt',
          'aave_v3:flash_fee_repaid_before_receiver_profit_event',
          '0x:v2_allowance_holder_firm_unwind',
          'receiver:exact_pretrade_full_liquidation_eth_call',
          ...(input.result.success ? ['receiver:terminal_profit_event'] : ['receiver:terminal_profit_event_unavailable_or_nonpositive']),
          ...input.actualGas.provenance,
          `transaction:${input.result.transactionHash}`,
          'synthetic_evidence:false',
        ],
        transactionHash: input.result.transactionHash,
        receiptStatus: input.result.receiptStatus,
        error: input.result.error,
      },
    });
    this.terminalApplied.add(input.decision.opportunityId);
    return { economicallySuccessful, realizedNetProfitUsd };
  }

  private async dispatchDexAtomic(decision: UnifiedExecutionDecision): Promise<MeasuredTopologyDispatchResult> {
    const candidate = measuredCandidateRegistry.get(decision.opportunityId);
    if (!candidate || candidate.topology !== 'DEX_ATOMIC' || candidate.status !== 'eligible' || !candidate.executableCapability) {
      return { opportunityId: decision.opportunityId, topology: decision.topology, path: decision.path, dispatched: false, success: false, settlementConfirmed: false, error: 'DEX_ATOMIC_CANDIDATE_NOT_CURRENTLY_ELIGIBLE' };
    }
    if (candidate.missingInformation.length > 0 || candidate.expiresAt <= Date.now()) {
      return { opportunityId: decision.opportunityId, topology: decision.topology, path: decision.path, dispatched: false, success: false, settlementConfirmed: false, error: 'DEX_ATOMIC_CURRENT_EVIDENCE_INCOMPLETE_OR_EXPIRED' };
    }
    const chain = asSupportedChain(candidate.chains[0]);
    if (!chain) {
      return { opportunityId: decision.opportunityId, topology: decision.topology, path: decision.path, dispatched: false, success: false, settlementConfirmed: false, error: 'DEX_ATOMIC_UNSUPPORTED_CHAIN' };
    }
    const expectedProfitUsd = Number(candidate.economics.deterministicNetProfitUsd);
    if (!Number.isFinite(expectedProfitUsd) || expectedProfitUsd <= 0) {
      return { opportunityId: decision.opportunityId, topology: decision.topology, path: decision.path, dispatched: false, success: false, settlementConfirmed: false, error: 'DEX_ATOMIC_DETERMINISTIC_NET_NOT_POSITIVE' };
    }

    const fundingMode: 'sponsored' | 'native' = getGasSponsorManager().getReadiness().ready ? 'sponsored' : 'native';
    const lease = await zeroCapitalResourceScheduler.acquireMeasuredAtomic({
      opportunityId: candidate.opportunityId,
      chain,
      expiresAt: candidate.expiresAt,
      expectedNetProfitUsd: expectedProfitUsd,
      protocols: ['0x_allowance_holder', 'balancer_v2'],
      fundingMode,
    });
    if (!lease) {
      return { opportunityId: decision.opportunityId, topology: decision.topology, path: decision.path, dispatched: false, success: false, settlementConfirmed: false, error: 'DEX_ATOMIC_RESOURCE_LEASE_UNAVAILABLE' };
    }

    const governance = getCryptocrawlGovernance();
    const startedAt = Date.now();
    try {
      governance.requireAllowed('EXECUTE_OPPORTUNITY', { chain, venue: '0x' });
      governance.recordExecutionAttempt();
      const result = await executePreparedZeroXAtomicRoundTrip(decision.opportunityId, { fundingMode });
      if (result.fundingModeUsed && result.fundingModeUsed !== fundingMode) {
        throw new Error(`DEX_ATOMIC_FUNDING_MODE_DRIFT leased=${fundingMode} used=${result.fundingModeUsed}`);
      }
      if (result.terminal && result.transactionHash && result.receiptStatus !== undefined) {
        const actualGas = await actualGasFromExecution(chain, result);
        const terminal = await this.recordDexTerminal({ decision, chain, startedAt, expectedProfitUsd, result, actualGas });
        return {
          opportunityId: decision.opportunityId,
          topology: decision.topology,
          path: decision.path,
          dispatched: true,
          success: terminal.economicallySuccessful,
          settlementConfirmed: result.settlementConfirmed,
          transactionHash: result.transactionHash,
          realizedNetProfitUsd: terminal.realizedNetProfitUsd,
          error: terminal.economicallySuccessful ? undefined : result.error || (terminal.realizedNetProfitUsd === null ? 'DEX_ATOMIC_REALIZED_ALL_IN_USD_UNKNOWN' : 'DEX_ATOMIC_REALIZED_ALL_IN_NET_NONPOSITIVE'),
        };
      }
      return {
        opportunityId: decision.opportunityId,
        topology: decision.topology,
        path: decision.path,
        dispatched: true,
        success: false,
        settlementConfirmed: false,
        transactionHash: result.transactionHash,
        error: result.error || (result.status === 'settlement_unknown' ? 'DEX_ATOMIC_SETTLEMENT_UNKNOWN' : 'DEX_ATOMIC_PRE_SUBMIT_REJECTED'),
      };
    } catch (error) {
      return {
        opportunityId: decision.opportunityId,
        topology: decision.topology,
        path: decision.path,
        dispatched: true,
        success: false,
        settlementConfirmed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await lease.release();
    }
  }

  private async dispatchAaveLiquidation(decision: UnifiedExecutionDecision): Promise<MeasuredTopologyDispatchResult> {
    const candidate = measuredCandidateRegistry.get(decision.opportunityId);
    if (!candidate || candidate.topology !== 'LIQUIDATION' || candidate.status !== 'eligible' || !candidate.executableCapability) {
      return { opportunityId: decision.opportunityId, topology: decision.topology, path: decision.path, dispatched: false, success: false, settlementConfirmed: false, error: 'AAVE_LIQUIDATION_CANDIDATE_NOT_CURRENTLY_ELIGIBLE' };
    }
    if (candidate.missingInformation.length > 0 || candidate.expiresAt <= Date.now()) {
      return { opportunityId: decision.opportunityId, topology: decision.topology, path: decision.path, dispatched: false, success: false, settlementConfirmed: false, error: 'AAVE_LIQUIDATION_CURRENT_EVIDENCE_INCOMPLETE_OR_EXPIRED' };
    }
    const chain = asLiquidationChain(candidate.chains[0]);
    if (!chain) {
      return { opportunityId: decision.opportunityId, topology: decision.topology, path: decision.path, dispatched: false, success: false, settlementConfirmed: false, error: 'AAVE_LIQUIDATION_UNSUPPORTED_CHAIN' };
    }
    const expectedProfitUsd = Number(candidate.economics.deterministicNetProfitUsd);
    if (!Number.isFinite(expectedProfitUsd) || expectedProfitUsd <= 0) {
      return { opportunityId: decision.opportunityId, topology: decision.topology, path: decision.path, dispatched: false, success: false, settlementConfirmed: false, error: 'AAVE_LIQUIDATION_DETERMINISTIC_NET_NOT_POSITIVE' };
    }

    const fundingMode: 'sponsored' | 'native' = getGasSponsorManager().getReadiness().ready ? 'sponsored' : 'native';
    const lease = await zeroCapitalResourceScheduler.acquireMeasuredAtomic({
      opportunityId: candidate.opportunityId,
      chain,
      expiresAt: candidate.expiresAt,
      expectedNetProfitUsd: expectedProfitUsd,
      protocols: ['aave_v3_liquidation', 'aave_v3_flash_loan', '0x_allowance_holder'],
      fundingMode,
    });
    if (!lease) {
      return { opportunityId: decision.opportunityId, topology: decision.topology, path: decision.path, dispatched: false, success: false, settlementConfirmed: false, error: 'AAVE_LIQUIDATION_RESOURCE_LEASE_UNAVAILABLE' };
    }

    const governance = getCryptocrawlGovernance();
    const startedAt = Date.now();
    try {
      governance.requireAllowed('EXECUTE_OPPORTUNITY', { chain, venue: 'aave_v3' });
      governance.recordExecutionAttempt();
      const result = await executePreparedAaveLiquidation(decision.opportunityId, { fundingMode });
      if (result.fundingModeUsed && result.fundingModeUsed !== fundingMode) {
        throw new Error(`AAVE_LIQUIDATION_FUNDING_MODE_DRIFT leased=${fundingMode} used=${result.fundingModeUsed}`);
      }
      if (result.terminal && result.transactionHash && result.receiptStatus !== undefined) {
        const actualGas = await actualGasFromLiquidation(chain, result);
        const terminal = await this.recordLiquidationTerminal({ decision, chain, startedAt, expectedProfitUsd, result, actualGas });
        return {
          opportunityId: decision.opportunityId,
          topology: decision.topology,
          path: decision.path,
          dispatched: true,
          success: terminal.economicallySuccessful,
          settlementConfirmed: result.settlementConfirmed,
          transactionHash: result.transactionHash,
          realizedNetProfitUsd: terminal.realizedNetProfitUsd,
          error: terminal.economicallySuccessful ? undefined : result.error || (terminal.realizedNetProfitUsd === null ? 'AAVE_LIQUIDATION_REALIZED_ALL_IN_USD_UNKNOWN' : 'AAVE_LIQUIDATION_REALIZED_ALL_IN_NET_NONPOSITIVE'),
        };
      }
      return {
        opportunityId: decision.opportunityId,
        topology: decision.topology,
        path: decision.path,
        dispatched: true,
        success: false,
        settlementConfirmed: false,
        transactionHash: result.transactionHash,
        error: result.error || (result.status === 'settlement_unknown' ? 'AAVE_LIQUIDATION_SETTLEMENT_UNKNOWN' : 'AAVE_LIQUIDATION_PRE_SUBMIT_REJECTED'),
      };
    } catch (error) {
      return {
        opportunityId: decision.opportunityId,
        topology: decision.topology,
        path: decision.path,
        dispatched: true,
        success: false,
        settlementConfirmed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await lease.release();
    }
  }
}

export const measuredTopologyExecutionAdapter = new MeasuredTopologyExecutionAdapter();
