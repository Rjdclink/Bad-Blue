import crypto from 'node:crypto';
import {
  assertCryptocrawlRuntimeDatabaseAvailable,
  pool,
} from '../runtime/cryptocrawl-runtime-database.js';

export type SystemCapitalDestinationKind = 'cex' | 'onchain_strategy' | 'native_gas' | 'other_strategy';
export type SystemCapitalAllocationStatus = 'RESERVED' | 'PLACEMENT_PENDING' | 'PLACED' | 'CONSUMED' | 'RELEASED' | 'FAILED';

export interface SystemCapitalAuthorityEvidence {
  strategySelectionAuthority: 'cryptara';
  notionalAuthority: 'profit_ladder';
  executionAuthority: 'stage_manager';
  governanceAdmitted: true;
  reference: string;
  [key: string]: unknown;
}

export interface ReserveSystemCapitalInput {
  idempotencyKey: string;
  capitalScope: string;
  opportunityId?: string;
  strategy: string;
  authorityReference: string;
  authorityEvidence: SystemCapitalAuthorityEvidence;
  destinationKind: SystemCapitalDestinationKind;
  destinationVenue?: string;
  sourceChain: string;
  sourceAsset: string;
  sourceAssetDecimals: number;
  sourceRecipient: string;
  sourceAmountBaseUnits: string;
  destinationChain?: string;
  destinationAsset: string;
  destinationAssetDecimals: number;
}

export interface SystemCapitalAllocation {
  allocationId: string;
  idempotencyKey: string;
  capitalScope: string;
  opportunityId?: string;
  strategy: string;
  authorityReference: string;
  authorityEvidence: Record<string, unknown>;
  destinationKind: SystemCapitalDestinationKind;
  destinationVenue?: string;
  sourceChain: string;
  sourceAsset: string;
  sourceAssetDecimals: number;
  sourceRecipient: string;
  sourceAmountBaseUnits: string;
  destinationChain?: string;
  destinationAsset: string;
  destinationAssetDecimals: number;
  deliveredAmountBaseUnits?: string;
  remainingDestinationBaseUnits?: string;
  status: SystemCapitalAllocationStatus;
  placementReference?: string;
  placementEvidence?: Record<string, unknown>;
  terminalReference?: string;
  terminalEvidence?: Record<string, unknown>;
}

function requireText(label: string, value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function requireDecimals(label: string, value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 36) throw new Error(`${label} must be an integer from 0 through 36`);
  return value;
}

function requirePositiveBaseUnits(label: string, value: string): bigint {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error(`${label} must be a positive integer string in base units`);
  return BigInt(value);
}

function requireAuthority(input: ReserveSystemCapitalInput): void {
  const evidence = input.authorityEvidence;
  if (
    evidence?.strategySelectionAuthority !== 'cryptara' ||
    evidence?.notionalAuthority !== 'profit_ladder' ||
    evidence?.executionAuthority !== 'stage_manager' ||
    evidence?.governanceAdmitted !== true ||
    typeof evidence?.reference !== 'string' ||
    !evidence.reference.trim()
  ) {
    throw new Error('System-capital reservation requires Cryptara, Profit Ladder, StageManager and governance authority evidence');
  }
  if (requireText('authorityReference', input.authorityReference) !== evidence.reference.trim()) {
    throw new Error('System-capital authority reference does not match authority evidence');
  }
}

