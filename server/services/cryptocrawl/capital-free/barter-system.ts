// Bot-to-Bot Financial Barter System
// Implements automated resource exchange between smart contracts
// Trading: gas for routing rights, liquidity for positioning, data for priority

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { ChainId } from '../core/lux-swarm';

export type BarterResourceType = 
  | 'gas'
  | 'routing_rights'
  | 'mempool_position'
  | 'liquidity'
  | 'profit_share'
  | 'data_feed'
  | 'execution_priority'
  | 'node_access';

export interface BarterResource {
  type: BarterResourceType;
  amount: number;
  chain: ChainId;
  expiresAt: number;
  owner: string; // Contract address
}

export interface BarterOffer {
  id: string;
  offeredResource: BarterResource;
  requestedResource: BarterResource;
  status: 'open' | 'matched' | 'executed' | 'expired' | 'cancelled';
  offererContract: string;
  createdAt: number;
  expiresAt: number;
  matchedWith?: string; // Matched offer ID
}

export interface BarterExecution {
  id: string;
  offer1Id: string;
  offer2Id: string;
  resourcesExchanged: [BarterResource, BarterResource];
  executedAt: number;
  success: boolean;
  profitGenerated: number;
}

export interface BarterResult {
  success: boolean;
  executionId: string;
  resourceReceived: BarterResource | null;
  resourceGiven: BarterResource | null;
  message: string;
}

// Resource value ratios for fair exchange calculations
const RESOURCE_VALUE_RATIOS: Record<BarterResourceType, number> = {
  gas: 1.0,
  routing_rights: 2.5,
  mempool_position: 3.0,
  liquidity: 1.5,
  profit_share: 2.0,
  data_feed: 1.8,
  execution_priority: 2.2,
  node_access: 4.0,
};

/**
 * Bot-to-Bot Financial Barter System
 * Automated voluntary exchange between smart contracts
 */
export class BarterSystem {
  private openOffers: Map<string, BarterOffer> = new Map();
  private executions: Map<string, BarterExecution> = new Map();
  private totalBarters: number = 0;
  private successfulBarters: number = 0;
  private totalValueExchanged: number = 0;

  constructor() {
    // Start cleanup interval for expired offers
    this.startCleanupInterval();
    
    logger.info('[Barter] Bot-to-Bot Financial Barter System initialized', {
      component: 'BarterSystem',
    });
  }

  /**
   * Create a barter offer - offering one resource for another
   */
  async createOffer(
    offered: Omit<BarterResource, 'expiresAt'>,
    requested: Omit<BarterResource, 'expiresAt'>,
    offererContract: string,
    validityPeriod: number = 60000 // 1 minute default
  ): Promise<BarterOffer> {
    const expiresAt = Date.now() + validityPeriod;

    const offer: BarterOffer = {
      id: randomUUID(),
      offeredResource: { ...offered, expiresAt },
      requestedResource: { ...requested, expiresAt },
      status: 'open',
      offererContract,
      createdAt: Date.now(),
      expiresAt,
    };

    this.openOffers.set(offer.id, offer);

    logger.debug('[Barter] Offer created', {
      component: 'BarterSystem',
      offerId: offer.id,
      offered: offered.type,
      requested: requested.type,
    });

    // Try to find a matching offer immediately
    await this.findAndExecuteMatch(offer);

    return offer;
  }

  /**
   * Find matching offers and execute barter
   */
  private async findAndExecuteMatch(offer: BarterOffer): Promise<boolean> {
    // Find offers that want what we're offering and offer what we want
    const matches = Array.from(this.openOffers.values()).filter(o => 
      o.id !== offer.id &&
      o.status === 'open' &&
      o.offeredResource.type === offer.requestedResource.type &&
      o.requestedResource.type === offer.offeredResource.type &&
      o.offeredResource.chain === offer.requestedResource.chain &&
      o.expiresAt > Date.now()
    );

    if (matches.length === 0) {
      return false;
    }

    // Find best match based on value ratio
    const bestMatch = this.findBestMatch(offer, matches);
    if (!bestMatch) {
      return false;
    }

    // Execute the barter
    return await this.executeBarter(offer, bestMatch);
  }

