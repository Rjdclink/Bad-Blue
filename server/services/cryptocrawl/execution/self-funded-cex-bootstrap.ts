import { ethers } from 'ethers';
import logger from '../../../logger.js';
import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import type { ProfitLadderNotionalAuthoritySnapshot } from '../governance/profit-ladder-notional-authority.js';
import { assertCryptocrawlRuntimeDatabaseAvailable, pool } from '../runtime/cryptocrawl-runtime-database.js';
import { cexInventoryLedger, type InventoryVenue } from './cex-inventory-ledger.js';
import { placeReservedCexSystemCapital, reconcilePendingCexSystemCapitalPlacements } from './cex-system-capital-placement.js';
import { placeReservedCoinbaseSystemCapital, reconcilePendingCoinbaseSystemCapitalPlacements } from './coinbase-system-capital-placement.js';
import { placeReservedKrakenSystemCapital, reconcilePendingKrakenSystemCapitalPlacements } from './kraken-system-capital-placement.js';
import { reserveOnchainSystemCapital } from './onchain-system-capital-ledger.js';
import {
  releaseUnplacedSystemCapital,
  reserveAuthorizedSystemCapital,
  type SystemCapitalAuthorityEvidence,
} from './system-capital-allocation-ledger.js';

export type CexBootstrapInventoryRole = 'BUY_QUOTE' | 'SELL_BASE';
export type CexBootstrapVenue = 'coinbase' | 'kraken' | 'okx';

type BootstrapRequirement = {
  role: CexBootstrapInventoryRole;
  venue: CexBootstrapVenue;
  asset: string;
  amountDecimal: number;
};

type BootstrapDemand = {
  demandId: string;
  status: string;
  requirement: BootstrapRequirement;
};

type SourceCandidate = {
  scope: string;
  chain: string;
  asset: string;
  tokenAddress: string;
  decimals: number;
  recipient: string;
  availableBaseUnits: bigint;
  originReference: string;
};

export interface SelfFundedCexBootstrapResult {
  deferred: true;
  opportunityId: string;
  demands: Array<{
    role: CexBootstrapInventoryRole;
    venue: CexBootstrapVenue;
    asset: string;
    requiredAmountDecimal: number;
    status: string;
    detail: string;
  }>;
}

function canonicalOpportunityId(plan: VerifiedArbitragePlan): string {
  return `cex-inventory:${plan.buyVenue}:${plan.sellVenue}:${plan.symbol}:${plan.buyAsk}:${plan.sellBid}:${plan.baseQty}`;
}

function splitSpotSymbol(symbol: string): { base: string; quote: string } | null {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? { base: match[1], quote: match[2] } : null;
}

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function baseUnitsCeil(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) throw new Error('CEX bootstrap amount must be finite and positive');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('CEX bootstrap asset decimals are invalid');
  const fixed = value.toFixed(decimals);
  let units = BigInt(ethers.utils.parseUnits(fixed, decimals).toString());
  if (Number(fixed) + Number.EPSILON * Math.max(1, Math.abs(value)) < value) units += 1n;
  if (units <= 0n) throw new Error('CEX bootstrap amount rounded to zero base units');
  return units.toString();
}

