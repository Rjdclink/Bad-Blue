import { BigNumber, Contract, ethers } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager, type SupportedChain as RpcSupportedChain } from '../api/blockchain-providers.js';
import { normalizePrivateKey, walletFromPrivateKey } from '../core/wallet-identity.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { getCoinbaseKeyPermissions } from '../intelligence/coinbase-advanced-trade-authority.js';
import {
  createCoinbaseReceiveAddress,
  listCoinbaseAddressTransactions,
} from '../intelligence/coinbase-app-transfer-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { withEvmSignerLane } from './evm-signer-lane.js';
import { confirmSystemCapitalPlacement } from './system-capital-allocation-ledger.js';
import {
  bindSystemNativeGasSpendSubmission,
  quarantineSubmittedSystemNativeGasSpend,
  releaseUnsubmittedSystemNativeGasSpend,
  reserveSystemNativeGasSpend,
  settleSystemNativeGasSpend,
} from './system-native-gas-spend-authority.js';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];
const TRANSFER_IFACE = new ethers.utils.Interface(ERC20_ABI);
const SYSTEM_CAPITAL_TABLE = 'public.cryptocrawler_system_capital_allocations';
const NETWORK_BY_CHAIN: Partial<Record<RpcSupportedChain, string>> = {
  ethereum: 'ethereum',
  polygon: 'polygon',
};

type AllocationRow = {
  allocation_id: string;
  capital_scope: string;
  destination_kind: string;
  destination_venue: string | null;
  source_chain: string;
  source_asset: string;
  source_token_address: string | null;
  source_asset_decimals: number;
  source_recipient: string;
  source_amount_base_units: string;
  destination_asset: string;
  destination_asset_decimals: number;
  status: string;
  placement_reference: string | null;
  placement_evidence: Record<string, any> | null;
};

export interface CoinbaseSystemCapitalPlacementResult {
  allocationId: string;
  venue: 'coinbase';
  status: 'PLACEMENT_PENDING' | 'PLACED';
  transactionHash?: string;
  deliveredAmountBaseUnits?: string;
  reason?: string;
}

function canonicalAddress(label: string, raw: unknown): string {
  const value = String(raw || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(value)) throw new Error(`${label} must be an EVM address`);
  return value;
}

function positiveBaseUnits(label: string, raw: unknown): bigint {
  const value = String(raw ?? '');
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error(`${label} must be positive integer base units`);
  return BigInt(value);
}

async function loadAllocation(allocationId: string): Promise<AllocationRow> {
  const result = await pool.query(
    `SELECT allocation_id, capital_scope, destination_kind, destination_venue,
            source_chain, source_asset, source_token_address, source_asset_decimals,
            source_recipient, source_amount_base_units, destination_asset,
            destination_asset_decimals, status, placement_reference, placement_evidence
     FROM ${SYSTEM_CAPITAL_TABLE}
     WHERE allocation_id=$1`,
    [allocationId],
  );
  if (!result.rows[0]) throw new Error(`System-capital allocation ${allocationId} does not exist`);
  return result.rows[0] as AllocationRow;
}

