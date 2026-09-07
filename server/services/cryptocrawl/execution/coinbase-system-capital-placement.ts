import { BigNumber, Contract, ethers } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager, type SupportedChain as RpcSupportedChain } from '../api/blockchain-providers.js';
import { normalizePrivateKey, walletFromPrivateKey } from '../core/wallet-identity.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import {
  assertCoinbaseAppReceiveReady,
  coinbaseAppPrivateRequest,
} from '../intelligence/coinbase-app-private-authority.js';
import { assertCoinbaseSpotTradeReady } from '../intelligence/coinbase-advanced-trade-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { compareExactDecimals } from './exact-decimal.js';
import { withEvmSignerLane } from './evm-signer-lane.js';
import { createProductionCexSettlementAdapters } from './cex-settlement.js';
import { confirmSystemCapitalPlacement } from './system-capital-allocation-ledger.js';

const ERC20_TRANSFER_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
];
const TABLE = 'public.cryptocrawler_system_capital_allocations';
const SUPPORTED_COINBASE_EVM_NETWORKS: Partial<Record<RpcSupportedChain, string>> = {
  ethereum: 'ethereum',
  polygon: 'polygon',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  avalanche: 'avalanche',
};

type AllocationRow = {
  allocation_id: string;
  capital_scope: string;
  opportunity_id: string | null;
  strategy: string;
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
  placement_evidence: Record<string, unknown> | null;
};

export interface CoinbaseSystemCapitalPlacementResult {
  allocationId: string;
  venue: 'coinbase';
  status: 'PLACEMENT_PENDING' | 'PLACED';
  transactionHash?: string;
  deliveredAmountBaseUnits?: string;
  reason?: string;
}

type ValidatedAllocation = {
  chain: RpcSupportedChain;
  coinbaseNetwork: string;
  tokenAddress: string;
  sourceRecipient: string;
  sourceAmount: bigint;
};

type CoinbaseDepositDestination = {
  accountId: string;
  addressId: string;
  address: string;
  network: string;
  createdAt: string;
};

function canonicalAddress(label: string, value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) throw new Error(`${label} must be a valid EVM address`);
  return normalized;
}

function positiveBaseUnits(label: string, value: string): bigint {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error(`${label} must be a positive integer base-unit string`);
  return BigInt(value);
}

function parseScope(scope: string): { chain: RpcSupportedChain; tokenAddress: string; recipient: string } {
  const parts = scope.trim().split(':');
  if (parts.length !== 4 || !['zero-capital', 'system-capital'].includes(parts[0])) {
    throw new Error('Coinbase placement requires canonical system-generated capital provenance');
  }
  const chain = parts[1] as RpcSupportedChain;
  return {
    chain,
    tokenAddress: canonicalAddress('capital scope token', parts[2]),
    recipient: canonicalAddress('capital scope recipient', parts[3]),
  };
}

async function loadAllocation(allocationId: string): Promise<AllocationRow> {
  const result = await pool.query(
    `SELECT allocation_id, capital_scope, opportunity_id, strategy,
            destination_kind, destination_venue, source_chain, source_asset,
            source_token_address, source_asset_decimals, source_recipient,
            source_amount_base_units, destination_asset, destination_asset_decimals,
            status, placement_reference, placement_evidence
     FROM ${TABLE} WHERE allocation_id=$1`,
    [allocationId],
  );
  if (!result.rows[0]) throw new Error(`System-capital allocation ${allocationId} does not exist`);
  return result.rows[0] as AllocationRow;
}

