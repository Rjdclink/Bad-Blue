import { BigNumber, ethers, type Wallet, type providers } from 'ethers';
import logger from '../../../logger.js';
import {
  zeroCapitalEngine,
  type ExecutionResult,
  type SupportedChain,
  type ZeroCapitalOpportunity,
} from '../core/zero-capital-engine.js';
import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';
import { buildFlashLoanExecutionPlanFromOpportunity } from '../execution/adapters/autonomous-route-planner.js';
import { buildFlashLoanReceiverPayloadFromPlan } from '../execution/adapters/flashloan-receiver-builder.js';
import { dualFlashLoanProviderSelectionRegistry } from '../execution/adapters/dual-flashloan-receiver-builder.js';
import { flashLoanProviderSelectionRegistry } from '../execution/adapters/flash-loan-provider-selection-registry.js';
import type { NormalizedRealizedExecution } from '../execution/settlement-types.js';

const installed = new WeakSet<object>();
const RECEIVER_EVENT = new ethers.utils.Interface([
  'event FlashLoanExecuted(address indexed initiator,address indexed loanToken,uint256 loanAmount,uint256 profit)',
]);

type BalancerRuntime = {
  providers: Map<SupportedChain, providers.JsonRpcProvider>;
  executionWallets: Map<SupportedChain, Wallet>;
  receiverManager: { getReceiver: (chain: string) => string | null };
  executeFunded: (opportunity: ZeroCapitalOpportunity, funding: GasFundingDecision & Record<string, unknown>) => Promise<ExecutionResult>;
};

function toUsd(value: bigint | undefined, decimals: number): number | null {
  if (value === undefined) return null;
  const scale = 10 ** Math.max(0, Math.min(18, decimals));
  const converted = Number(value) / scale;
  return Number.isFinite(converted) ? converted : null;
}

function extractProfit(receipt: providers.TransactionReceipt, receiver: string): bigint | null {
  for (const entry of receipt.logs) {
    if (entry.address.toLowerCase() !== receiver.toLowerCase()) continue;
    try {
      const parsed = RECEIVER_EVENT.parseLog(entry);
      if (parsed.name === 'FlashLoanExecuted') return BigInt(parsed.args.profit.toString());
    } catch {
      // Ignore unrelated receiver logs.
    }
  }
  return null;
}

function normalizeSettlement(input: {
  opportunity: ZeroCapitalOpportunity;
  txHash: string;
  receipt: providers.TransactionReceipt;
  profit: bigint;
  gasUsed: bigint;
  effectiveGasPriceWei: bigint;
  startedAt: number;
}): NormalizedRealizedExecution {
  return {
    status: 'filled',
    terminal: true,
    settlementConfirmed: true,
    submittedAt: input.startedAt,
    settledAt: Date.now(),
    venueOrRoute: `balancer_v2:${input.opportunity.route.map(step => step.protocol).join('->')}`,
    chain: input.opportunity.chain,
    predicted: {
      profitUsd: toUsd(input.opportunity.expectedProfit, input.opportunity.inputTokenDecimals),
      feeUsd: toUsd(input.opportunity.estimatedExecutionCostInInputToken, input.opportunity.inputTokenDecimals),
      slippageBps: input.opportunity.expectedSlippageBps,
    },
    realized: {
      acquisitionCostUsd: null,
      proceedsUsd: null,
      exchangeFeeUsd: null,
      gasUsd: null,
      gasUsed: input.gasUsed.toString(),
      effectiveGasPriceWei: input.effectiveGasPriceWei.toString(),
      slippageBps: null,
      netProfitUsd: toUsd(input.profit, input.opportunity.inputTokenDecimals),
    },
    provenance: [
      'cryptara_live_intelligence',
      'computational_beam',
      'monte_carlo_profitability',
      'balancer_v2_flash_loan',
      'verified_balancer_receiver',
      'flashloan_receiver_profit_verified',
      'system_native_gas_provenance_required_upstream',
      'profit_recipient_operational_wallet_before_rainbow',
      'synthetic_evidence:false',
    ],
    transactionHash: input.txHash,
    blockNumber: input.receipt.blockNumber,
    receiptStatus: 1,
  };
}

