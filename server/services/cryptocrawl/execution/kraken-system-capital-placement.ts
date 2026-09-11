import { BigNumber, Contract, ethers } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager, type SupportedChain as RpcSupportedChain } from '../api/blockchain-providers.js';
import { normalizePrivateKey, walletFromPrivateKey } from '../core/wallet-identity.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { krakenPrivateRequest } from '../intelligence/cex-private-authority.js';
import { krakenFundingBetaRequest } from '../intelligence/kraken-funding-beta-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { withEvmSignerLane } from './evm-signer-lane.js';
import { createProductionCexSettlementAdapters } from './cex-settlement.js';
import { confirmSystemCapitalPlacement } from './system-capital-allocation-ledger.js';
import {
  bindSystemNativeGasSpendSubmission,
  getSystemNativeGasAuthority,
  quarantineSubmittedSystemNativeGasSpend,
  releaseUnsubmittedSystemNativeGasSpend,
  reserveSystemNativeGasSpend,
  settleSystemNativeGasSpend,
} from './system-native-gas-spend-authority.js';

const ERC20_TRANSFER_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
];
const TABLE = 'public.cryptocrawler_system_capital_allocations';
const SUPPORTED_KRAKEN_EVM_CHAINS = new Set<RpcSupportedChain>([
  'ethereum', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc',
]);

const CHAIN_NETWORK_ALIASES: Partial<Record<RpcSupportedChain, string[]>> = {
  ethereum: ['ethereum', 'ethereum mainnet'],
  polygon: ['polygon', 'polygon pos'],
  arbitrum: ['arbitrum', 'arbitrum one'],
  optimism: ['optimism', 'op mainnet'],
  avalanche: ['avalanche', 'avalanche c-chain', 'avalanche c chain'],
  bsc: ['bsc', 'bnb smart chain', 'binance smart chain'],
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

type ValidatedAllocation = {
  chain: RpcSupportedChain;
  tokenAddress: string;
  sourceRecipient: string;
  sourceAmount: bigint;
};

type KrakenDepositDestination = {
  methodId: string;
  methodName: string;
  networkId: string;
  networkName: string;
  contractAddress: string;
  address: string;
};

export interface KrakenSystemCapitalPlacementResult {
  allocationId: string;
  venue: 'kraken';
  status: 'PLACEMENT_PENDING' | 'PLACED';
  transactionHash?: string;
  deliveredAmountBaseUnits?: string;
  reason?: string;
}

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
    throw new Error('Kraken placement requires canonical system-generated capital provenance');
  }
  return {
    chain: parts[1] as RpcSupportedChain,
    tokenAddress: canonicalAddress('capital scope token', parts[2]),
    recipient: canonicalAddress('capital scope recipient', parts[3]),
  };
}

async function loadAllocation(allocationId: string): Promise<AllocationRow> {
  const result = await pool.query(
    `SELECT allocation_id,capital_scope,opportunity_id,strategy,destination_kind,destination_venue,
            source_chain,source_asset,source_token_address,source_asset_decimals,source_recipient,
            source_amount_base_units,destination_asset,destination_asset_decimals,status,
            placement_reference,placement_evidence
     FROM ${TABLE} WHERE allocation_id=$1`,
    [allocationId],
  );
  if (!result.rows[0]) throw new Error(`System-capital allocation ${allocationId} does not exist`);
  return result.rows[0] as AllocationRow;
}