  /**
   * Find the best matching offer based on value fairness
   */
  private findBestMatch(offer: BarterOffer, candidates: BarterOffer[]): BarterOffer | null {
    const ourOfferedValue = offer.offeredResource.amount * RESOURCE_VALUE_RATIOS[offer.offeredResource.type];
    const ourRequestedValue = offer.requestedResource.amount * RESOURCE_VALUE_RATIOS[offer.requestedResource.type];
    const ourRatio = ourOfferedValue / ourRequestedValue;

    let bestMatch: BarterOffer | null = null;
    let bestFairness = 0;

    for (const candidate of candidates) {
      const theirOfferedValue = candidate.offeredResource.amount * RESOURCE_VALUE_RATIOS[candidate.offeredResource.type];
      const theirRequestedValue = candidate.requestedResource.amount * RESOURCE_VALUE_RATIOS[candidate.requestedResource.type];
      const theirRatio = theirOfferedValue / theirRequestedValue;

      // Calculate fairness (1.0 = perfectly fair, lower = more favorable to us)
      const fairness = Math.min(ourRatio, theirRatio) / Math.max(ourRatio, theirRatio);

      // Accept if fairness is at least 0.7 (30% deviation acceptable)
      if (fairness >= 0.7 && fairness > bestFairness) {
        bestFairness = fairness;
        bestMatch = candidate;
      }
    }

    return bestMatch;
  }

  /**
   * Execute a barter between two offers
   */
  private async executeBarter(offer1: BarterOffer, offer2: BarterOffer): Promise<boolean> {
    try {
      // Mark both offers as matched
      offer1.status = 'matched';
      offer1.matchedWith = offer2.id;
      offer2.status = 'matched';
      offer2.matchedWith = offer1.id;

      // Create execution record
      const execution: BarterExecution = {
        id: randomUUID(),
        offer1Id: offer1.id,
        offer2Id: offer2.id,
        resourcesExchanged: [offer1.offeredResource, offer2.offeredResource],
        executedAt: Date.now(),
        success: false,
        profitGenerated: 0,
      };

      // Simulate the exchange (in production, this would be atomic on-chain)
      const exchangeValue = 
        offer1.offeredResource.amount * RESOURCE_VALUE_RATIOS[offer1.offeredResource.type] +
        offer2.offeredResource.amount * RESOURCE_VALUE_RATIOS[offer2.offeredResource.type];

      // Mark as executed
      offer1.status = 'executed';
      offer2.status = 'executed';
      execution.success = true;
      execution.profitGenerated = exchangeValue * 0.01; // 1% efficiency gain

      this.executions.set(execution.id, execution);
      this.totalBarters++;
      this.successfulBarters++;
      this.totalValueExchanged += exchangeValue;

      // Remove from open offers
      this.openOffers.delete(offer1.id);
      this.openOffers.delete(offer2.id);

      logger.info('[Barter] Barter executed successfully', {
        component: 'BarterSystem',
        executionId: execution.id,
        resources: `${offer1.offeredResource.type} <-> ${offer2.offeredResource.type}`,
        valueExchanged: exchangeValue,
      });

      return true;
    } catch (error) {
      offer1.status = 'open';
      offer2.status = 'open';
      
      logger.error('[Barter] Barter execution failed', {
        component: 'BarterSystem',
        offer1Id: offer1.id,
        offer2Id: offer2.id,
        error: error instanceof Error ? error.message : String(error),
      });

      return false;
    }
  }

  /**
   * Create common barter: Gas for routing rights
   */
  async barterGasForRouting(
    chain: ChainId,
    gasAmount: number,
    routingDuration: number,
    contract: string
  ): Promise<BarterResult> {
    const offer = await this.createOffer(
      { type: 'gas', amount: gasAmount, chain, owner: contract },
      { type: 'routing_rights', amount: routingDuration, chain, owner: '' },
      contract
    );

    if (offer.status === 'executed') {
      return {
        success: true,
        executionId: offer.matchedWith || offer.id,
        resourceReceived: offer.requestedResource,
        resourceGiven: offer.offeredResource,
        message: 'Gas successfully bartered for routing rights',
      };
    }

    return {
      success: false,
      executionId: offer.id,
      resourceReceived: null,
      resourceGiven: null,
      message: 'Offer created, waiting for match',
    };
  }

