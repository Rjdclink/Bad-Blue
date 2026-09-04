import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { assertCryptocrawlRuntimeDatabaseAvailable, pool } from '../runtime/cryptocrawl-runtime-database.js';
import type { OnchainSystemCapitalReservation } from './onchain-system-capital-ledger.js';

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
function positiveInteger(value: string): bigint {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized) || BigInt(normalized) <= 0n) throw new Error('Onchain reservation amount must be positive base units');
  return BigInt(normalized);
}

/**
 * Serialized reservation wrapper used by live cross-chain execution. It locks the
 * concrete ACTIVE owned-lot rows before reading outstanding reservations. A
 * concurrent reserver for the same chain/token therefore observes the preceding
 * committed reservation instead of racing an aggregate SUM lock.
 */
export async function reserveOnchainSystemCapitalSafely(input: {
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
  const amount = positiveInteger(input.amountBaseUnits);
  const acquiredAt = Date.now();
  if (!Number.isFinite(input.expiresAt) || input.expiresAt <= acquiredAt) return null;
  const reservationId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM public.cryptocrawler_onchain_inventory_reservations WHERE expires_at <= now()`);
    const lots = await client.query(
      `SELECT lot_id::text, remaining_base_units::text
       FROM public.cryptocrawler_onchain_system_owned_lots
       WHERE chain=$1 AND token_address=$2 AND status='ACTIVE' AND remaining_base_units > 0
       ORDER BY created_at ASC, lot_id ASC
       FOR UPDATE`,
      [chain, tokenAddress],
    );
    let owned = 0n;
    for (const row of lots.rows) owned += BigInt(String(row.remaining_base_units || '0'));
    const reservations = await client.query(
      `SELECT COALESCE(SUM(amount_base_units),0)::text AS amount
       FROM public.cryptocrawler_onchain_inventory_reservations
       WHERE chain=$1 AND token_address=$2 AND expires_at > now()`,
      [chain, tokenAddress],
    );
    const reserved = BigInt(String(reservations.rows[0]?.amount || '0'));
    if (owned - reserved < amount) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(
      `INSERT INTO public.cryptocrawler_onchain_inventory_reservations
        (reservation_id,opportunity_id,chain,asset,token_address,amount_base_units,acquired_at,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6::numeric,to_timestamp($7/1000.0),to_timestamp($8/1000.0))`,
      [reservationId, input.opportunityId, chain, asset, tokenAddress, amount.toString(), acquiredAt, input.expiresAt],
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
    amountBaseUnits: amount.toString(),
    acquiredAt,
    expiresAt: input.expiresAt,
    release: async () => {
      if (released) return;
      released = true;
      await pool.query(`DELETE FROM public.cryptocrawler_onchain_inventory_reservations WHERE reservation_id=$1`, [reservationId]);
    },
  };
}
