import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { assertCryptocrawlRuntimeDatabaseAvailable, pool } from '../runtime/cryptocrawl-runtime-database.js';

export interface OnchainSystemCapitalReservation {
  reservationId: string;
  opportunityId: string;
  chain: string;
  asset: string;
  tokenAddress: string;
  amountBaseUnits: string;
  acquiredAt: number;
  expiresAt: number;
  release: () => Promise<void>;
}

function canonicalChain(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || !/^[a-z0-9_-]+$/.test(normalized)) throw new Error(`Invalid onchain capital chain ${value}`);
  return normalized;
}

function canonicalAsset(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized || !/^[A-Z0-9]+$/.test(normalized)) throw new Error(`Invalid onchain capital asset ${value}`);
  return normalized;
}

function canonicalToken(value: string): string {
  if (!ethers.utils.isAddress(value)) throw new Error(`Invalid onchain capital token ${value}`);
  return ethers.utils.getAddress(value).toLowerCase();
}

function positiveIntegerString(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized) || BigInt(normalized) <= 0n) throw new Error(`${label} must be a positive integer base-unit string`);
  return BigInt(normalized).toString();
}

function nonNegativeIntegerString(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized) || BigInt(normalized) < 0n) throw new Error(`${label} must be a non-negative integer base-unit string`);
  return BigInt(normalized).toString();
}

function validTxHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

export async function creditVerifiedReceiverProfit(input: {
  opportunityId: string;
  chain: string;
  asset: string;
  tokenAddress: string;
  decimals: number;
  amountBaseUnits: string;
  transactionHash: string;
  receiver: string;
  recipient: string;
  provenance: readonly string[];
}): Promise<{ lotId: string; created: boolean }> {
  assertCryptocrawlRuntimeDatabaseAvailable();
  const chain = canonicalChain(input.chain);
  const asset = canonicalAsset(input.asset);
  const tokenAddress = canonicalToken(input.tokenAddress);
  const amount = positiveIntegerString(input.amountBaseUnits, 'receiver profit');
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 36) throw new Error('Invalid onchain token decimals');
  if (!validTxHash(input.transactionHash)) throw new Error('Receiver profit requires a terminal transaction hash');
  if (!ethers.utils.isAddress(input.receiver) || !ethers.utils.isAddress(input.recipient)) throw new Error('Receiver profit identities are invalid');
  const idempotencyKey = `receiver-profit:${input.transactionHash.toLowerCase()}:${tokenAddress}:${amount}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const prior = await client.query(
      `SELECT lot_id::text, amount_base_units::text, chain, token_address
       FROM public.cryptocrawler_onchain_system_owned_lots
       WHERE idempotency_key=$1 FOR UPDATE`,
      [idempotencyKey],
    );
    if (prior.rowCount === 1) {
      const row = prior.rows[0];
      if (String(row.chain) !== chain || String(row.token_address).toLowerCase() !== tokenAddress || String(row.amount_base_units) !== amount) {
        throw new Error(`Onchain receiver-profit idempotency collision for ${idempotencyKey}`);
      }
      await client.query('COMMIT');
      return { lotId: String(row.lot_id), created: false };
    }

    const lotId = randomUUID();
    await client.query(
      `INSERT INTO public.cryptocrawler_onchain_system_owned_lots (
         lot_id,idempotency_key,chain,asset,token_address,decimals,amount_base_units,remaining_base_units,
         status,origin_kind,origin_reference,opportunity_id,settlement_evidence,authority_evidence,created_at,updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$7::numeric,'ACTIVE','ATOMIC_RECEIVER_PROFIT',$8,$9,$10::jsonb,$11::jsonb,now(),now())`,
      [
        lotId,
        idempotencyKey,
        chain,
        asset,
        tokenAddress,
        input.decimals,
        amount,
        input.transactionHash.toLowerCase(),
        input.opportunityId || null,
        JSON.stringify({
          transactionHash: input.transactionHash.toLowerCase(),
          receiver: ethers.utils.getAddress(input.receiver),
          recipient: ethers.utils.getAddress(input.recipient),
          tokenAddress,
          amountBaseUnits: amount,
          provenance: [...input.provenance],
        }),
        JSON.stringify({
          authority: 'terminal_receiver_profit_transfer',
          walletBalanceAuthority: false,
          syntheticEvidenceAllowed: false,
        }),
      ],
    );
    await client.query('COMMIT');
    return { lotId, created: true };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function getAvailableOnchainSystemCapital(input: {
  chain: string;
  tokenAddress: string;
}): Promise<string> {
  assertCryptocrawlRuntimeDatabaseAvailable();
  const chain = canonicalChain(input.chain);
  const tokenAddress = canonicalToken(input.tokenAddress);
  const result = await pool.query(
    `WITH owned AS (
       SELECT COALESCE(SUM(remaining_base_units),0) AS amount
       FROM public.cryptocrawler_onchain_system_owned_lots
       WHERE chain=$1 AND token_address=$2 AND status='ACTIVE' AND remaining_base_units > 0
     ), reserved AS (
       SELECT COALESCE(SUM(amount_base_units),0) AS amount
       FROM public.cryptocrawler_onchain_inventory_reservations
       WHERE chain=$1 AND token_address=$2 AND expires_at > now()
     )
     SELECT greatest(0, owned.amount-reserved.amount)::text AS available FROM owned,reserved`,
    [chain, tokenAddress],
  );
  return String(result.rows[0]?.available || '0');
}

export async function reserveOnchainSystemCapital(input: {
  opportunityId: string;
  chain: string;
  asset: string;
  tokenAddress: string;
  amountBaseUnits: string;
  expiresAt: number;
}): Promise<OnchainSystemCapitalReservation | null> {
  assertCryptocrawlRuntimeDatabaseAvailable();
  const chain = canonicalChain(input.chain);
  const asset = canonicalAsset(input.asset);
  const tokenAddress = canonicalToken(input.tokenAddress);
  const amount = positiveIntegerString(input.amountBaseUnits, 'onchain reservation');
  const acquiredAt = Date.now();
  if (!Number.isFinite(input.expiresAt) || input.expiresAt <= acquiredAt) return null;
  const reservationId = randomUUID();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM public.cryptocrawler_onchain_inventory_reservations WHERE expires_at <= now()`);
    const lots = await client.query(
      `SELECT COALESCE(SUM(remaining_base_units),0)::text AS amount
       FROM public.cryptocrawler_onchain_system_owned_lots
       WHERE chain=$1 AND token_address=$2 AND status='ACTIVE' AND remaining_base_units > 0
       FOR SHARE`,
      [chain, tokenAddress],
    );
    const reservations = await client.query(
      `SELECT COALESCE(SUM(amount_base_units),0)::text AS amount
       FROM public.cryptocrawler_onchain_inventory_reservations
       WHERE chain=$1 AND token_address=$2 AND expires_at > now()`,
      [chain, tokenAddress],
    );
    const owned = BigInt(String(lots.rows[0]?.amount || '0'));
    const reserved = BigInt(String(reservations.rows[0]?.amount || '0'));
    if (owned - reserved < BigInt(amount)) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(
      `INSERT INTO public.cryptocrawler_onchain_inventory_reservations
        (reservation_id,opportunity_id,chain,asset,token_address,amount_base_units,acquired_at,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6::numeric,to_timestamp($7/1000.0),to_timestamp($8/1000.0))`,
      [reservationId, input.opportunityId, chain, asset, tokenAddress, amount, acquiredAt, input.expiresAt],
    );
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original */ }
    throw error;
  } finally {
    client.release();
  }

  let released = false;
  return {
    reservationId,
    opportunityId: input.opportunityId,
    chain,
    asset,
    tokenAddress,
    amountBaseUnits: amount,
    acquiredAt,
    expiresAt: input.expiresAt,
    release: async () => {
      if (released) return;
      released = true;
      await pool.query(`DELETE FROM public.cryptocrawler_onchain_inventory_reservations WHERE reservation_id=$1`, [reservationId]);
    },
  };
}