function spendable(venue: InventoryVenue, asset: string): number {
  const snapshot = cexInventoryLedger.getSnapshots().find(row =>
    row.venue === venue && row.asset.toUpperCase() === asset.toUpperCase(),
  );
  if (!snapshot) return 0;
  const value = snapshot.available - snapshot.reserved - snapshot.payoutReserved
    - snapshot.pendingOrder - snapshot.pendingTransfer - snapshot.minimumReserve;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function requirementsFor(plan: VerifiedArbitragePlan): BootstrapRequirement[] {
  const pair = splitSpotSymbol(plan.symbol);
  if (!pair) return [];
  const buyPrice = finitePositive(plan.buyLimitPrice) ?? finitePositive(plan.buyAsk);
  if (buyPrice === null || !(plan.baseQty > 0)) return [];
  const requiredQuote = plan.baseQty * buyPrice + Math.max(0, Number(plan.costs.buyFeeUsd) || 0);
  const all: BootstrapRequirement[] = [
    { role: 'BUY_QUOTE', venue: plan.buyVenue, asset: pair.quote, amountDecimal: requiredQuote },
    { role: 'SELL_BASE', venue: plan.sellVenue, asset: pair.base, amountDecimal: plan.baseQty },
  ];
  return all.filter(requirement => spendable(requirement.venue, requirement.asset) + 1e-12 < requirement.amountDecimal);
}

async function upsertDemand(opportunityId: string, symbol: string, requirement: BootstrapRequirement): Promise<BootstrapDemand> {
  const idempotencyKey = [
    'cex-bootstrap-demand', opportunityId, requirement.role, requirement.venue,
    requirement.asset.toUpperCase(),
  ].join(':');
  const result = await pool.query(
    `INSERT INTO public.cryptocrawler_cex_bootstrap_demands (
       idempotency_key, opportunity_id, symbol, inventory_role,
       destination_venue, destination_asset, required_amount_decimal, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,'PENDING')
     ON CONFLICT (idempotency_key) DO UPDATE
     SET required_amount_decimal=GREATEST(
           public.cryptocrawler_cex_bootstrap_demands.required_amount_decimal,
           EXCLUDED.required_amount_decimal
         ),
         updated_at=now()
     RETURNING demand_id::text, status`,
    [
      idempotencyKey,
      opportunityId,
      symbol.toUpperCase(),
      requirement.role,
      requirement.venue,
      requirement.asset.toUpperCase(),
      requirement.amountDecimal.toString(),
    ],
  );
  return {
    demandId: String(result.rows[0].demand_id),
    status: String(result.rows[0].status),
    requirement,
  };
}

async function updateDemand(demandId: string, status: string, error?: unknown): Promise<void> {
  const message = error === undefined ? null : (error instanceof Error ? error.message : String(error)).slice(0, 1500);
  await pool.query(
    `UPDATE public.cryptocrawler_cex_bootstrap_demands
     SET status=$2, last_error=$3,
         attempt_count=attempt_count+CASE WHEN $2 IN ('RESERVED','PLACEMENT_PENDING','MANUAL_REVIEW') THEN 1 ELSE 0 END,
         updated_at=now()
     WHERE demand_id=$1::uuid`,
    [demandId, status, message],
  );
}

async function directSourceCandidates(asset: string, requiredBaseUnits: bigint): Promise<SourceCandidate[]> {
  const result = await pool.query(
    `SELECT s.scope, lower(l.chain) AS chain, upper(l.asset) AS asset,
            lower(l.token_address) AS token_address, l.decimals,
            lower(s.source_recipient) AS recipient,
            LEAST(l.remaining_base_units, s.internally_generated_balance::numeric)::text AS available_base_units,
            l.origin_reference
     FROM public.cryptocrawler_onchain_system_owned_lots l
     JOIN public.zero_capital_capital_state s
       ON lower(COALESCE(s.chain,''))=lower(l.chain)
      AND upper(COALESCE(s.asset,''))=upper(l.asset)
      AND lower(COALESCE(s.source_recipient,''))=lower(COALESCE(l.settlement_evidence->>'recipient',''))
      AND s.scope IN (
        'zero-capital:' || lower(l.chain) || ':' || lower(l.token_address) || ':' || lower(COALESCE(s.source_recipient,'')),
        'system-capital:' || lower(l.chain) || ':' || lower(l.token_address) || ':' || lower(COALESCE(s.source_recipient,''))
      )
     WHERE l.status='ACTIVE' AND l.remaining_base_units > 0
       AND s.lifecycle='SELF_FUNDED'
       AND s.internally_generated_balance::numeric >= $2::numeric
       AND upper(l.asset)=upper($1)
       AND l.remaining_base_units >= $2::numeric
     ORDER BY l.created_at ASC, l.lot_id ASC`,
    [asset.toUpperCase(), requiredBaseUnits.toString()],
  );
  return result.rows.map(row => ({
    scope: String(row.scope),
    chain: String(row.chain),
    asset: String(row.asset),
    tokenAddress: String(row.token_address),
    decimals: Number(row.decimals),
    recipient: String(row.recipient),
    availableBaseUnits: BigInt(String(row.available_base_units)),
    originReference: String(row.origin_reference),
  })).filter(row =>
    row.availableBaseUnits >= requiredBaseUnits &&
    ethers.utils.isAddress(row.tokenAddress) && ethers.utils.isAddress(row.recipient),
  );
}

async function bindBridge(input: {
  demandId: string;
  allocationId: string;
  reservationId: string;
  source: SourceCandidate;
  sourceAmountBaseUnits: string;
  venue: CexBootstrapVenue;
  destinationAsset: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO public.cryptocrawler_cex_bootstrap_bridges (
       demand_id, allocation_id, onchain_reservation_id,
       source_chain, source_asset, source_token_address, source_amount_base_units,
       destination_venue, destination_asset, status
     ) VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,$7::numeric,$8,$9,'RESERVED')
     ON CONFLICT (allocation_id) DO NOTHING`,
    [
      input.demandId,
      input.allocationId,
      input.reservationId,
      input.source.chain,
      input.source.asset,
      input.source.tokenAddress,
      input.sourceAmountBaseUnits,
      input.venue,
      input.destinationAsset.toUpperCase(),
    ],
  );
}

async function bridgeExists(allocationId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM public.cryptocrawler_cex_bootstrap_bridges WHERE allocation_id=$1`,
    [allocationId],
  );
  return result.rowCount === 1;
}

