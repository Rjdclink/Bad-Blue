import crypto from 'node:crypto';
import { assertCryptocrawlRuntimeDatabaseAvailable, pool } from '../runtime/cryptocrawl-runtime-database.js';
import type { ExactCexOrderAssetDeltaEvidence } from './cex-system-capital-settlement-evidence.js';
import type { ExactCoinbaseOrderAssetDeltaEvidence } from './coinbase-system-capital-settlement-evidence.js';
import {
  compareExactDecimals,
  negateExactDecimal,
  requirePositiveExactDecimal,
  subtractExactDecimals,
} from './exact-decimal.js';

export type SystemOwnedCexVenue = 'coinbase' | 'kraken' | 'okx';
export type SystemOwnedCexSettlementEvidence = ExactCexOrderAssetDeltaEvidence | ExactCoinbaseOrderAssetDeltaEvidence;

export type CexSystemCapitalSettlementAuthority =
  | {
      strategySelectionAuthority: 'cryptara';
      notionalAuthority: 'profit_ladder';
      executionAuthority: 'stage_manager';
      governanceAdmitted: true;
      reference: string;
      [key: string]: unknown;
    }
  | {
      strategySelectionAuthority: 'funding_arbitrage_policy';
      notionalAuthority: 'profit_ladder';
      executionAuthority: 'funding_position_lifecycle';
      governanceAdmitted: true;
      reference: string;
      [key: string]: unknown;
    }
  | {
      treasuryAuthority: 'operator_strategy';
      notionalAuthority: 'system_owned_sweep_target';
      executionAuthority: 'system_capital_sweep_worker';
      governanceAdmitted: true;
      reference: string;
      [key: string]: unknown;
    }
  | {
      learningAuthority: 'cryptara_controlled_loss';
      notionalAuthority: 'controlled_loss_budget';
      executionAuthority: 'controlled_loss_learning_worker';
      governanceAdmitted: true;
      reference: string;
      [key: string]: unknown;
    };

export interface AppliedCexOwnershipSettlement {
  settlementReference: string;
  venue: SystemOwnedCexVenue;
  orderId: string;
  opportunityId?: string;
  strategy?: string;
  assetDeltas: Record<string, string>;
  consumedLotIds: string[];
  createdLotIds: string[];
  applied: boolean;
}

function requireAuthority(authority: CexSystemCapitalSettlementAuthority): void {
  const referenceValid = typeof authority?.reference === 'string' && Boolean(authority.reference.trim());
  const tradeAuthority =
    'strategySelectionAuthority' in authority &&
    authority.strategySelectionAuthority === 'cryptara' &&
    authority.notionalAuthority === 'profit_ladder' &&
    authority.executionAuthority === 'stage_manager' &&
    authority.governanceAdmitted === true;
  const fundingAuthority =
    'strategySelectionAuthority' in authority &&
    authority.strategySelectionAuthority === 'funding_arbitrage_policy' &&
    authority.notionalAuthority === 'profit_ladder' &&
    authority.executionAuthority === 'funding_position_lifecycle' &&
    authority.governanceAdmitted === true;
  const treasuryAuthority =
    'treasuryAuthority' in authority &&
    authority.treasuryAuthority === 'operator_strategy' &&
    authority.notionalAuthority === 'system_owned_sweep_target' &&
    authority.executionAuthority === 'system_capital_sweep_worker' &&
    authority.governanceAdmitted === true;
  const controlledLearningAuthority =
    'learningAuthority' in authority &&
    authority.learningAuthority === 'cryptara_controlled_loss' &&
    authority.notionalAuthority === 'controlled_loss_budget' &&
    authority.executionAuthority === 'controlled_loss_learning_worker' &&
    authority.governanceAdmitted === true;
  if (!referenceValid || (!tradeAuthority && !fundingAuthority && !treasuryAuthority && !controlledLearningAuthority)) {
    throw new Error('CEX ownership transformation requires canonical trade, funding-lifecycle, explicit operator-strategy treasury, or controlled-loss learning authority');
  }
}

function normalizedAsset(asset: string): string {
  const upper = asset.trim().toUpperCase();
  if (!upper || !/^[A-Z0-9]+$/.test(upper)) throw new Error(`Invalid CEX ownership asset: ${asset}`);
  return upper;
}

function parseJsonStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String);
}

