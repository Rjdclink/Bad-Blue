// LEGACY COMPATIBILITY SHELL
//
// Historical Starburst replication created in-memory agents and reported
// placeholder executor/monitor success. That behavior is retired. This module
// preserves type/import compatibility only and cannot authorize or represent
// CryptoCrawler execution, profit, settlement, discovery, or learning.

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { Opportunity, ChainId } from '../core/lux-swarm';

export interface StarburstTrigger {
  type: 'high-value' | 'cascade' | 'emergency' | 'opportunity-surge';
  threshold: number;
  replicationFactor: number;
  priority: number;
}

export interface ReplicaAgent {
  id: string;
  parentId: string;
  generation: number;
  role: 'scanner' | 'executor' | 'validator' | 'monitor';
  target: Opportunity;
  status: 'active' | 'completed' | 'failed' | 'dormant';
  spawnTime: number;
  lifetime: number;
  executionCount: number;
}

export interface StarburstEvent {
  id: string;
  triggerType: StarburstTrigger['type'];
  sourceAgent: string;
  replicasCreated: number;
  timestamp: number;
  value: number;
  chain: ChainId;
  success: boolean;
}

export class StarburstEngine {
  static startMonitoring(): void {
    logger.info('Legacy Starburst replication is quarantined', {
      component: 'StarburstEngine',
      authority: 'compatibility_only',
    });
  }

  static stopMonitoring(): void {}

  static triggerStarburst(
    type: StarburstTrigger['type'],
    opportunity: Opportunity,
    value: number,
  ): StarburstEvent {
    logger.warn('Legacy Starburst trigger ignored', {
      component: 'StarburstEngine',
      type,
      authority: 'none',
    });
    return {
      id: `legacy-starburst-${Date.now()}-${randomUUID().split('-')[0]}`,
      triggerType: type,
      sourceAgent: 'legacy-compatibility-shell',
      replicasCreated: 0,
      timestamp: Date.now(),
      value,
      chain: opportunity.chain,
      success: false,
    };
  }

  static async executeReplica(_replicaId: string): Promise<boolean> {
    return false;
  }

  static getActiveReplicas(): ReplicaAgent[] {
    return [];
  }

  static getReplicasByRole(_role: ReplicaAgent['role']): ReplicaAgent[] {
    return [];
  }

  static getEvents(_limit: number = 100): StarburstEvent[] {
    return [];
  }

  static getStatistics(): {
    totalReplicas: number;
    activeReplicas: number;
    totalEvents: number;
    successfulEvents: number;
    replicasByRole: Record<ReplicaAgent['role'], number>;
  } {
    return {
      totalReplicas: 0,
      activeReplicas: 0,
      totalEvents: 0,
      successfulEvents: 0,
      replicasByRole: { scanner: 0, executor: 0, validator: 0, monitor: 0 },
    };
  }

  static manualStarburst(opportunity: Opportunity, _replicationFactor?: number): StarburstEvent {
    return this.triggerStarburst('emergency', opportunity, opportunity.profitEstimate);
  }

  static setMaxReplicas(_max: number): void {}

  static reset(): void {}
}

export class EnhancedSnakeAgent {
  id: string;

  constructor(
    _opp: Opportunity,
    _canShed = true,
    _starburstEnabled = true,
  ) {
    this.id = `legacy-snake-${Date.now()}-${randomUUID().split('-')[0]}`;
  }

  async crawl(): Promise<void> {
    logger.debug('Legacy enhanced snake crawl ignored', {
      component: 'EnhancedSnakeAgent',
      authority: 'none',
    });
  }
}