function validate(row: AllocationRow): {
  chain: RpcSupportedChain;
  network: string;
  tokenAddress: string;
  sourceRecipient: string;
  sourceAmount: bigint;
  asset: 'USDC' | 'USDT';
} {
  if (row.destination_kind !== 'cex' || String(row.destination_venue || '').toLowerCase() !== 'coinbase') {
    throw new Error('Coinbase placement requires a canonical Coinbase CEX allocation');
  }
  if (!['RESERVED','PLACEMENT_PENDING','PLACED'].includes(row.status)) {
    throw new Error(`Coinbase placement cannot proceed from ${row.status}`);
  }
  const scope = row.capital_scope.split(':');
  if (scope.length !== 4 || !['zero-capital','system-capital'].includes(scope[0])) {
    throw new Error('Coinbase placement requires system-generated capital scope identity');
  }
  const chain = row.source_chain.toLowerCase() as RpcSupportedChain;
  const network = NETWORK_BY_CHAIN[chain];
  if (!network) throw new Error(`Coinbase system-capital placement has no proven network mapping for ${row.source_chain}`);
  if (scope[1].toLowerCase() !== chain) throw new Error('Coinbase placement source chain conflicts with capital scope');
  const tokenAddress = canonicalAddress('Coinbase placement token', row.source_token_address || scope[2]);
  if (canonicalAddress('capital scope token', scope[2]) !== tokenAddress) throw new Error('Coinbase placement token conflicts with capital scope');
  const sourceRecipient = canonicalAddress('Coinbase placement source recipient', row.source_recipient);
  if (canonicalAddress('capital scope recipient', scope[3]) !== sourceRecipient) throw new Error('Coinbase placement recipient conflicts with capital scope');
  const asset = row.source_asset.toUpperCase();
  if (asset !== 'USDC' && asset !== 'USDT') throw new Error(`Coinbase placement supports retained USDC/USDT only; received ${asset}`);
  if (row.destination_asset.toUpperCase() !== asset || row.destination_asset_decimals !== row.source_asset_decimals) {
    throw new Error('Coinbase placement cannot silently convert asset identity or decimals');
  }
  return { chain, network, tokenAddress, sourceRecipient, sourceAmount: positiveBaseUnits('source_amount_base_units', row.source_amount_base_units), asset };
}

function exactTransferFromReceipt(input: {
  receipt: ethers.providers.TransactionReceipt;
  tokenAddress: string;
  sourceRecipient: string;
  destinationAddress: string;
  expectedAmount: bigint;
}): void {
  const matches = input.receipt.logs
    .filter(log => log.address.toLowerCase() === input.tokenAddress)
    .flatMap(log => {
      try {
        const parsed = TRANSFER_IFACE.parseLog(log);
        if (parsed.name !== 'Transfer') return [];
        return [{
          from: String(parsed.args.from).toLowerCase(),
          to: String(parsed.args.to).toLowerCase(),
          value: BigInt(parsed.args.value.toString()),
        }];
      } catch {
        return [];
      }
    })
    .filter(item => item.from === input.sourceRecipient && item.to === input.destinationAddress.toLowerCase());
  if (matches.length !== 1 || matches[0].value !== input.expectedAmount) {
    throw new Error('Coinbase placement receipt does not contain exactly one matching ERC20 Transfer of the reserved system-owned units');
  }
}

async function persistPrepared(input: {
  row: AllocationRow;
  tokenAddress: string;
  transactionHash: string;
  evidence: Record<string, unknown>;
}): Promise<void> {
  const result = await pool.query(
    `UPDATE ${SYSTEM_CAPITAL_TABLE}
     SET status='PLACEMENT_PENDING', source_token_address=$2,
         placement_reference=$3, placement_evidence=$4::jsonb, updated_at=now()
     WHERE allocation_id=$1 AND status='RESERVED'
       AND (source_token_address IS NULL OR lower(source_token_address)=lower($2))
     RETURNING allocation_id`,
    [input.row.allocation_id, input.tokenAddress, input.transactionHash, JSON.stringify(input.evidence)],
  );
  if (result.rowCount === 1) return;
  const current = await loadAllocation(input.row.allocation_id);
  if (current.status === 'PLACEMENT_PENDING'
      && String(current.placement_reference || '').toLowerCase() === input.transactionHash.toLowerCase()) return;
  throw new Error('Coinbase placement could not atomically persist its durable transaction identity before broadcast');
}

