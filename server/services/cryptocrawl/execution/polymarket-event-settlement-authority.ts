import { BigNumber, Contract, Wallet, constants, utils } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import type { EventOutcome } from '../discovery/event-venue.js';
import { normalizePrivateKey } from '../core/wallet-identity.js';
import { getPolymarketAuthenticatedAccountSnapshot } from '../intelligence/polymarket-authenticated-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { executeSystemOwnedNativeTransaction } from './system-owned-native-transaction.js';
import { settleSystemNativeGasSpend } from './system-native-gas-spend-authority.js';

const REDEMPTIONS = 'private.cryptocrawler_polymarket_redemption_intents';
const ORDERS = 'private.cryptocrawler_polymarket_event_order_intents';
const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const CLOB_BASE = 'https://clob.polymarket.com';
const COLLATERAL = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB'; // pUSD, Polygon production.
const CONDITIONAL_TOKENS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const NEG_RISK_ADAPTER = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
const COLLATERAL_ADAPTER = '0xAdA100Db00Ca00073811820692005400218FcE1f';
const NEG_RISK_COLLATERAL_ADAPTER = '0xadA2005600Dec949baf300f4C6120000bDB6eAab';
const COLLATERAL_DECIMALS = 6n;
const CONTRACT_BASE_UNITS = 10n ** COLLATERAL_DECIMALS;
const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)'];
const ERC1155_ABI = ['function balanceOf(address account,uint256 id) view returns (uint256)'];
const REDEEM_ABI = ['function redeemPositions(address collateralToken,bytes32 parentCollectionId,bytes32 conditionId,uint256[] indexSets)'];

export interface PolymarketTerminalRedemptionResult {
  terminal: boolean;
  cashRealized: boolean;
  marketId: string;
  conditionId: string;
  outcome: EventOutcome;
  marketResult: EventOutcome;
  contracts: number;
  won: boolean;
  payoutUsd: number | null;
  transactionHash: string | null;
  gasSpentWei: bigint;
  observedAt: number;
  provenance: string[];
  error?: string;
}

type RedemptionStatus = 'PREPARING' | 'SUBMISSION_UNKNOWN' | 'SUBMITTED' | 'CONFIRMED' | 'NO_REDEMPTION_REQUIRED' | 'QUARANTINED';

type RedemptionRow = {
  redemptionId: string;
  lifecycleId: string;
  opportunityId: string;
  marketId: string;
  conditionId: string;
  tokenId: string;
  complementTokenId: string;
  outcome: EventOutcome;
  contracts: number;
  negRisk: boolean;
  status: RedemptionStatus;
  preCollateralBaseUnits: bigint;
  expectedPayoutBaseUnits: bigint;
  purchasedPositionBaseUnits: bigint;
  complementPositionBaseUnits: bigint;
  transactionHash: string | null;
  postCollateralBaseUnits: bigint | null;
  realizedPayoutBaseUnits: bigint | null;
  gasSpendWei: bigint | null;
  receiptEvidence: Record<string, unknown> | null;
  lastError: string | null;
};

function parseArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}
function integer(value: unknown): bigint | null {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  try { return BigInt(text); } catch { return null; }
}
function parseJson(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  try { const parsed = JSON.parse(String(value)); return parsed && typeof parsed === 'object' ? parsed : null; } catch { return null; }
}
function parseRow(row: any): RedemptionRow | null {
  if (!row?.redemption_id || !row?.lifecycle_id) return null;
  const pre = integer(row.pre_collateral_base_units);
  const expected = integer(row.expected_payout_base_units);
  const purchased = integer(row.purchased_position_base_units);
  const complement = integer(row.complement_position_base_units);
  if (pre === null || expected === null || purchased === null || complement === null) return null;
  return {
    redemptionId: String(row.redemption_id),
    lifecycleId: String(row.lifecycle_id),
    opportunityId: String(row.opportunity_id),
    marketId: String(row.market_id),
    conditionId: String(row.condition_id),
    tokenId: String(row.token_id),
    complementTokenId: String(row.complement_token_id),
    outcome: String(row.outcome) as EventOutcome,
    contracts: Number(row.contracts),
    negRisk: row.neg_risk === true,
    status: String(row.status) as RedemptionStatus,
    preCollateralBaseUnits: pre,
    expectedPayoutBaseUnits: expected,
    purchasedPositionBaseUnits: purchased,
    complementPositionBaseUnits: complement,
    transactionHash: row.transaction_hash ? String(row.transaction_hash).toLowerCase() : null,
    postCollateralBaseUnits: integer(row.post_collateral_base_units),
    realizedPayoutBaseUnits: integer(row.realized_payout_base_units),
    gasSpendWei: integer(row.gas_spend_wei),
    receiptEvidence: parseJson(row.receipt_evidence),
    lastError: row.last_error ? String(row.last_error) : null,
  };
}
function redemptionId(lifecycleId: string): string {
  return `poly-redeem:${utils.keccak256(utils.toUtf8Bytes(lifecycleId)).slice(2, 50)}`;
}
function gasIdempotencyKey(id: string): string { return `polymarket-redemption:${id}`; }
function toUsd(baseUnits: bigint): number {
  if (baseUnits > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('POLYMARKET_REDEMPTION_USD_OVERFLOW');
  return Number(baseUnits) / Number(CONTRACT_BASE_UNITS);
}
function executionWallet(): Wallet {
  const key = normalizePrivateKey(process.env.CRYPTOCRAWL_POLYMARKET_PRIVATE_KEY || process.env.POLYMARKET_PRIVATE_KEY);
  if (!key) throw new Error('POLYMARKET_REDEMPTION_EOA_SIGNER_UNAVAILABLE');
  return new Wallet(key);
}
async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`POLYMARKET_HTTP_${response.status}`);
  return response.json() as Promise<T>;
}
async function marketIdentity(input: { marketId: string; conditionId: string; outcome: EventOutcome; tokenId: string }): Promise<{ complementTokenId: string; negRisk: boolean }> {
  const payload = await json<any>(`${GAMMA_BASE}/markets?id=${encodeURIComponent(input.marketId)}`);
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.markets) ? payload.markets : [];
  const row = rows[0];
  if (!row) throw new Error('POLYMARKET_REDEMPTION_MARKET_UNAVAILABLE');
  const conditionId = String(row?.conditionId ?? row?.condition_id ?? '').trim();
  if (conditionId.toLowerCase() !== input.conditionId.toLowerCase()) throw new Error('POLYMARKET_REDEMPTION_CONDITION_ID_CHANGED');
  const outcomes = parseArray(row?.outcomes).map(value => value.trim().toLowerCase());
  const ids = Array.isArray(row?.clob_token_ids) ? row.clob_token_ids.map(String) : parseArray(row?.clobTokenIds);
  const index = outcomes.indexOf(input.outcome);
  const complementIndex = outcomes.indexOf(input.outcome === 'yes' ? 'no' : 'yes');
  if (index < 0 || complementIndex < 0 || ids[index] !== input.tokenId || !ids[complementIndex]) {
    throw new Error('POLYMARKET_REDEMPTION_OUTCOME_TOKEN_IDENTITY_CHANGED');
  }
  const neg = await json<any>(`${CLOB_BASE}/neg-risk?token_id=${encodeURIComponent(input.tokenId)}`);
  if (typeof neg?.neg_risk !== 'boolean') throw new Error('POLYMARKET_REDEMPTION_NEG_RISK_EVIDENCE_MISSING');
  return { complementTokenId: String(ids[complementIndex]), negRisk: neg.neg_risk };
}
async function orderIntent(orderId: string): Promise<{ marketId: string; conditionId: string; tokenId: string; outcome: EventOutcome; contracts: number } | null> {
  const query = await pool.query(
    `SELECT market_id,condition_id,token_id,outcome,contracts,status FROM ${ORDERS} WHERE order_id=$1 LIMIT 1`,
    [orderId],
  );
  const row = query.rows?.[0];
  if (!row || String(row.status) !== 'FILLED') return null;
  const contracts = Number(row.contracts);
  if (!Number.isInteger(contracts) || contracts <= 0) return null;
  return {
    marketId: String(row.market_id), conditionId: String(row.condition_id), tokenId: String(row.token_id),
    outcome: String(row.outcome) as EventOutcome, contracts,
  };
}
async function balances(input: { wallet: string; tokenId: string; complementTokenId: string; negRisk: boolean }): Promise<{ collateral: bigint; purchased: bigint; complement: bigint }> {
  const managed = await multiProviderRpcManager.getHttpProvider('polygon', 'contract_calls');
  const collateral = new Contract(COLLATERAL, ERC20_ABI, managed.http);
  const positions = new Contract(input.negRisk ? NEG_RISK_ADAPTER : CONDITIONAL_TOKENS, ERC1155_ABI, managed.http);
  const [cash, purchased, complement] = await Promise.all([
    collateral.balanceOf(input.wallet), positions.balanceOf(input.wallet, input.tokenId), positions.balanceOf(input.wallet, input.complementTokenId),
  ]);
  return {
    collateral: BigInt(cash.toString()), purchased: BigInt(purchased.toString()), complement: BigInt(complement.toString()),
  };
}
async function load(id: string): Promise<RedemptionRow | null> {
  const query = await pool.query(`SELECT * FROM ${REDEMPTIONS} WHERE redemption_id=$1`, [id]);
  return parseRow(query.rows?.[0]);
}
async function update(id: string, patch: Record<string, unknown>): Promise<RedemptionRow> {
  const allowed = new Set(['status','transaction_hash','post_collateral_base_units','realized_payout_base_units','gas_spend_wei','receipt_evidence','last_error','submitted_at','confirmed_at']);
  const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
  if (!entries.length) {
    const current = await load(id); if (!current) throw new Error('POLYMARKET_REDEMPTION_INTENT_MISSING'); return current;
  }
  const setters = entries.map(([key], index) => `${key}=$${index + 2}`).join(',');
  const query = await pool.query(`UPDATE ${REDEMPTIONS} SET ${setters},updated_at=now() WHERE redemption_id=$1 RETURNING *`, [id, ...entries.map(([, value]) => value)]);
  const row = parseRow(query.rows?.[0]);
  if (!row) throw new Error('POLYMARKET_REDEMPTION_INTENT_UPDATE_FAILED');
  return row;
}
async function createOrLoad(input: {
  lifecycleId: string; opportunityId: string; marketId: string; conditionId: string; tokenId: string;
  complementTokenId: string; outcome: EventOutcome; contracts: number; negRisk: boolean; won: boolean; wallet: string;
}): Promise<RedemptionRow> {
  const id = redemptionId(input.lifecycleId);
  const expected = input.won ? BigInt(input.contracts) * CONTRACT_BASE_UNITS : 0n;
  const observed = await balances({ wallet: input.wallet, tokenId: input.tokenId, complementTokenId: input.complementTokenId, negRisk: input.negRisk });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [id]);
    const prior = await client.query(`SELECT * FROM ${REDEMPTIONS} WHERE redemption_id=$1 FOR UPDATE`, [id]);
    const existing = parseRow(prior.rows?.[0]);
    if (existing) {
      if (existing.lifecycleId !== input.lifecycleId || existing.opportunityId !== input.opportunityId
        || existing.marketId !== input.marketId || existing.conditionId.toLowerCase() !== input.conditionId.toLowerCase()
        || existing.tokenId !== input.tokenId || existing.complementTokenId !== input.complementTokenId
        || existing.outcome !== input.outcome || existing.contracts !== input.contracts || existing.negRisk !== input.negRisk
        || existing.expectedPayoutBaseUnits !== expected) {
        throw new Error('POLYMARKET_REDEMPTION_IMMUTABLE_INTENT_MISMATCH');
      }
      await client.query('COMMIT');
      return existing;
    }
    const expectedPosition = BigInt(input.contracts) * CONTRACT_BASE_UNITS;
    if (observed.purchased !== expectedPosition || observed.complement !== 0n) {
      throw new Error(`POLYMARKET_REDEMPTION_POSITION_NOT_LIFECYCLE_ISOLATED:${observed.purchased}:${observed.complement}`);
    }
    const status: RedemptionStatus = input.won ? 'PREPARING' : 'NO_REDEMPTION_REQUIRED';
    const inserted = await client.query(
      `INSERT INTO ${REDEMPTIONS} (
         redemption_id,lifecycle_id,opportunity_id,market_id,condition_id,token_id,complement_token_id,
         outcome,contracts,neg_risk,status,pre_collateral_base_units,expected_payout_base_units,
         purchased_position_base_units,complement_position_base_units,post_collateral_base_units,
         realized_payout_base_units,confirmed_at,receipt_evidence
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::numeric,$13::numeric,$14::numeric,$15::numeric,$16::numeric,$17::numeric,$18,$19::jsonb)
       RETURNING *`,
      [
        id,input.lifecycleId,input.opportunityId,input.marketId,input.conditionId,input.tokenId,input.complementTokenId,
        input.outcome,input.contracts,input.negRisk,status,observed.collateral.toString(),expected.toString(),
        observed.purchased.toString(),observed.complement.toString(),input.won ? null : observed.collateral.toString(),
        input.won ? null : '0',input.won ? null : new Date(),
        JSON.stringify(input.won ? {} : { terminalLosingPosition: true, payoutBaseUnits: '0', redemptionTransactionRequired: false }),
      ],
    );
    await client.query('COMMIT');
    const row = parseRow(inserted.rows?.[0]);
    if (!row) throw new Error('POLYMARKET_REDEMPTION_INTENT_INSERT_FAILED');
    return row;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
