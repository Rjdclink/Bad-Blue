import { BigNumber, Contract, ethers, type Wallet, type providers } from 'ethers';
import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';
import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import type { GhostWalletAlternativeZeroCapitalSelection } from '../ghost-wallet/zero-capital-alternative-selection-registry.js';
import { executeSystemOwnedNativeTransaction } from './system-owned-native-transaction.js';

const INTERMEDIARY_IDENTITY_ABI = ['function profitRecipient() view returns (address)'];
const ERC20_BALANCE_ABI = ['function balanceOf(address account) view returns (uint256)'];
const ALTERNATIVE_EVENTS = new ethers.utils.Interface([
  'event AtomicLiabilityCycleSettled(address indexed liabilityOracle,bytes32 indexed liabilityQueryHash,address indexed profitAsset,uint256 startingLiability,uint256 endingLiability,uint256 realizedProfit,address profitRecipient)',
  'event VaultCreditSettled(address indexed vault,address indexed asset,uint256 principal,uint256 sourceFee,uint256 realizedProfit,address indexed profitRecipient)',
]);

export interface AlternativePreparedRuntime {
  gasSponsor: {
    execute: (input: {
      wallet: Wallet;
      chainId: number;
      calls: Array<{ to: string; data: string; value?: BigNumber }>;
      timeoutMs: number;
    }) => Promise<{ transactionHash: string }>;
  };
}

export interface AlternativePreparedExecutionFacts {
  selection: GhostWalletAlternativeZeroCapitalSelection;
  transactionHash: string;
  receipt: providers.TransactionReceipt;
  grossProfit: bigint;
  recipientStarting: bigint;
  recipientEnding: bigint;
  intermediaryStarting: bigint;
  intermediaryEnding: bigint;
  nativeFeeWei: bigint;
  sponsoredExecution: boolean;
  sponsorOperatorMonetaryCostProvenZero: boolean;
  estimatedGasUnits: bigint;
}

export type AlternativePreparedExecutionOutcome =
  | { ok: true; facts: AlternativePreparedExecutionFacts }
  | {
      ok: false;
      reason: string;
      submitted: boolean;
      transactionHash?: string;
      receipt?: providers.TransactionReceipt | null;
    };

function validateFunding(funding: GasFundingDecision): string | null {
  if (funding.mode === 'unavailable' || funding.strictZeroInitialCapitalEligible !== true || funding.operatorMonetaryInputRequired !== false) {
    return `Strict zero-capital gas funding is unavailable: ${funding.reason}`;
  }
  if (funding.mode === 'native' && funding.paymentSource !== 'system_owned_native') {
    return 'Native gas is not proven system-owned';
  }
  if (funding.mode === 'sponsored' && funding.paymentSource !== 'provider_sponsored') {
    return 'Sponsored gas payment source is not canonical';
  }
  return null;
}

function parseAlternativeProfit(input: {
  selection: GhostWalletAlternativeZeroCapitalSelection;
  receipt: providers.TransactionReceipt;
  profitRecipient: string;
}): bigint | null {
  const { selection, receipt, profitRecipient } = input;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== selection.intermediary.toLowerCase()) continue;
    try {
      const parsed = ALTERNATIVE_EVENTS.parseLog(log);
      if (selection.source === 'aave_credit_delegation' && parsed.name === 'AtomicLiabilityCycleSettled') {
        const profitAsset = String(parsed.args.profitAsset);
        const recipient = String(parsed.args.profitRecipient);
        const startingLiability = BigInt(parsed.args.startingLiability.toString());
        const endingLiability = BigInt(parsed.args.endingLiability.toString());
        const realizedProfit = BigInt(parsed.args.realizedProfit.toString());
        if (profitAsset.toLowerCase() !== selection.asset.toLowerCase()) continue;
        if (recipient.toLowerCase() !== profitRecipient.toLowerCase()) continue;
        if (endingLiability > startingLiability || realizedProfit <= 0n) continue;
        return realizedProfit;
      }
      if (selection.source === 'permissionless_vault_capital' && parsed.name === 'VaultCreditSettled') {
        const asset = String(parsed.args.asset);
        const recipient = String(parsed.args.profitRecipient);
        const principal = BigInt(parsed.args.principal.toString());
        const sourceFee = BigInt(parsed.args.sourceFee.toString());
        const realizedProfit = BigInt(parsed.args.realizedProfit.toString());
        if (asset.toLowerCase() !== selection.asset.toLowerCase()) continue;
        if (recipient.toLowerCase() !== profitRecipient.toLowerCase()) continue;
        if (principal !== selection.principal || sourceFee !== selection.sourceFee || realizedProfit <= 0n) continue;
        return realizedProfit;
      }
    } catch {
      // Ignore unrelated intermediary logs.
    }
  }
  return null;
}

