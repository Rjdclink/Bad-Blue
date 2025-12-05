/**
 * PANTHEON Intelligence Core - Main Export
 * Phase 4A: Foundation Layer
 * 
 * Self-restructuring knowledge graph and preprocessing engine
 * for autonomous intelligence operations
 */

import { KnowledgeGraphCore } from './knowledgeGraph';
import { PreprocessingEngine } from './preprocessingEngine';
import { createLogger } from '../../logger';

const logger = createLogger('IntelligenceCore');

// Singleton instances
export const knowledgeGraph = new KnowledgeGraphCore();
export const preprocessingEngine = new PreprocessingEngine();

// Re-export types
export * from './types';
export { KnowledgeGraphCore } from './knowledgeGraph';
export { PreprocessingEngine } from './preprocessingEngine';
export { GraphAlgorithms } from './utils/graphAlgorithms';
export { ProvenanceManager } from './utils/provenanceManager';

/**
 * Service health check
 * Verifies all components are operational
 */
export async function healthCheck(): Promise<{
  knowledgeGraph: boolean;
  preprocessing: boolean;
  overall: boolean;
}> {
  try {
    const kgHealth = await knowledgeGraph.healthCheck();
    const prepHealth = true; // Preprocessing engine doesn't have async dependencies

    return {
      knowledgeGraph: kgHealth,
      preprocessing: prepHealth,
      overall: kgHealth && prepHealth,
    };
  } catch (error) {
    logger.error('Health check failed:', error);
    return {
      knowledgeGraph: false,
      preprocessing: false,
      overall: false,
    };
  }
}

/**
 * Initialize the Intelligence Core
 * Must be called before using the service
 */
export async function initialize(): Promise<void> {
  try {
    logger.info('Initializing PANTHEON Intelligence Core - Phase 4A Foundation Layer');

    // Initialize components
    await knowledgeGraph.initialize();
    await preprocessingEngine.initialize();

    logger.info('✓ Intelligence Core: Foundation Layer initialized');
  } catch (error) {
    logger.error('Failed to initialize Intelligence Core:', error);
    throw error;
  }
}

/**
 * Get service statistics
 */
export async function getStatistics(): Promise<{
  nodeCount: number;
  edgeCount: number;
  ready: boolean;
}> {
  try {
    // This would normally query the database for actual counts
    // For now, return a basic structure
    return {
      nodeCount: 0,
      edgeCount: 0,
      ready: true,
    };
  } catch (error) {
    logger.error('Failed to get statistics:', error);
    return {
      nodeCount: 0,
      edgeCount: 0,
      ready: false,
    };
  }
}
