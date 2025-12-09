/**
 * Evolution Module - Complete Hyper-Evolution System
 * 
 * Exports all evolution and swarm intelligence components for
 * radical strategy discovery and continuous learning.
 */

export {
  HyperEvolutionEngine,
  getHyperEvolutionEngine,
  hyperEvolution,
  type GeneticConfig,
  type StrategyGenome,
  type EvolutionState,
  type SuccessPattern,
  type FailurePattern
} from './hyper-evolution-engine';

export {
  SwarmIntelligenceEngine,
  getSwarmIntelligenceEngine,
  swarmIntelligence,
  type Particle,
  type SwarmConfig,
  type AntColonyConfig,
  type BeeColonyConfig,
  type FoodSource,
  type PheromoneTrail
} from './swarm-intelligence';
