import { assertCryptocrawlRuntimeDatabaseAvailable, pool } from '../runtime/cryptocrawl-runtime-database.js';

export interface ZeroCapitalRescueFairnessCandidate {
  opportunityId: string;
  routeId: string;
  routeFamily: string;
  priority: number;
  netProfitBps: number;
}

export interface ZeroCapitalRescueFairnessSelection {
  selectedOpportunityIds: Set<string>;
  deferredOpportunityIds: Set<string>;
  selectedRouteIds: string[];
  deferredRouteIds: string[];
}

type FairnessRow = {
  route_id: string;
  route_family: string;
  deferred_count: string | number;
  attempt_count: string | number;
  last_attempt_at: Date | string | null;
  first_seen_at: Date | string;
};

function finitePriority(value: number): number {
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function uniqueRouteCandidates(candidates: readonly ZeroCapitalRescueFairnessCandidate[]): ZeroCapitalRescueFairnessCandidate[] {
  const byRoute = new Map<string, ZeroCapitalRescueFairnessCandidate>();
  for (const candidate of candidates) {
    const current = byRoute.get(candidate.routeId);
    if (!current || finitePriority(candidate.priority) > finitePriority(current.priority)) byRoute.set(candidate.routeId, candidate);
  }
  return [...byRoute.values()];
}

/**
 * Persists bounded-work scheduling debt only. No quote/economics are carried
 * across cycles: a deferred route must appear again with fresh executable
 * evidence before it can be selected for another rescue attempt.
 */
export async function selectFairZeroCapitalRescueCandidates(input: {
  chain: string;
  candidates: readonly ZeroCapitalRescueFairnessCandidate[];
  maxCandidates: number;
}): Promise<ZeroCapitalRescueFairnessSelection> {
  assertCryptocrawlRuntimeDatabaseAvailable();
  const chain = input.chain.trim().toLowerCase();
  const candidates = uniqueRouteCandidates(input.candidates);
  const selectedOpportunityIds = new Set<string>();
  const deferredOpportunityIds = new Set<string>();
  if (!chain || candidates.length === 0 || input.maxCandidates <= 0) {
    for (const candidate of input.candidates) deferredOpportunityIds.add(candidate.opportunityId);
    return { selectedOpportunityIds, deferredOpportunityIds, selectedRouteIds: [], deferredRouteIds: candidates.map(item => item.routeId) };
  }

  const candidateByRoute = new Map(candidates.map(candidate => [candidate.routeId, candidate] as const));
  const routeIds = candidates.map(candidate => candidate.routeId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize the tiny scheduler metadata section per chain only. Network quote
    // work happens after COMMIT and never holds this advisory lock.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('cryptocrawl_zero_capital_rescue'), hashtext($1))`, [chain]);

    for (const candidate of candidates) {
      await client.query(
        `INSERT INTO public.cryptocrawler_zero_capital_rescue_fairness (
           chain, route_id, route_family, last_opportunity_id, last_net_profit_bps,
           first_seen_at, last_seen_at
         ) VALUES ($1,$2,$3,$4,$5,now(),now())
         ON CONFLICT (chain,route_id) DO UPDATE
         SET route_family=EXCLUDED.route_family,
             last_opportunity_id=EXCLUDED.last_opportunity_id,
             last_net_profit_bps=EXCLUDED.last_net_profit_bps,
             last_seen_at=now()`,
        [chain, candidate.routeId, candidate.routeFamily, candidate.opportunityId, candidate.netProfitBps],
      );
    }

    const rows = await client.query(
      `SELECT route_id, route_family, deferred_count, attempt_count, last_attempt_at, first_seen_at
       FROM public.cryptocrawler_zero_capital_rescue_fairness
       WHERE chain=$1 AND route_id=ANY($2::text[])
       ORDER BY deferred_count DESC,
                last_attempt_at ASC NULLS FIRST,
                first_seen_at ASC,
                route_id ASC
       FOR UPDATE`,
      [chain, routeIds],
    );

    const ordered = rows.rows as FairnessRow[];
    const maxCandidates = Math.min(candidates.length, Math.max(1, Math.trunc(input.maxCandidates)));
    const selectedRouteIds: string[] = [];
    const selectedRoutes = new Set<string>();
    const selectedFamilies = new Set<string>();

    // Preserve route-family diversity without losing durable fairness: rows with
    // the greatest scheduling debt are considered first, one family each, then
    // remaining slots are filled strictly in the same debt order.
    for (const row of ordered) {
      if (selectedRouteIds.length >= maxCandidates) break;
      if (selectedFamilies.has(row.route_family)) continue;
      selectedFamilies.add(row.route_family);
      selectedRoutes.add(row.route_id);
      selectedRouteIds.push(row.route_id);
    }
    for (const row of ordered) {
      if (selectedRouteIds.length >= maxCandidates) break;
      if (selectedRoutes.has(row.route_id)) continue;
      selectedRoutes.add(row.route_id);
      selectedRouteIds.push(row.route_id);
    }

    const deferredRouteIds = routeIds.filter(routeId => !selectedRoutes.has(routeId));
    if (selectedRouteIds.length > 0) {
      await client.query(
        `UPDATE public.cryptocrawler_zero_capital_rescue_fairness
         SET attempt_count=attempt_count+1, last_attempt_at=now(), last_seen_at=now()
         WHERE chain=$1 AND route_id=ANY($2::text[])`,
        [chain, selectedRouteIds],
      );
    }
    if (deferredRouteIds.length > 0) {
      await client.query(
        `UPDATE public.cryptocrawler_zero_capital_rescue_fairness
         SET deferred_count=deferred_count+1, last_seen_at=now()
         WHERE chain=$1 AND route_id=ANY($2::text[])`,
        [chain, deferredRouteIds],
      );
    }
    await client.query('COMMIT');

    for (const routeId of selectedRouteIds) {
      const candidate = candidateByRoute.get(routeId);
      if (candidate) selectedOpportunityIds.add(candidate.opportunityId);
    }
    for (const candidate of input.candidates) {
      if (!selectedOpportunityIds.has(candidate.opportunityId)) deferredOpportunityIds.add(candidate.opportunityId);
    }
    return { selectedOpportunityIds, deferredOpportunityIds, selectedRouteIds, deferredRouteIds };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original */ }
    throw error;
  } finally {
    client.release();
  }
}
