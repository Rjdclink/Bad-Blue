/**
 * PANTHEON Monte Carlo Simulation Engine
 * 
 * Mathematically defensible satellite tracking with bounded execution cycles.
 * 
 * CORE PRINCIPLES:
 * - Satellite imagery is discrete and delayed → Monte Carlo fills the gaps
 * - Movement between captures is probabilistic → Monte Carlo models paths
 * - Weather, revisit time, occlusion = noise → Monte Carlo absorbs noise
 * - Generates confidence envelopes, not guesses
 * 
 * EXECUTION MODEL:
 * - Bounded execution windows tied to Doomsday Clock tiers (4/8/12/18 min)
 * - No infinite loops, no unbounded timers, no runaway intervals
 * - Start → Execute → Snapshot → Suspend cycle
 * - Resumes cleanly on next scheduled window
 * 
 * OUTPUT:
 * - Probable paths with confidence intervals
 * - Heatmaps from particle density
 * - Likelihood cones (forward projection)
 * - Confidence scores per region
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A single Monte Carlo particle representing a possible state
 */
export interface Particle {
  id: string;
  // Position
  latitude: number;
  longitude: number;
  altitude: number;
  // Velocity vector
  velocityNorth: number;  // m/s (positive = north)
  velocityEast: number;   // m/s (positive = east)
  // State
  state: ParticleState;
  // Weight (likelihood this particle represents truth)
  weight: number;
  // History for path rendering
  history: { lat: number; lng: number; timestamp: number }[];
  // Metadata
  createdAt: number;
  lastUpdate: number;
}

export enum ParticleState {
  MOVING = 'MOVING',
  STATIONARY = 'STATIONARY',
  PAUSED = 'PAUSED',       // Temporary stop (traffic, etc)
  OCCLUDED = 'OCCLUDED',   // Under cover (building, tunnel)
}

/**
 * A constraint from satellite imagery or other signal
 */
export interface Constraint {
  id: string;
  type: ConstraintType;
  timestamp: number;
  // Position constraint (can be a point or region)
  latitude: number;
  longitude: number;
  // Uncertainty radius in meters
  uncertainty: number;
  // Confidence in this constraint (0-1)
  confidence: number;
  // Source metadata
  source: string;
  metadata?: Record<string, unknown>;
}

export enum ConstraintType {
  SATELLITE_CAPTURE = 'SATELLITE_CAPTURE',
  GEO_HINT = 'GEO_HINT',
  OSINT_PING = 'OSINT_PING',
  CELL_TOWER = 'CELL_TOWER',
  WIFI_SIGNAL = 'WIFI_SIGNAL',
  MANUAL_INPUT = 'MANUAL_INPUT',
}

/**
 * Motion model parameters
 */
export interface MotionModel {
  // Speed bounds (m/s)
  minSpeed: number;
  maxSpeed: number;
  typicalSpeed: number;
  // State transition probabilities
  moveToStopProb: number;
  stopToMoveProb: number;
  // Terrain bias (roads vs off-road)
  roadBias: number;  // 0-1, higher = prefer roads
  // Heading change rate (radians/second max)
  maxTurnRate: number;
  // Noise parameters
  positionNoise: number;  // meters
  velocityNoise: number;  // m/s
}

/**
 * Simulation configuration
 */
export interface SimulationConfig {
  // Particle count (1k-50k)
  particleCount: number;
  // Time step for propagation (ms)
  timeStepMs: number;
  // Effective sample size threshold for resampling
  essThreshold: number;
  // Maximum history length per particle
  maxHistoryLength: number;
  // Motion model
  motionModel: MotionModel;
}

/**
 * Execution window tied to Doomsday Clock tier
 */
export interface ExecutionWindow {
  id: string;
  tier: 'BASIC' | 'ENHANCED' | 'FULL' | 'EYE_OF_GOD';
  startTime: number;
  endTime: number;
  durationMs: number;
  status: WindowStatus;
}

