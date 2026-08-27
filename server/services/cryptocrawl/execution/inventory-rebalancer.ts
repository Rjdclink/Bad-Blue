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

  getPlans(): RebalancePlan[] {
    const now = Date.now();
    const recommendations = cexInventoryLedger.getRebalanceRecommendations();
    const deficits = recommendations.filter(item => item.action === 'fund');
    const surpluses = recommendations.filter(item => item.action === 'reduce');
    const plans: RebalancePlan[] = [];

    for (const deficit of deficits) {
      const possible = surpluses.filter(surplus =>
        surplus.asset === deficit.asset && surplus.venue !== deficit.venue && surplus.delta > 0,
      );
      for (const surplus of possible) {
        const routes = [...this.evidence.values()].filter(route =>
          route.sourceVenue === surplus.venue &&
          route.destinationVenue === deficit.venue &&
          route.asset === deficit.asset &&
          route.expiresAt > now &&
          route.withdrawalSupported && route.depositSupported && route.statusTrackingSupported,
        ).sort((left, right) => {
          const leftScore = left.estimatedFeeUsd + left.estimatedLatencyMs / 60_000 * 0.01;
          const rightScore = right.estimatedFeeUsd + right.estimatedLatencyMs / 60_000 * 0.01;
          return leftScore - rightScore;
        });
        const route = routes[0];
        if (!route) continue;
        const maximum = route.maximumAmount === null ? Number.POSITIVE_INFINITY : route.maximumAmount;
        const amount = Math.min(surplus.delta, deficit.delta, maximum);
        if (!(amount >= route.minimumAmount) || !(amount > 0)) continue;
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
          reason: 'Measured rebalance route selected, but transfers remain outside the arbitrage critical path and require explicit withdrawal/deposit address + settlement adapters before live execution',
          evidenceObservedAt: route.observedAt,
          evidenceExpiresAt: route.expiresAt,
          provenance: [...route.provenance],
        });
        break;
      }
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
      reason: 'Arbitrage execution is intentionally independent of venue transfer settlement; live rebalancing stays disabled until settlement-safe address/network adapters are installed',
    };
  }
}

export const inventoryRebalancer = new InventoryRebalancer();
