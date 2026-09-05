import { BigNumber, ethers, type Wallet, type providers } from 'ethers';
import {
  zeroCapitalEngine,
  type ExecutionResult,
  type SupportedChain,
  type ZeroCapitalOpportunity,
} from '../core/zero-capital-engine.js';
import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';
import { buildFlashLoanExecutionPlanFromOpportunity } from '../execution/adapters/autonomous-route-planner.js';
import { buildFlashLoanReceiverPayloadFromPlan } from '../execution/adapters/flashloan-receiver-builder.js';
import { dualFlashLoanProviderSelectionRegistry } from '../execution/adapters/dual-flash-loan-provider-selection-registry.js';
import { flashLoanProviderSelectionRegistry } from '../execution/adapters/flash-loan-provider-selection-registry.js';
import { executeSystemOwnedNativeTransaction } from '../execution/system-owned-native-transaction.js';

const installed = new WeakSet<object>();
const RECEIVER_EVENT = new ethers.utils.Interface([
  'event FlashLoanExecuted(address indexed initiator,address indexed loanToken,uint256 loanAmount,uint256 profit)',
]);

type Runtime = {
  providers: Map<SupportedChain, providers.JsonRpcProvider>;
  executionWallets: Map<SupportedChain, Wallet>;
  receiverManager: { getReceiver(chain: string): string | null };
  executeFunded: (opportunity: ZeroCapitalOpportunity, funding: GasFundingDecision) => Promise<ExecutionResult>;
};

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

/**
 * Replaces only the legacy Balancer native-wallet branch. Provider-specific and
 * dual-provider selections are left for their own exact payload executors. The
 * sponsored path is also delegated unchanged; strict funding selection remains
 * responsible for refusing operator-billed sponsorship.
 */
export function ensureSystemOwnedNativeZeroCapitalExecutionWiring(): void {
  const target = zeroCapitalEngine as unknown as Runtime;
  if (installed.has(target)) return;
  installed.add(target);
  const delegate = target.executeFunded.bind(target);

  target.executeFunded = async (opportunity, funding): Promise<ExecutionResult> => {
    if (funding.mode !== 'native') return delegate(opportunity, funding);
    if (dualFlashLoanProviderSelectionRegistry.get(opportunity.id)) return delegate(opportunity, funding);
    const single = flashLoanProviderSelectionRegistry.get(opportunity.id);
    if (single && single.provider !== 'balancer_v2') return delegate(opportunity, funding);

    if (
      funding.paymentSource !== 'system_owned_native' ||
      funding.strictZeroInitialCapitalEligible !== true ||
      funding.operatorMonetaryInputRequired !== false
    ) {
      return { success: false, error: 'Strict zero-capital Balancer execution rejected native gas without durable system ownership proof' };
    }

    const provider = target.providers.get(opportunity.chain);
    const wallet = target.executionWallets.get(opportunity.chain);
    const receiver = target.receiverManager.getReceiver(opportunity.chain);
    if (!provider || !wallet || !receiver) {
      return { success: false, error: `No execution wallet/provider/receiver for ${opportunity.chain}` };
    }

    const startedAt = Date.now();
    try {
      const plan = buildFlashLoanExecutionPlanFromOpportunity(opportunity, {
        receiver,
        provider: 'balancer_v2',
        profitRecipient: process.env.CRYPTO_PROFIT_WALLET_ADDRESS || wallet.address,
        nowMs: Date.now(),
      });
      const payload = buildFlashLoanReceiverPayloadFromPlan(plan);
      const systemTransaction = await executeSystemOwnedNativeTransaction({
        chain: opportunity.chain,
        wallet,
        provider,
        idempotencyKey: `zero-capital:${opportunity.id}:balancer-v2`,
        purpose: 'zero_capital_balancer_v2_flash_execution',
        transaction: {
          to: payload.to,
          data: payload.data,
          value: BigNumber.from(payload.value),
        },
        confirmations: 1,
      });
      const receipt = systemTransaction.receipt;
      if (receipt.status !== 1) {
        return { success: false, txHash: systemTransaction.transactionHash, receiptStatus: 0, error: 'Balancer receiver transaction reverted' };
      }
      const profit = extractProfit(receipt, receiver);
      if (profit === null || profit <= 0n) {
        return { success: false, txHash: systemTransaction.transactionHash, receiptStatus: 1, error: 'No positive verified FlashLoanExecuted profit was emitted' };
      }
      const gasUsed = BigInt(receipt.gasUsed.toString());
      const effectiveGasPriceWei = receipt.effectiveGasPrice ? BigInt(receipt.effectiveGasPrice.toString()) : 0n;
      return {
        success: true,
        txHash: systemTransaction.transactionHash,
        profit,
        profitVerified: true,
        gasUsed,
        effectiveGasPriceWei,
        receiptStatus: 1,
        nativeFeeWei: systemTransaction.actualSpentWei,
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
}