function rowToAllocation(row: Record<string, unknown>): SystemCapitalAllocation {
  return {
    allocationId: String(row.allocation_id),
    idempotencyKey: String(row.idempotency_key),
    capitalScope: String(row.capital_scope),
    opportunityId: row.opportunity_id ? String(row.opportunity_id) : undefined,
    strategy: String(row.strategy),
    authorityReference: String(row.authority_reference),
    authorityEvidence: (row.authority_evidence && typeof row.authority_evidence === 'object')
      ? row.authority_evidence as Record<string, unknown>
      : {},
    destinationKind: String(row.destination_kind) as SystemCapitalDestinationKind,
    destinationVenue: row.destination_venue ? String(row.destination_venue) : undefined,
    sourceChain: String(row.source_chain),
    sourceAsset: String(row.source_asset),
    sourceAssetDecimals: Number(row.source_asset_decimals),
    sourceRecipient: String(row.source_recipient),
    sourceAmountBaseUnits: String(row.source_amount_base_units),
    destinationChain: row.destination_chain ? String(row.destination_chain) : undefined,
    destinationAsset: String(row.destination_asset),
    destinationAssetDecimals: Number(row.destination_asset_decimals),
    deliveredAmountBaseUnits: row.delivered_amount_base_units == null ? undefined : String(row.delivered_amount_base_units),
    remainingDestinationBaseUnits: row.remaining_destination_base_units == null ? undefined : String(row.remaining_destination_base_units),
    status: String(row.status) as SystemCapitalAllocationStatus,
    placementReference: row.placement_reference ? String(row.placement_reference) : undefined,
    placementEvidence: row.placement_evidence && typeof row.placement_evidence === 'object'
      ? row.placement_evidence as Record<string, unknown>
      : undefined,
    terminalReference: row.terminal_reference ? String(row.terminal_reference) : undefined,
    terminalEvidence: row.terminal_evidence && typeof row.terminal_evidence === 'object'
      ? row.terminal_evidence as Record<string, unknown>
      : undefined,
  };
}

function sameReservation(existing: SystemCapitalAllocation, input: ReserveSystemCapitalInput): boolean {
  return existing.capitalScope === input.capitalScope
    && existing.opportunityId === input.opportunityId
    && existing.strategy === input.strategy
    && existing.authorityReference === input.authorityReference
    && existing.destinationKind === input.destinationKind
    && existing.destinationVenue === input.destinationVenue
    && existing.sourceChain === input.sourceChain
    && existing.sourceAsset === input.sourceAsset
    && existing.sourceAssetDecimals === input.sourceAssetDecimals
    && existing.sourceRecipient.toLowerCase() === input.sourceRecipient.toLowerCase()
    && existing.sourceAmountBaseUnits === input.sourceAmountBaseUnits
    && existing.destinationChain === input.destinationChain
    && existing.destinationAsset === input.destinationAsset
    && existing.destinationAssetDecimals === input.destinationAssetDecimals;
}

