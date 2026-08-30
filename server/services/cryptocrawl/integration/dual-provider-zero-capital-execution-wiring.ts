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
import { buildDualFlashLoanReceiverPayload } from '../execution/adapters/dual-flashloan-receiver-builder.js';
import { dualFlashLoanProviderSelectionRegistry } from '../execution/adapters/dual-flash-loan-provider-selection-registry.js';
import type { NormalizedRealizedExecution } from '../execution/settlement-types.js';
import { getGasSponsorManager } from '../strategies/gas-sponsorship.js';

const installed = new WeakSet<object>();
const RECEIVER_EVENT = new ethers.utils.Interface([
  'event FlashLoanExecuted(address indexed initiator,address indexed loanToken,uint256 loanAmount,uint256 profit)',
]);

type DualProviderRuntime = {
  providers: Map<SupportedChain, providers.JsonRpcProvider>;
  executionWallets: Map<SupportedChain, Wallet>;
  executeFunded: (opportunity: ZeroCapitalOpportunity, funding: GasFundingDecision) => Promise<ExecutionResult>;
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
  sponsoredExecution: boolean;
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
    venueOrRoute: `aave_balancer_dual:${input.opportunity.route.map(step => step.protocol).join('->')}`,
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
      gasUsd: input.sponsoredExecution ? 0 : null,
      gasUsed: input.gasUsed.toString(),
      effectiveGasPriceWei: input.effectiveGasPriceWei.toString(),
      slippageBps: null,
      netProfitUsd: toUsd(input.profit, input.opportunity.inputTokenDecimals),
    },
    provenance: [
      'cryptara_live_intelligence',
      'computational_beam',
      'monte_carlo_profitability',
      'dynamic_attempt_barrier_exact_dual_payload',
      'balancer_outer_flash_loan',
      'aave_v3_nested_flash_loan',
      'same_asset_combined_principal',
      'both_provider_repayments_atomic',
      ...(input.sponsoredExecution
        ? ['alchemy_gas_manager', 'eip7702_smart_wallet', 'erc4337_user_operation']
        : ['native_wallet_gas']),
      'dual_flashloan_receiver_profit_verified',
      'synthetic_evidence:false',
    ],
    transactionHash: input.txHash,
    blockNumber: input.receipt.blockNumber,
    receiptStatus: 1,
  };
}

export function ensureDualProviderZeroCapitalExecutionWiring(): void {
  const target = zeroCapitalEngine as unknown as DualProviderRuntime;
  if (installed.has(target)) return;
  installed.add(target);

  const originalExecuteFunded = target.executeFunded.bind(target);
  target.executeFunded = async (opportunity, funding): Promise<ExecutionResult> => {
    const selection = dualFlashLoanProviderSelectionRegistry.get(opportunity.id);
    if (!selection) return originalExecuteFunded(opportunity, funding);

    const provider = target.providers.get(opportunity.chain);
    const wallet = target.executionWallets.get(opportunity.chain);
    if (!provider || !wallet) return { success: false, error: `No provider/execution wallet for ${opportunity.chain}` };
    if (selection.expiresAt <= Date.now() || opportunity.expiresAt <= Date.now()) {
      return { success: false, error: 'Dual-provider selection or opportunity expired before execution' };
    }
    if (selection.receiverCapability.owner.toLowerCase() !== wallet.address.toLowerCase()) {
      return { success: false, error: 'Dual-provider receiver owner no longer matches execution wallet' };
    }
    if (selection.balancerAmount + selection.aaveAmount !== opportunity.flashLoanAmount) {
      return { success: false, error: 'Dual-provider principal split no longer equals exact opportunity notional' };
    }

    const startedAt = Date.now();
    try {
      const basePlan = buildFlashLoanExecutionPlanFromOpportunity(opportunity, {
        receiver: selection.receiver,
        provider: 'balancer_v2',
        profitRecipient: process.env.CRYPTO_PROFIT_WALLET_ADDRESS || wallet.address,
        nowMs: Date.now(),
      });
      const payload = buildDualFlashLoanReceiverPayload({
        chain: basePlan.chain,
        receiver: selection.receiver,
        loanToken: basePlan.loanToken,
        balancerAmount: selection.balancerAmount.toString(),
        aaveAmount: selection.aaveAmount.toString(),
        minProfit: basePlan.minProfit,
        profitRecipient: basePlan.profitRecipient,
        steps: basePlan.steps,
        gasLimit: Math.max(1_800_000, basePlan.gasLimit || 0),
      });

      let transactionHash: string;
      let receipt: providers.TransactionReceipt | null;
      let sponsoredExecution = false;
      if (funding.mode === 'sponsored') {
        const network = await provider.getNetwork();
        const sponsored = await getGasSponsorManager().execute({
          wallet,
          chainId: network.chainId,
          calls: [{ to: payload.to, data: payload.data, value: BigNumber.from(payload.value) }],
          timeoutMs: Math.max(10_000, Number(process.env.ZERO_CAPITAL_SPONSORED_TX_TIMEOUT_MS || 60_000)),
        });
        transactionHash = sponsored.transactionHash;
        receipt = await provider.getTransactionReceipt(transactionHash);
        if (!receipt) receipt = await provider.waitForTransaction(transactionHash, 1, 15_000);
        sponsoredExecution = true;
      } else if (funding.mode === 'native') {
        const transaction = await wallet.sendTransaction({
          to: payload.to,
          data: payload.data,
          value: BigNumber.from(payload.value),
        });
        transactionHash = transaction.hash;
        receipt = await transaction.wait(1);
      } else {
        return { success: false, error: funding.reason };
      }

      if (!receipt || receipt.status !== 1) {
        return { success: false, txHash: transactionHash, error: 'Dual-provider receiver transaction was not confirmed successfully' };
      }
      const profit = extractProfit(receipt, selection.receiver);
      if (profit === null || profit <= 0n) {
        return { success: false, txHash: transactionHash, error: 'No positive verified FlashLoanExecuted profit was emitted by dual-provider receiver' };
      }

      const gasUsed = BigInt(receipt.gasUsed.toString());
      const effectiveGasPriceWei = receipt.effectiveGasPrice ? BigInt(receipt.effectiveGasPrice.toString()) : 0n;
      const normalized = normalizeSettlement({
        opportunity,
        txHash: transactionHash,
        receipt,
        profit,
        sponsoredExecution,
        gasUsed,
        effectiveGasPriceWei,
        startedAt,
      });
      return {
        success: true,
        txHash: transactionHash,
        normalized,
        profit,
        profitVerified: true,
        gasUsed,
        effectiveGasPriceWei,
        receiptStatus: 1,
        nativeFeeWei: sponsoredExecution ? 0n : gasUsed * effectiveGasPriceWei,
        zeroMonetaryGasVerified: sponsoredExecution,
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

  logger.info('[ZeroCapitalProviderMesh] Dual-provider execution wiring installed', {
    component: 'DualProviderZeroCapitalExecutionWiring',
    providerMesh: ['balancer_v2', 'aave_v3', 'aave_balancer_dual'],
    dualTopology: 'balancer_outer_aave_nested_same_asset',
    terminalProfitAuthority: 'FlashLoanExecuted_receipt_event',
    exactBarrierRequiredBeforeBroadcast: true,
    syntheticExecution: false,
  });
}