/**
 * Executes one already-measured alternative-capital selection from inside the sole
 * canonical ZERO_CAPITAL_ATOMIC executor. This helper has no scheduling authority.
 * It revalidates identity, economics binding, exact call/gas, terminal source-specific
 * repayment evidence, intermediary balance neutrality, and payout-wallet delta.
 */
export async function executeAlternativePreparedWithinCanonicalExecutor(input: {
  opportunity: ZeroCapitalOpportunity;
  selection: GhostWalletAlternativeZeroCapitalSelection;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  profitRecipient: string;
  funding: GasFundingDecision;
  runtime: AlternativePreparedRuntime;
}): Promise<AlternativePreparedExecutionOutcome> {
  const { opportunity, selection, provider, wallet, profitRecipient, funding } = input;
  if (selection.expiresAt <= Date.now() || opportunity.expiresAt <= Date.now()) {
    return { ok: false, reason: 'Alternative-capital selection expired before canonical execution', submitted: false };
  }
  if (selection.opportunityId !== opportunity.id || selection.chain !== opportunity.chain) {
    return { ok: false, reason: 'Alternative-capital selection identity no longer matches opportunity', submitted: false };
  }
  if (selection.asset.toLowerCase() !== opportunity.inputToken.toLowerCase()) {
    return { ok: false, reason: 'Alternative-capital asset no longer matches opportunity input token', submitted: false };
  }
  if (selection.principal !== opportunity.flashLoanAmount) {
    return { ok: false, reason: 'Alternative-capital principal no longer matches exact opportunity notional', submitted: false };
  }
  if (selection.expectedNetProfit !== opportunity.expectedProfit || selection.expectedNetProfit <= 0n) {
    return { ok: false, reason: 'Alternative-capital economics are stale or non-positive', submitted: false };
  }
  if (selection.prepared.to.toLowerCase() !== selection.intermediary.toLowerCase() || selection.prepared.value !== '0') {
    return { ok: false, reason: 'Alternative-capital prepared transaction identity is invalid', submitted: false };
  }

  const fundingError = validateFunding(funding);
  if (fundingError) return { ok: false, reason: fundingError, submitted: false };

  const code = await provider.getCode(selection.intermediary);
  if (code === '0x') return { ok: false, reason: 'Alternative-capital intermediary is not deployed', submitted: false };
  const intermediary = new Contract(selection.intermediary, INTERMEDIARY_IDENTITY_ABI, provider);
  const boundProfitRecipient = ethers.utils.getAddress(String(await intermediary.profitRecipient()));
  if (boundProfitRecipient.toLowerCase() !== profitRecipient.toLowerCase()) {
    return { ok: false, reason: 'Alternative-capital intermediary payout binding changed', submitted: false };
  }

  const token = new Contract(selection.asset, ERC20_BALANCE_ABI, provider);
  const [recipientStartingRaw, intermediaryStartingRaw] = await Promise.all([
    token.balanceOf(profitRecipient),
    token.balanceOf(selection.intermediary),
  ]);
  const recipientStarting = BigInt(recipientStartingRaw.toString());
  const intermediaryStarting = BigInt(intermediaryStartingRaw.toString());

  const request = {
    from: wallet.address,
    to: selection.prepared.to,
    data: selection.prepared.data,
    value: selection.prepared.value,
  };
  try {
    await provider.call(request);
  } catch (error) {
    return {
      ok: false,
      reason: `Alternative-capital exact pre-broadcast call failed: ${error instanceof Error ? error.message : String(error)}`,
      submitted: false,
    };
  }

  let estimatedGasUnits: bigint;
  try {
    const estimate = await provider.estimateGas(request);
    estimatedGasUnits = BigInt(estimate.toString());
  } catch (error) {
    return {
      ok: false,
      reason: `Alternative-capital exact gas estimate failed: ${error instanceof Error ? error.message : String(error)}`,
      submitted: false,
    };
  }
  if (estimatedGasUnits <= 0n) {
    return { ok: false, reason: 'Alternative-capital exact gas estimate is zero', submitted: false };
  }
  // Any gas-unit increase invalidates the previously measured all-in economics.
  // Repricing on the next discovery cycle is safer than spending against stale cost.
  if (estimatedGasUnits > selection.estimatedGasUnits) {
    return { ok: false, reason: 'Alternative-capital gas requirement increased; reprice before execution', submitted: false };
  }

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
        calls: [{
          to: selection.prepared.to,
          data: selection.prepared.data,
          value: BigNumber.from(selection.prepared.value),
        }],
        timeoutMs: Math.max(10_000, Number(process.env.ZERO_CAPITAL_SPONSORED_TX_TIMEOUT_MS || 60_000)),
      });
      transactionHash = sponsored.transactionHash;
      receipt = await provider.getTransactionReceipt(transactionHash);
      if (!receipt) receipt = await provider.waitForTransaction(transactionHash, 1, 15_000);
      sponsoredExecution = true;
      if (receipt?.effectiveGasPrice) {
        nativeFeeWei = BigInt(receipt.gasUsed.toString()) * BigInt(receipt.effectiveGasPrice.toString());
      }
    } else {
      const native = await executeSystemOwnedNativeTransaction({
        chain: opportunity.chain,
        wallet,
        provider,
        idempotencyKey: `zero-capital-alternative:${opportunity.id}:${selection.source}`,
        purpose: `zero_capital_${selection.source}_execution`,
        transaction: {
          to: selection.prepared.to,
          data: selection.prepared.data,
          value: BigNumber.from(selection.prepared.value),
          gasLimit: BigNumber.from(estimatedGasUnits.toString()).mul(110).div(100),
        },
        confirmations: 1,
      });
      transactionHash = native.transactionHash;
      receipt = native.receipt;
      nativeFeeWei = native.actualSpentWei;
    }
  } catch (error) {
    return {
      ok: false,
      reason: `Alternative-capital canonical submission failed: ${error instanceof Error ? error.message : String(error)}`,
      submitted: Boolean(transactionHash),
      transactionHash: transactionHash || undefined,
      receipt,
    };
  }

  if (!receipt) {
    return { ok: false, reason: 'Alternative-capital submission has no terminal receipt', submitted: true, transactionHash };
  }
  if (receipt.status !== 1) {
    return { ok: false, reason: 'Alternative-capital transaction reverted', submitted: true, transactionHash, receipt };
  }

  const grossProfit = parseAlternativeProfit({ selection, receipt, profitRecipient });
  if (grossProfit === null || grossProfit <= 0n) {
    return {
      ok: false,
      reason: 'Alternative-capital terminal receipt lacks matching positive repayment/profit evidence',
      submitted: true,
      transactionHash,
      receipt,
    };
  }

  const [recipientEndingRaw, intermediaryEndingRaw] = await Promise.all([
    token.balanceOf(profitRecipient),
    token.balanceOf(selection.intermediary),
  ]);
  const recipientEnding = BigInt(recipientEndingRaw.toString());
  const intermediaryEnding = BigInt(intermediaryEndingRaw.toString());
  if (intermediaryEnding !== intermediaryStarting) {
    return {
      ok: false,
      reason: `Alternative-capital intermediary terminal balance changed: before=${intermediaryStarting} after=${intermediaryEnding}`,
      submitted: true,
      transactionHash,
      receipt,
    };
  }
  const recipientDelta = recipientEnding - recipientStarting;
  if (recipientDelta !== grossProfit) {
    return {
      ok: false,
      reason: `Alternative-capital payout delta disagrees with terminal event: event=${grossProfit} delta=${recipientDelta}`,
      submitted: true,
      transactionHash,
      receipt,
    };
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
      intermediaryStarting,
      intermediaryEnding,
      nativeFeeWei,
      sponsoredExecution,
      sponsorOperatorMonetaryCostProvenZero:
        sponsoredExecution && funding.sponsorOperatorMonetaryCostProvenZero === true,
      estimatedGasUnits,
    },
  };
}