async function prepareAndBroadcast(row: AllocationRow): Promise<string> {
  const validated = validate(row);
  const privateKey = normalizePrivateKey(process.env.WALLET_PRIVATE_KEY);
  if (!privateKey) throw new Error('WALLET_PRIVATE_KEY is required for system-capital placement signing');
  await multiProviderRpcManager.initialize([validated.chain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(validated.chain, 'json_rpc');
  const wallet = walletFromPrivateKey(privateKey).connect(provider);
  if (wallet.address.toLowerCase() !== validated.sourceRecipient) {
    throw new Error('Coinbase placement signer does not match SELF_FUNDED source recipient');
  }

  const permissions = await getCoinbaseKeyPermissions(true);
  if (!permissions.canView || !permissions.canReceive || !permissions.canTrade) {
    throw new Error('Coinbase placement requires view, receive and trade permissions before any source-chain submission');
  }
  const receive = await createCoinbaseReceiveAddress({
    asset: validated.asset,
    network: validated.network,
    name: `CryptoCrawler ${row.allocation_id}`,
  });
  const depositAddress = canonicalAddress('Coinbase receive address', receive.address);
  const token = new Contract(validated.tokenAddress, ERC20_ABI, wallet);
  const [decimalsRaw, tokenBalanceRaw] = await Promise.all([token.decimals(), token.balanceOf(wallet.address)]);
  if (Number(decimalsRaw) !== row.source_asset_decimals) throw new Error('Coinbase placement source-token decimals differ from allocation truth');
  if (BigInt(tokenBalanceRaw.toString()) < validated.sourceAmount) throw new Error('System-capital source wallet no longer holds the reserved token units');

  const populated = await token.populateTransaction.transfer(depositAddress, BigNumber.from(validated.sourceAmount.toString()));
  const network = await provider.getNetwork();
  const nonce = await provider.getTransactionCount(wallet.address, 'pending');
  const gasLimit = await provider.estimateGas({ ...populated, from: wallet.address });
  const feeData = await provider.getFeeData();
  const transaction: ethers.providers.TransactionRequest = { ...populated, chainId: network.chainId, nonce, gasLimit };
  let gasPriceCeiling: BigNumber;
  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    transaction.type = 2;
    transaction.maxFeePerGas = feeData.maxFeePerGas;
    transaction.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    gasPriceCeiling = feeData.maxFeePerGas;
  } else if (feeData.gasPrice) {
    transaction.gasPrice = feeData.gasPrice;
    gasPriceCeiling = feeData.gasPrice;
  } else {
    throw new Error('Coinbase placement source RPC returned no usable fee data');
  }
  const maximumGasWei = gasLimit.mul(gasPriceCeiling);
  const physicalNativeBalance = await provider.getBalance(wallet.address);
  if (physicalNativeBalance.lt(maximumGasWei)) {
    throw new Error('Source wallet physically lacks the native gas required by the provenance-backed placement ceiling');
  }

  const gasReservation = await reserveSystemNativeGasSpend({
    idempotencyKey: `cex-placement:${row.allocation_id}:gas`,
    scope: row.capital_scope,
    chain: validated.chain,
    wallet: wallet.address,
    purpose: `coinbase-system-capital-placement:${row.allocation_id}`,
    maximumWei: maximumGasWei.toString(),
  });
  if (!gasReservation) {
    throw new Error('Coinbase placement has no provenance-backed system-owned native gas budget; operator wallet gas cannot be used');
  }

  return withEvmSignerLane({
    chainId: network.chainId,
    walletAddress: wallet.address,
    operation: async () => {
      getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: validated.chain, venue: 'coinbase' });
      const current = await loadAllocation(row.allocation_id);
      if (current.status !== 'RESERVED') {
        if (current.status === 'PLACEMENT_PENDING' && /^0x[0-9a-fA-F]{64}$/.test(String(current.placement_reference || ''))) {
          return String(current.placement_reference).toLowerCase();
        }
        await releaseUnsubmittedSystemNativeGasSpend(gasReservation.spendId).catch(() => undefined);
        throw new Error(`Coinbase allocation changed before submission: ${current.status}`);
      }

      const signed = await wallet.signTransaction(transaction);
      const transactionHash = ethers.utils.keccak256(signed).toLowerCase();
      await persistPrepared({
        row,
        tokenAddress: validated.tokenAddress,
        transactionHash,
        evidence: {
          venue: 'coinbase', accountId: receive.accountId, addressId: receive.addressId,
          depositAddress, authenticatedNetwork: receive.network,
          sourceChain: validated.chain, sourceAsset: validated.asset,
          sourceAmountBaseUnits: validated.sourceAmount.toString(),
          expectedTransactionHash: transactionHash,
          systemNativeGasSpendId: gasReservation.spendId,
          systemNativeGasReservedWei: maximumGasWei.toString(),
          rawWalletNativeBalanceAuthority: false,
          preparedBeforeBroadcast: true,
          duplicateSubmissionAllowed: false,
        },
      });
      await bindSystemNativeGasSpendSubmission(gasReservation.spendId, transactionHash);
      try {
        const submitted = await provider.sendTransaction(signed);
        if (submitted.hash.toLowerCase() !== transactionHash) throw new Error('Source provider returned a different transaction hash');
      } catch (error) {
        const receipt = await provider.getTransactionReceipt(transactionHash).catch(() => null);
        if (!receipt) {
          await quarantineSubmittedSystemNativeGasSpend(gasReservation.spendId, error).catch(() => undefined);
          logger.error('[CoinbaseSystemCapitalPlacement] Broadcast outcome unresolved; reconcile exact hash only', {
            component: 'CoinbaseSystemCapitalPlacement', allocationId: row.allocation_id,
            transactionHash, duplicateSubmissionAllowed: false, sourceCapitalReleased: false,
          });
        }
      }
      return transactionHash;
    },
  });
}

