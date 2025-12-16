/**
 * Phase 3: Phantom Configuration
 * 
 * Single source of truth for Phantom Ninja extraction configuration
 * Defines tier order, providers, timeouts, retries, and constraints
 */

/**
 * Allowed Tier 2 providers (in priority order)
 */
export enum Tier2Provider {
  ZENROWS = 'ZENROWS',
  BROWSERLESS = 'BROWSERLESS',
  SCRAPINGBEE = 'SCRAPINGBEE',
  BRIGHTDATA = 'BRIGHTDATA',
}

/**
 * Phantom Configuration
 */
export interface PhantomConfig {
  /** Tier execution order */
  tierOrder: [0, 1, 2];
  
  /** Allowed Tier 2 providers (in priority order) */
  tier2Providers: Tier2Provider[];
  
  /** Timeouts per tier (ms) */
  timeouts: {
    tier0: number;
    tier1: number;
    tier2: number;
  };
  
  /** Max retries per tier */
  maxRetries: {
    tier0: number;
    tier1: number;
    tier2: number;
  };
  
  /** Hard constraint: no local browser binaries allowed */
  noLocalBrowsers: boolean;
  
  /** Enable debug logging */
  debugLogging: boolean;
}

/**
 * Default Phantom configuration
 */
export const DEFAULT_PHANTOM_CONFIG: PhantomConfig = {
  tierOrder: [0, 1, 2],
  tier2Providers: [
    Tier2Provider.ZENROWS,
    Tier2Provider.BROWSERLESS,
    Tier2Provider.SCRAPINGBEE,
    Tier2Provider.BRIGHTDATA,
  ],
  timeouts: {
    tier0: 15000,  // 15s for HTTP
    tier1: 10000,  // 10s for API discovery
    tier2: 30000,  // 30s for remote render
  },
  maxRetries: {
    tier0: 2,
    tier1: 1,
    tier2: 1,
  },
  noLocalBrowsers: true,
  debugLogging: false,
};

/**
 * Get Phantom configuration from environment
 */
export function getPhantomConfig(): PhantomConfig {
  return {
    ...DEFAULT_PHANTOM_CONFIG,
    debugLogging: process.env.PHANTOM_DEBUG === 'true',
  };
}