export enum WindowStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  COMPLETING = 'COMPLETING',
  SUSPENDED = 'SUSPENDED',
  COMPLETED = 'COMPLETED',
}

/**
 * Simulation state snapshot at tier boundary
 */
export interface SimulationSnapshot {
  id: string;
  simulationId: string;
  tier: string;
  timestamp: number;
  // Particle summary (not all particles - too large)
  particleCount: number;
  effectiveSampleSize: number;
  // Statistical summary
  centroid: { lat: number; lng: number };
  standardDeviation: { lat: number; lng: number };
  confidence95: { lat: number; lng: number; radius: number };
  // Heatmap data (gridded)
  heatmapGrid: HeatmapCell[];
  // Top probable paths
  probablePaths: ProbablePath[];
  // Likelihood cone (forward projection)
  likelihoodCone: LikelihoodCone;
  // Constraints applied
  constraintsApplied: number;
  // Metadata
  executionTimeMs: number;
}

export interface HeatmapCell {
  lat: number;
  lng: number;
  density: number;      // 0-1 normalized
  confidence: number;   // 0-1
  particleCount: number;
}

export interface ProbablePath {
  id: string;
  probability: number;  // 0-1
  waypoints: { lat: number; lng: number; timestamp: number }[];
  totalDistance: number;
  averageSpeed: number;
}

export interface LikelihoodCone {
  origin: { lat: number; lng: number };
  timestamp: number;
  projectionMinutes: number;
  contours: {
    confidence: number;  // e.g., 0.5, 0.75, 0.95
    polygon: { lat: number; lng: number }[];
  }[];
}

/**
 * Live render state for UI
 */
export interface LiveRenderState {
  simulationId: string;
  timestamp: number;
  isActive: boolean;
  currentTier: string;
  // Real-time particle positions (sampled for performance)
  sampledParticles: { lat: number; lng: number; weight: number }[];
  // Live heatmap
  heatmap: HeatmapCell[];
  // Current confidence envelope
  confidenceEnvelope: {
    center: { lat: number; lng: number };
    radius50: number;  // 50% confidence radius
    radius75: number;
    radius95: number;
  };
  // Statistics
  stats: {
    particleCount: number;
    effectiveSampleSize: number;
    constraintCount: number;
    lastConstraintAge: number;
    cyclesCompleted: number;
  };
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_MOTION_MODEL: MotionModel = {
  minSpeed: 0,
  maxSpeed: 30,           // ~70 mph max
  typicalSpeed: 5,        // ~11 mph typical (walking/slow driving)
  moveToStopProb: 0.02,   // 2% chance to stop per step
  stopToMoveProb: 0.1,    // 10% chance to start moving per step
  roadBias: 0.7,          // 70% preference for roads
  maxTurnRate: 0.5,       // ~30 degrees/second max
  positionNoise: 5,       // 5 meters
  velocityNoise: 0.5,     // 0.5 m/s
};

const DEFAULT_CONFIG: SimulationConfig = {
  particleCount: 5000,    // Start with 5k particles
  timeStepMs: 100,        // 100ms propagation steps
  essThreshold: 0.5,      // Resample when ESS < 50% of N
  maxHistoryLength: 100,  // Keep last 100 positions
  motionModel: DEFAULT_MOTION_MODEL,
};

// Execution window durations (tied to Doomsday Clock)
const TIER_DURATIONS: Record<string, number> = {
  BASIC: 4 * 60 * 1000,       // 4 minutes
  ENHANCED: 8 * 60 * 1000,    // 8 minutes
  FULL: 12 * 60 * 1000,       // 12 minutes
  EYE_OF_GOD: 18 * 60 * 1000, // 18 minutes
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const EARTH_RADIUS = 6371000; // meters

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function toDegrees(radians: number): number {
  return radians * 180 / Math.PI;
}

/**
 * Calculate distance between two points (Haversine)
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  const Δλ = toRadians(lng2 - lng1);
  
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Move a point by distance and bearing
 */
function movePoint(lat: number, lng: number, distanceM: number, bearingRad: number): { lat: number; lng: number } {
  const φ1 = toRadians(lat);
  const λ1 = toRadians(lng);
  const δ = distanceM / EARTH_RADIUS;
  
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(bearingRad)
  );
  const λ2 = λ1 + Math.atan2(
    Math.sin(bearingRad) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
  );
  
  return { lat: toDegrees(φ2), lng: toDegrees(λ2) };
}

/**
 * Generate Gaussian random number (Box-Muller)
 */
function gaussianRandom(mean: number = 0, stdDev: number = 1): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

/**
 * Calculate effective sample size
 */
function calculateESS(weights: number[]): number {
  const sumWeights = weights.reduce((a, b) => a + b, 0);
  if (sumWeights === 0) return 0;
  const normalizedWeights = weights.map(w => w / sumWeights);
  const sumSquared = normalizedWeights.reduce((a, b) => a + b * b, 0);
  return sumSquared > 0 ? 1 / sumSquared : 0;
}

// ============================================================================
// MONTE CARLO ENGINE
// ============================================================================

export class MonteCarloEngine extends EventEmitter {
  private simulationId: string;
  private config: SimulationConfig;
  private particles: Particle[] = [];
  private constraints: Constraint[] = [];
  private snapshots: SimulationSnapshot[] = [];
  
