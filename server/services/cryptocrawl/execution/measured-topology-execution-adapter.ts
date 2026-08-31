import { ethers } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import type { ChainId } from '../bridge/types.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { stageManager } from '../governance/stage-management.js';
import { getGasSponsorManager } from '../strategies/gas-sponsorship.js';
import { executePreparedZeroXAtomicRoundTrip } from './dex-zerox-atomic-executor.js';
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

function asSupportedChain(raw: string | undefined): ChainId | null {
  const chain = String(raw || '').trim().toLowerCase() as ChainId;
  return Object.prototype.hasOwnProperty.call(SUPPORTED_CHAINS, chain) ? chain : null;
}

async function observeActualGas(
  chain: ChainId,
  transactionHash: string,
  sponsored: boolean,
): Promise<ActualGasObservation> {
  await multiProviderRpcManager.initialize([chain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(chain, 'json_rpc');
  const receipt = await provider.getTransactionReceipt(transactionHash);
  if (!receipt) {
    return {
      gasUsd: sponsored ? 0 : null,
      gasUsed: null,
      effectiveGasPriceWei: null,
      receiptStatus: null,
      provenance: sponsored ? ['gas:sponsored_zero_user_monetary_cost', 'receipt:unavailable'] : ['gas:receipt_unavailable'],
    };
  }

  const gasUsed = receipt.gasUsed?.toString() || null;
  const effectiveGasPriceWei = receipt.effectiveGasPrice?.toString() || null;
  const receiptStatus = receipt.status === 1 ? 1 : receipt.status === 0 ? 0 : null;
  if (sponsored) {
    return {
      gasUsd: 0,
      gasUsed,
      effectiveGasPriceWei,
      receiptStatus,
      provenance: ['gas:sponsored_zero_user_monetary_cost', 'receipt:gas_measured'],
    };
  }
  if (!receipt.gasUsed || !receipt.effectiveGasPrice) {
    return {
      gasUsd: null,
      gasUsed,
      effectiveGasPriceWei,
      receiptStatus,
      provenance: ['gas:receipt_cost_fields_incomplete'],
    };
  }

  const currency = SUPPORTED_CHAINS[chain].currency.toUpperCase();
  const prices = await coinGeckoPriceClient.getLiveSymbolPrices([currency]).catch(() => new Map<string, number>());
  const nativePriceUsd = prices.get(currency);
  if (!Number.isFinite(nativePriceUsd) || Number(nativePriceUsd) <= 0) {
    return {
      gasUsd: null,
      gasUsed,
      effectiveGasPriceWei,
      receiptStatus,
      provenance: ['gas:receipt_measured', 'gas:live_native_price_unavailable', 'static_price_fallback_forbidden'],
    };
  }

  const feeWei = receipt.gasUsed.mul(receipt.effectiveGasPrice);
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
    if (candidate.missingInformation.length > 0 || candidate.expiresAt <= Date.now()) {
      return {
        opportunityId: decision.opportunityId,
        topology: decision.topology,
        path: decision.path,
        dispatched: false,
        success: false,
        settlementConfirmed: false,
        error: 'DEX_ATOMIC_CURRENT_EVIDENCE_INCOMPLETE_OR_EXPIRED',
      };
    }
    const chain = asSupportedChain(candidate.chains[0]);
    if (!chain) {
      return {
        opportunityId: decision.opportunityId,
        topology: decision.topology,
        path: decision.path,
        dispatched: false,
        success: false,
        settlementConfirmed: false,
        error: 'DEX_ATOMIC_UNSUPPORTED_CHAIN',
      };
    }
    const expectedProfitUsd = Number(candidate.economics.deterministicNetProfitUsd);
    if (!Number.isFinite(expectedProfitUsd) || expectedProfitUsd <= 0) {
      return {
        opportunityId: decision.opportunityId,
        topology: decision.topology,
        path: decision.path,
        dispatched: false,
        success: false,
        settlementConfirmed: false,
        error: 'DEX_ATOMIC_DETERMINISTIC_NET_NOT_POSITIVE',
      };
    }

    const sponsored = getGasSponsorManager().getReadiness().ready;
    const lease = await zeroCapitalResourceScheduler.acquireMeasuredAtomic({
      opportunityId: candidate.opportunityId,
      chain,
      expiresAt: candidate.expiresAt,
      expectedNetProfitUsd: expectedProfitUsd,
      protocols: ['0x_allowance_holder', 'balancer_v2'],
      fundingMode: sponsored ? 'sponsored' : 'native',
    });
    if (!lease) {
      return {
        opportunityId: decision.opportunityId,
        topology: decision.topology,
        path: decision.path,
        dispatched: false,
        success: false,
        settlementConfirmed: false,
        error: 'DEX_ATOMIC_RESOURCE_LEASE_UNAVAILABLE',
      };
    }

    const governance = getCryptocrawlGovernance();
    const startedAt = Date.now();
    try {
      governance.requireAllowed('EXECUTE_OPPORTUNITY', { chain, venue: '0x' });
      governance.recordExecutionAttempt();
      const result = await executePreparedZeroXAtomicRoundTrip(decision.opportunityId);
      if (!result.success || !result.settlementConfirmed || !result.transactionHash || result.realizedProfitUsd === undefined) {
        return {
          opportunityId: decision.opportunityId,
          topology: decision.topology,
          path: decision.path,
          dispatched: true,
          success: false,
          settlementConfirmed: result.settlementConfirmed,
          transactionHash: result.transactionHash,
          error: result.error || 'DEX_ATOMIC_TERMINAL_SETTLEMENT_NOT_PROFIT_VERIFIED',
        };
      }

      const actualGas = await observeActualGas(chain, result.transactionHash, sponsored);
      if (actualGas.receiptStatus !== 1) {
        return {
          opportunityId: decision.opportunityId,
          topology: decision.topology,
          path: decision.path,
          dispatched: true,
          success: false,
          settlementConfirmed: false,
          transactionHash: result.transactionHash,
          error: 'DEX_ATOMIC_TERMINAL_RECEIPT_STATUS_NOT_SUCCESS',
        };
      }

      const eventProfitUsd = result.realizedProfitUsd;
      const realizedNetProfitUsd = actualGas.gasUsd === null ? null : eventProfitUsd - actualGas.gasUsd;
      const economicallySuccessful = realizedNetProfitUsd !== null && realizedNetProfitUsd > 0;
      const settledAt = Date.now();
      const predictedFeeUsd = [candidate.economics.feeUsd, candidate.economics.gasUsd]
        .map(value => Number(value))
        .filter(Number.isFinite)
        .reduce((sum, value) => sum + Math.max(0, value), 0);
      const notionalUsd = Number(candidate.economics.notionalUsd);
      const realizedNetProfitBps = realizedNetProfitUsd !== null && Number.isFinite(notionalUsd) && notionalUsd > 0
        ? realizedNetProfitUsd / notionalUsd * 10_000
        : null;

      measuredCandidateRegistry.updateStatus(candidate.opportunityId, candidate.status, {
        economics: { ...candidate.economics, realizedNetProfitBps },
        provenance: [
          'dex_atomic:terminal_receiver_profit_event',
          ...actualGas.provenance,
          `dex_atomic:tx:${result.transactionHash}`,
        ],
      });

      await recordCryptaraExecutionEvidence({
        source: 'flash_loan',
        opportunityId: candidate.opportunityId,
        chain,
        symbol: candidate.assets.join('/'),
        strategy: 'dex_0x_atomic_roundtrip',
        success: economicallySuccessful,
        expectedProfitUsd,
        realizedProfitUsd: realizedNetProfitUsd,
        feeUsd: actualGas.gasUsd,
        slippageBps: null,
        latencyMs: settledAt - startedAt,
        usedZeroCapital: true,
        timestamp: settledAt,
        notes: realizedNetProfitUsd === null
          ? 'Terminal transaction confirmed but all-in USD profit remains unknown because live native-gas pricing was unavailable'
          : economicallySuccessful
            ? undefined
            : 'Terminal transaction confirmed but realized all-in net profit was non-positive after actual gas',
        settlementStatus: 'filled',
        settlementConfirmed: true,
        provenance: [
          ...candidate.provenance,
          'dex_atomic:canonical_execution_scheduler_adapter',
          'dex_atomic:terminal_receiver_profit_event',
          ...actualGas.provenance,
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
            feeUsd: predictedFeeUsd,
            slippageBps: candidate.economics.expectedSlippageBps,
          },
          realized: {
            acquisitionCostUsd: null,
            proceedsUsd: null,
            exchangeFeeUsd: null,
            gasUsd: actualGas.gasUsd,
            gasUsed: actualGas.gasUsed,
            effectiveGasPriceWei: actualGas.effectiveGasPriceWei,
            slippageBps: null,
            netProfitUsd: realizedNetProfitUsd,
          },
          provenance: [
            '0x:v2_allowance_holder_firm_quotes',
            'balancer_v2:flash_fee_repaid_before_receiver_profit_event',
            'receiver:exact_pretrade_eth_call',
            'receiver:terminal_profit_event',
            ...actualGas.provenance,
            `transaction:${result.transactionHash}`,
            'synthetic_evidence:false',
          ],
          transactionHash: result.transactionHash,
          receiptStatus: 1,
        },
      });
      this.terminalApplied.add(decision.opportunityId);

      const dispatch: MeasuredTopologyDispatchResult = {
        opportunityId: decision.opportunityId,
        topology: decision.topology,
        path: decision.path,
        dispatched: true,
        success: economicallySuccessful,
        settlementConfirmed: true,
        transactionHash: result.transactionHash,
        realizedNetProfitUsd,
        error: realizedNetProfitUsd === null
          ? 'DEX_ATOMIC_REALIZED_ALL_IN_USD_UNKNOWN'
          : economicallySuccessful ? undefined : 'DEX_ATOMIC_REALIZED_ALL_IN_NET_NONPOSITIVE',
      };
      logger.info('[MeasuredTopologyExecution] DEX atomic canonical adapter completed', {
        component: 'MeasuredTopologyExecutionAdapter',
        opportunityId: decision.opportunityId,
        success: dispatch.success,
        settlementConfirmed: true,
        realizedNetProfitUsd,
        transactionHash: result.transactionHash,
        schedulingAuthority: 'CanonicalExecutionScheduler',
        syntheticEvidence: false,
      });
      return dispatch;
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
