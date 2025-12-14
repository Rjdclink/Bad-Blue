/**
 * PANTHEON Monte Carlo Simulation Module
 * 
 * Provides mathematically defensible satellite tracking with:
 * - Particle filter for probabilistic location estimation
 * - Constraint-based updates from satellite imagery
 * - Bounded execution cycles tied to Doomsday Clock
 * - Heatmaps, probable paths, and likelihood cones
 */

// Values (classes/enums) — safe to import at runtime
export {
  MonteCarloEngine,
  createMonteCarloEngine,
  ParticleState,
  ConstraintType,
  WindowStatus,
} from './MonteCarloEngine';

// Types — compile-time only
export type {
  Particle,
  Constraint,
  MotionModel,
  SimulationConfig,
  ExecutionWindow,
  SimulationSnapshot,
  HeatmapCell,
  ProbablePath,
  LikelihoodCone,
  LiveRenderState,
} from './MonteCarloEngine';