async function consumeLots(client: any, chain: string, tokenAddress: string, amountBaseUnits: string): Promise<string[]> {
  let remaining = BigInt(amountBaseUnits);
  const result = await client.query(
    `SELECT lot_id::text, remaining_base_units::text
     FROM public.cryptocrawler_onchain_system_owned_lots
     WHERE chain=$1 AND token_address=$2 AND status='ACTIVE' AND remaining_base_units > 0
     ORDER BY created_at ASC, lot_id ASC FOR UPDATE`,
    [chain, tokenAddress],
  );
  const consumed: string[] = [];
  for (const row of result.rows) {
    if (remaining <= 0n) break;
    const available = BigInt(String(row.remaining_base_units));
    const take = available >= remaining ? remaining : available;
    const next = available - take;
    await client.query(
      `UPDATE public.cryptocrawler_onchain_system_owned_lots
       SET remaining_base_units=$2::numeric,status=CASE WHEN $2::numeric=0 THEN 'CONSUMED' ELSE 'ACTIVE' END,updated_at=now()
       WHERE lot_id=$1`,
      [String(row.lot_id), next.toString()],
    );
    consumed.push(String(row.lot_id));
    remaining -= take;
  }
  if (remaining > 0n) throw new Error(`ONCHAIN_SYSTEM_CAPITAL_PROVENANCE_DEFICIT:${chain}:${tokenAddress}:${remaining}`);
  return consumed;
}

