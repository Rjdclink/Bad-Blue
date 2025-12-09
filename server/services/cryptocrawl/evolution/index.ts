/**
 * Evolution Module - Complete Hyper-Evolution System
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

export {
  FrontierResearchEngine,
  frontierResearch,
  DARPA_METHODOLOGIES,
  NASA_METHODOLOGIES,
  IARPA_METHODOLOGIES,
  QUANTUM_METHODOLOGIES,
  HFT_METHODOLOGIES,
  type DARPAMethodology,
  type NASAMethodology,
  type IARPAMethodology,
  type QuantumMethodology,
  type HFTMethodology,
  type ResearchSynthesis,
  type FrontierCapability
} from './frontier-research-integration';