async function reconcile(row: AllocationRow): Promise<CoinbaseSystemCapitalPlacementResult> {
  const validated = validate(row);
  const txHash = String(row.placement_reference || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) throw new Error('Pending Coinbase placement has no durable signed transaction hash');
  const evidence = row.placement_evidence || {};
  const depositAddress = canonicalAddress('persisted Coinbase receive address', evidence.depositAddress);
  const accountId = String(evidence.accountId || '').trim();
  const addressId = String(evidence.addressId || '').trim();
  const authenticatedNetwork = String(evidence.authenticatedNetwork || '').trim().toLowerCase();
  const gasSpendId = String(evidence.systemNativeGasSpendId || '').trim();
  if (!accountId || !addressId || authenticatedNetwork !== validated.network || !gasSpendId) {
    throw new Error('Pending Coinbase placement lacks durable account/address/network/gas identity');
  }

  await multiProviderRpcManager.initialize([validated.chain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(validated.chain, 'receipts');
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    return { allocationId: row.allocation_id, venue: 'coinbase', status: 'PLACEMENT_PENDING', transactionHash: txHash,
      reason: 'Signed source transaction has no receipt yet; exact hash remains quarantined from resubmission' };
  }
  const effectiveGasPrice = receipt.effectiveGasPrice;
  if (!effectiveGasPrice) throw new Error('Coinbase placement receipt omitted effective gas price');
  const actualGasWei = receipt.gasUsed.mul(effectiveGasPrice).toString();
  await settleSystemNativeGasSpend({
    spendId: gasSpendId,
    transactionHash: txHash,
    actualSpentWei: actualGasWei,
    evidence: { receiptStatus: receipt.status, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: effectiveGasPrice.toString() },
  });
  if (receipt.status !== 1) throw new Error('Coinbase placement source transaction failed on-chain; source token remains non-spendable pending explicit recovery');
  exactTransferFromReceipt({ receipt, tokenAddress: validated.tokenAddress, sourceRecipient: validated.sourceRecipient,
    destinationAddress: depositAddress, expectedAmount: validated.sourceAmount });

  const transactions = await listCoinbaseAddressTransactions({ accountId, addressId });
  const matches = transactions.filter(item =>
    String(item.transactionHash || '').toLowerCase() === txHash
    && String(item.network || '').toLowerCase() === authenticatedNetwork
    && item.debitAsset === validated.asset,
  );
  if (matches.length === 0) {
    return { allocationId: row.allocation_id, venue: 'coinbase', status: 'PLACEMENT_PENDING', transactionHash: txHash,
      reason: 'On-chain transfer is confirmed but Coinbase has not yet reported the exact address transaction' };
  }
  if (matches.length !== 1) throw new Error('Coinbase returned multiple address transactions for one exact source transaction hash');
  const coinbaseTx = matches[0];
  if (coinbaseTx.status !== 'completed') {
    return { allocationId: row.allocation_id, venue: 'coinbase', status: 'PLACEMENT_PENDING', transactionHash: txHash,
      reason: `Coinbase address transaction is not terminal completed (${coinbaseTx.status || 'unknown'})` };
  }
  const deliveredBaseUnits = ethers.utils.parseUnits(coinbaseTx.debitAmount, row.destination_asset_decimals).toString();
  if (BigInt(deliveredBaseUnits) !== validated.sourceAmount) throw new Error('Coinbase credited amount does not equal the exact on-chain system-capital transfer');

  const permissions = await getCoinbaseKeyPermissions(true);
  if (!permissions.canView || !permissions.canReceive || !permissions.canTrade) {
    throw new Error('Coinbase deposit is observed but authenticated trading-account spendability is not proven');
  }
  await confirmSystemCapitalPlacement({
    allocationId: row.allocation_id,
    placementReference: txHash,
    deliveredAmountBaseUnits,
    placementEvidence: {
      ...evidence,
      onchainReceiptStatus: receipt.status,
      blockNumber: receipt.blockNumber,
      exactErc20TransferVerified: true,
      coinbaseTransactionId: coinbaseTx.transactionId,
      coinbaseTransactionStatus: coinbaseTx.status,
      coinbaseNetworkStatus: coinbaseTx.networkStatus,
      coinbaseTransactionHash: coinbaseTx.transactionHash,
      coinbaseAccountBalanceAuthority: false,
      coinbaseCanView: permissions.canView,
      coinbaseCanReceive: permissions.canReceive,
      coinbaseCanTrade: permissions.canTrade,
      tradingAccountSpendableAuthority: true,
      settlementConfirmed: true,
      deliveredAmountBaseUnits,
      actualSystemOwnedGasSpentWei: actualGasWei,
    },
  });
  return { allocationId: row.allocation_id, venue: 'coinbase', status: 'PLACED', transactionHash: txHash, deliveredAmountBaseUnits };
}

export async function placeReservedCoinbaseSystemCapital(allocationId: string): Promise<CoinbaseSystemCapitalPlacementResult> {
  let row = await loadAllocation(allocationId);
  const validated = validate(row);
  void validated;
  if (row.status === 'PLACED') {
    return { allocationId, venue: 'coinbase', status: 'PLACED', transactionHash: row.placement_reference || undefined };
  }
  if (row.status === 'PLACEMENT_PENDING') return reconcile(row);
  const transactionHash = await prepareAndBroadcast(row);
  row = await loadAllocation(allocationId);
  if (String(row.placement_reference || '').toLowerCase() !== transactionHash) {
    throw new Error('Coinbase durable placement reference changed after submission');
  }
  return reconcile(row);
}

export async function reconcilePendingCoinbaseSystemCapitalPlacements(limit = 20): Promise<CoinbaseSystemCapitalPlacementResult[]> {
  const result = await pool.query(
    `SELECT allocation_id FROM ${SYSTEM_CAPITAL_TABLE}
     WHERE destination_kind='cex' AND lower(destination_venue)='coinbase'
       AND status='PLACEMENT_PENDING'
     ORDER BY updated_at ASC LIMIT $1`,
    [Math.max(1, Math.min(100, Math.trunc(limit)))],
  );
  const outcomes: CoinbaseSystemCapitalPlacementResult[] = [];
  for (const row of result.rows) {
    try {
      outcomes.push(await placeReservedCoinbaseSystemCapital(String(row.allocation_id)));
    } catch (error) {
      logger.error('[CoinbaseSystemCapitalPlacement] Pending placement reconciliation failed closed', {
        component: 'CoinbaseSystemCapitalPlacement', allocationId: String(row.allocation_id),
        error: error instanceof Error ? error.message : String(error),
        duplicateSubmissionAllowed: false, operatorBalanceAuthorityGranted: false,
      });
    }
  }
  return outcomes;
}