function validateAllocation(row: AllocationRow): ValidatedAllocation {
  if (row.destination_kind !== 'cex' || String(row.destination_venue || '').toLowerCase() !== 'coinbase') {
    throw new Error('Coinbase system-capital placement requires a Coinbase CEX allocation');
  }
  if (!['RESERVED', 'PLACEMENT_PENDING', 'PLACED'].includes(row.status)) {
    throw new Error(`Coinbase system-capital placement cannot proceed from ${row.status}`);
  }
  const scope = parseScope(row.capital_scope);
  const coinbaseNetwork = SUPPORTED_COINBASE_EVM_NETWORKS[scope.chain];
  if (!coinbaseNetwork) throw new Error(`Coinbase placement does not authorize source network ${scope.chain}`);
  if (scope.chain !== row.source_chain.toLowerCase()) throw new Error('Coinbase allocation source chain conflicts with system-capital scope');
  const sourceRecipient = canonicalAddress('allocation source recipient', row.source_recipient);
  if (scope.recipient !== sourceRecipient) throw new Error('Coinbase allocation source recipient conflicts with system-capital scope');
  if (row.source_token_address && canonicalAddress('stored source token', row.source_token_address) !== scope.tokenAddress) {
    throw new Error('Coinbase allocation source token conflicts with system-capital scope');
  }
  const asset = row.source_asset.toUpperCase();
  if (!['USDC', 'USDT'].includes(asset)) throw new Error(`Coinbase system-capital bootstrap supports stablecoin ERC20 capital only; received ${asset}`);
  if (row.destination_asset.toUpperCase() !== asset) throw new Error('Coinbase placement cannot change asset identity without governed conversion');
  if (row.destination_asset_decimals !== row.source_asset_decimals) throw new Error('Coinbase placement cannot change asset decimals');
  return {
    chain: scope.chain,
    coinbaseNetwork,
    tokenAddress: scope.tokenAddress,
    sourceRecipient,
    sourceAmount: positiveBaseUnits('source_amount_base_units', row.source_amount_base_units),
  };
}

async function createDepositDestination(row: AllocationRow, validated: ValidatedAllocation): Promise<CoinbaseDepositDestination> {
  await assertCoinbaseAppReceiveReady();
  const asset = row.source_asset.toUpperCase();
  const accountPayload = await coinbaseAppPrivateRequest(`/v2/accounts/${encodeURIComponent(asset)}`, 'GET');
  const account = accountPayload?.data;
  const accountId = String(account?.id || '').trim();
  if (!accountId) throw new Error(`Coinbase App account for ${asset} is unavailable`);
  if (String(account?.currency?.code || '').trim().toUpperCase() !== asset) throw new Error('Coinbase App account currency identity mismatch');
  if (String(account?.type || '').trim().toLowerCase() !== 'wallet') throw new Error('Coinbase App deposit destination requires a wallet account');

  const created = await coinbaseAppPrivateRequest(`/v2/accounts/${encodeURIComponent(accountId)}/addresses`, 'POST', {
    body: {
      name: `cryptocrawl-${row.allocation_id}`,
      network: validated.coinbaseNetwork,
    },
  });
  const address = created?.data;
  const addressId = String(address?.id || '').trim();
  const network = String(address?.network || '').trim().toLowerCase();
  const depositAddress = canonicalAddress('Coinbase deposit address', String(address?.address || ''));
  if (!addressId || network !== validated.coinbaseNetwork) {
    throw new Error(`Coinbase returned an incompatible deposit network for ${asset}: expected=${validated.coinbaseNetwork} observed=${network || 'missing'}`);
  }
  return {
    accountId,
    addressId,
    address: depositAddress,
    network,
    createdAt: String(address?.created_at || new Date().toISOString()),
  };
}

async function persistPrepared(input: {
  row: AllocationRow;
  validated: ValidatedAllocation;
  destination: CoinbaseDepositDestination;
  transactionHash: string;
  chainId: number;
  nonce: number;
  gasLimit: string;
}): Promise<void> {
  const evidence = {
    venue: 'coinbase',
    coinbaseAccountId: input.destination.accountId,
    coinbaseAddressId: input.destination.addressId,
    depositAddress: input.destination.address,
    authenticatedExchangeChain: input.destination.network,
    depositAddressCreatedAt: input.destination.createdAt,
    authenticatedSourceTokenContract: input.validated.tokenAddress,
    sourceAsset: input.row.source_asset.toUpperCase(),
    sourceAssetDecimals: input.row.source_asset_decimals,
    sourceAmountBaseUnits: input.validated.sourceAmount.toString(),
    expectedTransactionHash: input.transactionHash,
    chainId: input.chainId,
    nonce: input.nonce,
    gasLimit: input.gasLimit,
    preparedBeforeBroadcast: true,
    signerLaneHeldThroughBroadcast: true,
    accountBalanceCreatesOwnership: false,
    tradingAccountSpendableAuthority: false,
  };
  const result = await pool.query(
    `UPDATE ${TABLE}
     SET status='PLACEMENT_PENDING', source_token_address=$2,
         placement_reference=$3, placement_evidence=$4::jsonb, updated_at=now()
     WHERE allocation_id=$1 AND status='RESERVED'
       AND (source_token_address IS NULL OR lower(source_token_address)=lower($2))
     RETURNING allocation_id`,
    [input.row.allocation_id, input.validated.tokenAddress, input.transactionHash, JSON.stringify(evidence)],
  );
  if (result.rowCount === 1) return;
  const current = await loadAllocation(input.row.allocation_id);
  if (current.status === 'PLACEMENT_PENDING' && String(current.placement_reference || '').toLowerCase() === input.transactionHash) return;
  throw new Error('Coinbase system-capital placement could not durably bind the prepared transaction');
}