  // Execution state
  private currentWindow: ExecutionWindow | null = null;
  private executionTimer: ReturnType<typeof setTimeout> | null = null;
  private propagationInterval: ReturnType<typeof setInterval> | null = null;
  private isActive: boolean = false;
  private cyclesCompleted: number = 0;
  
  // Statistics
  private lastPropagationTime: number = 0;

  constructor(config: Partial<SimulationConfig> = {}) {
    super();
    this.simulationId = randomUUID();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==================== INITIALIZATION ====================

  /**
   * Initialize particle set at known coordinates
   */
  initialize(
    latitude: number, 
    longitude: number, 
    uncertainty: number = 50,
    particleCount?: number
  ): void {
    const count = particleCount || this.config.particleCount;
    this.particles = [];
    
    const now = Date.now();
    
    for (let i = 0; i < count; i++) {
      // Distribute particles in Gaussian cloud around initial position
      const distance = Math.abs(gaussianRandom(0, uncertainty / 2));
      const bearing = Math.random() * 2 * Math.PI;
      const pos = movePoint(latitude, longitude, distance, bearing);
      
      // Initialize with random velocity (mostly stationary initially)
      const isMoving = Math.random() < 0.3;
      const speed = isMoving ? gaussianRandom(this.config.motionModel.typicalSpeed, 2) : 0;
      const heading = Math.random() * 2 * Math.PI;
      
      this.particles.push({
        id: `p_${i}_${now}`,
        latitude: pos.lat,
        longitude: pos.lng,
        altitude: 0,
        velocityNorth: speed * Math.cos(heading),
        velocityEast: speed * Math.sin(heading),
        state: isMoving ? ParticleState.MOVING : ParticleState.STATIONARY,
        weight: 1 / count,  // Uniform initial weights
        history: [{ lat: pos.lat, lng: pos.lng, timestamp: now }],
        createdAt: now,
        lastUpdate: now,
      });
    }
    
    console.log(`[MonteCarloEngine] Initialized ${count} particles at (${latitude.toFixed(6)}, ${longitude.toFixed(6)})`);
    this.emit('initialized', { simulationId: this.simulationId, particleCount: count });
  }

  // ==================== CONSTRAINT HANDLING ====================

  /**
   * Add a constraint (satellite capture, geo hint, etc.)
   * This triggers particle reweighting
   */
  addConstraint(constraint: Omit<Constraint, 'id'>): void {
    const fullConstraint: Constraint = {
      ...constraint,
      id: randomUUID(),
    };
    
    this.constraints.push(fullConstraint);
    
    // Reweight particles based on new constraint
    this.reweightParticles(fullConstraint);
    
    // Check if resampling needed
    const ess = calculateESS(this.particles.map(p => p.weight));
    if (ess < this.config.essThreshold * this.particles.length) {
      this.resampleParticles();
    }
    
    console.log(`[MonteCarloEngine] Added constraint: ${constraint.type}, ESS: ${ess.toFixed(0)}`);
    this.emit('constraint:added', { constraint: fullConstraint, ess });
  }

  /**
   * Reweight particles based on constraint
   * Particles closer to constraint get higher weight
   */
  private reweightParticles(constraint: Constraint): void {
    const { latitude, longitude, uncertainty, confidence } = constraint;
    
    for (const particle of this.particles) {
      const distance = haversineDistance(
        particle.latitude, particle.longitude,
        latitude, longitude
      );
      
      // Gaussian likelihood based on distance from constraint
      const sigma = uncertainty;
      const likelihood = Math.exp(-(distance ** 2) / (2 * sigma ** 2));
      
      // Update weight (multiply by likelihood, scaled by confidence)
      particle.weight *= (likelihood * confidence + (1 - confidence));
    }
    
    // Normalize weights
    const totalWeight = this.particles.reduce((sum, p) => sum + p.weight, 0);
    if (totalWeight > 0) {
      for (const particle of this.particles) {
        particle.weight /= totalWeight;
      }
    }
  }

  /**
   * Systematic resampling to concentrate probability mass
   */
  private resampleParticles(): void {
    const N = this.particles.length;
    const weights = this.particles.map(p => p.weight);
    const cumulativeWeights: number[] = [];
    
    let sum = 0;
    for (const w of weights) {
      sum += w;
      cumulativeWeights.push(sum);
    }
    
    // Systematic resampling
    const newParticles: Particle[] = [];
    const u0 = Math.random() / N;
    
    let j = 0;
    for (let i = 0; i < N; i++) {
      const u = u0 + i / N;
      while (j < cumulativeWeights.length - 1 && cumulativeWeights[j] < u) {
        j++;
      }
      
      // Clone particle with small noise to prevent degeneracy
      const original = this.particles[j];
      const noise = this.config.motionModel.positionNoise;
      const pos = movePoint(
        original.latitude, original.longitude,
        Math.abs(gaussianRandom(0, noise / 2)),
        Math.random() * 2 * Math.PI
      );
      
      newParticles.push({
        ...original,
        id: `p_${i}_${Date.now()}`,
        latitude: pos.lat,
        longitude: pos.lng,
        weight: 1 / N,
        history: [...original.history],
      });
    }
    
    this.particles = newParticles;
    console.log(`[MonteCarloEngine] Resampled ${N} particles`);
    this.emit('resampled', { particleCount: N });
  }

  // ==================== PROPAGATION ====================

  /**
   * Propagate all particles forward by one time step
   */
  private propagateParticles(): void {
    const now = Date.now();
    const dt = this.config.timeStepMs / 1000; // Convert to seconds
    const model = this.config.motionModel;
    
    for (const particle of this.particles) {
      // State transitions
      if (particle.state === ParticleState.MOVING && Math.random() < model.moveToStopProb) {
        particle.state = ParticleState.STATIONARY;
        particle.velocityNorth = 0;
        particle.velocityEast = 0;
      } else if (particle.state === ParticleState.STATIONARY && Math.random() < model.stopToMoveProb) {
        particle.state = ParticleState.MOVING;
        const speed = gaussianRandom(model.typicalSpeed, 2);
        const heading = Math.random() * 2 * Math.PI;
        particle.velocityNorth = speed * Math.cos(heading);
        particle.velocityEast = speed * Math.sin(heading);
      }
      
      if (particle.state === ParticleState.MOVING) {
        // Add velocity noise
        particle.velocityNorth += gaussianRandom(0, model.velocityNoise * dt);
        particle.velocityEast += gaussianRandom(0, model.velocityNoise * dt);
        
        // Apply turn rate limit
        const currentSpeed = Math.sqrt(particle.velocityNorth ** 2 + particle.velocityEast ** 2);
        const currentHeading = Math.atan2(particle.velocityEast, particle.velocityNorth);
        const headingChange = gaussianRandom(0, model.maxTurnRate * dt);
        const newHeading = currentHeading + Math.max(-model.maxTurnRate * dt, Math.min(model.maxTurnRate * dt, headingChange));
        
        // Clamp speed
        const clampedSpeed = Math.max(model.minSpeed, Math.min(model.maxSpeed, currentSpeed));
        particle.velocityNorth = clampedSpeed * Math.cos(newHeading);
        particle.velocityEast = clampedSpeed * Math.sin(newHeading);
        
        // Update position
        const distanceM = clampedSpeed * dt;
        if (distanceM > 0.01) {
          const bearing = Math.atan2(particle.velocityEast, particle.velocityNorth);
          const newPos = movePoint(particle.latitude, particle.longitude, distanceM, bearing);
          
          // Add position noise
          const noisyPos = movePoint(
            newPos.lat, newPos.lng,
            Math.abs(gaussianRandom(0, model.positionNoise * dt)),
            Math.random() * 2 * Math.PI
          );
          
          particle.latitude = noisyPos.lat;
          particle.longitude = noisyPos.lng;
        }
      }
      
      // Update history
      particle.history.push({ lat: particle.latitude, lng: particle.longitude, timestamp: now });
      if (particle.history.length > this.config.maxHistoryLength) {
        particle.history.shift();
      }
      
      particle.lastUpdate = now;
    }
    
    this.lastPropagationTime = now;
  }

  // ==================== EXECUTION WINDOWS ====================

  /**
   * Start a new execution window for the given tier
   * Bounded execution: Start → Execute → Snapshot → Suspend
   */
  startExecutionWindow(tier: 'BASIC' | 'ENHANCED' | 'FULL' | 'EYE_OF_GOD'): ExecutionWindow {
    if (this.isActive) {
      throw new Error('Execution window already active');
    }
    
    const now = Date.now();
    const duration = TIER_DURATIONS[tier];
    
    this.currentWindow = {
      id: randomUUID(),
      tier,
      startTime: now,
      endTime: now + duration,
      durationMs: duration,
      status: WindowStatus.ACTIVE,
    };
    
    this.isActive = true;
    
    // Start propagation interval (bounded by window duration)
    this.propagationInterval = setInterval(() => {
      if (this.isActive) {
        this.propagateParticles();
        this.emit('propagated', { simulationId: this.simulationId });
      }
    }, this.config.timeStepMs);
    
    // Schedule window completion
    this.executionTimer = setTimeout(() => {
      this.completeExecutionWindow();
    }, duration);
    
    console.log(`[MonteCarloEngine] Started ${tier} execution window (${duration / 60000} min)`);
    this.emit('window:started', { window: this.currentWindow });
    
    return this.currentWindow;
  }

  /**
   * Complete execution window: Snapshot → Suspend
   */
  private completeExecutionWindow(): void {
    if (!this.currentWindow) return;
    
    this.currentWindow.status = WindowStatus.COMPLETING;
    
    // Stop propagation
    if (this.propagationInterval) {
      clearInterval(this.propagationInterval);
      this.propagationInterval = null;
    }
    
    // Create snapshot
    const snapshot = this.createSnapshot();
    this.snapshots.push(snapshot);
    
    // Resample particles for next window
    this.resampleParticles();
    
    // Suspend
    this.currentWindow.status = WindowStatus.COMPLETED;
    this.isActive = false;
    this.cyclesCompleted++;
    
    console.log(`[MonteCarloEngine] Completed ${this.currentWindow.tier} window, cycle ${this.cyclesCompleted}`);
    this.emit('window:completed', { 
      window: this.currentWindow, 
      snapshot,
      cyclesCompleted: this.cyclesCompleted 
    });
    
    this.currentWindow = null;
    this.executionTimer = null;
  }

  /**
   * Manually suspend execution (user hard stop)
   */
  suspend(): SimulationSnapshot | null {
    if (!this.isActive) return null;
    
    // Clear timers
    if (this.propagationInterval) {
      clearInterval(this.propagationInterval);
      this.propagationInterval = null;
    }
    if (this.executionTimer) {
      clearTimeout(this.executionTimer);
      this.executionTimer = null;
    }
    
    // Create final snapshot
    const snapshot = this.createSnapshot();
    this.snapshots.push(snapshot);
    
    if (this.currentWindow) {
      this.currentWindow.status = WindowStatus.SUSPENDED;
    }
    
    this.isActive = false;
    
    console.log(`[MonteCarloEngine] Suspended execution`);
    this.emit('suspended', { snapshot });
    
    return snapshot;
  }

  // ==================== SNAPSHOT & ANALYSIS ====================

  /**
   * Create a snapshot of current simulation state
   */
  createSnapshot(): SimulationSnapshot {
    const startTime = Date.now();
    
    // Calculate centroid
    let sumLat = 0, sumLng = 0, sumWeight = 0;
    for (const p of this.particles) {
      sumLat += p.latitude * p.weight;
      sumLng += p.longitude * p.weight;
      sumWeight += p.weight;
    }
    const centroid = sumWeight > 0 
      ? { lat: sumLat / sumWeight, lng: sumLng / sumWeight }
      : { lat: 0, lng: 0 };
    
    // Calculate standard deviation
    let varLat = 0, varLng = 0;
    for (const p of this.particles) {
      varLat += p.weight * (p.latitude - centroid.lat) ** 2;
      varLng += p.weight * (p.longitude - centroid.lng) ** 2;
    }
    const stdDev = sumWeight > 0 
      ? { lat: Math.sqrt(varLat / sumWeight), lng: Math.sqrt(varLng / sumWeight) }
      : { lat: 0, lng: 0 };
    
    // Calculate 95% confidence radius
    const distances = this.particles.map(p => ({
      dist: haversineDistance(p.latitude, p.longitude, centroid.lat, centroid.lng),
      weight: p.weight,
    })).sort((a, b) => a.dist - b.dist);
    
    let cumWeight = 0;
    let conf95Radius = 0;
    for (const d of distances) {
      cumWeight += d.weight;
      if (cumWeight >= 0.95) {
        conf95Radius = d.dist;
        break;
      }
    }
    
    // Generate heatmap grid
    const heatmap = this.generateHeatmapGrid();
    
    // Extract probable paths
    const probablePaths = this.extractProbablePaths();
    
    // Generate likelihood cone
    const likelihoodCone = this.generateLikelihoodCone();
    
    const executionTime = Date.now() - startTime;
    
    return {
      id: randomUUID(),
      simulationId: this.simulationId,
      tier: this.currentWindow?.tier || 'UNKNOWN',
      timestamp: Date.now(),
      particleCount: this.particles.length,
      effectiveSampleSize: calculateESS(this.particles.map(p => p.weight)),
      centroid,
      standardDeviation: stdDev,
      confidence95: { ...centroid, radius: conf95Radius },
      heatmapGrid: heatmap,
      probablePaths,
      likelihoodCone,
      constraintsApplied: this.constraints.length,
      executionTimeMs: executionTime,
    };
  }

  /**
   * Generate gridded heatmap from particle density
   */
  private generateHeatmapGrid(gridSize: number = 20): HeatmapCell[] {
    if (this.particles.length === 0) return [];
    
    // Find bounds
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    
    for (const p of this.particles) {
      minLat = Math.min(minLat, p.latitude);
      maxLat = Math.max(maxLat, p.latitude);
      minLng = Math.min(minLng, p.longitude);
      maxLng = Math.max(maxLng, p.longitude);
    }
    
    // Add padding
    const latPad = (maxLat - minLat) * 0.1 || 0.001;
    const lngPad = (maxLng - minLng) * 0.1 || 0.001;
    minLat -= latPad; maxLat += latPad;
    minLng -= lngPad; maxLng += lngPad;
    
    const latStep = (maxLat - minLat) / gridSize;
    const lngStep = (maxLng - minLng) / gridSize;
    
    // Count particles in each cell
    const grid: Map<string, { weight: number; count: number }> = new Map();
    
    for (const p of this.particles) {
      const latIdx = Math.floor((p.latitude - minLat) / latStep);
      const lngIdx = Math.floor((p.longitude - minLng) / lngStep);
      const key = `${latIdx},${lngIdx}`;
      
      const cell = grid.get(key) || { weight: 0, count: 0 };
      cell.weight += p.weight;
      cell.count++;
      grid.set(key, cell);
    }
    
    // Convert to heatmap cells
    const maxWeight = Math.max(...Array.from(grid.values()).map(c => c.weight));
    const cells: HeatmapCell[] = [];
    
    for (const [key, value] of grid.entries()) {
      const [latIdx, lngIdx] = key.split(',').map(Number);
      cells.push({
        lat: minLat + (latIdx + 0.5) * latStep,
        lng: minLng + (lngIdx + 0.5) * lngStep,
        density: maxWeight > 0 ? value.weight / maxWeight : 0,
        confidence: value.weight,
        particleCount: value.count,
      });
    }
    
    return cells;
  }

  /**
   * Extract most probable paths from particle histories
   */
  private extractProbablePaths(numPaths: number = 5): ProbablePath[] {
    // Sort particles by weight and take top N
    const topParticles = [...this.particles]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, numPaths);
    
    return topParticles.map((p, idx) => {
      const waypoints = p.history.map(h => ({ lat: h.lat, lng: h.lng, timestamp: h.timestamp }));
      
      // Calculate total distance
      let totalDistance = 0;
      for (let i = 1; i < waypoints.length; i++) {
        totalDistance += haversineDistance(
          waypoints[i - 1].lat, waypoints[i - 1].lng,
          waypoints[i].lat, waypoints[i].lng
        );
      }
      
      // Calculate average speed
      const duration = waypoints.length > 1 
        ? (waypoints[waypoints.length - 1].timestamp - waypoints[0].timestamp) / 1000 
        : 1;
      
      return {
        id: `path_${idx}`,
        probability: p.weight,
        waypoints,
        totalDistance,
        averageSpeed: duration > 0 ? totalDistance / duration : 0,
      };
    });
  }

