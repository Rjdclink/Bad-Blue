import { createHash } from 'node:crypto';
import { BigNumber, Contract, ethers } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager, type SupportedChain as RpcSupportedChain } from '../api/blockchain-providers.js';
import { normalizePrivateKey, walletFromPrivateKey } from '../core/wallet-identity.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { withEvmSignerLane } from './evm-signer-lane.js';
import { confirmSystemCapitalPlacement } from './system-capital-allocation-ledger.js';

const ERC20_TRANSFER_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
];
const SYSTEM_CAPITAL_TABLE = 'public.cryptocrawler_system_capital_allocations';
const SUPPORTED_SOURCE_CHAINS = new Set<RpcSupportedChain>([
  'ethereum', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc',
]);

type CexCapitalVenue = 'okx' | 'kraken';
type OkxDepositAccount = '6' | '18';
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

export interface CexSystemCapitalPlacementResult {
  allocationId: string;
  venue: CexCapitalVenue;
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

function parseCapitalScope(scope: string): { chain: RpcSupportedChain; tokenAddress: string; recipient: string } {
  const parts = scope.trim().split(':');
  if (parts.length !== 4 || !['zero-capital', 'system-capital'].includes(parts[0])) {
    throw new Error('CEX placement requires canonical system-generated capital provenance with chain/token/recipient identity');
  }
  const chain = parts[1] as RpcSupportedChain;
  if (!SUPPORTED_SOURCE_CHAINS.has(chain)) {
    throw new Error(`CEX placement source chain ${parts[1]} is not supported by the canonical EVM placement lane`);
  }
  return {
    chain,
    tokenAddress: canonicalAddress('capital scope token', parts[2]),
    recipient: canonicalAddress('capital scope recipient', parts[3]),
  };
}

function okxTransferClientId(allocationId: string, transactionHash: string): string {
  return createHash('sha256')
    .update(`cryptocrawl:okx:funding-to-trading:${allocationId}:${transactionHash.toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
}

async function loadAllocation(allocationId: string): Promise<AllocationRow> {
  const result = await pool.query(
    `SELECT allocation_id, capital_scope, opportunity_id, strategy,
            destination_kind, destination_venue, source_chain, source_asset,
            source_token_address, source_asset_decimals, source_recipient,
            source_amount_base_units, destination_asset, destination_asset_decimals,
            status, placement_reference, placement_evidence
     FROM ${SYSTEM_CAPITAL_TABLE}
     WHERE allocation_id=$1`,
    [allocationId],
  );
  if (!result.rows[0]) throw new Error(`System-capital allocation ${allocationId} does not exist`);
  return result.rows[0] as AllocationRow;
}

function requirePlacementAllocation(row: AllocationRow): {
  venue: CexCapitalVenue;
  chain: RpcSupportedChain;
  tokenAddress: string;
  sourceRecipient: string;
  sourceAmount: bigint;
} {
  if (row.destination_kind !== 'cex') throw new Error('System-capital placement row is not a CEX allocation');
  const venue = String(row.destination_venue || '').toLowerCase();
  if (venue === 'coinbase') throw new Error('Coinbase operator account is evidence-only and cannot receive system-capital placement');
  if (venue !== 'okx' && venue !== 'kraken') throw new Error(`Unsupported CEX system-capital destination: ${venue || 'missing'}`);
  if (!['RESERVED', 'PLACEMENT_PENDING', 'PLACED'].includes(row.status)) {
    throw new Error(`CEX system-capital placement cannot proceed from ${row.status}`);
  }
  const scope = parseCapitalScope(row.capital_scope);
  if (scope.chain !== row.source_chain.toLowerCase()) throw new Error('Allocation source chain does not match SELF_FUNDED capital scope');
  const sourceRecipient = canonicalAddress('allocation source recipient', row.source_recipient);
  if (scope.recipient !== sourceRecipient) throw new Error('Allocation source recipient does not match SELF_FUNDED capital scope');
  if (row.source_token_address && canonicalAddress('stored source token', row.source_token_address) !== scope.tokenAddress) {
    throw new Error('Stored source token contract conflicts with SELF_FUNDED capital scope');
  }
  const asset = row.source_asset.toUpperCase();
  if (asset !== 'USDC' && asset !== 'USDT') throw new Error(`CEX bootstrap supports retained USDC/USDT only; received ${asset}`);
  if (row.destination_asset.toUpperCase() !== asset) throw new Error('CEX placement cannot change asset identity without an explicit governed conversion');
  if (row.destination_asset_decimals !== row.source_asset_decimals) throw new Error('CEX placement cannot change token decimals without an explicit conversion');
  return {
    venue: venue as CexCapitalVenue,
    chain: scope.chain,
    tokenAddress: scope.tokenAddress,
    sourceRecipient,
    sourceAmount: positiveBaseUnits('source_amount_base_units', String(row.source_amount_base_units)),
  };
}

async function resolveOkxDeposit(row: AllocationRow, tokenAddress: string): Promise<{
  address: string;
  chain: string;
  depositAccount: OkxDepositAccount;
}> {
  const asset = row.source_asset.toUpperCase();
  const currencies = await okxPrivateRequest('/api/v5/asset/currencies', 'GET', { ccy: asset }, { lane: 'account_read' });
  const matching = currencies.data.filter((entry: any) => {
    const contractAddress = String(entry?.ctAddr || '').trim().toLowerCase();
    const canDeposit = entry?.canDep === true || String(entry?.canDep).toLowerCase() === 'true';
    return contractAddress === tokenAddress && canDeposit;
  });
  if (matching.length !== 1) {
    throw new Error(`OKX deposit network cannot be proven uniquely from source token contract ${tokenAddress}; matches=${matching.length}`);
  }
  const chain = String(matching[0]?.chain || '').trim();
  if (!chain) throw new Error('OKX deposit network returned no chain identity');
  const minDep = String(matching[0]?.minDep ?? '0').trim();
  if (minDep && Number(minDep) > 0) {
    const minimum = BigInt(ethers.utils.parseUnits(minDep, row.source_asset_decimals).toString());
    if (BigInt(row.source_amount_base_units) < minimum) {
      throw new Error(`OKX deposit amount is below the authenticated network minimum: required=${minimum.toString()} requested=${row.source_amount_base_units}`);
    }
  }

  const addresses = await okxPrivateRequest('/api/v5/asset/deposit-address', 'GET', { ccy: asset }, { lane: 'account_read' });
  const candidates = addresses.data.filter((entry: any) => {
    const contractSuffix = String(entry?.ctAddr || '').trim().toLowerCase();
    return String(entry?.chain || '').trim() === chain && contractSuffix.length === 6 && tokenAddress.endsWith(contractSuffix);
  });
  if (candidates.length < 1) throw new Error(`OKX returned no contract-compatible deposit address for authenticated chain ${chain}`);
  const preferred = candidates.find((entry: any) => entry?.selected === true || String(entry?.selected).toLowerCase() === 'true') || candidates[0];
  const address = canonicalAddress('OKX deposit address', String(preferred?.addr || ''));
  const tag = String(preferred?.tag || preferred?.memo || preferred?.pmtId || '').trim();
  if (tag) throw new Error('OKX deposit network requires a tag/memo/payment ID; tagged ERC20 placement is not implemented and fails closed');
  const depositAccount = String(preferred?.to || '').trim();
  if (depositAccount !== '6' && depositAccount !== '18') {
    throw new Error(`OKX deposit address returned unsupported beneficiary account ${depositAccount || 'missing'}`);
  }
  return { address, chain, depositAccount };
}

async function persistPreparedPlacement(input: {
  allocationId: string;
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
    [input.allocationId, input.tokenAddress, input.transactionHash, JSON.stringify(input.evidence)],
  );
  if (result.rowCount === 1) return;
  const current = await loadAllocation(input.allocationId);
  if (
    current.status === 'PLACEMENT_PENDING' &&
    String(current.placement_reference || '').toLowerCase() === input.transactionHash &&
    String(current.source_token_address || '').toLowerCase() === input.tokenAddress
  ) return;
  throw new Error('System-capital placement could not atomically bind the prepared transaction to the reserved allocation');
}

async function mergePlacementEvidence(allocationId: string, evidence: Record<string, unknown>): Promise<void> {
  const result = await pool.query(
    `UPDATE ${SYSTEM_CAPITAL_TABLE}
     SET placement_evidence=COALESCE(placement_evidence, '{}'::jsonb) || $2::jsonb,
         updated_at=now()
     WHERE allocation_id=$1 AND status='PLACEMENT_PENDING'
     RETURNING allocation_id`,
    [allocationId, JSON.stringify(evidence)],
  );
  if (result.rowCount !== 1) throw new Error(`Pending system-capital placement ${allocationId} is no longer mutable`);
}

async function preparePersistAndBroadcastOkxTransfer(input: {
  row: AllocationRow;
  chain: RpcSupportedChain;
  tokenAddress: string;
  sourceRecipient: string;
  sourceAmount: bigint;
  depositAddress: string;
  authenticatedExchangeChain: string;
  authenticatedDepositAccount: OkxDepositAccount;
}): Promise<string> {
  const privateKey = normalizePrivateKey(process.env.WALLET_PRIVATE_KEY);
  if (!privateKey) throw new Error('WALLET_PRIVATE_KEY is required for system-capital placement');
  await multiProviderRpcManager.initialize([input.chain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(input.chain, 'json_rpc');
  const wallet = walletFromPrivateKey(privateKey).connect(provider);
  if (wallet.address.toLowerCase() !== input.sourceRecipient) {
    throw new Error('Canonical signer address does not match the SELF_FUNDED source recipient');
  }
  const network = await provider.getNetwork();
  if (!Number.isSafeInteger(network.chainId) || network.chainId <= 0) throw new Error('Source RPC returned an invalid chain id');

  return withEvmSignerLane({
    chainId: network.chainId,
    walletAddress: wallet.address,
    operation: async () => {
      getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: input.chain });
      const current = await loadAllocation(input.row.allocation_id);
      if (current.status !== 'RESERVED') {
        if (current.status === 'PLACEMENT_PENDING' && /^0x[a-fA-F0-9]{64}$/.test(String(current.placement_reference || ''))) {
          return String(current.placement_reference).toLowerCase();
        }
        throw new Error(`System-capital allocation changed before physical submission: ${current.status}`);
      }

      const token = new Contract(input.tokenAddress, ERC20_TRANSFER_ABI, wallet);
      const [decimalsRaw, balanceRaw] = await Promise.all([token.decimals(), token.balanceOf(wallet.address)]);
      const decimals = Number(decimalsRaw);
      if (decimals !== input.row.source_asset_decimals) {
        throw new Error(`Source token decimals mismatch: contract=${decimals} allocation=${input.row.source_asset_decimals}`);
      }
      const balance = BigInt(balanceRaw.toString());
      if (balance < input.sourceAmount) {
        throw new Error(`SELF_FUNDED source wallet does not physically hold the reserved token units: required=${input.sourceAmount.toString()} observed=${balance.toString()}`);
      }

      const populated = await token.populateTransaction.transfer(
        input.depositAddress,
        BigNumber.from(input.sourceAmount.toString()),
      );
      const nonce = await provider.getTransactionCount(wallet.address, 'pending');
      const gasLimit = await provider.estimateGas({ ...populated, from: wallet.address });
      const feeData = await provider.getFeeData();
      const transaction: ethers.providers.TransactionRequest = {
        ...populated,
        chainId: network.chainId,
        nonce,
        gasLimit,
      };
      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        transaction.type = 2;
        transaction.maxFeePerGas = feeData.maxFeePerGas;
        transaction.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
      } else if (feeData.gasPrice) {
        transaction.gasPrice = feeData.gasPrice;
      } else {
        throw new Error('Source RPC returned no usable EVM fee data');
      }

      const signedTransaction = await wallet.signTransaction(transaction);
      const transactionHash = ethers.utils.keccak256(signedTransaction).toLowerCase();
      await persistPreparedPlacement({
        allocationId: input.row.allocation_id,
        tokenAddress: input.tokenAddress,
        transactionHash,
        evidence: {
          venue: 'okx',
          depositAddress: input.depositAddress,
          authenticatedExchangeChain: input.authenticatedExchangeChain,
          authenticatedDepositAccount: input.authenticatedDepositAccount,
          authenticatedSourceTokenContract: input.tokenAddress,
          sourceAsset: input.row.source_asset.toUpperCase(),
          sourceAssetDecimals: input.row.source_asset_decimals,
          sourceAmountBaseUnits: input.sourceAmount.toString(),
          expectedTransactionHash: transactionHash,
          chainId: network.chainId,
          nonce,
          gasLimit: gasLimit.toString(),
          signedTransactionPersisted: false,
          preparedBeforeBroadcast: true,
          signerLaneHeldThroughBroadcast: true,
        },
      });

      try {
        const submitted = await provider.sendTransaction(signedTransaction);
        if (submitted.hash.toLowerCase() !== transactionHash) {
          throw new Error(`Provider returned a transaction hash different from the locally signed placement hash: expected=${transactionHash} observed=${submitted.hash}`);
        }
      } catch (error) {
        const receipt = await provider.getTransactionReceipt(transactionHash).catch(() => null);
        if (!receipt) {
          logger.error('[SystemCapitalPlacement] Broadcast outcome unresolved; allocation remains PLACEMENT_PENDING', {
            component: 'SystemCapitalPlacement',
            allocationId: input.row.allocation_id,
            venue: 'okx',
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

async function okxDepositConfirmation(row: AllocationRow, transactionHash: string, authenticatedChain: string, depositAddress: string): Promise<{
  confirmed: boolean;
  deliveredBaseUnits?: string;
  creditedAmount?: string;
  evidence: Record<string, unknown>;
}> {
  const asset = row.destination_asset.toUpperCase();
  const history = await okxPrivateRequest('/api/v5/asset/deposit-history', 'GET', { ccy: asset, txId: transactionHash }, { lane: 'account_read' });
  const candidate = history.data.find((entry: any) =>
    String(entry?.txId || '').toLowerCase() === transactionHash.toLowerCase() &&
    String(entry?.chain || '').trim() === authenticatedChain,
  );
  if (!candidate) {
    return {
      confirmed: false,
      evidence: { venue: 'okx', transactionHash, authenticatedChain, depositAddress, depositObserved: false },
    };
  }
  const state = String(candidate.state ?? '').trim();
  const amount = String(candidate.amt ?? '').trim();
  if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    throw new Error('OKX deposit history returned an invalid credited amount');
  }
  const deliveredBaseUnits = ethers.utils.parseUnits(amount, row.destination_asset_decimals).toString();
  const toAddress = String(candidate.to || '').trim().toLowerCase();
  if (toAddress && /^0x[a-f0-9]{40}$/.test(toAddress) && toAddress !== depositAddress.toLowerCase()) {
    throw new Error('OKX deposit history destination does not match the authenticated deposit address');
  }
  return {
    confirmed: state === '2',
    deliveredBaseUnits,
    creditedAmount: amount,
    evidence: {
      venue: 'okx',
      transactionHash,
      authenticatedChain,
      depositAddress,
      depositObserved: true,
      exchangeState: state,
      creditedAmount: amount,
      deliveredBaseUnits,
      exchangeTerminalCreditRequired: '2',
    },
  };
}

async function ensureOkxTradingAccountCredit(input: {
  row: AllocationRow;
  transactionHash: string;
  depositAccount: OkxDepositAccount;
  creditedAmount: string;
  deliveredBaseUnits: string;
}): Promise<{ confirmed: boolean; evidence: Record<string, unknown> }> {
  if (input.depositAccount === '18') {
    return {
      confirmed: true,
      evidence: {
        okxTradingAccountCredit: 'direct_deposit',
        okxDepositBeneficiaryAccount: '18',
        okxInternalTransferRequired: false,
      },
    };
  }

  const clientId = okxTransferClientId(input.row.allocation_id, input.transactionHash);
  const expectedBaseUnits = BigInt(input.deliveredBaseUnits);
  let stateRows: any[] = [];
  try {
    const state = await okxPrivateRequest(
      '/api/v5/asset/transfer-state',
      'GET',
      { clientId, type: '0' },
      { lane: 'account_read' },
    );
    stateRows = state.data;
  } catch {
    stateRows = [];
  }

  if (stateRows.length === 0) {
    try {
      const submitted = await okxPrivateRequest(
        '/api/v5/asset/transfer',
        'POST',
        {
          ccy: input.row.destination_asset.toUpperCase(),
          amt: input.creditedAmount,
          from: '6',
          to: '18',
          type: '0',
          clientId,
        },
        { lane: 'order_write' },
      );
      const transfer = submitted.data[0];
      await mergePlacementEvidence(input.row.allocation_id, {
        okxDepositBeneficiaryAccount: '6',
        okxInternalTransferRequired: true,
        okxInternalTransferClientId: clientId,
        okxInternalTransferId: transfer?.transId ? String(transfer.transId) : null,
        okxInternalTransferRequestedAmount: input.creditedAmount,
        okxInternalTransferRequestedBaseUnits: input.deliveredBaseUnits,
      });
    } catch (error) {
      logger.warn('[SystemCapitalPlacement] OKX funding-to-trading transfer submission requires state reconciliation', {
        component: 'SystemCapitalPlacement',
        allocationId: input.row.allocation_id,
        transactionHash: input.transactionHash,
        clientId,
        error: error instanceof Error ? error.message : String(error),
        duplicateTransferClientIdAllowed: false,
      });
    }

    const state = await okxPrivateRequest(
      '/api/v5/asset/transfer-state',
      'GET',
      { clientId, type: '0' },
      { lane: 'account_read' },
    );
    stateRows = state.data;
  }

  const transfer = stateRows[0];
  if (!transfer) {
    return {
      confirmed: false,
      evidence: {
        okxDepositBeneficiaryAccount: '6',
        okxInternalTransferRequired: true,
        okxInternalTransferClientId: clientId,
        okxInternalTransferState: 'unresolved',
      },
    };
  }
  const state = String(transfer.state || '').trim().toLowerCase();
  const from = String(transfer.from || '').trim();
  const to = String(transfer.to || '').trim();
  const ccy = String(transfer.ccy || '').trim().toUpperCase();
  const amount = String(transfer.amt || '').trim();
  if (from !== '6' || to !== '18' || ccy !== input.row.destination_asset.toUpperCase()) {
    throw new Error('OKX internal transfer state does not match the expected Funding-to-Trading capital movement');
  }
  const observedBaseUnits = BigInt(ethers.utils.parseUnits(amount, input.row.destination_asset_decimals).toString());
  if (observedBaseUnits !== expectedBaseUnits) {
    throw new Error(`OKX internal transfer amount mismatch: expected=${expectedBaseUnits.toString()} observed=${observedBaseUnits.toString()}`);
  }
  await mergePlacementEvidence(input.row.allocation_id, {
    okxDepositBeneficiaryAccount: '6',
    okxInternalTransferRequired: true,
    okxInternalTransferClientId: clientId,
    okxInternalTransferId: transfer.transId ? String(transfer.transId) : null,
    okxInternalTransferState: state,
    okxInternalTransferAmount: amount,
    okxInternalTransferBaseUnits: observedBaseUnits.toString(),
  });
  if (state === 'failed') throw new Error('OKX Funding-to-Trading transfer reached terminal failed state');
  return {
    confirmed: state === 'success',
    evidence: {
      okxDepositBeneficiaryAccount: '6',
      okxInternalTransferRequired: true,
      okxInternalTransferClientId: clientId,
      okxInternalTransferId: transfer.transId ? String(transfer.transId) : null,
      okxInternalTransferState: state,
      okxInternalTransferAmount: amount,
      okxInternalTransferBaseUnits: observedBaseUnits.toString(),
      okxTradingAccountCredit: state === 'success' ? 'confirmed' : 'pending',
    },
  };
}

async function reconcileOkxPlacement(row: AllocationRow): Promise<CexSystemCapitalPlacementResult> {
  const validated = requirePlacementAllocation(row);
  const txHash = String(row.placement_reference || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(txHash)) throw new Error('PLACEMENT_PENDING OKX allocation has no valid prepared transaction hash');
  const evidence = row.placement_evidence || {};
  const authenticatedChain = String(evidence.authenticatedExchangeChain || '').trim();
  const depositAddress = canonicalAddress('persisted OKX deposit address', String(evidence.depositAddress || ''));
  const depositAccount = String(evidence.authenticatedDepositAccount || '').trim();
  if (!authenticatedChain) throw new Error('PLACEMENT_PENDING OKX allocation has no authenticated exchange-chain identity');
  if (depositAccount !== '6' && depositAccount !== '18') {
    throw new Error('PLACEMENT_PENDING OKX allocation has no authenticated Funding/Trading beneficiary account');
  }

  await multiProviderRpcManager.initialize([validated.chain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(validated.chain, 'receipts');
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    return {
      allocationId: row.allocation_id,
      venue: 'okx',
      status: 'PLACEMENT_PENDING',
      transactionHash: txHash,
      reason: 'Prepared/submitted transaction is not yet receipt-confirmed; source capital remains reserved and cannot be duplicated',
    };
  }
  if (receipt.status !== 1) {
    throw new Error(`System-capital transfer ${txHash} reached a failed on-chain receipt; allocation remains non-spendable pending explicit recovery`);
  }

  const deposit = await okxDepositConfirmation(row, txHash, authenticatedChain, depositAddress);
  if (!deposit.confirmed || !deposit.deliveredBaseUnits || !deposit.creditedAmount) {
    return {
      allocationId: row.allocation_id,
      venue: 'okx',
      status: 'PLACEMENT_PENDING',
      transactionHash: txHash,
      deliveredAmountBaseUnits: deposit.deliveredBaseUnits,
      reason: 'On-chain transfer is confirmed, but OKX has not yet reached terminal deposit state 2',
    };
  }

  const tradingCredit = await ensureOkxTradingAccountCredit({
    row,
    transactionHash: txHash,
    depositAccount: depositAccount as OkxDepositAccount,
    creditedAmount: deposit.creditedAmount,
    deliveredBaseUnits: deposit.deliveredBaseUnits,
  });
  if (!tradingCredit.confirmed) {
    return {
      allocationId: row.allocation_id,
      venue: 'okx',
      status: 'PLACEMENT_PENDING',
      transactionHash: txHash,
      deliveredAmountBaseUnits: deposit.deliveredBaseUnits,
      reason: 'OKX deposit is successful, but Funding-to-Trading settlement has not yet reached transfer-state=success',
    };
  }

  await confirmSystemCapitalPlacement({
    allocationId: row.allocation_id,
    placementReference: txHash,
    placementEvidence: {
      ...evidence,
      ...deposit.evidence,
      ...tradingCredit.evidence,
      onchainReceiptStatus: receipt.status,
      blockNumber: receipt.blockNumber,
      settlementConfirmed: true,
      tradingAccountSpendableAuthority: true,
    },
    deliveredAmountBaseUnits: deposit.deliveredBaseUnits,
  });
  return {
    allocationId: row.allocation_id,
    venue: 'okx',
    status: 'PLACED',
    transactionHash: txHash,
    deliveredAmountBaseUnits: deposit.deliveredBaseUnits,
  };
}

export async function placeReservedCexSystemCapital(allocationId: string): Promise<CexSystemCapitalPlacementResult> {
  let row = await loadAllocation(allocationId);
  const validated = requirePlacementAllocation(row);
  if (row.status === 'PLACED') {
    return { allocationId, venue: validated.venue, status: 'PLACED', transactionHash: row.placement_reference || undefined };
  }
  if (validated.venue === 'kraken') {
    throw new Error('Kraken CEX seeding remains fail-closed until its authenticated funding method proves exact source-network compatibility and exchange-side deposit status by transaction hash');
  }
  if (row.status === 'PLACEMENT_PENDING') return reconcileOkxPlacement(row);

  const deposit = await resolveOkxDeposit(row, validated.tokenAddress);
  const transactionHash = await preparePersistAndBroadcastOkxTransfer({
    row,
    chain: validated.chain,
    tokenAddress: validated.tokenAddress,
    sourceRecipient: validated.sourceRecipient,
    sourceAmount: validated.sourceAmount,
    depositAddress: deposit.address,
    authenticatedExchangeChain: deposit.chain,
    authenticatedDepositAccount: deposit.depositAccount,
  });
  row = await loadAllocation(allocationId);
  if (String(row.placement_reference || '').toLowerCase() !== transactionHash) {
    throw new Error('Durable placement reference changed after signed transaction submission');
  }
  return reconcileOkxPlacement(row);
}

export async function reconcilePendingCexSystemCapitalPlacements(limit = 20): Promise<CexSystemCapitalPlacementResult[]> {
  const capped = Math.max(1, Math.min(100, Math.trunc(limit)));
  const result = await pool.query(
    `SELECT allocation_id FROM ${SYSTEM_CAPITAL_TABLE}
     WHERE destination_kind='cex' AND status='PLACEMENT_PENDING'
     ORDER BY updated_at ASC LIMIT $1`,
    [capped],
  );
  const outcomes: CexSystemCapitalPlacementResult[] = [];
  for (const item of result.rows) {
    try {
      const row = await loadAllocation(String(item.allocation_id));
      const validated = requirePlacementAllocation(row);
      if (validated.venue !== 'okx') continue;
      outcomes.push(await reconcileOkxPlacement(row));
    } catch (error) {
      logger.error('[SystemCapitalPlacement] Pending CEX capital reconciliation failed closed', {
        component: 'SystemCapitalPlacement',
        allocationId: String(item.allocation_id),
        error: error instanceof Error ? error.message : String(error),
        sourceCapitalReleased: false,
        destinationInventorySpendable: false,
      });
    }
  }
  return outcomes;
}
