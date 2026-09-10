import { BigNumber, type Wallet, type providers } from 'ethers';

export interface ProfitFundedNativePayoutSubmission {
  transactionHash: string;
  result: Record<string, unknown>;
}

function asBigInt(value: unknown, label: string): bigint {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) throw new Error(label);
  return BigInt(raw);
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

/**
 * Send only newly realized Ghost native profit to the independent fallback wallet.
 * The transaction value plus its maximum signed gas envelope must fit entirely
 * inside acquiredProfitWei, so pre-existing/operator native balance is never used.
 */
export async function submitProfitFundedEthereumFallback(input: {
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  destination: string;
  acquiredProfitWei: bigint;
  sourceNativeBaselineWei: bigint;
  onSubmitted?: (transactionHash: string, result: Record<string, unknown>) => Promise<void>;
}): Promise<ProfitFundedNativePayoutSubmission> {
  if (input.acquiredProfitWei <= 0n) throw new Error('GHOST_WALLET_FALLBACK_PROFIT_MUST_BE_POSITIVE');
  const current = BigInt((await input.provider.getBalance(input.wallet.address)).toString());
  if (current < input.sourceNativeBaselineWei + input.acquiredProfitWei) {
    throw new Error('GHOST_WALLET_FALLBACK_NATIVE_PROFIT_NO_LONGER_AVAILABLE');
  }

  const destinationBalanceBefore = await input.provider.getBalance(input.destination);
  const feeData = await input.provider.getFeeData();
  const maxFee = feeData.maxFeePerGas?.gt(0)
    ? feeData.maxFeePerGas
    : feeData.gasPrice?.gt(0)
      ? feeData.gasPrice
      : null;
  if (!maxFee) throw new Error('GHOST_WALLET_FALLBACK_GAS_PRICE_UNAVAILABLE');

  const measuredGas = await input.provider.estimateGas({
    from: input.wallet.address,
    to: input.destination,
    value: BigNumber.from(1),
  });
  const gasLimit = measuredGas.mul(110).add(99).div(100);
  const maximumGasWei = gasLimit.mul(maxFee);
  const maximumGas = BigInt(maximumGasWei.toString());
  if (maximumGas >= input.acquiredProfitWei) {
    throw new Error('GHOST_WALLET_FALLBACK_PROFIT_TOO_SMALL_FOR_SELF_FUNDED_TRANSFER');
  }
  const transferValue = input.acquiredProfitWei - maximumGas;
  if (transferValue <= 0n) throw new Error('GHOST_WALLET_FALLBACK_TRANSFER_VALUE_NOT_POSITIVE');

  const request: providers.TransactionRequest = {
    to: input.destination,
    value: BigNumber.from(transferValue.toString()),
    gasLimit,
  };
  if (feeData.maxFeePerGas?.gt(0)) {
    request.maxFeePerGas = feeData.maxFeePerGas;
    if (feeData.maxPriorityFeePerGas?.gt(0)) request.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    request.type = 2;
  } else {
    request.gasPrice = feeData.gasPrice!;
  }

  const sent = await input.wallet.sendTransaction(request);
  const result: Record<string, unknown> = {
    phase: 'ethereum_profit_funded_fallback_submitted',
    destination: input.destination,
    destinationMode: 'fallback',
    acquiredProfitWei: input.acquiredProfitWei.toString(),
    sourceNativeBaselineWei: input.sourceNativeBaselineWei.toString(),
    destinationBalanceBeforeWei: destinationBalanceBefore.toString(),
    transferValueWei: transferValue.toString(),
    maximumGasWei: maximumGas.toString(),
    gasLimit: gasLimit.toString(),
    gasFundingAuthority: 'realized_ghost_profit_only',
    operatorMonetaryInputRequired: false,
  };
  if (input.onSubmitted) await input.onSubmitted(sent.hash, result);
  return { transactionHash: sent.hash, result };
}

