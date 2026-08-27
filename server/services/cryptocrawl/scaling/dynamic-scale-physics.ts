import logger from '../../../logger.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';

type ComputeProfile = 'low' | 'medium' | 'high' | 'burst';
type Chain = 'ethereum' | 'polygon' | 'bsc' | 'arbitrum' | 'optimism';
type Region = string;

interface ScaleMetrics {
  currentProfile: ComputeProfile;
  marketVolatility: number;
  opportunityDensity: number;
  searchOpportunityDensity: number;
  verifiedPositiveDensity: number;
  avgProfitPerHour: number | null;
  expectedProfitPerHour: number | null;
  profitabilityStatus: ProfitabilityStatus;
  profitabilitySource: 'realized_settlement' | 'verified_pretrade' | 'unavailable';
  capacityMultiplier: number;
  costMultiplier: number;
}

type ProfitabilityStatus = 'PROFITABILITY_UNKNOWN' | 'PROFITABILITY_KNOWN_ZERO' | 'PROFITABILITY_KNOWN';

interface RegionConfig {
  chain: Chain;
  region: Region | null;
  latency: number | null;
  reason: string;
}

class DynamicScalePhysics {
  private currentProfile: ComputeProfile = 'medium';
  private priceHistory: number[] = [];
  private opportunityHistory: number[] = [];
  private profitHistory: Array<number | null> = [];
  private lastRecordedOpportunityTotal: number | null = null;
  private readonly MAX_HISTORY = 60; // Track recent samples; canonical state remains authoritative.

  constructor() {
    this.priceHistory = Array(60).fill(0);
    this.opportunityHistory = [];
    this.profitHistory = Array(60).fill(null);
  }

  adjustComputeProfile(): ComputeProfile {
    const volatility = this.calculateMarketVolatility();
    const searchDensity = this.getSearchOpportunityDensity();
    const verifiedPositiveDensity = this.getVerifiedPositiveDensity();

    let newProfile: ComputeProfile;

    // Discovery capacity is driven by measured search activity, not only by the
    // subset that survives deterministic economics. Otherwise a market with many
    // candidates but zero positive candidates self-throttles its own discovery.
    if (volatility > 5 || searchDensity > 20) {
      newProfile = 'burst';
      logger.info('Scaling discovery compute profile to BURST', {
        component: 'DynamicScalePhysics',
        volatility: `${volatility.toFixed(2)}%`,
        searchDensity: `${searchDensity} observed/min`,
        verifiedPositiveDensity: `${verifiedPositiveDensity} positive/min`,
        capacityMultiplier: '10x',
      });
    } else if (searchDensity > 10) {
      newProfile = 'high';
      logger.info('Scaling discovery compute profile to HIGH', {
        component: 'DynamicScalePhysics',
        searchDensity: `${searchDensity} observed/min`,
        verifiedPositiveDensity: `${verifiedPositiveDensity} positive/min`,
        capacityMultiplier: '5x',
      });
    } else if (searchDensity < 3) {
      newProfile = 'low';
      logger.info('Scaling discovery compute profile to LOW', {
        component: 'DynamicScalePhysics',
        searchDensity: `${searchDensity} observed/min`,
        verifiedPositiveDensity: `${verifiedPositiveDensity} positive/min`,
        capacityMultiplier: '1x',
      });
    } else {
      newProfile = 'medium';
    }

    if (newProfile !== this.currentProfile) {
      logger.info('Compute profile changed', {
        component: 'DynamicScalePhysics',
        from: this.currentProfile,
        to: newProfile,
        basis: 'measured_search_density',
      });
      this.currentProfile = newProfile;
    }

    return newProfile;
  }

  private calculateMarketVolatility(): number {
    const nonZero = this.priceHistory.filter(price => Number.isFinite(price) && price > 0);
    if (nonZero.length < 2) return 0;
    const recent = nonZero.slice(-60);
    const oldest = recent[0];
    const newest = recent[recent.length - 1];
    return Math.abs((newest - oldest) / oldest) * 100;
  }

