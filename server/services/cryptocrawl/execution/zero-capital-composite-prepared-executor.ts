import { BigNumber, Contract, ethers, type Wallet, type providers } from 'ethers';
import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';
import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { expectedExecutionGasPriceWei } from '../discovery/configured-zero-capital-gas-economics.js';
import { verifyFlashLoanReceiverCapability } from './adapters/flash-loan-receiver-capability.js';
import type { ZeroCapitalCompositePreparedSelection } from './zero-capital-composite-selection-registry.js';
import { executeSystemOwnedNativeTransaction } from './system-owned-native-transaction.js';

const ERC20_BALANCE_ABI = ['function balanceOf(address account) view returns (uint256)'];
const COMPOSITE_EVENT = new ethers.utils.Interface([
  'event FlashLoanExecuted(address indexed initiator,address indexed loanToken,uint256 loanAmount,uint256 profit)',
]);

export interface CompositePreparedRuntime {
  gasSponsor: {
    execute: (input: {
      wallet: Wallet;
      chainId: number;
      calls: Array<{ to: string; data: string; value?: BigNumber }>;
      timeoutMs: number;
    }) => Promise<{ transactionHash: string }>;
  };
}

export interface CompositePreparedExecutionFacts {
  selection: ZeroCapitalCompositePreparedSelection;
  transactionHash: string;
  receipt: providers.TransactionReceipt;
  grossProfit: bigint;
  recipientStarting: bigint;
  recipientEnding: bigint;
  receiverStarting: bigint;
  receiverEnding: bigint;
  nativeFeeWei: bigint;
  sponsoredExecution: boolean;
  sponsorOperatorMonetaryCostProvenZero: boolean;
  estimatedGasUnits: bigint;
}

export type CompositePreparedExecutionOutcome =
  | { ok: true; facts: CompositePreparedExecutionFacts }
  | {
      ok: false;
      reason: string;
      submitted: boolean;
      transactionHash?: string;
      receipt?: providers.TransactionReceipt | null;
    };

function fundingError(funding: GasFundingDecision): string | null {
  if (funding.mode === 'unavailable' || funding.strictZeroInitialCapitalEligible !== true || funding.operatorMonetaryInputRequired !== false) {
    return `Strict zero-capital gas funding is unavailable: ${funding.reason}`;
  }
  if (funding.mode === 'native' && funding.paymentSource !== 'system_owned_native') return 'Native gas is not proven system-owned';
  if (funding.mode === 'sponsored') {
    if (funding.paymentSource !== 'provider_sponsored') return 'Sponsored gas payment source is not canonical';
    if (funding.sponsorOperatorMonetaryCostProvenZero !== true || funding.providerBillingLiability === true) {
      return 'Sponsored gas is not independently proven zero-operator-cost';
    }
  }
  return null;
}

function parseProfit(receipt: providers.TransactionReceipt, receiver: string, selection: ZeroCapitalCompositePreparedSelection): bigint | null {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== receiver.toLowerCase()) continue;
    try {
      const parsed = COMPOSITE_EVENT.parseLog(log);
      if (parsed.name !== 'FlashLoanExecuted') continue;
      const loanToken = String(parsed.args.loanToken);
      const amount = BigInt(parsed.args.loanAmount.toString());
      const profit = BigInt(parsed.args.profit.toString());
      if (loanToken.toLowerCase() !== selection.asset.toLowerCase()) continue;
      if (amount !== selection.principal || profit <= 0n) continue;
      return profit;
    } catch {
      // Ignore unrelated receiver logs.
    }
  }
  return null;
}

/**
 * Executes one exact, target-bound shared-principal selection from inside the
 * canonical ZERO_CAPITAL_ATOMIC executor. It has no scheduling authority and
 * cannot weaken ordinary single-route admission. The composite receiver itself
 * atomically repays principal + provider fee and reverts unless its configured
 * residual is present; this helper additionally revalidates gas, payout delta and
 * receiver balance neutrality before reporting terminal economic facts.
 */
