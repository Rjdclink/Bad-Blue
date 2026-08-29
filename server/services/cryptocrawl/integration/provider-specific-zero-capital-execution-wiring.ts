import { BigNumber, ethers, type Wallet, type providers } from 'ethers';
import logger from '../../../logger.js';
import {
  zeroCapitalEngine,
  type ExecutionResult,
  type SupportedChain,
  type ZeroCapitalOpportunity,
} from '../core/zero-capital-engine.js';
import { buildFlashLoanExecutionPlanFromOpportunity } from '../execution/adapters/autonomous-route-planner.js';
import { buildFlashLoanReceiverPayloadFromPlan } from '../execution/adapters/flashloan-receiver-builder.js';
import { flashLoanProviderSelectionRegistry } from '../execution/adapters/flash-loan-provider-selection-registry.js';
import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';
import { getGasSponsorManager } from '../strategies/gas-sponsorship.js';

const installed = new WeakSet<object>();
const RECEIVER_EVENT = new ethers.utils.Interface([
  'event FlashLoanExecuted(address indexed initiator,address indexed loanToken,uint256 loanAmount,uint256 profit)',
]);

type ProviderSpecificRuntime = {
  providers: Map<SupportedChain, providers.JsonRpcProvider>;
  executionWallets: Map<SupportedChain, Wallet>;
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

async function executeProviderSpecific(input: {
  opportunity: ZeroCapitalOpportunity;
  funding: GasFundingDecision;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  receiver: string;
  providerKind: 'aave_v3';
}): Promise<ExecutionResult> {
  const startedAt = Date.now();
  try {
    const plan = buildFlashLoanExecutionPlanFromOpportunity(input.opportunity, {
      receiver: input.receiver,
      provider: input.providerKind,
      profitRecipient: process.env.CRYPTO_PROFIT_WALLET_ADDRESS || input.wallet.address,
      nowMs: Date.now(),
    });
    const payload = buildFlashLoanReceiverPayloadFromPlan(plan);
    let transactionHash: string;
    let receipt: providers.TransactionReceipt | null;
    let sponsoredExecution = false;

    if (input.funding.mode === 'sponsored') {
      const network = await input.provider.getNetwork();
      const sponsored = await getGasSponsorManager().execute({
        wallet: input.wallet,
        chainId: network.chainId,
        calls: [{ to: payload.to, data: payload.data, value: BigNumber.from(payload.value) }],
        timeoutMs: Math.max(10_000, Number(process.env.ZERO_CAPITAL_SPONSORED_TX_TIMEOUT_MS || 60_000)),
      });
      transactionHash = sponsored.transactionHash;
      receipt = await input.provider.getTransactionReceipt(transactionHash);
      if (!receipt) receipt = await input.provider.waitForTransaction(transactionHash, 1, 15_000);
      sponsoredExecution = true;
    } else if (input.funding.mode === 'native') {
      const transaction = await input.wallet.sendTransaction({
        to: payload.to,
        data: payload.data,
        value: BigNumber.from(payload.value),
      });
      transactionHash = transaction.hash;
      receipt = await transaction.wait(1);
    } else {
      return { success: false, error: input.funding.reason };
    }

    if (!receipt || receipt.status !== 1) {
      return { success: false, txHash: transactionHash, error: `${input.providerKind} receiver transaction was not confirmed successfully` };
    }
    const profit = extractProfit(receipt, input.receiver);
    if (profit === null || profit <= 0n) {
      return { success: false, txHash: transactionHash, error: `No positive verified FlashLoanExecuted profit was emitted by ${input.providerKind} receiver` };
    }

    const gasUsed = BigInt(receipt.gasUsed.toString());
    const effectiveGasPriceWei = receipt.effectiveGasPrice ? BigInt(receipt.effectiveGasPrice.toString()) : 0n;
    return {
      success: true,
      txHash: transactionHash,
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
}

export function ensureProviderSpecificZeroCapitalExecutionWiring(): void {
  const target = zeroCapitalEngine as unknown as ProviderSpecificRuntime;
  if (installed.has(target)) return;
  installed.add(target);

  const originalExecuteFunded = target.executeFunded.bind(target);
  target.executeFunded = async (opportunity, funding): Promise<ExecutionResult> => {
    const selection = flashLoanProviderSelectionRegistry.get(opportunity.id);
    if (!selection || selection.provider === 'balancer_v2') {
      return originalExecuteFunded(opportunity, funding);
    }
    if (selection.provider !== 'aave_v3') {
      return { success: false, error: `Unsupported selected flash-loan provider: ${selection.provider}` };
    }

    const provider = target.providers.get(opportunity.chain);
    const wallet = target.executionWallets.get(opportunity.chain);
    if (!provider || !wallet) return { success: false, error: `No provider/execution wallet for ${opportunity.chain}` };
    if (selection.expiresAt <= Date.now() || opportunity.expiresAt <= Date.now()) {
      return { success: false, error: 'Provider selection or opportunity expired before provider-specific execution' };
    }
    if (selection.receiverCapability.owner.toLowerCase() !== wallet.address.toLowerCase()) {
      return { success: false, error: 'Selected provider receiver owner no longer matches execution wallet' };
    }
    if (selection.receiverCapability.kind !== 'aave_v3') {
      return { success: false, error: 'Aave provider selection is not bound to a verified Aave V3 receiver capability' };
    }

    return executeProviderSpecific({
      opportunity,
      funding,
      provider,
      wallet,
      receiver: selection.receiver,
      providerKind: 'aave_v3',
    });
  };

  logger.info('[ZeroCapitalProviderExecution] Provider-specific execution wiring installed', {
    component: 'ProviderSpecificZeroCapitalExecutionWiring',
    balancerV2: 'delegates_to_existing_canonical_executor',
    aaveV3: 'provider_specific_receiver_payload_and_receipt_verification',
    providerSelectionAuthority: 'flash_loan_provider_selection_registry',
    syntheticExecution: false,
  });
}