function validateAllocation(row: AllocationRow): ValidatedAllocation {
  if (row.destination_kind !== 'cex' || String(row.destination_venue || '').toLowerCase() !== 'kraken') {
    throw new Error('Kraken system-capital placement requires a Kraken CEX allocation');
  }
  if (!['RESERVED', 'PLACEMENT_PENDING', 'PLACED'].includes(row.status)) {
    throw new Error(`Kraken system-capital placement cannot proceed from ${row.status}`);
  }
  const scope = parseScope(row.capital_scope);
  if (!SUPPORTED_KRAKEN_EVM_CHAINS.has(scope.chain)) throw new Error(`Kraken placement does not authorize source network ${scope.chain}`);
  if (scope.chain !== row.source_chain.toLowerCase()) throw new Error('Kraken allocation source chain conflicts with system-capital scope');
  const sourceRecipient = canonicalAddress('allocation source recipient', row.source_recipient);
  if (scope.recipient !== sourceRecipient) throw new Error('Kraken allocation source recipient conflicts with system-capital scope');
  if (row.source_token_address && canonicalAddress('stored source token', row.source_token_address) !== scope.tokenAddress) {
    throw new Error('Kraken allocation source token conflicts with system-capital scope');
  }
  const asset = row.source_asset.toUpperCase();
  if (!['USDC', 'USDT'].includes(asset)) throw new Error(`Kraken direct bootstrap supports stablecoin ERC20 capital only; received ${asset}`);
  if (row.destination_asset.toUpperCase() !== asset) throw new Error('Kraken placement cannot change asset identity without governed conversion');
  if (row.destination_asset_decimals !== row.source_asset_decimals) throw new Error('Kraken placement cannot change asset decimals');
  return {
    chain: scope.chain,
    tokenAddress: scope.tokenAddress,
    sourceRecipient,
    sourceAmount: positiveBaseUnits('source_amount_base_units', row.source_amount_base_units),
  };
}

