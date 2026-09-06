import { BigNumber, ethers, type Wallet, type providers } from 'ethers';
import {
  bindSystemNativeGasSpendSubmission,
  getSystemNativeGasAuthority,
  quarantineSubmittedSystemNativeGasSpend,
  releaseUnsubmittedSystemNativeGasSpend,
  reserveSystemNativeGasSpend,
  settleSystemNativeGasSpend,
} from './system-native-gas-spend-authority.js';

export interface SystemOwnedNativeTransactionResult {
  transactionHash: string;
  receipt: providers.TransactionReceipt;
  reservedWei: bigint;
  actualSpentWei: bigint;
  scope: string;
}

function safeId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 240);
}

function preparedTransactionEnvelope(input: {
  signedTransaction: string;
  providerNetworkChainId: number;
}): {
  transactionHash: string;
  walletAddress: string;
  maximumWei: BigNumber;
  parsed: ethers.utils.Transaction;
} {
  const signedTransaction = input.signedTransaction.trim();
  if (!/^0x[0-9a-fA-F]+$/.test(signedTransaction)) {
    throw new Error('system-owned prepared transaction requires exact signed transaction bytes');
  }
  const parsed = ethers.utils.parseTransaction(signedTransaction);
  const walletAddress = String(parsed.from || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(walletAddress)) {
    throw new Error('system-owned prepared transaction has no recoverable signer');
  }
  if (parsed.chainId !== input.providerNetworkChainId) {
    throw new Error(`system-owned prepared transaction chain mismatch: signed=${parsed.chainId} provider=${input.providerNetworkChainId}`);
  }
  if (!parsed.gasLimit || parsed.nonce === undefined) {
    throw new Error('system-owned prepared transaction has no bounded gas limit and nonce');
  }
  const maxPrice = parsed.maxFeePerGas || parsed.gasPrice;
  if (!maxPrice || BigNumber.from(maxPrice).lte(0)) {
    throw new Error('system-owned prepared transaction has no bounded maximum gas price');
  }
  const maximumWei = BigNumber.from(parsed.gasLimit).mul(BigNumber.from(maxPrice));
  if (maximumWei.lte(0)) throw new Error('system-owned prepared transaction gas ceiling must be positive');
  return {
    transactionHash: ethers.utils.keccak256(signedTransaction).toLowerCase(),
    walletAddress,
    maximumWei,
    parsed,
  };
}

/**
 * Executes an already-signed exact transaction only after provenance-backed
 * CryptoCrawler-owned native gas is durably reserved and bound to its exact hash.
 * The idempotency key may therefore be reused by restart recovery for the same
 * signed transaction without creating a second gas commitment or second nonce.
 */
