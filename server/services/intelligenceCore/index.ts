/**
 * PANTHEON Intelligence Core
 * Phase 4A - Part 2: Knowledge Graph Core + Algorithms
 * 
 * Self-restructuring knowledge graph with graph algorithms
 */

import { KnowledgeGraphCore } from './knowledgeGraph';
import { createLogger } from '../../logger';

const logger = createLogger('IntelligenceCore');

// Singleton instances
export const knowledgeGraph = new KnowledgeGraphCore();

// Re-export types and utilities
export * from './types';
export { KnowledgeGraphCore } from './knowledgeGraph';
export { GraphAlgorithms } from './utils/graphAlgorithms';
export { ProvenanceManager } from './utils/provenanceManager';

/**
 * Service health check
 */
export async function healthCheck(): Promise<{
  knowledgeGraph: boolean;
  overall: boolean;
}> {
  try {
    const kgHealth = await knowledgeGraph.healthCheck();

    return {
      knowledgeGraph: kgHealth,
      overall: kgHealth,
    };
  } catch (error) {
    logger.error('Health check failed:', error);
    return {
      knowledgeGraph: false,
      overall: false,
    };
  }
}

/**
 * Initialize the Intelligence Core
 */
export async function initialize(): Promise<void> {
  try {
    logger.info('Initializing PANTHEON Intelligence Core - Part 2');

    await knowledgeGraph.initialize();

    logger.info('✓ Intelligence Core: Knowledge Graph ready');
    logger.info('  Waiting for Part 3: Preprocessing Engine');
  } catch (error) {
    logger.error('Failed to initialize Intelligence Core:', error);
    throw error;
  }
}