  /**
   * Generate likelihood cone for forward projection
   */
  private generateLikelihoodCone(projectionMinutes: number = 30): LikelihoodCone {
    const centroid = this.getCentroid();
    const now = Date.now();
    
    // Calculate average velocity
    let avgVN = 0, avgVE = 0, totalWeight = 0;
    for (const p of this.particles) {
      avgVN += p.velocityNorth * p.weight;
      avgVE += p.velocityEast * p.weight;
      totalWeight += p.weight;
    }
    if (totalWeight > 0) {
      avgVN /= totalWeight;
      avgVE /= totalWeight;
    }
    
    const avgSpeed = Math.sqrt(avgVN ** 2 + avgVE ** 2);
    const avgHeading = Math.atan2(avgVE, avgVN);
    
    // Project forward
    const projectionSeconds = projectionMinutes * 60;
    const maxDistance = avgSpeed * projectionSeconds * 1.5; // 150% for uncertainty
    
    // Generate confidence contours
    const contours: LikelihoodCone['contours'] = [];
    
    for (const confidence of [0.5, 0.75, 0.95]) {
      const spreadAngle = (1 - confidence) * Math.PI / 2; // Wider spread for lower confidence
      const radius = maxDistance * confidence;
      
      const polygon: { lat: number; lng: number }[] = [];
      const numPoints = 12;
      
      for (let i = 0; i <= numPoints; i++) {
        const angle = avgHeading - spreadAngle + (2 * spreadAngle * i / numPoints);
        const dist = radius * (0.5 + 0.5 * Math.cos((i / numPoints - 0.5) * Math.PI));
        const point = movePoint(centroid.lat, centroid.lng, dist, angle);
        polygon.push(point);
      }
      
      // Close the polygon back to origin
      polygon.push({ lat: centroid.lat, lng: centroid.lng });
      
      contours.push({ confidence, polygon });
    }
    
    return {
      origin: centroid,
      timestamp: now,
      projectionMinutes,
      contours,
    };
  }