export async function reserveAuthorizedSystemCapital(input: ReserveSystemCapitalInput): Promise<SystemCapitalAllocation> {
  assertCryptocrawlRuntimeDatabaseAvailable();
  requireAuthority(input);
  requireText('idempotencyKey', input.idempotencyKey);
  requireText('capitalScope', input.capitalScope);
  requireText('strategy', input.strategy);
  requireText('sourceChain', input.sourceChain);
  requireText('sourceAsset', input.sourceAsset);
  requireText('sourceRecipient', input.sourceRecipient);
  requireText('destinationAsset', input.destinationAsset);
  requireDecimals('sourceAssetDecimals', input.sourceAssetDecimals);
  requireDecimals('destinationAssetDecimals', input.destinationAssetDecimals);
  const amount = requirePositiveBaseUnits('sourceAmountBaseUnits', input.sourceAmountBaseUnits);
  if (input.destinationKind === 'cex' && !input.destinationVenue?.trim()) {
    throw new Error('CEX system-capital allocation requires a destination venue');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingResult = await client.query(
      `SELECT * FROM public.cryptocrawler_system_capital_allocations
       WHERE idempotency_key=$1 FOR UPDATE`,
      [input.idempotencyKey],
    );
    if (existingResult.rows[0]) {
      const existing = rowToAllocation(existingResult.rows[0]);
      if (!sameReservation(existing, input)) {
        throw new Error('System-capital idempotency key is already bound to a different reservation');
      }
      await client.query('COMMIT');
      return existing;
    }

    const stateResult = await client.query(
      `SELECT scope, lifecycle, asset, chain, internally_generated_balance,
              source_recipient
       FROM public.zero_capital_capital_state
       WHERE scope=$1 FOR UPDATE`,
      [input.capitalScope],
    );
    const state = stateResult.rows[0];
    if (!state) throw new Error(`System-capital scope ${input.capitalScope} does not exist`);
    if (String(state.lifecycle) !== 'SELF_FUNDED') {
      throw new Error(`System-capital allocation requires SELF_FUNDED provenance, received ${String(state.lifecycle)}`);
    }
    if (String(state.asset || '').toUpperCase() !== input.sourceAsset.toUpperCase()) {
      throw new Error('System-capital source asset does not match SELF_FUNDED provenance');
    }
    if (String(state.chain || '').toLowerCase() !== input.sourceChain.toLowerCase()) {
      throw new Error('System-capital source chain does not match SELF_FUNDED provenance');
    }
    if (!state.source_recipient || String(state.source_recipient).toLowerCase() !== input.sourceRecipient.toLowerCase()) {
      throw new Error('System-capital source recipient does not match durable profit-recipient provenance');
    }
    const available = BigInt(String(state.internally_generated_balance));
    if (available < amount) {
      throw new Error(`System-capital allocation exceeds available retained capital: requested=${amount.toString()} available=${available.toString()}`);
    }

    const allocationId = crypto.randomUUID();
    const debited = await client.query(
      `UPDATE public.zero_capital_capital_state
       SET internally_generated_balance=(internally_generated_balance::numeric - $2::numeric)::text,
           latest_execution_key=$3,
           updated_at=now()
       WHERE scope=$1 AND lifecycle='SELF_FUNDED'
         AND internally_generated_balance::numeric >= $2::numeric
       RETURNING internally_generated_balance`,
      [input.capitalScope, amount.toString(), `allocation:${allocationId}`],
    );
    if (!debited.rows[0]) throw new Error('System-capital available balance changed while reservation was locked');

    const inserted = await client.query(
      `INSERT INTO public.cryptocrawler_system_capital_allocations (
         allocation_id, idempotency_key, capital_scope, opportunity_id, strategy,
         authority_reference, authority_evidence, destination_kind, destination_venue,
         source_chain, source_asset, source_asset_decimals, source_recipient,
         source_amount_base_units, destination_chain, destination_asset,
         destination_asset_decimals, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'RESERVED')
       RETURNING *`,
      [
        allocationId,
        input.idempotencyKey,
        input.capitalScope,
        input.opportunityId || null,
        input.strategy,
        input.authorityReference,
        JSON.stringify(input.authorityEvidence),
        input.destinationKind,
        input.destinationVenue || null,
        input.sourceChain,
        input.sourceAsset,
        input.sourceAssetDecimals,
        input.sourceRecipient,
        amount.toString(),
        input.destinationChain || null,
        input.destinationAsset,
        input.destinationAssetDecimals,
      ],
    );
    await client.query('COMMIT');
    return rowToAllocation(inserted.rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function releaseUnplacedSystemCapital(allocationId: string, terminalReference: string, evidence: Record<string, unknown>): Promise<SystemCapitalAllocation> {
  assertCryptocrawlRuntimeDatabaseAvailable();
  requireText('allocationId', allocationId);
  requireText('terminalReference', terminalReference);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const allocationResult = await client.query(
      `SELECT * FROM public.cryptocrawler_system_capital_allocations
       WHERE allocation_id=$1 FOR UPDATE`,
      [allocationId],
    );
    if (!allocationResult.rows[0]) throw new Error(`System-capital allocation ${allocationId} does not exist`);
    const allocation = rowToAllocation(allocationResult.rows[0]);
    if (allocation.status === 'RELEASED') {
      await client.query('COMMIT');
      return allocation;
    }
    if (allocation.status !== 'RESERVED') {
      throw new Error(`Only unsubmitted RESERVED capital can be released; received ${allocation.status}`);
    }

    const stateResult = await client.query(
      `SELECT lifecycle, asset, chain, source_recipient FROM public.zero_capital_capital_state
       WHERE scope=$1 FOR UPDATE`,
      [allocation.capitalScope],
    );
    const state = stateResult.rows[0];
    if (!state || String(state.lifecycle) !== 'SELF_FUNDED') {
      throw new Error('Released system capital lost SELF_FUNDED source authority');
    }
    if (
      String(state.asset || '').toUpperCase() !== allocation.sourceAsset.toUpperCase() ||
      String(state.chain || '').toLowerCase() !== allocation.sourceChain.toLowerCase() ||
      String(state.source_recipient || '').toLowerCase() !== allocation.sourceRecipient.toLowerCase()
    ) {
      throw new Error('Released system capital no longer matches its source provenance');
    }

    await client.query(
      `UPDATE public.zero_capital_capital_state
       SET internally_generated_balance=(internally_generated_balance::numeric + $2::numeric)::text,
           latest_execution_key=$3,
           updated_at=now()
       WHERE scope=$1`,
      [allocation.capitalScope, allocation.sourceAmountBaseUnits, `allocation-release:${allocationId}`],
    );
    const updated = await client.query(
      `UPDATE public.cryptocrawler_system_capital_allocations
       SET status='RELEASED', remaining_destination_base_units=NULL,
           terminal_reference=$2, terminal_evidence=$3::jsonb, updated_at=now()
       WHERE allocation_id=$1 RETURNING *`,
      [allocationId, terminalReference, JSON.stringify(evidence || {})],
    );
    await client.query('COMMIT');
    return rowToAllocation(updated.rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function markSystemCapitalPlacementPending(allocationId: string): Promise<SystemCapitalAllocation> {
  assertCryptocrawlRuntimeDatabaseAvailable();
  requireText('allocationId', allocationId);
  const result = await pool.query(
    `UPDATE public.cryptocrawler_system_capital_allocations
     SET status='PLACEMENT_PENDING', updated_at=now()
     WHERE allocation_id=$1 AND status='RESERVED'
     RETURNING *`,
    [allocationId],
  );
  if (result.rows[0]) return rowToAllocation(result.rows[0]);
  const existing = await pool.query('SELECT * FROM public.cryptocrawler_system_capital_allocations WHERE allocation_id=$1', [allocationId]);
  if (!existing.rows[0]) throw new Error(`System-capital allocation ${allocationId} does not exist`);
  const allocation = rowToAllocation(existing.rows[0]);
  if (allocation.status === 'PLACEMENT_PENDING' || allocation.status === 'PLACED') return allocation;
  throw new Error(`System-capital placement cannot start from ${allocation.status}`);
}

export async function confirmSystemCapitalPlacement(input: {
  allocationId: string;
  placementReference: string;
  placementEvidence: Record<string, unknown>;
  deliveredAmountBaseUnits: string;
}): Promise<SystemCapitalAllocation> {
  assertCryptocrawlRuntimeDatabaseAvailable();
  requireText('allocationId', input.allocationId);
  requireText('placementReference', input.placementReference);
  const delivered = requirePositiveBaseUnits('deliveredAmountBaseUnits', input.deliveredAmountBaseUnits);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingResult = await client.query(
      `SELECT * FROM public.cryptocrawler_system_capital_allocations WHERE allocation_id=$1 FOR UPDATE`,
      [input.allocationId],
    );
    if (!existingResult.rows[0]) throw new Error(`System-capital allocation ${input.allocationId} does not exist`);
    const existing = rowToAllocation(existingResult.rows[0]);
    if (existing.status === 'PLACED') {
      if (existing.placementReference !== input.placementReference || existing.deliveredAmountBaseUnits !== delivered.toString()) {
        throw new Error('System-capital placement is already confirmed with different settlement evidence');
      }
      await client.query('COMMIT');
      return existing;
    }
    if (existing.status !== 'PLACEMENT_PENDING') {
      throw new Error(`System-capital placement confirmation requires PLACEMENT_PENDING, received ${existing.status}`);
    }

    const updated = await client.query(
      `UPDATE public.cryptocrawler_system_capital_allocations
       SET status='PLACED', delivered_amount_base_units=$2,
           remaining_destination_base_units=$2, placement_reference=$3,
           placement_evidence=$4::jsonb, updated_at=now()
       WHERE allocation_id=$1 RETURNING *`,
      [input.allocationId, delivered.toString(), input.placementReference, JSON.stringify(input.placementEvidence || {})],
    );
    await client.query('COMMIT');
    return rowToAllocation(updated.rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function consumePlacedSystemCapital(input: {
  allocationId: string;
  consumedAmountBaseUnits: string;
  terminalReference: string;
  terminalEvidence: Record<string, unknown>;
}): Promise<SystemCapitalAllocation> {
  assertCryptocrawlRuntimeDatabaseAvailable();
  const consumed = requirePositiveBaseUnits('consumedAmountBaseUnits', input.consumedAmountBaseUnits);
  requireText('terminalReference', input.terminalReference);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingResult = await client.query(
      `SELECT * FROM public.cryptocrawler_system_capital_allocations WHERE allocation_id=$1 FOR UPDATE`,
      [input.allocationId],
    );
    if (!existingResult.rows[0]) throw new Error(`System-capital allocation ${input.allocationId} does not exist`);
    const existing = rowToAllocation(existingResult.rows[0]);
    if (existing.status !== 'PLACED' || existing.remainingDestinationBaseUnits == null) {
      throw new Error(`System-capital consumption requires PLACED destination capital, received ${existing.status}`);
    }
    const remaining = BigInt(existing.remainingDestinationBaseUnits);
    if (consumed > remaining) throw new Error('System-capital consumption exceeds settlement-confirmed destination balance');
    const nextRemaining = remaining - consumed;
    const updated = await client.query(
      `UPDATE public.cryptocrawler_system_capital_allocations
       SET remaining_destination_base_units=$2,
           status=CASE WHEN $2::numeric = 0 THEN 'CONSUMED' ELSE 'PLACED' END,
           terminal_reference=$3, terminal_evidence=$4::jsonb, updated_at=now()
       WHERE allocation_id=$1 RETURNING *`,
      [input.allocationId, nextRemaining.toString(), input.terminalReference, JSON.stringify(input.terminalEvidence || {})],
    );
    await client.query('COMMIT');
    return rowToAllocation(updated.rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function getPlacedCexSystemOwnedInventory(venue: string, asset: string): Promise<{
  venue: string;
  asset: string;
  assetDecimals: number;
  baseUnits: string;
}> {
  assertCryptocrawlRuntimeDatabaseAvailable();
  const normalizedVenue = requireText('venue', venue).toLowerCase();
  const normalizedAsset = requireText('asset', asset).toUpperCase();
  const result = await pool.query(
    `SELECT destination_asset_decimals AS decimals,
            COALESCE(SUM(remaining_destination_base_units),0)::text AS base_units
     FROM public.cryptocrawler_system_capital_allocations
     WHERE destination_kind='cex' AND lower(destination_venue)=lower($1)
       AND upper(destination_asset)=upper($2) AND status='PLACED'
       AND remaining_destination_base_units > 0
     GROUP BY destination_asset_decimals`,
    [normalizedVenue, normalizedAsset],
  );
  if (result.rowCount === 0) return { venue: normalizedVenue, asset: normalizedAsset, assetDecimals: 0, baseUnits: '0' };
  if (result.rowCount !== 1) throw new Error(`CEX system-owned inventory has inconsistent decimals for ${normalizedVenue}:${normalizedAsset}`);
  return {
    venue: normalizedVenue,
    asset: normalizedAsset,
    assetDecimals: Number(result.rows[0].decimals),
    baseUnits: String(result.rows[0].base_units),
  };
}