function normalizeNetwork(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function networkMatchesChain(chain: RpcSupportedChain, networkName: unknown): boolean {
  const observed = normalizeNetwork(networkName);
  const aliases = CHAIN_NETWORK_ALIASES[chain] || [chain];
  return aliases.some(alias => observed === normalizeNetwork(alias));
}

function exactAmount(row: AllocationRow): string {
  return ethers.utils.formatUnits(row.source_amount_base_units, row.source_asset_decimals);
}

async function resolveDepositDestination(row: AllocationRow, validated: ValidatedAllocation): Promise<KrakenDepositDestination> {
  const asset = row.source_asset.toUpperCase();
  const methodsPayload = await krakenFundingBetaRequest('GET', '/funding/v1/methods/deposit', {
    query: { asset: { class: 'currency', name: asset }, limit: 100 },
  });
  const sourceAmount = Number(exactAmount(row));
  const compatible = (Array.isArray(methodsPayload?.methods) ? methodsPayload.methods : []).filter((method: any) => {
    const methodAsset = String(method?.asset?.name || '').trim().toUpperCase();
    const network = method?.network || {};
    const contract = String(network?.contract_address || '').trim().toLowerCase();
    const symbol = String(network?.on_chain_asset_symbol || '').trim().toUpperCase();
    const minimum = Number(method?.minimum_amount ?? 0);
    return methodAsset === asset
      && symbol === asset
      && contract === validated.tokenAddress
      && networkMatchesChain(validated.chain, network?.network_name)
      && Number.isFinite(minimum)
      && sourceAmount + 1e-12 >= minimum;
  }).sort((left: any, right: any) => String(left?.method_id || '').localeCompare(String(right?.method_id || '')));
  if (compatible.length === 0) {
    throw new Error(`Kraken has no authenticated deposit method matching ${asset} ${validated.chain} ${validated.tokenAddress}`);
  }

  const method = compatible[0];
  const methodId = String(method?.method_id || '').trim();
  const methodName = String(method?.method_name || '').trim();
  const networkId = String(method?.network?.network_id || '').trim();
  const networkName = String(method?.network?.network_name || '').trim();
  const contractAddress = canonicalAddress('Kraken authenticated token contract', String(method?.network?.contract_address || ''));
  if (!methodId || !networkId || !methodName) throw new Error('Kraken compatible funding method lacks durable method/network identity');

  let addressesPayload = await krakenFundingBetaRequest('GET', '/funding/v2/deposit/addresses', {
    query: { scope: { method_id: methodId }, limit: 20 },
  });
  let addresses = Array.isArray(addressesPayload?.addresses) ? addressesPayload.addresses : [];
  if (addresses.length === 0) {
    const claimed = await krakenFundingBetaRequest('PUT', '/funding/v1/deposit/address', { body: { method_id: methodId } });
    addressesPayload = { addresses: [{ method_id: methodId, address_details: claimed?.address_details }] };
    addresses = addressesPayload.addresses;
  }

  const destination = addresses.find((entry: any) => {
    const crypto = entry?.address_details?.crypto || {};
    const address = String(crypto?.address || '').trim().toLowerCase();
    const tag = String(crypto?.tag || '').trim();
    const memo = String(crypto?.memo || '').trim();
    return /^0x[a-f0-9]{40}$/.test(address) && !tag && !memo;
  });
  if (!destination) throw new Error('Kraken did not provide a tag-free EVM deposit address for the exact funding method');
  return {
    methodId,
    methodName,
    networkId,
    networkName,
    contractAddress,
    address: canonicalAddress('Kraken deposit address', String(destination.address_details.crypto.address)),
  };
}

async function persistPrepared(input: {
  row: AllocationRow;
  validated: ValidatedAllocation;
  destination: KrakenDepositDestination;
  transactionHash: string;
  chainId: number;
  nonce: number;
  gasLimit: string;
  maximumGasWei: string;
  systemNativeGasSpendId: string;
  systemNativeGasScope: string;
}): Promise<void> {
  const evidence = {
    venue: 'kraken',
    krakenFundingApi: 'beta_method_and_address_plus_legacy_txid_terminal_reconciliation',
    krakenMethodId: input.destination.methodId,
    krakenMethodName: input.destination.methodName,
    krakenNetworkId: input.destination.networkId,
    krakenNetworkName: input.destination.networkName,
    depositAddress: input.destination.address,
    authenticatedSourceTokenContract: input.destination.contractAddress,
    sourceAsset: input.row.source_asset.toUpperCase(),
    sourceAssetDecimals: input.row.source_asset_decimals,
    sourceAmountBaseUnits: input.validated.sourceAmount.toString(),
    expectedTransactionHash: input.transactionHash,
    chainId: input.chainId,
    nonce: input.nonce,
    gasLimit: input.gasLimit,
    maximumNativeGasWei: input.maximumGasWei,
    systemNativeGasSpendId: input.systemNativeGasSpendId,
    systemNativeGasScope: input.systemNativeGasScope,
    systemNativeGasAuthority: true,
    systemNativeGasSettled: false,
    rawWalletNativeBalanceAuthority: false,
    preparedBeforeBroadcast: true,
    signerLaneHeldThroughBroadcast: true,
    tradingAccountSpendableAuthority: false,
  };
  const result = await pool.query(
    `UPDATE ${TABLE}
     SET status='PLACEMENT_PENDING',source_token_address=$2,placement_reference=$3,placement_evidence=$4::jsonb,updated_at=now()
     WHERE allocation_id=$1 AND status='RESERVED'
       AND (source_token_address IS NULL OR lower(source_token_address)=lower($2))
     RETURNING allocation_id`,
    [input.row.allocation_id, input.validated.tokenAddress, input.transactionHash, JSON.stringify(evidence)],
  );
  if (result.rowCount === 1) return;
  const current = await loadAllocation(input.row.allocation_id);
  if (current.status === 'PLACEMENT_PENDING' && String(current.placement_reference || '').toLowerCase() === input.transactionHash) return;
  throw new Error('Kraken system-capital placement could not durably bind the prepared transaction');
}

async function mergePlacementEvidence(allocationId: string, evidence: Record<string, unknown>): Promise<void> {
  const result = await pool.query(
    `UPDATE ${TABLE}
     SET placement_evidence=COALESCE(placement_evidence,'{}'::jsonb) || $2::jsonb,updated_at=now()
     WHERE allocation_id=$1 AND status='PLACEMENT_PENDING' RETURNING allocation_id`,
    [allocationId, JSON.stringify(evidence)],
  );
  if (result.rowCount !== 1) throw new Error(`Pending Kraken system-capital placement ${allocationId} is no longer mutable`);
}

async function settlePlacementNativeGas(row: AllocationRow, transactionHash: string, receipt: ethers.providers.TransactionReceipt): Promise<void> {
  const spendId = String(row.placement_evidence?.systemNativeGasSpendId || '').trim();
  if (!spendId) throw new Error('Kraken placement lacks provenance-backed native gas spend identity');
  const effectiveGasPrice = receipt.effectiveGasPrice;
  if (!effectiveGasPrice) throw new Error(`Kraken placement ${transactionHash} has no receipt gas price for provenance settlement`);
  const actualSpentWei = receipt.gasUsed.mul(effectiveGasPrice).toString();
  await settleSystemNativeGasSpend({
    spendId,
    transactionHash,
    actualSpentWei,
    evidence: {
      allocationId: row.allocation_id,
      chain: row.source_chain,
      blockNumber: receipt.blockNumber,
      receiptStatus: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPriceWei: effectiveGasPrice.toString(),
      purpose: 'kraken_system_capital_placement',
      rawWalletBalanceAuthority: false,
    },
  });
  await mergePlacementEvidence(row.allocation_id, {
    systemNativeGasAuthority: true,
    systemNativeGasSettled: true,
    actualNativeGasSpentWei: actualSpentWei,
  });
}

async function broadcastPrepared(input: {
  row: AllocationRow;
  validated: ValidatedAllocation;
  destination: KrakenDepositDestination;
}): Promise<string> {
  const privateKey = normalizePrivateKey(process.env.WALLET_PRIVATE_KEY);
  if (!privateKey) throw new Error('WALLET_PRIVATE_KEY is required for Kraken system-capital placement');
  await multiProviderRpcManager.initialize([input.validated.chain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(input.validated.chain, 'json_rpc');
  const wallet = walletFromPrivateKey(privateKey).connect(provider);
  if (wallet.address.toLowerCase() !== input.validated.sourceRecipient) throw new Error('Kraken placement signer does not match system-capital source recipient');
  const network = await provider.getNetwork();
  if (!Number.isSafeInteger(network.chainId) || network.chainId <= 0) throw new Error('Kraken placement source RPC returned invalid chain id');

  return withEvmSignerLane({
    chainId: network.chainId,
    walletAddress: wallet.address,
    operation: async () => {
      getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: input.validated.chain, venue: 'kraken' });
      const current = await loadAllocation(input.row.allocation_id);
      if (current.status !== 'RESERVED') {
        if (current.status === 'PLACEMENT_PENDING' && /^0x[a-fA-F0-9]{64}$/.test(String(current.placement_reference || ''))) {
          return String(current.placement_reference).toLowerCase();
        }
        throw new Error(`Kraken system-capital allocation changed before broadcast: ${current.status}`);
      }

      const token = new Contract(input.validated.tokenAddress, ERC20_TRANSFER_ABI, wallet);
      const [decimalsRaw, balanceRaw] = await Promise.all([token.decimals(), token.balanceOf(wallet.address)]);
      if (Number(decimalsRaw) !== input.row.source_asset_decimals) throw new Error('Kraken placement source-token decimals mismatch');
      if (BigInt(balanceRaw.toString()) < input.validated.sourceAmount) throw new Error('Kraken placement source wallet lacks physically reserved system capital');

      const populated = await token.populateTransaction.transfer(input.destination.address, BigNumber.from(input.validated.sourceAmount.toString()));
      const nonce = await provider.getTransactionCount(wallet.address, 'pending');
      const gasLimit = await provider.estimateGas({ ...populated, from: wallet.address });
      const feeData = await provider.getFeeData();
      const transaction: ethers.providers.TransactionRequest = { ...populated, chainId: network.chainId, nonce, gasLimit };
      let maximumGasPrice: BigNumber;
      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        transaction.type = 2;
        transaction.maxFeePerGas = feeData.maxFeePerGas;
        transaction.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
        maximumGasPrice = feeData.maxFeePerGas;
      } else if (feeData.gasPrice) {
        transaction.gasPrice = feeData.gasPrice;
        maximumGasPrice = feeData.gasPrice;
      } else {
        throw new Error('Kraken placement source RPC returned no usable fee data');
      }
      const signed = await wallet.signTransaction(transaction);
      const transactionHash = ethers.utils.keccak256(signed).toLowerCase();
      const maximumGasWei = gasLimit.mul(maximumGasPrice).toString();
      const gasAuthority = await getSystemNativeGasAuthority({ chain: input.validated.chain, wallet: wallet.address, minimumWei: maximumGasWei });
      if (!gasAuthority) throw new Error('Kraken bootstrap placement rejected: no SELF_FUNDED provenance-backed native gas covers the signed transfer ceiling');
      const gasReservation = await reserveSystemNativeGasSpend({
        idempotencyKey: `kraken-placement:${input.row.allocation_id}:${transactionHash}`,
        scope: gasAuthority.scope,
        chain: input.validated.chain,
        wallet: wallet.address,
        purpose: `kraken_system_capital_placement:${input.row.allocation_id}`,
        maximumWei: maximumGasWei,
      });
      if (!gasReservation) throw new Error('Kraken bootstrap placement rejected: system-owned native gas reservation lost the capacity race');
      try {
        await bindSystemNativeGasSpendSubmission(gasReservation.spendId, transactionHash);
      } catch (error) {
        await releaseUnsubmittedSystemNativeGasSpend(gasReservation.spendId).catch(() => undefined);
        throw error;
      }
      try {
        await persistPrepared({
          row: input.row,
          validated: input.validated,
          destination: input.destination,
          transactionHash,
          chainId: network.chainId,
          nonce,
          gasLimit: gasLimit.toString(),
          maximumGasWei,
          systemNativeGasSpendId: gasReservation.spendId,
          systemNativeGasScope: gasAuthority.scope,
        });
      } catch (error) {
        await quarantineSubmittedSystemNativeGasSpend(gasReservation.spendId, error).catch(() => undefined);
        throw error;
      }
      try {
        const submitted = await provider.sendTransaction(signed);
        if (submitted.hash.toLowerCase() !== transactionHash) throw new Error('Kraken placement RPC returned a different transaction hash');
      } catch (error) {
        const observed = await provider.getTransaction(transactionHash).catch(() => null);
        if (!observed) {
          await quarantineSubmittedSystemNativeGasSpend(gasReservation.spendId, error).catch(() => undefined);
          logger.error('[KrakenPlacement] Broadcast outcome unresolved; capital remains reserved', {
            component: 'KrakenSystemCapitalPlacement', allocationId: input.row.allocation_id,
            transactionHash, error: error instanceof Error ? error.message : String(error),
            duplicateSubmissionAllowed: false, sourceCapitalReleased: false, systemNativeGasReleased: false,
          });
        }
      }
      return transactionHash;
    },
  });
}