export async function reconcileProfitFundedEthereumFallback(input: {
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  transactionHash: string;
  result: Record<string, unknown>;
}): Promise<{
  pending: boolean;
  blockNumber: number | null;
  destination: string;
  deliveredWei: bigint;
  result: Record<string, unknown>;
}> {
  if (!validHash(input.transactionHash)) throw new Error('GHOST_WALLET_FALLBACK_TRANSACTION_HASH_INVALID');
  const receipt = await input.provider.getTransactionReceipt(input.transactionHash);
  if (!receipt) {
    return {
      pending: true,
      blockNumber: null,
      destination: String(input.result.destination || ''),
      deliveredWei: 0n,
      result: input.result,
    };
  }
  if (receipt.status !== 1) throw new Error('GHOST_WALLET_FALLBACK_TRANSACTION_REVERTED');

  const transaction = await input.provider.getTransaction(input.transactionHash);
  if (!transaction) throw new Error('GHOST_WALLET_FALLBACK_TRANSACTION_UNAVAILABLE');
  const destination = String(input.result.destination || '');
  if (!destination || String(transaction.to || '').toLowerCase() !== destination.toLowerCase()) {
    throw new Error('GHOST_WALLET_FALLBACK_RECIPIENT_MISMATCH');
  }
  if (transaction.from.toLowerCase() !== input.wallet.address.toLowerCase()) {
    throw new Error('GHOST_WALLET_FALLBACK_SIGNER_MISMATCH');
  }
  const transferValue = asBigInt(input.result.transferValueWei, 'GHOST_WALLET_FALLBACK_TRANSFER_VALUE_INVALID');
  if (BigInt(transaction.value.toString()) !== transferValue || transferValue <= 0n) {
    throw new Error('GHOST_WALLET_FALLBACK_TRANSFER_VALUE_MISMATCH');
  }

  const destinationBefore = asBigInt(
    input.result.destinationBalanceBeforeWei,
    'GHOST_WALLET_FALLBACK_DESTINATION_BASELINE_INVALID',
  );
  const destinationAfter = BigInt((await input.provider.getBalance(destination)).toString());
  if (destinationAfter < destinationBefore + transferValue) {
    throw new Error('GHOST_WALLET_FALLBACK_RECIPIENT_BALANCE_DELTA_NOT_VERIFIED');
  }
  const sourceBaseline = asBigInt(
    input.result.sourceNativeBaselineWei,
    'GHOST_WALLET_FALLBACK_SOURCE_BASELINE_INVALID',
  );
  const sourceAfter = BigInt((await input.provider.getBalance(input.wallet.address)).toString());
  if (sourceAfter < sourceBaseline) {
    throw new Error('GHOST_WALLET_FALLBACK_SPENT_PREEXISTING_NATIVE');
  }

  const effectiveGasPrice = receipt.effectiveGasPrice || transaction.gasPrice || transaction.maxFeePerGas;
  const actualGasWei = effectiveGasPrice
    ? BigInt(receipt.gasUsed.mul(effectiveGasPrice).toString())
    : 0n;
  const acquiredProfit = asBigInt(input.result.acquiredProfitWei, 'GHOST_WALLET_FALLBACK_ACQUIRED_PROFIT_INVALID');
  if (transferValue + actualGasWei > acquiredProfit) {
    throw new Error('GHOST_WALLET_FALLBACK_COST_EXCEEDED_REALIZED_PROFIT');
  }

  return {
    pending: false,
    blockNumber: receipt.blockNumber ?? null,
    destination,
    deliveredWei: transferValue,
    result: {
      ...input.result,
      phase: 'native_eth_delivered',
      payoutTerminallyVerified: true,
      payoutTransactionHash: input.transactionHash,
      deliveredEthWei: transferValue.toString(),
      actualGasWei: actualGasWei.toString(),
      operatorMonetaryInputRequired: false,
    },
  };
}
