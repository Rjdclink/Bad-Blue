import { BigNumber, ethers, type Wallet, type providers } from 'ethers';
import {
  bindSystemNativeGasSpendSubmission,
  getSystemNativeGasAuthority,
  quarantineSubmittedSystemNativeGasSpend,
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

/**
 * Signs first, durably reserves system-owned gas, binds the exact signed hash,
 * then broadcasts. Once a hash is bound, any ambiguous result is quarantined;
 * the reservation is never silently returned to the spendable pool.
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
  const walletAddress = wallet.address.toLowerCase();
  const network = await input.provider.getNetwork();
  const populated = await wallet.populateTransaction({
    ...input.transaction,
    chainId: network.chainId,
  });
  if (!populated.gasLimit || populated.nonce === undefined) {
    throw new Error('system-owned native transaction could not establish a bounded gas limit and nonce');
  }

  const maxPrice = populated.maxFeePerGas || populated.gasPrice;
  if (!maxPrice || BigNumber.from(maxPrice).lte(0)) {
    throw new Error('system-owned native transaction could not establish a bounded maximum gas price');
  }
  const maximumWei = BigNumber.from(populated.gasLimit).mul(BigNumber.from(maxPrice));
  if (maximumWei.lte(0)) throw new Error('system-owned native transaction gas ceiling must be positive');

  const authority = await getSystemNativeGasAuthority({
    chain: input.chain,
    wallet: walletAddress,
    minimumWei: maximumWei.toString(),
  });
  if (!authority) {
    throw new Error('strict native execution rejected: no SELF_FUNDED provenance-backed gas capacity covers the signed transaction ceiling');
  }

  const signedTransaction = await wallet.signTransaction(populated);
  const transactionHash = ethers.utils.keccak256(signedTransaction).toLowerCase();
  const reservation = await reserveSystemNativeGasSpend({
    idempotencyKey: safeId(input.idempotencyKey),
    scope: authority.scope,
    chain: input.chain,
    wallet: walletAddress,
    purpose: safeId(input.purpose),
    maximumWei: maximumWei.toString(),
  });
  if (!reservation) {
    throw new Error('strict native execution rejected: system-owned gas reservation lost the provenance/capacity race');
  }

  await bindSystemNativeGasSpendSubmission(reservation.spendId, transactionHash);

  try {
    try {
      await input.provider.sendTransaction(signedTransaction);
    } catch (error) {
      const observed = await input.provider.getTransaction(transactionHash).catch(() => null);
      if (!observed) {
        await quarantineSubmittedSystemNativeGasSpend(reservation.spendId, error);
        throw new Error(`system-owned native broadcast outcome is unknown for ${transactionHash}`);
      }
    }

    const receipt = await input.provider.waitForTransaction(
      transactionHash,
      Math.max(1, input.confirmations || 1),
      Math.max(10_000, Number(process.env.ZERO_CAPITAL_NATIVE_TX_TIMEOUT_MS || 60_000)),
    );
    if (!receipt) {
      await quarantineSubmittedSystemNativeGasSpend(reservation.spendId, 'receipt timeout');
      throw new Error(`system-owned native transaction ${transactionHash} has no terminal receipt`);
    }

    const effectiveGasPrice = receipt.effectiveGasPrice || populated.gasPrice || populated.maxFeePerGas;
    if (!effectiveGasPrice) {
      await quarantineSubmittedSystemNativeGasSpend(reservation.spendId, 'receipt missing effective gas price');
      throw new Error(`system-owned native transaction ${transactionHash} has no verifiable gas price`);
    }
    const actualSpent = receipt.gasUsed.mul(BigNumber.from(effectiveGasPrice));
    await settleSystemNativeGasSpend({
      spendId: reservation.spendId,
      transactionHash,
      actualSpentWei: actualSpent.toString(),
      evidence: {
        chainId: network.chainId,
        blockNumber: receipt.blockNumber,
        receiptStatus: receipt.status,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPriceWei: BigNumber.from(effectiveGasPrice).toString(),
        rawWalletBalanceAuthority: false,
      },
    });

    return {
      transactionHash,
      receipt,
      reservedWei: BigInt(maximumWei.toString()),
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