async function gasSpend(idempotencyKey: string): Promise<{ spendId: string; status: string; transactionHash: string | null; actualSpentWei: bigint | null } | null> {
  const query = await pool.query(
    `SELECT spend_id::text,status,transaction_hash,actual_spent_wei::text FROM public.cryptocrawler_system_native_gas_spends WHERE idempotency_key=$1 LIMIT 1`,
    [idempotencyKey],
  );
  const row = query.rows?.[0];
  if (!row) return null;
  return { spendId: String(row.spend_id), status: String(row.status), transactionHash: row.transaction_hash ? String(row.transaction_hash).toLowerCase() : null, actualSpentWei: integer(row.actual_spent_wei) };
}
async function reconcileExistingSubmission(row: RedemptionRow, wallet: Wallet): Promise<RedemptionRow | null> {
  const managed = await multiProviderRpcManager.getHttpProvider('polygon', 'transactions');
  const spend = await gasSpend(gasIdempotencyKey(row.redemptionId));
  const observed = await balances({ wallet: wallet.address, tokenId: row.tokenId, complementTokenId: row.complementTokenId, negRisk: row.negRisk });
  const delta = observed.collateral >= row.preCollateralBaseUnits ? observed.collateral - row.preCollateralBaseUnits : -1n;
  if (observed.purchased === 0n && observed.complement === 0n && delta === row.expectedPayoutBaseUnits) {
    const txHash = row.transactionHash ?? spend?.transactionHash ?? null;
    let gasWei = row.gasSpendWei ?? spend?.actualSpentWei ?? 0n;
    let receiptEvidence: Record<string, unknown> = row.receiptEvidence ?? {};
    if (txHash) {
      const receipt = await managed.http.getTransactionReceipt(txHash).catch(() => null);
      if (receipt?.status === 1) {
        const price = receipt.effectiveGasPrice;
        gasWei = BigInt(receipt.gasUsed.mul(price).toString());
        if (spend && spend.status !== 'SETTLED') {
          await settleSystemNativeGasSpend({
            spendId: spend.spendId, transactionHash: txHash, actualSpentWei: gasWei.toString(),
            evidence: { recoveredPolymarketRedemptionReceipt: true, blockNumber: receipt.blockNumber, receiptStatus: receipt.status },
          }).catch(() => undefined);
        }
        receiptEvidence = { transactionHash: txHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: price.toString(), receiptStatus: receipt.status, recoveredAfterRestart: true };
      }
    }
    return update(row.redemptionId, {
      status: 'CONFIRMED', transaction_hash: txHash, post_collateral_base_units: observed.collateral.toString(),
      realized_payout_base_units: delta.toString(), gas_spend_wei: gasWei.toString(), receipt_evidence: JSON.stringify(receiptEvidence),
      confirmed_at: new Date(), last_error: null,
    });
  }
  if (spend?.transactionHash && ['SUBMITTED','MANUAL_REVIEW','SETTLED'].includes(spend.status)) {
    const receipt = await managed.http.getTransactionReceipt(spend.transactionHash).catch(() => null);
    if (!receipt) return update(row.redemptionId, { status: 'SUBMISSION_UNKNOWN', transaction_hash: spend.transactionHash, last_error: 'POLYMARKET_REDEMPTION_RECEIPT_PENDING' });
    if (receipt.status !== 1) return update(row.redemptionId, { status: 'QUARANTINED', transaction_hash: spend.transactionHash, last_error: 'POLYMARKET_REDEMPTION_TRANSACTION_REVERTED', receipt_evidence: JSON.stringify({ blockNumber: receipt.blockNumber, receiptStatus: receipt.status }) });
    return update(row.redemptionId, { status: 'SUBMISSION_UNKNOWN', transaction_hash: spend.transactionHash, last_error: 'POLYMARKET_REDEMPTION_RECEIPT_CONFIRMED_BALANCE_DELTA_NOT_YET_PROVEN' });
  }
  return null;
}