  /** Current measured discovery density. Kept under the legacy name for callers. */
  getOpportunityDensity(): number {
    return this.getSearchOpportunityDensity();
  }

  getSearchOpportunityDensity(): number {
    const canonical = canonicalOpportunityState.getMetrics(60_000);
    if (canonical.observedOpportunities > 0) return canonical.observedOpportunities;
    if (this.opportunityHistory.length === 0) return 0;
    return this.opportunityHistory.reduce((sum, count) => sum + count, 0) / this.opportunityHistory.length;
  }

  getVerifiedPositiveDensity(): number {
    return canonicalOpportunityState.getMetrics(60_000).verifiedPositiveOpportunities;
  }

  routeToOptimalRegion(chain: Chain): RegionConfig {
    const suffix = chain.toUpperCase();
    const configuredRegion = process.env[`CRYPTO_CHAIN_REGION_${suffix}`]?.trim()
      || process.env.RAILWAY_REPLICA_REGION?.trim()
      || null;
    const configuredLatency = Number(process.env[`CRYPTO_CHAIN_REGION_LATENCY_MS_${suffix}`]);
    const latency = Number.isFinite(configuredLatency) && configuredLatency >= 0 ? configuredLatency : null;
    const config: RegionConfig = {
      chain,
      region: configuredRegion,
      latency,
      reason: configuredRegion
        ? latency === null
          ? 'Region is deployment/configuration evidence; latency has not been measured'
          : 'Region and latency were supplied by deployment/runtime measurement configuration'
        : 'No measured/configured region evidence is available',
    };
    logger.debug('Region evidence resolved', {
      component: 'DynamicScalePhysics',
      chain,
      region: config.region,
      latencyMs: config.latency,
      reason: config.reason,
    });
    return config;
  }

  optimizeCosts(): void {
    const realizedProfitPerHour = this.getAverageProfitPerHour();
    const expectedProfitPerHour = this.getExpectedProfitPerHour();
    const profitability = realizedProfitPerHour !== null ? realizedProfitPerHour : expectedProfitPerHour;
    const source = realizedProfitPerHour !== null
      ? 'realized_settlement'
      : expectedProfitPerHour !== null
        ? 'verified_pretrade'
        : 'unavailable';

    if (profitability === null) {
      logger.info('Profitability unknown - retaining current compute profile', {
        component: 'DynamicScalePhysics',
        profitabilityStatus: 'PROFITABILITY_UNKNOWN',
      });
      return;
    }

    // Profitability can reduce the expensive execution/analysis posture, but it
    // must not erase discovery evidence. The next adjustComputeProfile() is still
    // driven by observed search density.
    if (profitability < 50 && this.getSearchOpportunityDensity() < 3) {
      logger.info('Low measured profitability and low search density - selecting LOW compute profile', {
        component: 'DynamicScalePhysics',
        profitabilityPerHour: `$${profitability.toFixed(2)}`,
        profitabilitySource: source,
        searchDensity: this.getSearchOpportunityDensity(),
        action: 'logical_profile_low',
      });
      this.currentProfile = 'low';
    } else {
      logger.debug('Profitability/search signal does not justify further compute reduction', {
        component: 'DynamicScalePhysics',
        profitabilityPerHour: `$${profitability.toFixed(2)}`,
        profitabilitySource: source,
        searchDensity: this.getSearchOpportunityDensity(),
      });
    }
  }

  private getAverageProfitPerHour(): number | null {
    const canonical = canonicalOpportunityState.getMetrics(60 * 60 * 1000);
    if (canonical.realizedSettlementCount > 0) return canonical.realizedNetProfitUsd;
    const observedProfits = this.profitHistory.filter((profit): profit is number => profit !== null);
    if (observedProfits.length === 0) return null;
    const totalProfit = observedProfits.reduce((sum, profit) => sum + profit, 0);
    const hours = observedProfits.length / 60;
    return totalProfit / Math.max(hours, 1);
  }