export async function executePreparedSystemOwnedNativeTransaction(input: {
  chain: string;
  provider: providers.JsonRpcProvider;
  idempotencyKey: string;
  purpose: string;
  signedTransaction: string;
  confirmations?: number;
}): Promise<SystemOwnedNativeTransactionResult> {
  const network = await input.provider.getNetwork();
  const envelope = preparedTransactionEnvelope({
    signedTransaction: input.signedTransaction,
    providerNetworkChainId: network.chainId,
  });
  const authority = await getSystemNativeGasAuthority({
    chain: input.chain,
    wallet: envelope.walletAddress,
    minimumWei: envelope.maximumWei.toString(),
  });
  if (!authority) {
    throw new Error('strict native execution rejected: no SELF_FUNDED provenance-backed gas capacity covers the signed transaction ceiling');
  }

  const reservation = await reserveSystemNativeGasSpend({
    idempotencyKey: safeId(input.idempotencyKey),
    scope: authority.scope,
    chain: input.chain,
    wallet: envelope.walletAddress,
    purpose: safeId(input.purpose),
    maximumWei: envelope.maximumWei.toString(),
  });
  if (!reservation) {
    throw new Error('strict native execution rejected: system-owned gas reservation lost the provenance/capacity race');
  }

  try {
    await bindSystemNativeGasSpendSubmission(reservation.spendId, envelope.transactionHash);
  } catch (error) {
    await releaseUnsubmittedSystemNativeGasSpend(reservation.spendId).catch(() => undefined);
    throw error;
  }

  try {
    try {
      await input.provider.sendTransaction(input.signedTransaction);
    } catch (error) {
      const observed = await input.provider.getTransaction(envelope.transactionHash).catch(() => null);
      if (!observed) {
        await quarantineSubmittedSystemNativeGasSpend(reservation.spendId, error);
        throw new Error(`system-owned native broadcast outcome is unknown for ${envelope.transactionHash}`);
      }
    }

    const receipt = await input.provider.waitForTransaction(
      envelope.transactionHash,
      Math.max(1, input.confirmations || 1),
      Math.max(10_000, Number(process.env.ZERO_CAPITAL_NATIVE_TX_TIMEOUT_MS || 60_000)),
    );
    if (!receipt) {
      await quarantineSubmittedSystemNativeGasSpend(reservation.spendId, 'receipt timeout');
      throw new Error(`system-owned native transaction ${envelope.transactionHash} has no terminal receipt`);
    }

    const effectiveGasPrice = receipt.effectiveGasPrice || envelope.parsed.gasPrice || envelope.parsed.maxFeePerGas;
    if (!effectiveGasPrice) {
      await quarantineSubmittedSystemNativeGasSpend(reservation.spendId, 'receipt missing effective gas price');
      throw new Error(`system-owned native transaction ${envelope.transactionHash} has no verifiable gas price`);
    }
    const actualSpent = receipt.gasUsed.mul(BigNumber.from(effectiveGasPrice));
    await settleSystemNativeGasSpend({
      spendId: reservation.spendId,
      transactionHash: envelope.transactionHash,
      actualSpentWei: actualSpent.toString(),
      evidence: {
        chainId: network.chainId,
        blockNumber: receipt.blockNumber,
        receiptStatus: receipt.status,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPriceWei: BigNumber.from(effectiveGasPrice).toString(),
        rawWalletBalanceAuthority: false,
        exactSignedTransactionRecovery: true,
      },
    });

    return {
      transactionHash: envelope.transactionHash,
      receipt,
      reservedWei: BigInt(envelope.maximumWei.toString()),
      actualSpentWei: BigInt(actualSpent.toString()),
      scope: authority.scope,
    };
  } catch (error) {
    // If settlement already succeeded this becomes a harmless no-op. Otherwise a
    // submitted reservation stays quarantined and cannot be double-spent.
    await quarantineSubmittedSystemNativeGasSpend(reservation.spendId, error).catch(() => undefined);
    throw error;
  }
}

/**
 * Populates and signs a transaction, then delegates the exact signed bytes to the
 * same provenance-backed authority used by restart-safe prepared transactions.
 */
export async function executeSystemOwnedNativeTransaction(input: {
  chain: string;
  wallet: Wallet;
  provider: providers.JsonRpcProvider;
  idempotencyKey: string;
  purpose: string;
  transaction: providers.TransactionRequest;
  confirmations?: number;
}): Promise<SystemOwnedNativeTransactionResult> {
  const wallet = input.wallet.connect(input.provider);
  const network = await input.provider.getNetwork();
  const populated = await wallet.populateTransaction({
    ...input.transaction,
    chainId: network.chainId,
  });
  if (!populated.gasLimit || populated.nonce === undefined) {
    throw new Error('system-owned native transaction could not establish a bounded gas limit and nonce');
  }
  const signedTransaction = await wallet.signTransaction(populated);
  return executePreparedSystemOwnedNativeTransaction({
    chain: input.chain,
    provider: input.provider,
    idempotencyKey: input.idempotencyKey,
    purpose: input.purpose,
    signedTransaction,
    confirmations: input.confirmations,
  });
}
