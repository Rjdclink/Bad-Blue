import logger from '../../../logger.js';

type ComputeProfile = 'low' | 'medium' | 'high' | 'burst';
type Chain = 'ethereum' | 'polygon' | 'bsc' | 'arbitrum' | 'optimism';
type Region = 'us-east-1' | 'ap-south-1' | 'ap-southeast-1' | 'eu-west-1';

interface ScaleMetrics {
  currentProfile: ComputeProfile;
  marketVolatility: number;
  opportunityDensity: number;
  avgProfitPerHour: number | null;
  profitabilityStatus: ProfitabilityStatus;
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
    // Initialize with some baseline data
    this.priceHistory = Array(60).fill(0);
    this.opportunityHistory = Array(60).fill(0);
    this.profitHistory = Array(60).fill(null);
  }

  adjustComputeProfile(): ComputeProfile {
    const volatility = this.calculateMarketVolatility();
    const density = this.getOpportunityDensity();

    let newProfile: ComputeProfile;

    // BURST: 10x capacity for extreme conditions
    if (volatility > 5 || density > 20) {
      newProfile = 'burst';
      logger.info('Scaling to BURST profile', {
        component: 'DynamicScalePhysics',
        volatility: `${volatility.toFixed(2)}%`,
        density: `${density} opps/min`,
        capacityMultiplier: '10x'
      });
    }
    // HIGH: 5x capacity for high activity
    else if (density > 10) {
      newProfile = 'high';
      logger.info('Scaling to HIGH profile', {
        component: 'DynamicScalePhysics',
        density: `${density} opps/min`,
        capacityMultiplier: '5x'
      });
    }
    // LOW: 1x capacity for low activity (save 80% cost)
    else if (density < 3) {
      newProfile = 'low';
      logger.info('Scaling to LOW profile', {
        component: 'DynamicScalePhysics',
        density: `${density} opps/min`,
        capacityMultiplier: '1x',
        costSaving: '80%'
      });
    }
    // MEDIUM: Default 2x capacity
    else {
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

    // Calculate percentage price change over last hour
    const recent = this.priceHistory.slice(-60);
    const oldest = recent[0] || 1;
    const newest = recent[recent.length - 1] || 1;
    
    const change = Math.abs((newest - oldest) / oldest) * 100;
    
    return change;
  }

  getOpportunityDensity(): number {
    // Opportunities per minute (last 60 minutes)
    if (this.opportunityHistory.length === 0) return 0;
    
    const totalOpps = this.opportunityHistory.reduce((sum, count) => sum + count, 0);
    const minutes = this.opportunityHistory.length;
    
    return totalOpps / minutes;
  }

  routeToOptimalRegion(chain: Chain): RegionConfig {
    const regionMap: Record<Chain, RegionConfig> = {
      ethereum: {
        chain: 'ethereum',
        region: 'us-east-1',
        latency: 12,
        reason: 'Most validators are on East Coast US'
      },
      polygon: {
        chain: 'polygon',
        region: 'ap-south-1',
        latency: 15,
        reason: 'Polygon network concentrated in Mumbai'
      },
      bsc: {
        chain: 'bsc',
        region: 'ap-southeast-1',
        latency: 10,
        reason: 'Binance infrastructure in Singapore'
      },
      arbitrum: {
        chain: 'arbitrum',
        region: 'us-east-1',
        latency: 12,
        reason: 'L2 sequencer on East Coast US'
      },
      optimism: {
        chain: 'optimism',
        region: 'us-east-1',
        latency: 12,
        reason: 'L2 sequencer on East Coast US'
      }
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
    const avgProfitPerHour = this.getAverageProfitPerHour();

    if (avgProfitPerHour === null) {
      logger.info('Profitability unknown - retaining current compute profile', {
        component: 'DynamicScalePhysics',
        profitabilityStatus: 'PROFITABILITY_UNKNOWN',
      });
      return;
    }

    if (avgProfitPerHour < 50) {
      // Scale down to 20% capacity
      logger.warn('Low profitability detected - scaling down', {
        component: 'DynamicScalePhysics',
        avgProfitPerHour: `$${avgProfitPerHour.toFixed(2)}`,
        action: 'Scale to 20% capacity'
      });

      this.currentProfile = 'low';
      
      // Pause non-critical services
      this.pauseNonCriticalServices();
    } else {
      logger.debug('Profitability acceptable', {
        component: 'DynamicScalePhysics',
        avgProfitPerHour: `$${avgProfitPerHour.toFixed(2)}`
      });
    }
  }

  private getAverageProfitPerHour(): number | null {
    const observedProfits = this.profitHistory.filter((profit): profit is number => profit !== null);
    if (observedProfits.length === 0) return null;

    const totalProfit = observedProfits.reduce((sum, profit) => sum + profit, 0);
    const hours = observedProfits.length / 60; // Convert observed minutes to hours
    
    return totalProfit / Math.max(hours, 1);
  }

  private pauseNonCriticalServices(): void {
    logger.info('Pausing non-critical services', {
      component: 'DynamicScalePhysics',
      services: ['historical-analysis', 'extended-monitoring', 'deep-scanning']
    });
    // Implementation would pause background tasks
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
      case 'low': return 0.2; // 80% cost savings
      case 'medium': return 1.0;
      case 'high': return 2.5;
      case 'burst': return 5.0;
      default: return 1.0;
    }
  }

  recordPrice(price: number): void {
    this.priceHistory.push(price);
    if (this.priceHistory.length > this.MAX_HISTORY) {
      this.priceHistory.shift();
    }
  }

  recordOpportunityCount(count: number): void {
    this.opportunityHistory.push(count);
    if (this.opportunityHistory.length > this.MAX_HISTORY) {
      this.opportunityHistory.shift();
    }
  }

  recordProfit(profit: number | null | undefined): void {
    this.profitHistory.push(typeof profit === 'number' && Number.isFinite(profit) ? profit : null);
    if (this.profitHistory.length > this.MAX_HISTORY) {
      this.profitHistory.shift();
    }
  }

  getMetrics(): ScaleMetrics {
    return {
      currentProfile: this.currentProfile,
      marketVolatility: this.calculateMarketVolatility(),
      opportunityDensity: this.getOpportunityDensity(),
      avgProfitPerHour: this.getAverageProfitPerHour(),
      profitabilityStatus: this.getProfitabilityStatus(),
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
    if (average === null) return 'PROFITABILITY_UNKNOWN';
    return average === 0 ? 'PROFITABILITY_KNOWN_ZERO' : 'PROFITABILITY_KNOWN';
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