async function broadcastPrepared(input: {
  row: AllocationRow;
  validated: ValidatedAllocation;
  destination: CoinbaseDepositDestination;
}): Promise<string> {
  const privateKey = normalizePrivateKey(process.env.WALLET_PRIVATE_KEY);
  if (!privateKey) throw new Error('WALLET_PRIVATE_KEY is required for Coinbase system-capital placement');
  await multiProviderRpcManager.initialize([input.validated.chain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(input.validated.chain, 'json_rpc');
  const wallet = walletFromPrivateKey(privateKey).connect(provider);
  if (wallet.address.toLowerCase() !== input.validated.sourceRecipient) {
    throw new Error('Coinbase placement signer does not match system-capital source recipient');
  }
  const network = await provider.getNetwork();
  if (!Number.isSafeInteger(network.chainId) || network.chainId <= 0) throw new Error('Coinbase placement source RPC returned invalid chain id');

  return withEvmSignerLane({
    chainId: network.chainId,
    walletAddress: wallet.address,
    operation: async () => {
      getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: input.validated.chain, venue: 'coinbase' });
      const current = await loadAllocation(input.row.allocation_id);
      if (current.status !== 'RESERVED') {
        if (current.status === 'PLACEMENT_PENDING' && /^0x[a-fA-F0-9]{64}$/.test(String(current.placement_reference || ''))) {
          return String(current.placement_reference).toLowerCase();
        }
        throw new Error(`Coinbase system-capital allocation changed before broadcast: ${current.status}`);
      }

      const token = new Contract(input.validated.tokenAddress, ERC20_TRANSFER_ABI, wallet);
      const [decimalsRaw, balanceRaw] = await Promise.all([token.decimals(), token.balanceOf(wallet.address)]);
      if (Number(decimalsRaw) !== input.row.source_asset_decimals) throw new Error('Coinbase placement source-token decimals mismatch');
      if (BigInt(balanceRaw.toString()) < input.validated.sourceAmount) throw new Error('Coinbase placement source wallet lacks physically reserved system capital');

      const populated = await token.populateTransaction.transfer(
        input.destination.address,
        BigNumber.from(input.validated.sourceAmount.toString()),
      );
      const nonce = await provider.getTransactionCount(wallet.address, 'pending');
      const gasLimit = await provider.estimateGas({ ...populated, from: wallet.address });
      const feeData = await provider.getFeeData();
      const transaction: ethers.providers.TransactionRequest = { ...populated, chainId: network.chainId, nonce, gasLimit };
      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        transaction.type = 2;
        transaction.maxFeePerGas = feeData.maxFeePerGas;
        transaction.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
      } else if (feeData.gasPrice) {
        transaction.gasPrice = feeData.gasPrice;
      } else {
        throw new Error('Coinbase placement source RPC returned no usable fee data');
      }
      const signed = await wallet.signTransaction(transaction);
      const transactionHash = ethers.utils.keccak256(signed).toLowerCase();
      await persistPrepared({
        row: input.row,
        validated: input.validated,
        destination: input.destination,
        transactionHash,
        chainId: network.chainId,
        nonce,
        gasLimit: gasLimit.toString(),
      });
      try {
        const submitted = await provider.sendTransaction(signed);
        if (submitted.hash.toLowerCase() !== transactionHash) throw new Error('Coinbase placement RPC returned a different transaction hash');
      } catch (error) {
        const receipt = await provider.getTransactionReceipt(transactionHash).catch(() => null);
        if (!receipt) {
          logger.error('[CoinbasePlacement] Broadcast outcome unresolved; capital remains reserved', {
            component: 'CoinbaseSystemCapitalPlacement',
            allocationId: input.row.allocation_id,
            transactionHash,
            error: error instanceof Error ? error.message : String(error),
            duplicateSubmissionAllowed: false,
            sourceCapitalReleased: false,
          });
        }
      }
      return transactionHash;
    },
  });
}