export async function executeCompositePreparedWithinCanonicalExecutor(input: {
  opportunity: ZeroCapitalOpportunity;
  selection: ZeroCapitalCompositePreparedSelection;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  profitRecipient: string;
  funding: GasFundingDecision;
  runtime: CompositePreparedRuntime;
}): Promise<CompositePreparedExecutionOutcome> {
  const { opportunity, selection, provider, wallet, profitRecipient, funding } = input;
  if (selection.expiresAt <= Date.now() || opportunity.expiresAt <= Date.now()) {
    return { ok: false, reason: 'Composite selection expired before canonical execution', submitted: false };
  }
  if (selection.opportunityId !== opportunity.id || selection.chain !== opportunity.chain) {
    return { ok: false, reason: 'Composite selection identity no longer matches opportunity', submitted: false };
  }
  if (selection.asset.toLowerCase() !== opportunity.inputToken.toLowerCase() || selection.principal !== opportunity.flashLoanAmount) {
    return { ok: false, reason: 'Composite asset/principal no longer matches the exact opportunity', submitted: false };
  }
  if (selection.expectedNetProfit !== opportunity.expectedProfit || selection.expectedNetProfit < selection.targetNetProfitBaseUnits) {
    return { ok: false, reason: 'Composite target economics are stale or below the required net target', submitted: false };
  }
  if (selection.prepared.to.toLowerCase() !== selection.receiver.toLowerCase() || selection.prepared.value !== '0') {
    return { ok: false, reason: 'Composite prepared transaction identity is invalid', submitted: false };
  }
  const fundingFailure = fundingError(funding);
  if (fundingFailure) return { ok: false, reason: fundingFailure, submitted: false };

  const capability = await verifyFlashLoanReceiverCapability({
    kind: 'balancer_composite_v2',
    chain: opportunity.chain,
    provider,
    expectedOwner: wallet.address,
    address: selection.receiver,
  }).catch(() => null);
  if (!capability) return { ok: false, reason: 'Composite receiver capability is no longer verified', submitted: false };

  const token = new Contract(selection.asset, ERC20_BALANCE_ABI, provider);
  const [recipientStartingRaw, receiverStartingRaw] = await Promise.all([
    token.balanceOf(profitRecipient),
    token.balanceOf(selection.receiver),
  ]);
  const recipientStarting = BigInt(recipientStartingRaw.toString());
  const receiverStarting = BigInt(receiverStartingRaw.toString());
  if (receiverStarting !== 0n) {
    return { ok: false, reason: 'Composite receiver has a pre-existing loan-token balance; profit attribution is not clean', submitted: false };
  }

  const request = {
    from: wallet.address,
    to: selection.prepared.to,
    data: selection.prepared.data,
    value: selection.prepared.value,
  };
  try {
    await provider.call(request);
  } catch (error) {
    return { ok: false, reason: `Composite exact pre-broadcast call failed: ${error instanceof Error ? error.message : String(error)}`, submitted: false };
  }

  let estimatedGasUnits: bigint;
  try {
    const estimate = await provider.estimateGas(request);
    estimatedGasUnits = BigInt(estimate.toString());
  } catch (error) {
    return { ok: false, reason: `Composite exact gas estimate failed: ${error instanceof Error ? error.message : String(error)}`, submitted: false };
  }
  if (estimatedGasUnits <= 0n || estimatedGasUnits > selection.estimatedGasUnits) {
    return { ok: false, reason: 'Composite gas requirement increased; fresh target economics are required before execution', submitted: false };
  }

  const validateNativeGas = async (): Promise<void> => {
    if (funding.mode !== 'native') return;
    if (selection.estimatedGasCostInInputToken <= 0n || selection.expectedGasPriceWei <= 0n) {
      throw new Error('Composite native gas economics are missing their measured gas-price binding');
    }
    const currentGasPriceWei = expectedExecutionGasPriceWei(await provider.getFeeData());
    if (currentGasPriceWei <= 0n || currentGasPriceWei > selection.expectedGasPriceWei) {
      throw new Error('Composite native gas price increased or is unavailable; fresh target economics are required');
    }
  };

  let transactionHash = '';
  let receipt: providers.TransactionReceipt | null = null;
  let nativeFeeWei = 0n;
  let sponsoredExecution = false;
  try {
    if (funding.mode === 'sponsored') {
      const network = await provider.getNetwork();
      const sponsored = await input.runtime.gasSponsor.execute({
        wallet,
        chainId: network.chainId,
        calls: [{ to: selection.prepared.to, data: selection.prepared.data, value: BigNumber.from(0) }],
        timeoutMs: Math.max(10_000, Number(process.env.ZERO_CAPITAL_SPONSORED_TX_TIMEOUT_MS || 60_000)),
      });
      transactionHash = sponsored.transactionHash;
      receipt = await provider.getTransactionReceipt(transactionHash);
      if (!receipt) receipt = await provider.waitForTransaction(transactionHash, 1, 15_000);
      sponsoredExecution = true;
      if (receipt?.effectiveGasPrice) nativeFeeWei = BigInt(receipt.gasUsed.toString()) * BigInt(receipt.effectiveGasPrice.toString());
    } else {
      const native = await executeSystemOwnedNativeTransaction({
        chain: opportunity.chain,
        wallet,
        provider,
        idempotencyKey: `zero-capital-composite:${opportunity.id}`,
        purpose: 'zero_capital_composite_execution',
        transaction: {
          to: selection.prepared.to,
          data: selection.prepared.data,
          value: BigNumber.from(0),
          gasLimit: BigNumber.from(estimatedGasUnits.toString()).mul(110).div(100),
        },
        confirmations: 1,
        preBroadcastCheck: validateNativeGas,
      });
      transactionHash = native.transactionHash;
      receipt = native.receipt;
      nativeFeeWei = native.actualSpentWei;
    }
  } catch (error) {
    return {
      ok: false,
      reason: `Composite canonical submission failed: ${error instanceof Error ? error.message : String(error)}`,
      submitted: Boolean(transactionHash),
      transactionHash: transactionHash || undefined,
      receipt,
    };
  }

  if (!receipt) return { ok: false, reason: 'Composite submission has no terminal receipt', submitted: true, transactionHash };
  if (receipt.status !== 1) return { ok: false, reason: 'Composite transaction reverted', submitted: true, transactionHash, receipt };

  const grossProfit = parseProfit(receipt, selection.receiver, selection);
  if (grossProfit === null) {
    return { ok: false, reason: 'Composite terminal receipt lacks matching repayment/profit evidence', submitted: true, transactionHash, receipt };
  }
  const requiredResidual = selection.targetNetProfitBaseUnits
    + selection.estimatedGasCostInInputToken
    + selection.relayFeeInInputToken;
  if (grossProfit < requiredResidual) {
    return { ok: false, reason: 'Composite terminal residual is below the target-bound all-in requirement', submitted: true, transactionHash, receipt };
  }

  const [recipientEndingRaw, receiverEndingRaw] = await Promise.all([
    token.balanceOf(profitRecipient),
    token.balanceOf(selection.receiver),
  ]);
  const recipientEnding = BigInt(recipientEndingRaw.toString());
  const receiverEnding = BigInt(receiverEndingRaw.toString());
  if (receiverEnding !== receiverStarting) {
    return { ok: false, reason: 'Composite receiver terminal balance is not neutral', submitted: true, transactionHash, receipt };
  }
  const recipientDelta = recipientEnding - recipientStarting;
  if (recipientDelta !== grossProfit) {
    return { ok: false, reason: `Composite payout delta disagrees with terminal event: event=${grossProfit} delta=${recipientDelta}`, submitted: true, transactionHash, receipt };
  }

  return {
    ok: true,
    facts: {
      selection,
      transactionHash,
      receipt,
      grossProfit,
      recipientStarting,
      recipientEnding,
      receiverStarting,
      receiverEnding,
      nativeFeeWei,
      sponsoredExecution,
      sponsorOperatorMonetaryCostProvenZero: sponsoredExecution && funding.sponsorOperatorMonetaryCostProvenZero === true,
      estimatedGasUnits,
    },
  };
}