async function dispatchPlacement(venue: CexBootstrapVenue, allocationId: string) {
  if (venue === 'coinbase') return placeReservedCoinbaseSystemCapital(allocationId);
  if (venue === 'kraken') return placeReservedKrakenSystemCapital(allocationId);
  return placeReservedCexSystemCapital(allocationId);
}

async function reserveAndDispatchDirect(input: {
  demand: BootstrapDemand;
  opportunityId: string;
  notionalAuthority: ProfitLadderNotionalAuthoritySnapshot;
}): Promise<{ status: string; detail: string }> {
  const requirement = input.demand.requirement;
  if (!['USDC', 'USDT'].includes(requirement.asset.toUpperCase())) {
    await updateDemand(input.demand.demandId, 'TRANSFORM_REQUIRED', `Direct retained-capital placement cannot manufacture ${requirement.asset}; a terminal CEX conversion/rebalance is required`);
    return { status: 'TRANSFORM_REQUIRED', detail: `${requirement.asset} requires a real terminal conversion/rebalance before it is spendable inventory` };
  }

  // Direct placement adapters admit stablecoin source assets. Candidate source
  // lots are examined one at a time so an incompatible chain/token route is
  // local and the next compatible retained-profit lot remains eligible.
  const provisional = await directSourceCandidates(requirement.asset, 1n);
  if (provisional.length === 0) {
    await updateDemand(input.demand.demandId, 'PENDING', `No matching SELF_FUNDED ${requirement.asset} on-chain lot is currently available`);
    return { status: 'PENDING', detail: `No matching SELF_FUNDED ${requirement.asset} source capital yet` };
  }

  let lastError: unknown = null;
  for (const source of provisional) {
    const sourceAmountBaseUnits = baseUnitsCeil(requirement.amountDecimal, source.decimals);
    const amount = BigInt(sourceAmountBaseUnits);
    if (source.availableBaseUnits < amount) continue;
    const sourceCandidates = await directSourceCandidates(requirement.asset, amount);
    if (!sourceCandidates.some(candidate =>
      candidate.scope === source.scope && candidate.chain === source.chain && candidate.tokenAddress === source.tokenAddress
    )) continue;

    const reservation = await reserveOnchainSystemCapital({
      opportunityId: `${input.opportunityId}:bootstrap:${requirement.role}:${requirement.venue}`,
      chain: source.chain,
      asset: source.asset,
      tokenAddress: source.tokenAddress,
      amountBaseUnits: sourceAmountBaseUnits,
      // CEX deposits are intentionally quote-independent. Keep the source locked
      // across long exchange settlement; uncertain submitted transfers must not
      // become available to another route merely because the original quote died.
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
    });
    if (!reservation) continue;

    const reference = `cex-bootstrap:${input.opportunityId}:${input.notionalAuthority.rungKey}:${input.notionalAuthority.evaluatedAt}`;
    const authorityEvidence: SystemCapitalAuthorityEvidence = {
      strategySelectionAuthority: 'cryptara',
      notionalAuthority: 'profit_ladder',
      executionAuthority: 'stage_manager',
      governanceAdmitted: true,
      reference,
      profitLadderRung: input.notionalAuthority.rungKey,
      profitLadderMaxNotionalUsd: input.notionalAuthority.maxNotionalUsd,
      stage: input.notionalAuthority.stage,
      tierId: input.notionalAuthority.tierId,
      purpose: 'self_funded_cex_inventory_bootstrap',
    };

    let allocation: Awaited<ReturnType<typeof reserveAuthorizedSystemCapital>> | null = null;
    try {
      allocation = await reserveAuthorizedSystemCapital({
        idempotencyKey: `cex-bootstrap:${input.demand.demandId}:${source.scope}:${source.chain}:${source.tokenAddress}:${sourceAmountBaseUnits}`,
        capitalScope: source.scope,
        opportunityId: input.opportunityId,
        strategy: 'verified_cex_arbitrage_bootstrap',
        authorityReference: reference,
        authorityEvidence,
        destinationKind: 'cex',
        destinationVenue: requirement.venue,
        sourceChain: source.chain,
        sourceAsset: source.asset,
        sourceAssetDecimals: source.decimals,
        sourceRecipient: source.recipient,
        sourceAmountBaseUnits,
        destinationAsset: requirement.asset.toUpperCase(),
        destinationAssetDecimals: source.decimals,
      });
      await bindBridge({
        demandId: input.demand.demandId,
        allocationId: allocation.allocationId,
        reservationId: reservation.reservationId,
        source,
        sourceAmountBaseUnits,
        venue: requirement.venue,
        destinationAsset: requirement.asset,
      });
      if (!(await bridgeExists(allocation.allocationId))) {
        throw new Error('CEX bootstrap allocation could not bind to its on-chain ownership reservation');
      }
      await updateDemand(input.demand.demandId, 'RESERVED');

      const placed = await dispatchPlacement(requirement.venue, allocation.allocationId);
      const nextStatus = placed.status === 'PLACED' ? 'READY' : 'PLACEMENT_PENDING';
      await pool.query(
        `UPDATE public.cryptocrawler_cex_bootstrap_bridges
         SET status=CASE WHEN status='APPLIED' THEN status ELSE $2 END, updated_at=now()
         WHERE allocation_id=$1`,
        [allocation.allocationId, nextStatus === 'READY' ? 'PLACEMENT_PENDING' : nextStatus],
      );
      await updateDemand(input.demand.demandId, nextStatus);
      return {
        status: nextStatus,
        detail: placed.status === 'PLACED'
          ? `${requirement.venue} placement reached terminal spendability; ownership bridge applied atomically`
          : `${requirement.venue} placement submitted/pending; source ownership remains reserved`,
      };
    } catch (error) {
      lastError = error;
      const allocationStatus = allocation
        ? (await pool.query(`SELECT status FROM public.cryptocrawler_system_capital_allocations WHERE allocation_id=$1`, [allocation.allocationId])).rows[0]?.status
        : null;
      if (!allocation || allocationStatus === 'RESERVED') {
        if (allocation) await releaseUnplacedSystemCapital(allocation.allocationId, 'cex_bootstrap_prebroadcast_failure').catch(() => undefined);
        await reservation.release().catch(() => undefined);
        if (allocation) {
          await pool.query(
            `UPDATE public.cryptocrawler_cex_bootstrap_bridges SET status='RELEASED', updated_at=now() WHERE allocation_id=$1 AND status='RESERVED'`,
            [allocation.allocationId],
          ).catch(() => undefined);
        }
      } else {
        await pool.query(
          `UPDATE public.cryptocrawler_cex_bootstrap_bridges SET status='MANUAL_REVIEW', updated_at=now() WHERE allocation_id=$1 AND status <> 'APPLIED'`,
          [allocation.allocationId],
        ).catch(() => undefined);
        await updateDemand(input.demand.demandId, 'MANUAL_REVIEW', error).catch(() => undefined);
        return {
          status: 'MANUAL_REVIEW',
          detail: `Submitted placement outcome is uncertain and remains fully encumbered: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      // Route-local failure: try the next matching SELF_FUNDED source lot/chain.
    }
  }

  await updateDemand(input.demand.demandId, 'PENDING', lastError || 'No compatible retained-capital placement source could be reserved');
  return {
    status: 'PENDING',
    detail: lastError instanceof Error ? lastError.message : 'No compatible retained-capital source path is currently executable',
  };
}

export async function requestSelfFundedCexBootstrap(input: {
  plan: VerifiedArbitragePlan;
  notionalAuthority: ProfitLadderNotionalAuthoritySnapshot;
}): Promise<SelfFundedCexBootstrapResult> {
  assertCryptocrawlRuntimeDatabaseAvailable();
  const opportunityId = canonicalOpportunityId(input.plan);
  const requirements = requirementsFor(input.plan);
  const summaries: SelfFundedCexBootstrapResult['demands'] = [];

  for (const requirement of requirements) {
    const demand = await upsertDemand(opportunityId, input.plan.symbol, requirement);
    if (demand.status === 'READY') {
      summaries.push({
        role: requirement.role,
        venue: requirement.venue,
        asset: requirement.asset,
        requiredAmountDecimal: requirement.amountDecimal,
        status: 'READY',
        detail: 'Terminal destination ownership already exists; waiting for fresh authenticated inventory reconciliation',
      });
      continue;
    }
    const outcome = await reserveAndDispatchDirect({ demand, opportunityId, notionalAuthority: input.notionalAuthority });
    summaries.push({
      role: requirement.role,
      venue: requirement.venue,
      asset: requirement.asset,
      requiredAmountDecimal: requirement.amountDecimal,
      status: outcome.status,
      detail: outcome.detail,
    });
  }

  logger.info('[SelfFundedCexBootstrap] Inventory bootstrap deferred from expired quote lifetime', {
    component: 'SelfFundedCexBootstrap',
    opportunityId,
    symbol: input.plan.symbol,
    buyVenue: input.plan.buyVenue,
    sellVenue: input.plan.sellVenue,
    demands: summaries,
    quoteHeldOpenForPlacement: false,
    operatorPrincipalRequired: false,
    rawWalletBalanceOwnershipAuthority: false,
  });

  return { deferred: true, opportunityId, demands: summaries };
}

/**
 * Background-only reconciliation. Never call this from a fresh quote-critical
 * path: exchange deposit settlement can outlive the quote by minutes or hours.
 */
export async function reconcileSelfFundedCexBootstraps(limit = 25): Promise<void> {
  assertCryptocrawlRuntimeDatabaseAvailable();
  const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
  await Promise.allSettled([
    reconcilePendingCoinbaseSystemCapitalPlacements(bounded),
    reconcilePendingKrakenSystemCapitalPlacements(bounded),
    reconcilePendingCexSystemCapitalPlacements(bounded),
  ]);
  await pool.query(
    `UPDATE public.cryptocrawler_cex_bootstrap_demands d
     SET status=CASE
           WHEN b.status='APPLIED' THEN 'READY'
           WHEN b.status='MANUAL_REVIEW' THEN 'MANUAL_REVIEW'
           ELSE d.status
         END,
         updated_at=now()
     FROM public.cryptocrawler_cex_bootstrap_bridges b
     WHERE b.demand_id=d.demand_id
       AND d.status IN ('RESERVED','PLACEMENT_PENDING','MANUAL_REVIEW')`,
  );
}