function exactDepositAmount(row: AllocationRow): string {
  return ethers.utils.formatUnits(row.source_amount_base_units, row.source_asset_decimals);
}

async function findCompletedAddressDeposit(row: AllocationRow, evidence: Record<string, unknown>): Promise<{ transactionId: string; amount: string } | null> {
  await assertCoinbaseAppReceiveReady();
  const accountId = String(evidence.coinbaseAccountId || '').trim();
  const addressId = String(evidence.coinbaseAddressId || '').trim();
  const expectedNetwork = String(evidence.authenticatedExchangeChain || '').trim().toLowerCase();
  const createdAt = Date.parse(String(evidence.depositAddressCreatedAt || ''));
  if (!accountId || !addressId || !expectedNetwork || !Number.isFinite(createdAt)) throw new Error('Coinbase pending placement lacks durable deposit-address identity');
  const response = await coinbaseAppPrivateRequest(
    `/v2/accounts/${encodeURIComponent(accountId)}/addresses/${encodeURIComponent(addressId)}/transactions`,
    'GET',
  );
  const expectedAmount = exactDepositAmount(row);
  const matches = (Array.isArray(response?.data) ? response.data : []).filter((transaction: any) => {
    const amount = String(transaction?.amount?.amount || '').trim();
    const currency = String(transaction?.amount?.currency || '').trim().toUpperCase();
    const status = String(transaction?.status || '').trim().toLowerCase();
    const networkStatus = String(transaction?.network?.status || '').trim().toLowerCase();
    const observedAt = Date.parse(String(transaction?.created_at || ''));
    if (!amount || currency !== row.destination_asset.toUpperCase() || status !== 'completed' || networkStatus !== 'confirmed') return false;
    if (Number.isFinite(observedAt) && observedAt + 5_000 < createdAt) return false;
    return compareExactDecimals(amount, expectedAmount) === 0;
  });
  if (matches.length > 1) throw new Error('Multiple completed Coinbase deposits match one fresh allocation-specific address');
  if (matches.length === 0) return null;
  const transactionId = String(matches[0]?.id || '').trim();
  if (!transactionId) throw new Error('Coinbase completed deposit transaction has no durable id');
  return { transactionId, amount: String(matches[0].amount.amount) };
}

async function proveAdvancedTradeSpendability(row: AllocationRow): Promise<{ available: string }> {
  await assertCoinbaseSpotTradeReady();
  const balances = await createProductionCexSettlementAdapters().coinbase.getBalances?.();
  if (!balances) throw new Error('Coinbase Advanced Trade balance reconciliation is unavailable');
  const asset = row.destination_asset.toUpperCase();
  const available = String(balances[asset] ?? '0');
  const delivered = exactDepositAmount(row);
  if (compareExactDecimals(available, delivered) < 0) {
    throw new Error(`Coinbase completed deposit is not yet available to Advanced Trade: required=${delivered} available=${available}`);
  }
  return { available };
}