  private getExpectedProfitPerHour(): number | null {
    const canonical = canonicalOpportunityState.getMetrics(60 * 60 * 1000);
    return canonical.verifiedPositiveOpportunities > 0 ? canonical.expectedNetProfitUsd : null;
  }

  getCapacityMultiplier(): number {
    switch (this.currentProfile) {
      case 'low': return 1;
      case 'medium': return 2;
      case 'high': return 5;
      case 'burst': return 10;
      default: return 2;
    }
  }

  getCostMultiplier(): number {
    switch (this.currentProfile) {
      case 'low': return 0.2;
      case 'medium': return 1.0;
      case 'high': return 2.5;
      case 'burst': return 5.0;
      default: return 1.0;
    }
  }

  recordPrice(price: number): void {
    if (!Number.isFinite(price) || price <= 0) return;
    this.priceHistory.push(price);
    if (this.priceHistory.length > this.MAX_HISTORY) this.priceHistory.shift();
  }

  recordOpportunityCount(count: number): void {
    if (!Number.isFinite(count) || count < 0) return;
    const normalized = Math.floor(count);
    // MasterPipeline historically passes a cumulative processed counter. Store
    // its non-negative delta rather than averaging cumulative totals as density.
    const delta = this.lastRecordedOpportunityTotal === null
      ? normalized
      : Math.max(0, normalized - this.lastRecordedOpportunityTotal);
    this.lastRecordedOpportunityTotal = normalized;
    this.opportunityHistory.push(delta);
    if (this.opportunityHistory.length > this.MAX_HISTORY) this.opportunityHistory.shift();
  }

  recordProfit(profit: number | null | undefined): void {
    this.profitHistory.push(typeof profit === 'number' && Number.isFinite(profit) ? profit : null);
    if (this.profitHistory.length > this.MAX_HISTORY) this.profitHistory.shift();
  }

  getMetrics(): ScaleMetrics {
    const avgProfitPerHour = this.getAverageProfitPerHour();
    const expectedProfitPerHour = this.getExpectedProfitPerHour();
    const searchOpportunityDensity = this.getSearchOpportunityDensity();
    const verifiedPositiveDensity = this.getVerifiedPositiveDensity();
    return {
      currentProfile: this.currentProfile,
      marketVolatility: this.calculateMarketVolatility(),
      opportunityDensity: searchOpportunityDensity,
      searchOpportunityDensity,
      verifiedPositiveDensity,
      avgProfitPerHour,
      expectedProfitPerHour,
      profitabilityStatus: avgProfitPerHour !== null || expectedProfitPerHour !== null
        ? ((avgProfitPerHour ?? expectedProfitPerHour) === 0 ? 'PROFITABILITY_KNOWN_ZERO' : 'PROFITABILITY_KNOWN')
        : 'PROFITABILITY_UNKNOWN',
      profitabilitySource: avgProfitPerHour !== null
        ? 'realized_settlement'
        : expectedProfitPerHour !== null
          ? 'verified_pretrade'
          : 'unavailable',
      capacityMultiplier: this.getCapacityMultiplier(),
      costMultiplier: this.getCostMultiplier(),
    };
  }

  getCurrentProfile(): ComputeProfile {
    return this.currentProfile;
  }

  setProfile(profile: ComputeProfile): void {
    if (this.currentProfile !== profile) {
      logger.info('Manual logical profile change', {
        component: 'DynamicScalePhysics',
        from: this.currentProfile,
        to: profile,
      });
      this.currentProfile = profile;
    }
  }

  private getProfitabilityStatus(): ProfitabilityStatus {
    const average = this.getAverageProfitPerHour();
    const expected = this.getExpectedProfitPerHour();
    if (average === null && expected === null) return 'PROFITABILITY_UNKNOWN';
    return (average ?? expected) === 0 ? 'PROFITABILITY_KNOWN_ZERO' : 'PROFITABILITY_KNOWN';
  }
}

export {
  DynamicScalePhysics,
  type ComputeProfile,
  type Chain,
  type Region,
  type ScaleMetrics,
  type ProfitabilityStatus,
  type RegionConfig,
};
