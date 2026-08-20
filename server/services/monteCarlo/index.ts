/**
 * PANTHEON Monte Carlo Simulation Module
 * 
 * Provides mathematically defensible satellite tracking with:
 * - Particle filter for probabilistic location estimation
 * - Constraint-based updates from satellite imagery
 * - Bounded execution cycles tied to Doomsday Clock
 * - Heatmaps, probable paths, and likelihood cones
 * 
 * CRAWLER OPTIMIZATION:
 * - Monte Carlo decision layer for adaptive crawler selection
 * - Stochastic simulation over randomized crawl parameters
 * - Convergence detection for strategy stabilization
 * - 4 specialized crawlers: StarTrek, Blizzard, BirdOfPrey, Hydra
 */

export {
  MonteCarloEngine,
  createMonteCarloEngine,
  // Types
  type Particle,
  ParticleState,
  type Constraint,
  ConstraintType,
  type MotionModel,
  type SimulationConfig,
  type ExecutionWindow,
  WindowStatus,
  type SimulationSnapshot,
  type HeatmapCell,
  type ProbablePath,
  type LikelihoodCone,
  type LiveRenderState,
} from './MonteCarloEngine';

// Monte Carlo Crawler Optimizer
export {
  MonteCarloCrawlerOptimizer,
  monteCarloCrawlerOptimizer,
  type SeedURL,
  type CrawlParameters,
  type RunOutcome,
  type StrategyRanking,
  type ConvergenceState,
  type OptimizationState,
} from './MonteCarloCrawlerOptimizer';

// Monte Carlo Configuration
export {
  MONTE_CARLO_CRAWLERS,
  DEFAULT_MONTE_CARLO_CONFIG,
  SCALE_UP_CONFIGS,
  type CrawlerId,
  type CrawlerCandidate,
  type MonteCarloConfig,
  type RandomizationParameter,
} from './MonteCarloConfig';

// Evolutionary Cycle Engine (Bounded 4-Crawler System)
export {
  EvolutionaryCycleEngine,
  evolutionaryCycleEngine,
  type CrawlerVariant,
  type VariantParameters,
  type PerformanceMetrics,
  type EvolutionaryCycle,
  type EvolutionaryState,
} from './EvolutionaryCycleEngine';