  /**
   * Create common barter: Liquidity for mempool positioning
   */
  async barterLiquidityForPosition(
    chain: ChainId,
    liquidityAmount: number,
    positionPriority: number,
    contract: string
  ): Promise<BarterResult> {
    const offer = await this.createOffer(
      { type: 'liquidity', amount: liquidityAmount, chain, owner: contract },
      { type: 'mempool_position', amount: positionPriority, chain, owner: '' },
      contract
    );

    if (offer.status === 'executed') {
      return {
        success: true,
        executionId: offer.matchedWith || offer.id,
        resourceReceived: offer.requestedResource,
        resourceGiven: offer.offeredResource,
        message: 'Liquidity successfully bartered for mempool position',
      };
    }

    return {
      success: false,
      executionId: offer.id,
      resourceReceived: null,
      resourceGiven: null,
      message: 'Offer created, waiting for match',
    };
  }

  /**
   * Create common barter: Data feed for execution priority
   */
  async barterDataForPriority(
    chain: ChainId,
    dataFeedValue: number,
    priorityLevel: number,
    contract: string
  ): Promise<BarterResult> {
    const offer = await this.createOffer(
      { type: 'data_feed', amount: dataFeedValue, chain, owner: contract },
      { type: 'execution_priority', amount: priorityLevel, chain, owner: '' },
      contract
    );

    if (offer.status === 'executed') {
      return {
        success: true,
        executionId: offer.matchedWith || offer.id,
        resourceReceived: offer.requestedResource,
        resourceGiven: offer.offeredResource,
        message: 'Data feed successfully bartered for execution priority',
      };
    }

    return {
      success: false,
      executionId: offer.id,
      resourceReceived: null,
      resourceGiven: null,
      message: 'Offer created, waiting for match',
    };
  }

  /**
   * Get all open offers for a chain
   */
  getOpenOffers(chain: ChainId): BarterOffer[] {
    return Array.from(this.openOffers.values()).filter(
      o => o.status === 'open' && o.offeredResource.chain === chain
    );
  }

  /**
   * Cancel an offer
   */
  cancelOffer(offerId: string): boolean {
    const offer = this.openOffers.get(offerId);
    if (!offer || offer.status !== 'open') {
      return false;
    }

    offer.status = 'cancelled';
    this.openOffers.delete(offerId);
    return true;
  }

  /**
   * Start cleanup interval for expired offers
   */
  private startCleanupInterval(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [id, offer] of this.openOffers) {
        if (offer.expiresAt < now && offer.status === 'open') {
          offer.status = 'expired';
          this.openOffers.delete(id);
        }
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Get barter statistics
   */
  getStatistics(): {
    openOffers: number;
    totalBarters: number;
    successfulBarters: number;
    successRate: number;
    totalValueExchanged: number;
    recentExecutions: number;
  } {
    const recentCutoff = Date.now() - 3600000; // Last hour
    const recentExecutions = Array.from(this.executions.values())
      .filter(e => e.executedAt > recentCutoff).length;

    return {
      openOffers: this.openOffers.size,
      totalBarters: this.totalBarters,
      successfulBarters: this.successfulBarters,
      successRate: this.totalBarters > 0 ? this.successfulBarters / this.totalBarters : 0,
      totalValueExchanged: this.totalValueExchanged,
      recentExecutions,
    };
  }

  /**
   * Reset system (for testing)
   */
  reset(): void {
    this.openOffers.clear();
    this.executions.clear();
    this.totalBarters = 0;
    this.successfulBarters = 0;
    this.totalValueExchanged = 0;
  }
}

export const barterSystem = new BarterSystem();