/**
 * Surgical override for the SELF_FUNDED native-gas Balancer lane only.
 *
 * The historical base executor can route receiver profit directly to the payout
 * wallet. That is incompatible with the canonical terminal treasury boundary,
 * which must first verify the operational-wallet token delta and only then let
 * Rainbow split payout versus retained capital. Aave and dual-provider variants
 * already have provider-specific operational-recipient wiring, so they delegate.
 */
export function ensureBalancerOperationalProfitRecipientWiring(): void {
  const runtime = zeroCapitalEngine as unknown as BalancerRuntime;
  if (installed.has(runtime)) return;
  installed.add(runtime);

  const delegate = runtime.executeFunded.bind(runtime);
  runtime.executeFunded = async (opportunity, funding): Promise<ExecutionResult> => {
    const dual = dualFlashLoanProviderSelectionRegistry.get(opportunity.id);
    const single = dual ? null : flashLoanProviderSelectionRegistry.get(opportunity.id);
    const isSystemNative = funding.mode === 'native' && (funding as any).operatorNativeGasInputRequired === false;
    if (!isSystemNative || dual || single?.provider === 'aave_v3') {
      return delegate(opportunity, funding);
    }

    const provider = runtime.providers.get(opportunity.chain);
    const wallet = runtime.executionWallets.get(opportunity.chain);
    const receiver = runtime.receiverManager.getReceiver(opportunity.chain);
    if (!provider || !wallet || !receiver) {
      return { success: false, error: `No provider/execution wallet/Balancer receiver for ${opportunity.chain}` };
    }
    if (Date.now() >= opportunity.expiresAt) return { success: false, error: 'Opportunity expired before self-funded Balancer execution' };

    const startedAt = Date.now();
    try {
      const plan = buildFlashLoanExecutionPlanFromOpportunity(opportunity, {
        receiver,
        provider: 'balancer_v2',
        profitRecipient: wallet.address,
        nowMs: Date.now(),
      });
      const payload = buildFlashLoanReceiverPayloadFromPlan(plan);
      const transaction = await wallet.sendTransaction({
        to: payload.to,
        data: payload.data,
        value: BigNumber.from(payload.value),
      });
      const receipt = await transaction.wait(1);
      if (!receipt || receipt.status !== 1) {
        return { success: false, txHash: transaction.hash, error: 'Self-funded Balancer receiver transaction was not confirmed successfully' };
      }
      const profit = extractProfit(receipt, receiver);
      if (profit === null || profit <= 0n) {
        return { success: false, txHash: transaction.hash, receiptStatus: 1, error: 'No positive verified FlashLoanExecuted profit was emitted by Balancer receiver' };
      }

      const gasUsed = BigInt(receipt.gasUsed.toString());
      const effectiveGasPriceWei = receipt.effectiveGasPrice ? BigInt(receipt.effectiveGasPrice.toString()) : 0n;
      return {
        success: true,
        txHash: transaction.hash,
        normalized: normalizeSettlement({ opportunity, txHash: transaction.hash, receipt, profit, gasUsed, effectiveGasPriceWei, startedAt }),
        profit,
        profitVerified: true,
        gasUsed,
        effectiveGasPriceWei,
        receiptStatus: 1,
        nativeFeeWei: gasUsed * effectiveGasPriceWei,
        zeroMonetaryGasVerified: false,
        latencyMs: Date.now() - startedAt,
        blockNumber: receipt.blockNumber,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startedAt,
      };
    }
  };

  logger.info('[ZeroInitialCapital] Self-funded Balancer profit-recipient guard installed', {
    component: 'BalancerOperationalProfitRecipientWiring',
    scope: 'proven_system_native_balancer_only',
    profitRecipient: 'operational_wallet_before_rainbow',
    ordinaryNativeWalletGasAuthority: false,
    executionAuthority: 'delegated_existing_zero_capital_engine_only',
  });
}