export async function reconcileCoinbaseSystemCapitalPlacement(rowOrId: AllocationRow | string): Promise<CoinbaseSystemCapitalPlacementResult> {
  const row = typeof rowOrId === 'string' ? await loadAllocation(rowOrId) : rowOrId;
  const validated = validateAllocation(row);
  if (row.status === 'PLACED') {
    return { allocationId: row.allocation_id, venue: 'coinbase', status: 'PLACED', transactionHash: row.placement_reference || undefined };
  }
  if (row.status !== 'PLACEMENT_PENDING') throw new Error(`Coinbase reconciliation requires PLACEMENT_PENDING, received ${row.status}`);
  const txHash = String(row.placement_reference || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(txHash)) throw new Error('Coinbase pending placement has no valid prepared transaction hash');
  const evidence = row.placement_evidence || {};

  await multiProviderRpcManager.initialize([validated.chain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(validated.chain, 'receipts');
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    return { allocationId: row.allocation_id, venue: 'coinbase', status: 'PLACEMENT_PENDING', transactionHash: txHash, reason: 'On-chain transfer receipt remains pending' };
  }
  if (receipt.status !== 1) throw new Error(`Coinbase system-capital source transfer ${txHash} failed onchain`);

  const deposit = await findCompletedAddressDeposit(row, evidence);
  if (!deposit) {
    return { allocationId: row.allocation_id, venue: 'coinbase', status: 'PLACEMENT_PENDING', transactionHash: txHash, reason: 'Coinbase allocation-specific address has not recorded a completed confirmed deposit' };
  }
  const spendability = await proveAdvancedTradeSpendability(row);
  const deliveredAmountBaseUnits = BigInt(ethers.utils.parseUnits(deposit.amount, row.destination_asset_decimals).toString()).toString();
  if (deliveredAmountBaseUnits !== row.source_amount_base_units) throw new Error('Coinbase completed deposit amount differs from the exact source allocation');

  await confirmSystemCapitalPlacement({
    allocationId: row.allocation_id,
    placementReference: txHash,
    deliveredAmountBaseUnits,
    placementEvidence: {
      ...evidence,
      coinbaseDepositTransactionId: deposit.transactionId,
      coinbaseDepositStatus: 'completed',
      coinbaseDepositNetworkStatus: 'confirmed',
      advancedTradeAvailableAsset: row.destination_asset.toUpperCase(),
      advancedTradeAvailableAmount: spendability.available,
      onchainReceiptStatus: receipt.status,
      blockNumber: receipt.blockNumber,
      settlementConfirmed: true,
      tradingAccountSpendableAuthority: true,
      accountBalanceCreatesOwnership: false,
      ownershipCreatedOnlyByAllocationSpecificDeposit: true,
    },
  });
  return {
    allocationId: row.allocation_id,
    venue: 'coinbase',
    status: 'PLACED',
    transactionHash: txHash,
    deliveredAmountBaseUnits,
  };
}

export async function placeReservedCoinbaseSystemCapital(allocationId: string): Promise<CoinbaseSystemCapitalPlacementResult> {
  let row = await loadAllocation(allocationId);
  const validated = validateAllocation(row);
  if (row.status === 'PLACED') return reconcileCoinbaseSystemCapitalPlacement(row);
  if (row.status === 'PLACEMENT_PENDING') return reconcileCoinbaseSystemCapitalPlacement(row);
  const destination = await createDepositDestination(row, validated);
  const transactionHash = await broadcastPrepared({ row, validated, destination });
  row = await loadAllocation(allocationId);
  if (String(row.placement_reference || '').toLowerCase() !== transactionHash) throw new Error('Coinbase durable placement reference changed after broadcast');
  return reconcileCoinbaseSystemCapitalPlacement(row);
}

export async function reconcilePendingCoinbaseSystemCapitalPlacements(limit = 20): Promise<CoinbaseSystemCapitalPlacementResult[]> {
  const capped = Math.max(1, Math.min(100, Math.trunc(limit)));
  const result = await pool.query(
    `SELECT allocation_id FROM ${TABLE}
     WHERE destination_kind='cex' AND lower(COALESCE(destination_venue,''))='coinbase'
       AND status='PLACEMENT_PENDING'
     ORDER BY updated_at ASC LIMIT $1`,
    [capped],
  );
  const outcomes: CoinbaseSystemCapitalPlacementResult[] = [];
  for (const record of result.rows) {
    try {
      outcomes.push(await reconcileCoinbaseSystemCapitalPlacement(String(record.allocation_id)));
    } catch (error) {
      logger.error('[CoinbasePlacement] Pending placement reconciliation failed closed', {
        component: 'CoinbaseSystemCapitalPlacement',
        allocationId: String(record.allocation_id),
        error: error instanceof Error ? error.message : String(error),
        sourceCapitalReleased: false,
        destinationInventorySpendable: false,
      });
    }
  }
  return outcomes;
}