  // ==================== ACCESSORS ====================

  getCentroid(): { lat: number; lng: number } {
    let sumLat = 0, sumLng = 0, sumWeight = 0;
    for (const p of this.particles) {
      sumLat += p.latitude * p.weight;
      sumLng += p.longitude * p.weight;
      sumWeight += p.weight;
    }
    return sumWeight > 0 
      ? { lat: sumLat / sumWeight, lng: sumLng / sumWeight }
      : { lat: 0, lng: 0 };
  }

  getLiveRenderState(): LiveRenderState {
    const now = Date.now();
    
    // Sample particles for rendering (max 500 for performance)
    const sampleSize = Math.min(500, this.particles.length);
    const step = Math.max(1, Math.floor(this.particles.length / sampleSize));
    const sampledParticles = this.particles
      .filter((_, i) => i % step === 0)
      .map(p => ({ lat: p.latitude, lng: p.longitude, weight: p.weight }));
    
    // Quick heatmap
    const heatmap = this.generateHeatmapGrid(15);
    
    // Confidence envelope
    const centroid = this.getCentroid();
    const distances = this.particles.map(p => 
      haversineDistance(p.latitude, p.longitude, centroid.lat, centroid.lng)
    ).sort((a, b) => a - b);
    
    const idx50 = Math.floor(distances.length * 0.5);
    const idx75 = Math.floor(distances.length * 0.75);
    const idx95 = Math.floor(distances.length * 0.95);
    
    const lastConstraint = this.constraints[this.constraints.length - 1];
    
    return {
      simulationId: this.simulationId,
      timestamp: now,
      isActive: this.isActive,
      currentTier: this.currentWindow?.tier || 'IDLE',
      sampledParticles,
      heatmap,
      confidenceEnvelope: {
        center: centroid,
        radius50: distances[idx50] || 0,
        radius75: distances[idx75] || 0,
        radius95: distances[idx95] || 0,
      },
      stats: {
        particleCount: this.particles.length,
        effectiveSampleSize: calculateESS(this.particles.map(p => p.weight)),
        constraintCount: this.constraints.length,
        lastConstraintAge: lastConstraint ? now - lastConstraint.timestamp : -1,
        cyclesCompleted: this.cyclesCompleted,
      },
    };
  }

  getSnapshots(): SimulationSnapshot[] {
    return [...this.snapshots];
  }

  getConstraints(): Constraint[] {
    return [...this.constraints];
  }

  isRunning(): boolean {
    return this.isActive;
  }

  getSimulationId(): string {
    return this.simulationId;
  }

  // ==================== CLEANUP ====================

  destroy(): void {
    if (this.propagationInterval) {
      clearInterval(this.propagationInterval);
    }
    if (this.executionTimer) {
      clearTimeout(this.executionTimer);
    }
    this.particles = [];
    this.constraints = [];
    this.isActive = false;
    this.removeAllListeners();
  }
}

// Export singleton factory
export function createMonteCarloEngine(config?: Partial<SimulationConfig>): MonteCarloEngine {
  return new MonteCarloEngine(config);
}

export default MonteCarloEngine;