export async function applyCrossChainSystemCapitalSettlement(input: {
  reservationId: string;
  opportunityId: string;
  originChain: string;
  destinationChain: string;
  inputAsset: string;
  outputAsset: string;
  inputTokenAddress: string;
  outputTokenAddress: string;
  inputDecimals: number;
  outputDecimals: number;
  inputAmountBaseUnits: string;
  outputAmountBaseUnits: string;
  settlementReference: string;
  settlementEvidence: Record<string, unknown>;
}): Promise<{ createdLotId: string | null; consumedLotIds: string[]; applied: boolean }> {
  assertCryptocrawlRuntimeDatabaseAvailable();
  const originChain = canonicalChain(input.originChain);
  const destinationChain = canonicalChain(input.destinationChain);
  const inputAsset = canonicalAsset(input.inputAsset);
  const outputAsset = canonicalAsset(input.outputAsset);
  const inputTokenAddress = canonicalToken(input.inputTokenAddress);
  const outputTokenAddress = canonicalToken(input.outputTokenAddress);
  const inputAmount = positiveIntegerString(input.inputAmountBaseUnits, 'cross-chain input');
  const outputAmount = nonNegativeIntegerString(input.outputAmountBaseUnits, 'cross-chain output');
  if (!input.settlementReference.trim()) throw new Error('Cross-chain settlement reference is required');
  if (!Number.isInteger(input.inputDecimals) || !Number.isInteger(input.outputDecimals)) throw new Error('Cross-chain decimals are invalid');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const prior = await client.query(
      `SELECT consumed_lot_ids,created_lot_id::text,input_amount_base_units::text,output_amount_base_units::text,status
       FROM public.cryptocrawler_onchain_system_owned_settlements WHERE settlement_reference=$1 FOR UPDATE`,
      [input.settlementReference],
    );
    if (prior.rowCount === 1) {
      const row = prior.rows[0];
      if (String(row.status) !== 'APPLIED' || String(row.input_amount_base_units) !== inputAmount || String(row.output_amount_base_units) !== outputAmount) {
        throw new Error(`Cross-chain system-capital settlement collision ${input.settlementReference}`);
      }
      await client.query('COMMIT');
      return {
        createdLotId: row.created_lot_id ? String(row.created_lot_id) : null,
        consumedLotIds: Array.isArray(row.consumed_lot_ids) ? row.consumed_lot_ids.map(String) : [],
        applied: false,
      };
    }

    const reservation = await client.query(
      `SELECT amount_base_units::text,chain,token_address FROM public.cryptocrawler_onchain_inventory_reservations
       WHERE reservation_id=$1 AND expires_at > now() FOR UPDATE`,
      [input.reservationId],
    );
    if (reservation.rowCount !== 1) throw new Error('Cross-chain system-capital reservation is unavailable or expired');
    const reserved = reservation.rows[0];
    if (String(reserved.chain) !== originChain || String(reserved.token_address).toLowerCase() !== inputTokenAddress || BigInt(String(reserved.amount_base_units)) < BigInt(inputAmount)) {
      throw new Error('Cross-chain system-capital reservation identity/amount mismatch');
    }

    const consumedLotIds = await consumeLots(client, originChain, inputTokenAddress, inputAmount);
    let createdLotId: string | null = null;
    if (BigInt(outputAmount) > 0n) {
      createdLotId = randomUUID();
      const idempotencyKey = `cross-chain:${input.settlementReference}:${outputTokenAddress}`;
      await client.query(
        `INSERT INTO public.cryptocrawler_onchain_system_owned_lots (
           lot_id,idempotency_key,chain,asset,token_address,decimals,amount_base_units,remaining_base_units,status,
           origin_kind,origin_reference,opportunity_id,settlement_evidence,authority_evidence,created_at,updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$7::numeric,'ACTIVE','CROSS_CHAIN_SETTLEMENT',$8,$9,$10::jsonb,$11::jsonb,now(),now())`,
        [
          createdLotId,
          idempotencyKey,
          destinationChain,
          outputAsset,
          outputTokenAddress,
          input.outputDecimals,
          outputAmount,
          input.settlementReference,
          input.opportunityId || null,
          JSON.stringify(input.settlementEvidence),
          JSON.stringify({ authority: 'terminal_cross_chain_settlement', walletBalanceAuthority: false, syntheticEvidenceAllowed: false }),
        ],
      );
    }

    await client.query(
      `INSERT INTO public.cryptocrawler_onchain_system_owned_settlements (
         settlement_reference,opportunity_id,origin_chain,destination_chain,input_asset,output_asset,input_token_address,output_token_address,
         input_amount_base_units,output_amount_base_units,status,consumed_lot_ids,created_lot_id,settlement_evidence,authority_evidence,created_at,applied_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10::numeric,'APPLIED',$11::jsonb,$12,$13::jsonb,$14::jsonb,now(),now())`,
      [
        input.settlementReference,
        input.opportunityId || null,
        originChain,
        destinationChain,
        inputAsset,
        outputAsset,
        inputTokenAddress,
        outputTokenAddress,
        inputAmount,
        outputAmount,
        JSON.stringify(consumedLotIds),
        createdLotId,
        JSON.stringify(input.settlementEvidence),
        JSON.stringify({ authority: 'terminal_cross_chain_settlement', reservationId: input.reservationId }),
      ],
    );
    await client.query(`DELETE FROM public.cryptocrawler_onchain_inventory_reservations WHERE reservation_id=$1`, [input.reservationId]);
    await client.query('COMMIT');
    return { createdLotId, consumedLotIds, applied: true };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original */ }
    throw error;
  } finally {
    client.release();
  }
}
