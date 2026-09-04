import { pool } from '../runtime/cryptocrawl-runtime-database.js';

export type SystemNativeGasSpendStatus = 'RESERVED' | 'SUBMITTED' | 'SETTLED' | 'RELEASED' | 'MANUAL_REVIEW';

export interface SystemNativeGasSpendReservation {
  spendId: string;
  idempotencyKey: string;
  scope: string;
  chain: string;
  wallet: string;
  purpose: string;
  status: SystemNativeGasSpendStatus;
  reservedWei: string;
  actualSpentWei: string | null;
  transactionHash: string | null;
}

function requirePositiveInteger(label: string, value: string): string {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error(`${label} must be a positive integer wei string`);
  return value;
}

function requireHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) throw new Error('system native gas spend requires a transaction hash');
  return normalized;
}

function requireAddress(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) throw new Error('system native gas spend requires an EVM wallet address');
  return normalized;
}

async function load(spendId: string): Promise<SystemNativeGasSpendReservation> {
  const result = await pool.query(
    `SELECT spend_id, idempotency_key, scope, chain, wallet, purpose, status,
            reserved_wei::text AS reserved_wei,
            actual_spent_wei::text AS actual_spent_wei,
            transaction_hash
     FROM public.cryptocrawler_system_native_gas_spends
     WHERE spend_id=$1::uuid`,
    [spendId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`system native gas spend ${spendId} does not exist`);
  return {
    spendId: String(row.spend_id),
    idempotencyKey: String(row.idempotency_key),
    scope: String(row.scope),
    chain: String(row.chain),
    wallet: String(row.wallet),
    purpose: String(row.purpose),
    status: String(row.status) as SystemNativeGasSpendStatus,
    reservedWei: String(row.reserved_wei),
    actualSpentWei: row.actual_spent_wei == null ? null : String(row.actual_spent_wei),
    transactionHash: row.transaction_hash ? String(row.transaction_hash).toLowerCase() : null,
  };
}

export async function reserveSystemNativeGasSpend(input: {
  idempotencyKey: string;
  scope: string;
  chain: string;
  wallet: string;
  purpose: string;
  maximumWei: string;
}): Promise<SystemNativeGasSpendReservation | null> {
  const idempotencyKey = input.idempotencyKey.trim();
  const scope = input.scope.trim();
  const chain = input.chain.trim().toLowerCase();
  const wallet = requireAddress(input.wallet);
  const purpose = input.purpose.trim();
  const maximumWei = requirePositiveInteger('maximumWei', input.maximumWei);
  if (!idempotencyKey || !scope || !chain || !purpose) throw new Error('system native gas spend reservation identity is incomplete');
  const result = await pool.query(
    `SELECT public.cryptocrawler_reserve_system_native_gas_spend($1,$2,$3,$4,$5,$6::numeric) AS spend_id`,
    [idempotencyKey, scope, chain, wallet, purpose, maximumWei],
  );
  const spendId = String(result.rows[0]?.spend_id || '').trim();
  return spendId ? load(spendId) : null;
}

export async function bindSystemNativeGasSpendSubmission(spendId: string, transactionHash: string): Promise<SystemNativeGasSpendReservation> {
  const txHash = requireHash(transactionHash);
  const result = await pool.query(
    `SELECT public.cryptocrawler_submit_system_native_gas_spend($1::uuid,$2) AS accepted`,
    [spendId, txHash],
  );
  if (result.rows[0]?.accepted !== true) throw new Error('system native gas spend submission identity was rejected');
  return load(spendId);
}

export async function settleSystemNativeGasSpend(input: {
  spendId: string;
  transactionHash: string;
  actualSpentWei: string;
  evidence: Record<string, unknown>;
}): Promise<SystemNativeGasSpendReservation> {
  const txHash = requireHash(input.transactionHash);
  if (!/^\d+$/.test(input.actualSpentWei) || BigInt(input.actualSpentWei) < 0n) {
    throw new Error('actualSpentWei must be a non-negative integer wei string');
  }
  const result = await pool.query(
    `SELECT public.cryptocrawler_settle_system_native_gas_spend($1::uuid,$2,$3::numeric,$4::jsonb) AS settled`,
    [input.spendId, txHash, input.actualSpentWei, JSON.stringify(input.evidence || {})],
  );
  if (result.rows[0]?.settled !== true) throw new Error('system native gas receipt spend exceeded or contradicted its provenance-backed reservation');
  return load(input.spendId);
}

export async function releaseUnsubmittedSystemNativeGasSpend(spendId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT public.cryptocrawler_release_system_native_gas_spend($1::uuid) AS released`,
    [spendId],
  );
  return result.rows[0]?.released === true;
}

export async function quarantineSubmittedSystemNativeGasSpend(spendId: string, error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  await pool.query(
    `SELECT public.cryptocrawler_mark_system_native_gas_spend_manual_review($1::uuid,$2)`,
    [spendId, message],
  );
}
