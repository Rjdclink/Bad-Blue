import logger from '../../../logger.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';

type ComputeProfile = 'low' | 'medium' | 'high' | 'burst';
type Chain = 'ethereum' | 'polygon' | 'bsc' | 'arbitrum' | 'optimism';
type Region = 'us-east-1' | 'ap-south-1' | 'ap-southeast-1' | 'eu-west-1';

interface ScaleMetrics {
  currentProfile: ComputeProfile;
  marketVolatility: number;
  opportunityDensity: number;
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
  region: Region;
  latency: number;
  reason: string;
}

class DynamicScalePhysics {
  private currentProfile: ComputeProfile = 'medium';
  private priceHistory: number[] = [];
  private opportunityHistory: number[] = [];
  private profitHistory: Array<number | null> = [];
  private readonly MAX_HISTORY = 60; // Track last 60 minutes

  constructor() {
    this.priceHistory = Array(60).fill(0);
    this.opportunityHistory = Array(60).fill(0);
    this.profitHistory = Array(60).fill(null);
  }

  adjustComputeProfile(): ComputeProfile {
    const volatility = this.calculateMarketVolatility();
    const density = this.getOpportunityDensity();

    let newProfile: ComputeProfile;

    if (volatility > 5 || density > 20) {
      newProfile = 'burst';
      logger.info('Scaling to BURST profile', {
        component: 'DynamicScalePhysics',
        volatility: `${volatility.toFixed(2)}%`,
        density: `${density} opps/min`,
        capacityMultiplier: '10x'
      });
    } else if (density > 10) {
      newProfile = 'high';
      logger.info('Scaling to HIGH profile', {
        component: 'DynamicScalePhysics',
        density: `${density} opps/min`,
        capacityMultiplier: '5x'
      });
    } else if (density < 3) {
      newProfile = 'low';
      logger.info('Scaling to LOW profile', {
        component: 'DynamicScalePhysics',
        density: `${density} opps/min`,
        capacityMultiplier: '1x',
        costSaving: '80%'
      });
    } else {
      newProfile = 'medium';
    }

    if (newProfile !== this.currentProfile) {
      logger.info('Compute profile changed', {
        component: 'DynamicScalePhysics',
        from: this.currentProfile,
        to: newProfile
      });
      this.currentProfile = newProfile;
    }

    return newProfile;
  }

  private calculateMarketVolatility(): number {
    if (this.priceHistory.length < 2) return 0;
    const recent = this.priceHistory.slice(-60);
    const oldest = recent[0] || 1;
    const newest = recent[recent.length - 1] || 1;
    return Math.abs((newest - oldest) / oldest) * 100;
  }

  getOpportunityDensity(): number {
    const canonical = canonicalOpportunityState.getMetrics(60_000);
    const canonicalDensity = canonical.verifiedPositiveOpportunities;
    if (this.opportunityHistory.length === 0) return canonicalDensity;
    const totalOpps = this.opportunityHistory.reduce((sum, count) => sum + count, 0);
    const historicalDensity = totalOpps / this.opportunityHistory.length;
    // The canonical stream is authoritative for current verified opportunities. Retain
    // the historical path only as a compatibility fallback for callers not yet migrated.
    return Math.max(canonicalDensity, historicalDensity);
  }

  routeToOptimalRegion(chain: Chain): RegionConfig {
    const regionMap: Record<Chain, RegionConfig> = {
      ethereum: { chain: 'ethereum', region: 'us-east-1', latency: 12, reason: 'Most validators are on East Coast US' },
      polygon: { chain: 'polygon', region: 'ap-south-1', latency: 15, reason: 'Polygon network concentrated in Mumbai' },
      bsc: { chain: 'bsc', region: 'ap-southeast-1', latency: 10, reason: 'Binance infrastructure in Singapore' },
      arbitrum: { chain: 'arbitrum', region: 'us-east-1', latency: 12, reason: 'L2 sequencer on East Coast US' },
      optimism: { chain: 'optimism', region: 'us-east-1', latency: 12, reason: 'L2 sequencer on East Coast US' }
    };
    const config = regionMap[chain];
    logger.debug('Optimal region selected', {
      component: 'DynamicScalePhysics',
      chain,
      region: config.region,
      latency: `${config.latency}ms`,
      reason: config.reason
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

    if (profitability < 50) {
      logger.warn('Low profitability signal detected - scaling down', {
        component: 'DynamicScalePhysics',
        profitabilityPerHour: `$${profitability.toFixed(2)}`,
        profitabilitySource: source,
        action: 'Scale to 20% capacity'
      });
      this.currentProfile = 'low';
      this.pauseNonCriticalServices();
    } else {
      logger.debug('Profitability signal acceptable', {
        component: 'DynamicScalePhysics',
        profitabilityPerHour: `$${profitability.toFixed(2)}`,
        profitabilitySource: source,
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

  private pauseNonCriticalServices(): void {
    logger.info('Pausing non-critical services', {
      component: 'DynamicScalePhysics',
      services: ['historical-analysis', 'extended-monitoring', 'deep-scanning']
    });
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
    this.priceHistory.push(price);
    if (this.priceHistory.length > this.MAX_HISTORY) this.priceHistory.shift();
  }

  recordOpportunityCount(count: number): void {
    this.opportunityHistory.push(count);
    if (this.opportunityHistory.length > this.MAX_HISTORY) this.opportunityHistory.shift();
  }

  recordProfit(profit: number | null | undefined): void {
    this.profitHistory.push(typeof profit === 'number' && Number.isFinite(profit) ? profit : null);
    if (this.profitHistory.length > this.MAX_HISTORY) this.profitHistory.shift();
  }

  getMetrics(): ScaleMetrics {
    const avgProfitPerHour = this.getAverageProfitPerHour();
    const expectedProfitPerHour = this.getExpectedProfitPerHour();
    return {
      currentProfile: this.currentProfile,
      marketVolatility: this.calculateMarketVolatility(),
      opportunityDensity: this.getOpportunityDensity(),
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
      costMultiplier: this.getCostMultiplier()
    };
  }

  getCurrentProfile(): ComputeProfile {
    return this.currentProfile;
  }

  setProfile(profile: ComputeProfile): void {
    if (this.currentProfile !== profile) {
      logger.info('Manual profile change', {
        component: 'DynamicScalePhysics',
        from: this.currentProfile,
        to: profile
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
  type RegionConfig
};
