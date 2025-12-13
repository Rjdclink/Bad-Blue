/**
 * PANTHEON Monte Carlo Simulation Module
 * 
 * Provides mathematically defensible satellite tracking with:
 * - Particle filter for probabilistic location estimation
 * - Constraint-based updates from satellite imagery
 * - Bounded execution cycles tied to Doomsday Clock
 * - Heatmaps, probable paths, and likelihood cones
 */

export {
  MonteCarloEngine,
  createMonteCarloEngine,
  // Types
  type Particle,
  type ParticleState,
  type Constraint,
  type ConstraintType,
  type MotionModel,
  type SimulationConfig,
  type ExecutionWindow,
  type WindowStatus,
  type SimulationSnapshot,
  type HeatmapCell,
  type ProbablePath,
  type LikelihoodCone,
  type LiveRenderState,
} from './MonteCarloEngine';

// Re-export enums as values
export { ParticleState, ConstraintType, WindowStatus } from './MonteCarloEngine';