export async function realizePolymarketEventSettlement(input: {
  lifecycleId: string;
  opportunityId: string;
  polymarketOrderId: string;
  marketId: string;
  conditionId: string;
  outcome: EventOutcome;
  marketResult: EventOutcome;
  contracts: number;
}): Promise<PolymarketTerminalRedemptionResult> {
  const order = await orderIntent(input.polymarketOrderId);
  if (!order || order.marketId !== input.marketId || order.conditionId.toLowerCase() !== input.conditionId.toLowerCase()
    || order.outcome !== input.outcome || order.contracts !== input.contracts) {
    throw new Error('POLYMARKET_REDEMPTION_FILLED_ORDER_PROVENANCE_MISMATCH');
  }
  const identity = await marketIdentity({ marketId: input.marketId, conditionId: input.conditionId, outcome: input.outcome, tokenId: order.tokenId });
  const account = await getPolymarketAuthenticatedAccountSnapshot();
  const wallet = executionWallet();
  if (wallet.address.toLowerCase() !== account.signerAddress.toLowerCase() || account.funderAddress.toLowerCase() !== account.signerAddress.toLowerCase()) {
    throw new Error('POLYMARKET_REDEMPTION_SIGNER_ACCOUNT_IDENTITY_MISMATCH');
  }
  const won = input.marketResult === input.outcome;
  let row = await createOrLoad({
    lifecycleId: input.lifecycleId, opportunityId: input.opportunityId, marketId: input.marketId,
    conditionId: input.conditionId, tokenId: order.tokenId, complementTokenId: identity.complementTokenId,
    outcome: input.outcome, contracts: input.contracts, negRisk: identity.negRisk, won, wallet: wallet.address,
  });
  if (row.status === 'NO_REDEMPTION_REQUIRED') {
    return {
      terminal: true, cashRealized: true, marketId: row.marketId, conditionId: row.conditionId, outcome: row.outcome,
      marketResult: input.marketResult, contracts: row.contracts, won: false, payoutUsd: 0, transactionHash: null,
      gasSpentWei: 0n, observedAt: Date.now(), provenance: ['polymarket_settlement:onchain_binary_resolution', 'losing_position:payout_zero', 'redemption_transaction:not_required', 'cash_delta:terminal_loss_authoritative'],
    };
  }
  if (row.status === 'CONFIRMED' && row.realizedPayoutBaseUnits !== null) {
    return {
      terminal: true, cashRealized: true, marketId: row.marketId, conditionId: row.conditionId, outcome: row.outcome,
      marketResult: input.marketResult, contracts: row.contracts, won: true, payoutUsd: toUsd(row.realizedPayoutBaseUnits),
      transactionHash: row.transactionHash, gasSpentWei: row.gasSpendWei ?? 0n, observedAt: Date.now(),
      provenance: ['polymarket_redemption:durable_confirmed', 'pUSD_balance_delta:exact', 'system_owned_native_gas:provenance_backed'],
    };
  }
  if (row.status === 'QUARANTINED') {
    return {
      terminal: false, cashRealized: false, marketId: row.marketId, conditionId: row.conditionId, outcome: row.outcome,
      marketResult: input.marketResult, contracts: row.contracts, won: true, payoutUsd: null, transactionHash: row.transactionHash,
      gasSpentWei: row.gasSpendWei ?? 0n, observedAt: Date.now(), provenance: ['polymarket_redemption:quarantined'], error: row.lastError ?? 'POLYMARKET_REDEMPTION_QUARANTINED',
    };
  }

  const recovered = await reconcileExistingSubmission(row, wallet);
  if (recovered) {
    row = recovered;
    if (row.status === 'CONFIRMED' && row.realizedPayoutBaseUnits !== null) {
      return {
        terminal: true, cashRealized: true, marketId: row.marketId, conditionId: row.conditionId, outcome: row.outcome,
        marketResult: input.marketResult, contracts: row.contracts, won: true, payoutUsd: toUsd(row.realizedPayoutBaseUnits),
        transactionHash: row.transactionHash, gasSpentWei: row.gasSpendWei ?? 0n, observedAt: Date.now(),
        provenance: ['polymarket_redemption:recovered_after_restart', 'pUSD_balance_delta:exact', 'system_owned_native_gas:provenance_backed'],
      };
    }
    if (row.status === 'QUARANTINED' || row.status === 'SUBMISSION_UNKNOWN') {
      return {
        terminal: false, cashRealized: false, marketId: row.marketId, conditionId: row.conditionId, outcome: row.outcome,
        marketResult: input.marketResult, contracts: row.contracts, won: true, payoutUsd: null, transactionHash: row.transactionHash,
        gasSpentWei: row.gasSpendWei ?? 0n, observedAt: Date.now(), provenance: ['polymarket_redemption:recovery_pending'], error: row.lastError ?? 'POLYMARKET_REDEMPTION_RECOVERY_PENDING',
      };
    }
  }

  const expectedPosition = BigInt(row.contracts) * CONTRACT_BASE_UNITS;
  const managed = await multiProviderRpcManager.getHttpProvider('polygon', 'contract_calls');
  const adapterAddress = row.negRisk ? NEG_RISK_COLLATERAL_ADAPTER : COLLATERAL_ADAPTER;
  const adapter = new Contract(adapterAddress, REDEEM_ABI, managed.http);
  const data = adapter.interface.encodeFunctionData('redeemPositions', [COLLATERAL, constants.HashZero, row.conditionId, [1, 2]]);
  const gasEstimate = await managed.http.estimateGas({ from: wallet.address, to: adapterAddress, data });
  const gasLimit = BigNumber.from(gasEstimate).mul(125).add(99).div(100);
  try {
    row = await update(row.redemptionId, { status: 'SUBMISSION_UNKNOWN', submitted_at: new Date(), last_error: null });
    const executed = await executeSystemOwnedNativeTransaction({
      chain: 'polygon', wallet, provider: managed.http,
      idempotencyKey: gasIdempotencyKey(row.redemptionId), purpose: 'polymarket_terminal_redemption',
      transaction: { to: adapterAddress, data, gasLimit }, confirmations: 1,
      preBroadcastCheck: async () => {
        const fresh = await balances({ wallet: wallet.address, tokenId: row.tokenId, complementTokenId: row.complementTokenId, negRisk: row.negRisk });
        if (fresh.collateral !== row.preCollateralBaseUnits || fresh.purchased !== expectedPosition || fresh.complement !== 0n) {
          throw new Error('POLYMARKET_REDEMPTION_PREBROADCAST_ISOLATION_CHANGED');
        }
      },
    });
    if (executed.receipt.status !== 1) throw new Error('POLYMARKET_REDEMPTION_TRANSACTION_FAILED');
    row = await update(row.redemptionId, { status: 'SUBMITTED', transaction_hash: executed.transactionHash, gas_spend_wei: executed.actualSpentWei.toString(), submitted_at: new Date(), last_error: null });
    const after = await balances({ wallet: wallet.address, tokenId: row.tokenId, complementTokenId: row.complementTokenId, negRisk: row.negRisk });
    if (after.purchased !== 0n || after.complement !== 0n || after.collateral < row.preCollateralBaseUnits) {
      return {
        terminal: false, cashRealized: false, marketId: row.marketId, conditionId: row.conditionId, outcome: row.outcome,
        marketResult: input.marketResult, contracts: row.contracts, won: true, payoutUsd: null, transactionHash: executed.transactionHash,
        gasSpentWei: executed.actualSpentWei, observedAt: Date.now(), provenance: ['polymarket_redemption:receipt_confirmed_balance_reconciliation_pending'], error: 'POLYMARKET_REDEMPTION_POST_BALANCE_NOT_TERMINAL',
      };
    }
    const delta = after.collateral - row.preCollateralBaseUnits;
    if (delta !== row.expectedPayoutBaseUnits) {
      row = await update(row.redemptionId, {
        status: 'QUARANTINED', transaction_hash: executed.transactionHash,
        post_collateral_base_units: after.collateral.toString(), realized_payout_base_units: delta.toString(), gas_spend_wei: executed.actualSpentWei.toString(),
        receipt_evidence: JSON.stringify({ blockNumber: executed.receipt.blockNumber, receiptStatus: executed.receipt.status, expectedPayoutBaseUnits: row.expectedPayoutBaseUnits.toString(), actualPayoutBaseUnits: delta.toString() }),
        last_error: 'POLYMARKET_REDEMPTION_PUSD_DELTA_MISMATCH',
      });
      throw new Error('POLYMARKET_REDEMPTION_PUSD_DELTA_MISMATCH');
    }
    row = await update(row.redemptionId, {
      status: 'CONFIRMED', transaction_hash: executed.transactionHash,
      post_collateral_base_units: after.collateral.toString(), realized_payout_base_units: delta.toString(), gas_spend_wei: executed.actualSpentWei.toString(),
      receipt_evidence: JSON.stringify({ transactionHash: executed.transactionHash, blockNumber: executed.receipt.blockNumber, receiptStatus: executed.receipt.status, gasUsed: executed.receipt.gasUsed.toString(), actualSpentWei: executed.actualSpentWei.toString(), pUsdBalanceDeltaExact: true }),
      confirmed_at: new Date(), last_error: null,
    });
    return {
      terminal: true, cashRealized: true, marketId: row.marketId, conditionId: row.conditionId, outcome: row.outcome,
      marketResult: input.marketResult, contracts: row.contracts, won: true, payoutUsd: toUsd(delta), transactionHash: executed.transactionHash,
      gasSpentWei: executed.actualSpentWei, observedAt: Date.now(),
      provenance: ['polymarket_ctf:adapter_redemption', row.negRisk ? 'polymarket_redemption:neg_risk_collateral_adapter' : 'polymarket_redemption:standard_collateral_adapter', 'polymarket_collateral:pUSD', 'pUSD_balance_delta:exact', 'system_owned_native_gas:provenance_backed', 'raw_native_balance_spend_authority:false'],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[PolymarketSettlement] Terminal redemption remains fail-closed/recoverable', {
      component: 'PolymarketEventSettlementAuthority', lifecycleId: row.lifecycleId, redemptionId: row.redemptionId,
      error: message, realizedProfitAllowed: false, personalGasFallback: false,
    });
    return {
      terminal: false, cashRealized: false, marketId: row.marketId, conditionId: row.conditionId, outcome: row.outcome,
      marketResult: input.marketResult, contracts: row.contracts, won: true, payoutUsd: null, transactionHash: row.transactionHash,
      gasSpentWei: row.gasSpendWei ?? 0n, observedAt: Date.now(), provenance: ['polymarket_redemption:fail_closed_recovery_required', 'personal_gas_fallback:false'], error: message,
    };
  }
}
