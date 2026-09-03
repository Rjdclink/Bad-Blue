import { cexInventoryLedger, type InventoryVenue } from './cex-inventory-ledger.js';

export interface RebalanceRouteEvidence {
  sourceVenue: InventoryVenue;
  destinationVenue: InventoryVenue;
  asset: string;
  network: string;
  withdrawalFeeAsset: number;
  estimatedFeeUsd: number;
  estimatedLatencyMs: number;
  minimumAmount: number;
  maximumAmount: number | null;
  withdrawalSupported: boolean;
  depositSupported: boolean;
  statusTrackingSupported: boolean;
  observedAt: number;
  expiresAt: number;
  provenance: string[];
}

export interface RebalancePlan {
  sourceVenue: InventoryVenue;
  destinationVenue: InventoryVenue;
  asset: string;
  network: string;
  amount: number;
  estimatedFeeUsd: number;
  estimatedLatencyMs: number;
  sourceSurplus: number;
  destinationDeficit: number;
  executable: false;
  reason: string;
  evidenceObservedAt: number;
  evidenceExpiresAt: number;
  provenance: string[];
}

type RemainingRecommendation = ReturnType<typeof cexInventoryLedger.getRebalanceRecommendations>[number] & {
  remainingDelta: number;
};

type NettingCandidate = {
  surplus: RemainingRecommendation;
  deficit: RemainingRecommendation;
  route: RebalanceRouteEvidence;
  amount: number;
  utilityCost: number;
};

class InventoryRebalancer {
  private readonly evidence = new Map<string, RebalanceRouteEvidence>();

  private key(route: Pick<RebalanceRouteEvidence, 'sourceVenue' | 'destinationVenue' | 'asset' | 'network'>): string {
    return `${route.sourceVenue}:${route.destinationVenue}:${route.asset.toUpperCase()}:${route.network.toUpperCase()}`;
  }

  recordMeasuredRouteEvidence(input: RebalanceRouteEvidence): void {
    if (input.sourceVenue === input.destinationVenue) throw new Error('Rebalance route requires distinct venues');
    if (!(input.estimatedFeeUsd >= 0) || !(input.estimatedLatencyMs >= 0) || !(input.minimumAmount >= 0)) {
      throw new Error('Rebalance evidence requires finite non-negative fee/latency/minimum');
    }
    if (!Number.isFinite(input.observedAt) || !Number.isFinite(input.expiresAt) || input.expiresAt <= input.observedAt) {
      throw new Error('Rebalance evidence requires a bounded freshness interval');
    }
    this.evidence.set(this.key(input), {
      ...input,
      asset: input.asset.toUpperCase(),
      provenance: [...new Set([...input.provenance, 'measured_rebalance_route_evidence'])],
    });
  }

  private bestNettingCandidate(
    deficits: RemainingRecommendation[],
    surpluses: RemainingRecommendation[],
    now: number,
  ): NettingCandidate | null {
    const candidates: NettingCandidate[] = [];
    for (const deficit of deficits) {
      if (!(deficit.remainingDelta > 0)) continue;
      for (const surplus of surpluses) {
        if (!(surplus.remainingDelta > 0) || surplus.asset !== deficit.asset || surplus.venue === deficit.venue) continue;
        const routes = [...this.evidence.values()].filter(route =>
          route.sourceVenue === surplus.venue &&
          route.destinationVenue === deficit.venue &&
          route.asset === deficit.asset &&
          route.expiresAt > now &&
          route.withdrawalSupported && route.depositSupported && route.statusTrackingSupported,
        );
        for (const route of routes) {
          const maximum = route.maximumAmount === null ? Number.POSITIVE_INFINITY : route.maximumAmount;
          const amount = Math.min(surplus.remainingDelta, deficit.remainingDelta, maximum);
          if (!(amount > 0) || !(amount >= route.minimumAmount)) continue;
          // Rebalance fees are normally fixed or weakly amount-dependent. Prefer
          // routes that move more useful inventory per measured dollar of fee,
          // with latency only as a small tie-breaker. This is planning-only and
          // never changes arbitrage execution economics.
          const utilityCost = (route.estimatedFeeUsd + route.estimatedLatencyMs / 60_000 * 0.01) / amount;
          candidates.push({ surplus, deficit, route, amount, utilityCost });
        }
      }
    }
    candidates.sort((left, right) =>
      left.utilityCost - right.utilityCost ||
      right.amount - left.amount ||
      left.route.estimatedFeeUsd - right.route.estimatedFeeUsd,
    );
    return candidates[0] || null;
  }

  getPlans(): RebalancePlan[] {
    const now = Date.now();
    const recommendations = cexInventoryLedger.getRebalanceRecommendations();
    const deficits: RemainingRecommendation[] = recommendations
      .filter(item => item.action === 'fund')
      .map(item => ({ ...item, remainingDelta: item.delta }));
    const surpluses: RemainingRecommendation[] = recommendations
      .filter(item => item.action === 'reduce')
      .map(item => ({ ...item, remainingDelta: item.delta }));
    const plans: RebalancePlan[] = [];

    // Intent netting consumes every measured surplus/deficit unit at most once.
    // This prevents multiple planned transfers from reusing the same inventory.
    // It does not synthesize fills, erase exchange fees, or grant execution.
    const maxIterations = Math.max(1, deficits.length * Math.max(1, surpluses.length) * Math.max(1, this.evidence.size));
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const selected = this.bestNettingCandidate(deficits, surpluses, now);
      if (!selected) break;
      const { surplus, deficit, route, amount } = selected;
      plans.push({
        sourceVenue: surplus.venue,
        destinationVenue: deficit.venue,
        asset: deficit.asset,
        network: route.network,
        amount,
        estimatedFeeUsd: route.estimatedFeeUsd,
        estimatedLatencyMs: route.estimatedLatencyMs,
        sourceSurplus: surplus.delta,
        destinationDeficit: deficit.delta,
        executable: false,
        reason: 'Measured inventory intents netted without double allocation; transfer still requires verified withdrawal/deposit address and terminal settlement adapter',
        evidenceObservedAt: route.observedAt,
        evidenceExpiresAt: route.expiresAt,
        provenance: [...new Set([...route.provenance, 'inventory_intent_netting:single_consumption'])],
      });
      surplus.remainingDelta = Math.max(0, surplus.remainingDelta - amount);
      deficit.remainingDelta = Math.max(0, deficit.remainingDelta - amount);
    }

    return plans.sort((left, right) => {
      const leftUtility = left.amount / Math.max(0.01, left.estimatedFeeUsd + 0.01);
      const rightUtility = right.amount / Math.max(0.01, right.estimatedFeeUsd + 0.01);
      return rightUtility - leftUtility;
    });
  }

  getStatus() {
    const now = Date.now();
    const liveEvidence = [...this.evidence.values()].filter(item => item.expiresAt > now);
    return {
      measuredRoutes: liveEvidence.length,
      configuredTargets: cexInventoryLedger.getSnapshots().filter(snapshot => snapshot.target !== null).length,
      recommendations: cexInventoryLedger.getRebalanceRecommendations().length,
      plannedTransfers: this.getPlans().length,
      liveTransferExecutionEnabled: false,
      inventoryIntentNetting: true,
      singleConsumptionAllocation: true,
      syntheticFillNetting: false,
      exchangeFillFeeErasure: false,
      reason: 'Arbitrage execution is intentionally independent of venue transfer settlement; live rebalancing stays disabled until settlement-safe address/network adapters are installed',
    };
  }
}

export const inventoryRebalancer = new InventoryRebalancer();