function finiteNonNegative(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function findTerminalDeposit(row: AllocationRow, txHash: string): Promise<{ grossAmount: number; feeAmount: number; reference: string; status: string } | null> {
  const asset = row.destination_asset.toUpperCase();
  const result = await krakenPrivateRequest('/0/private/DepositStatus', { asset }, { encoding: 'json' });
  const matches = (Array.isArray(result) ? result : []).filter((deposit: any) => String(deposit?.txid || '').trim().toLowerCase() === txHash);
  if (matches.length > 1) throw new Error(`Kraken returned multiple deposit records for exact transaction ${txHash}`);
  if (matches.length === 0) return null;
  const deposit = matches[0];
  const status = String(deposit?.status || '').trim();
  const statusProp = String(deposit?.['status-prop'] || '').trim().toLowerCase();
  if (status.toLowerCase() !== 'success' || statusProp === 'onhold') return null;
  const grossAmount = finiteNonNegative(deposit?.amount);
  const feeAmount = finiteNonNegative(deposit?.fee) ?? 0;
  if (grossAmount === null || !(grossAmount > 0) || feeAmount > grossAmount) throw new Error('Kraken terminal deposit returned invalid amount/fee evidence');
  return { grossAmount, feeAmount, reference: String(deposit?.refid || '').trim(), status };
}

async function proveKrakenSpendability(row: AllocationRow, deliveredAmount: number): Promise<string> {
  const balances = await createProductionCexSettlementAdapters().kraken.getBalances?.();
  if (!balances) throw new Error('Kraken balance reconciliation is unavailable');
  const asset = row.destination_asset.toUpperCase();
  const available = Number(balances[asset] ?? 0);
  if (!Number.isFinite(available) || available + 1e-12 < deliveredAmount) {
    throw new Error(`Kraken completed deposit is not yet spendable: required=${deliveredAmount} available=${String(balances[asset] ?? '0')}`);
  }
  return String(balances[asset] ?? '0');
}

export async function reconcileKrakenSystemCapitalPlacement(rowOrId: AllocationRow | string): Promise<KrakenSystemCapitalPlacementResult> {
  const row = typeof rowOrId === 'string' ? await loadAllocation(rowOrId) : rowOrId;
  const validated = validateAllocation(row);
  if (row.status === 'PLACED') return { allocationId: row.allocation_id, venue: 'kraken', status: 'PLACED', transactionHash: row.placement_reference || undefined };
  if (row.status !== 'PLACEMENT_PENDING') throw new Error(`Kraken reconciliation requires PLACEMENT_PENDING, received ${row.status}`);
  const txHash = String(row.placement_reference || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(txHash)) throw new Error('Kraken pending placement has no valid prepared transaction hash');
  const evidence = row.placement_evidence || {};

  await multiProviderRpcManager.initialize([validated.chain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(validated.chain, 'receipts');
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) return { allocationId: row.allocation_id, venue: 'kraken', status: 'PLACEMENT_PENDING', transactionHash: txHash, reason: 'On-chain transfer receipt remains pending' };
  await settlePlacementNativeGas(row, txHash, receipt);
  if (receipt.status !== 1) throw new Error(`Kraken system-capital source transfer ${txHash} failed onchain`);

  const deposit = await findTerminalDeposit(row, txHash);
  if (!deposit) return { allocationId: row.allocation_id, venue: 'kraken', status: 'PLACEMENT_PENDING', transactionHash: txHash, reason: 'Exact Kraken deposit is not yet terminal and spendable' };
  const deliveredAmount = deposit.grossAmount - deposit.feeAmount;
  if (!(deliveredAmount > 0)) throw new Error('Kraken terminal deposit delivered no positive spendable capital after fee');
  const available = await proveKrakenSpendability(row, deliveredAmount);
  const deliveredAmountBaseUnits = BigInt(ethers.utils.parseUnits(deliveredAmount.toFixed(row.destination_asset_decimals), row.destination_asset_decimals).toString()).toString();
  if (BigInt(deliveredAmountBaseUnits) > validated.sourceAmount) throw new Error('Kraken delivered amount exceeds reserved source ownership');

  await confirmSystemCapitalPlacement({
    allocationId: row.allocation_id,
    placementReference: txHash,
    deliveredAmountBaseUnits,
    placementEvidence: {
      ...evidence,
      krakenDepositReference: deposit.reference,
      krakenDepositStatus: deposit.status,
      krakenDepositGrossAmount: deposit.grossAmount,
      krakenDepositFeeAmount: deposit.feeAmount,
      krakenSpendableBalance: available,
      onchainReceiptStatus: receipt.status,
      blockNumber: receipt.blockNumber,
      settlementConfirmed: true,
      tradingAccountSpendableAuthority: true,
      systemNativeGasAuthority: Boolean(evidence.systemNativeGasSpendId),
      rawWalletNativeBalanceAuthority: false,
      ownershipCreatedOnlyByExactTransactionDeposit: true,
    },
  });
  return { allocationId: row.allocation_id, venue: 'kraken', status: 'PLACED', transactionHash: txHash, deliveredAmountBaseUnits };
}

export async function placeReservedKrakenSystemCapital(allocationId: string): Promise<KrakenSystemCapitalPlacementResult> {
  let row = await loadAllocation(allocationId);
  const validated = validateAllocation(row);
  if (row.status === 'PLACED' || row.status === 'PLACEMENT_PENDING') return reconcileKrakenSystemCapitalPlacement(row);
  const destination = await resolveDepositDestination(row, validated);
  const transactionHash = await broadcastPrepared({ row, validated, destination });
  row = await loadAllocation(allocationId);
  if (String(row.placement_reference || '').toLowerCase() !== transactionHash) throw new Error('Kraken durable placement reference changed after broadcast');
  return reconcileKrakenSystemCapitalPlacement(row);
}

export async function reconcilePendingKrakenSystemCapitalPlacements(limit = 20): Promise<KrakenSystemCapitalPlacementResult[]> {
  const capped = Math.max(1, Math.min(100, Math.trunc(limit)));
  const result = await pool.query(
    `SELECT allocation_id FROM ${TABLE}
     WHERE destination_kind='cex' AND lower(COALESCE(destination_venue,''))='kraken' AND status='PLACEMENT_PENDING'
     ORDER BY updated_at ASC LIMIT $1`,
    [capped],
  );
  const outcomes: KrakenSystemCapitalPlacementResult[] = [];
  for (const record of result.rows) {
    try {
      outcomes.push(await reconcileKrakenSystemCapitalPlacement(String(record.allocation_id)));
    } catch (error) {
      logger.error('[KrakenPlacement] Pending placement reconciliation failed closed', {
        component: 'KrakenSystemCapitalPlacement', allocationId: String(record.allocation_id),
        error: error instanceof Error ? error.message : String(error), sourceCapitalReleased: false,
        destinationInventorySpendable: false,
      });
    }
  }
  return outcomes;
}