async function existingSettlement(client: any, reference: string): Promise<AppliedCexOwnershipSettlement | null> {
  const result = await client.query(
    `SELECT settlement_reference, venue, order_id, opportunity_id, strategy,
            status, asset_deltas, consumed_lot_ids, created_lot_ids
     FROM public.cryptocrawler_cex_system_owned_settlements
     WHERE settlement_reference=$1 FOR UPDATE`,
    [reference],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (String(row.status) === 'QUARANTINED') {
    throw new Error(`CEX system-capital settlement ${reference} is quarantined`);
  }
  if (String(row.status) !== 'APPLIED') {
    throw new Error(`CEX system-capital settlement ${reference} has unexpected durable state ${String(row.status)}`);
  }
  const venue = String(row.venue) as SystemOwnedCexVenue;
  if (!['coinbase', 'kraken', 'okx'].includes(venue)) throw new Error(`Unsupported durable CEX ownership venue ${String(row.venue)}`);
  return {
    settlementReference: String(row.settlement_reference),
    venue,
    orderId: String(row.order_id),
    opportunityId: row.opportunity_id ? String(row.opportunity_id) : undefined,
    strategy: row.strategy ? String(row.strategy) : undefined,
    assetDeltas: row.asset_deltas && typeof row.asset_deltas === 'object' ? row.asset_deltas : {},
    consumedLotIds: parseJsonStringArray(row.consumed_lot_ids),
    createdLotIds: parseJsonStringArray(row.created_lot_ids),
    applied: false,
  };
}

async function consumeSystemOwnedAsset(client: any, venue: SystemOwnedCexVenue, asset: string, amount: string): Promise<string[]> {
  let remaining = requirePositiveExactDecimal(amount, `${venue}:${asset} system-owned debit`);
  const lots = await client.query(
    `SELECT lot_id::text, remaining_decimal::text
     FROM public.cryptocrawler_cex_system_owned_lots
     WHERE venue=$1 AND asset=$2 AND status='ACTIVE' AND remaining_decimal > 0
     ORDER BY created_at ASC, lot_id ASC
     FOR UPDATE`,
    [venue, asset],
  );
  const consumedIds: string[] = [];

  for (const row of lots.rows) {
    if (compareExactDecimals(remaining, '0') <= 0) break;
    const available = String(row.remaining_decimal);
    const consume = compareExactDecimals(available, remaining) >= 0 ? remaining : available;
    const next = subtractExactDecimals(available, consume);
    await client.query(
      `UPDATE public.cryptocrawler_cex_system_owned_lots
       SET remaining_decimal=$2::numeric,
           status=CASE WHEN $2::numeric=0 THEN 'CONSUMED' ELSE 'ACTIVE' END,
           updated_at=now()
       WHERE lot_id=$1`,
      [String(row.lot_id), next],
    );
    consumedIds.push(String(row.lot_id));
    remaining = subtractExactDecimals(remaining, consume);
  }

  if (compareExactDecimals(remaining, '0') > 0) {
    throw new Error(`SYSTEM_CAPITAL_PROVENANCE_DEFICIT:${venue}:${asset}:unowned_required=${remaining}`);
  }
  return consumedIds;
}

async function createSystemOwnedOutputLot(input: {
  client: any;
  evidence: SystemOwnedCexSettlementEvidence;
  asset: string;
  amount: string;
  opportunityId?: string;
  strategy?: string;
  authority: CexSystemCapitalSettlementAuthority;
}): Promise<string> {
  const amount = requirePositiveExactDecimal(input.amount, `${input.evidence.venue}:${input.asset} system-owned credit`);
  const lotId = crypto.randomUUID();
  const isThirdAsset = input.asset !== input.evidence.baseAsset && input.asset !== input.evidence.quoteAsset;
  const originKind = isThirdAsset ? 'MAKER_REBATE' : 'TRADE_FILL';
  const idempotencyKey = `trade:${input.evidence.settlementReference}:${input.asset}`;
  const inserted = await input.client.query(
    `INSERT INTO public.cryptocrawler_cex_system_owned_lots (
       lot_id, idempotency_key, venue, asset, amount_decimal, remaining_decimal,
       status, origin_kind, origin_reference, opportunity_id, strategy,
       settlement_reference, settlement_evidence, authority_evidence
     ) VALUES ($1,$2,$3,$4,$5::numeric,$5::numeric,'ACTIVE',$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING lot_id::text`,
    [
      lotId,
      idempotencyKey,
      input.evidence.venue,
      input.asset,
      amount,
      originKind,
      input.evidence.orderId,
      input.opportunityId || null,
      input.strategy || null,
      input.evidence.settlementReference,
      JSON.stringify(input.evidence),
      JSON.stringify(input.authority),
    ],
  );
  if (inserted.rows[0]?.lot_id) return String(inserted.rows[0].lot_id);
  const existing = await input.client.query(
    `SELECT lot_id::text, amount_decimal::text, venue, asset, settlement_reference
     FROM public.cryptocrawler_cex_system_owned_lots WHERE idempotency_key=$1`,
    [idempotencyKey],
  );
  const row = existing.rows[0];
  if (!row || String(row.venue) !== input.evidence.venue || String(row.asset) !== input.asset ||
      String(row.settlement_reference) !== input.evidence.settlementReference ||
      compareExactDecimals(String(row.amount_decimal), amount) !== 0) {
    throw new Error(`CEX output-lot idempotency collision for ${idempotencyKey}`);
  }
  return String(row.lot_id);
}

export async function applyExactCexSystemOwnedSettlement(input: {
  evidence: SystemOwnedCexSettlementEvidence;
  opportunityId?: string;
  strategy?: string;
  authority: CexSystemCapitalSettlementAuthority;
}): Promise<AppliedCexOwnershipSettlement> {
  assertCryptocrawlRuntimeDatabaseAvailable();
  requireAuthority(input.authority);
  const evidence = input.evidence;
  if (!['coinbase', 'kraken', 'okx'].includes(evidence.venue)) {
    throw new Error(`Unsupported exact CEX ownership venue ${evidence.venue}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const prior = await existingSettlement(client, evidence.settlementReference);
    if (prior) {
      await client.query('COMMIT');
      return prior;
    }

    const marker = await client.query(
      `INSERT INTO public.cryptocrawler_cex_system_owned_settlements (
         settlement_reference, venue, order_id, opportunity_id, strategy,
         status, asset_deltas, settlement_evidence
       ) VALUES ($1,$2,$3,$4,$5,'APPLYING',$6::jsonb,$7::jsonb)
       ON CONFLICT (settlement_reference) DO NOTHING
       RETURNING settlement_reference`,
      [
        evidence.settlementReference,
        evidence.venue,
        evidence.orderId,
        input.opportunityId || null,
        input.strategy || null,
        JSON.stringify(evidence.assetDeltas),
        JSON.stringify(evidence),
      ],
    );
    if (marker.rowCount !== 1) {
      const raced = await existingSettlement(client, evidence.settlementReference);
      if (!raced) throw new Error(`CEX settlement ${evidence.settlementReference} idempotency race did not resolve`);
      await client.query('COMMIT');
      return raced;
    }

    const consumedLotIds: string[] = [];
    const createdLotIds: string[] = [];
    const entries = Object.entries(evidence.assetDeltas)
      .map(([asset, delta]) => [normalizedAsset(asset), String(delta)] as const)
      .sort(([a], [b]) => a.localeCompare(b));

    // Debit first. No output ownership can be created unless every cost/fee is
    // fully covered by prior system-owned inventory. A third-token fee therefore
    // cannot silently consume an operator balance.
    for (const [asset, delta] of entries) {
      if (compareExactDecimals(delta, '0') >= 0) continue;
      consumedLotIds.push(...await consumeSystemOwnedAsset(client, evidence.venue, asset, negateExactDecimal(delta)));
    }

    for (const [asset, delta] of entries) {
      if (compareExactDecimals(delta, '0') <= 0) continue;
      createdLotIds.push(await createSystemOwnedOutputLot({
        client,
        evidence,
        asset,
        amount: delta,
        opportunityId: input.opportunityId,
        strategy: input.strategy,
        authority: input.authority,
      }));
    }

    await client.query(
      `UPDATE public.cryptocrawler_cex_system_owned_settlements
       SET status='APPLIED', consumed_lot_ids=$2::jsonb, created_lot_ids=$3::jsonb,
           applied_at=now(), updated_at=now()
       WHERE settlement_reference=$1 AND status='APPLYING'`,
      [evidence.settlementReference, JSON.stringify(consumedLotIds), JSON.stringify(createdLotIds)],
    );
    await client.query('COMMIT');
    return {
      settlementReference: evidence.settlementReference,
      venue: evidence.venue,
      orderId: evidence.orderId,
      opportunityId: input.opportunityId,
      strategy: input.strategy,
      assetDeltas: evidence.assetDeltas,
      consumedLotIds,
      createdLotIds,
      applied: true,
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function getExactSystemOwnedCexInventory(venue: SystemOwnedCexVenue, asset: string): Promise<string> {
  assertCryptocrawlRuntimeDatabaseAvailable();
  const result = await pool.query(
    `SELECT COALESCE(SUM(remaining_decimal),0)::text AS amount
     FROM public.cryptocrawler_cex_system_owned_lots
     WHERE venue=$1 AND asset=$2 AND status='ACTIVE' AND remaining_decimal > 0`,
    [venue, normalizedAsset(asset)],
  );
  return String(result.rows[0]?.amount || '0');
}
