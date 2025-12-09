/**
 * SWARM INTELLIGENCE STRATEGY DISCOVERY
 * 
 * Uses emergent behavior from multiple parallel AI agents to discover
 * novel trading strategies through collective intelligence.
 * 
 * KEY CONCEPTS:
 * - Particle Swarm Optimization for parameter space exploration
 * - Ant Colony Optimization for route/path optimization
 * - Bee Colony Algorithm for resource allocation
 * - Emergent Strategy Patterns from agent interactions
 */

import logger from '../../../logger.js';
import type { StrategyGenome, EvolutionState } from './hyper-evolution-engine';
import { 
  createMonteCarloEngine, 
  type StrategyProfile, 
  type MarketCondition,
  MARKET_CONDITIONS 
} from '../validation/monte-carlo-engine';

// ============================================
// PARTICLE SWARM OPTIMIZATION
// ============================================
export interface Particle {
  id: string;
  position: number[];           // Current position in parameter space
  velocity: number[];           // Current velocity
  personalBest: number[];       // Best position found by this particle
  personalBestFitness: number;
  currentFitness: number;
}

export interface SwarmConfig {
  particleCount: number;        // Number of particles
  dimensions: number;           // Number of parameters to optimize
  inertiaWeight: number;        // Momentum factor (0.4-0.9)
  cognitiveWeight: number;      // Personal best attraction (1.5-2.5)
  socialWeight: number;         // Global best attraction (1.5-2.5)
  maxVelocity: number;          // Velocity clamp
  iterations: number;           // Max iterations per run
}

const DEFAULT_SWARM_CONFIG: SwarmConfig = {
  particleCount: 50,
  dimensions: 7,                // 7 strategy parameters
  inertiaWeight: 0.7,
  cognitiveWeight: 2.0,
  socialWeight: 2.0,
  maxVelocity: 0.3,
  iterations: 100
};

// Parameter bounds for strategy optimization
const PARAMETER_BOUNDS = {
  baseSuccessRate: [0.1, 0.95],
  avgProfitPerTrade: [0.001, 0.5],
  avgLossPerTrade: [0.001, 0.2],
  tradesPerDay: [1, 1000],
  gasPerTrade: [0.0001, 0.01],
  slippageTolerance: [0.001, 0.05],
  executionLatency: [1, 500]
};

const PARAMETER_KEYS = Object.keys(PARAMETER_BOUNDS);

// ============================================
// ANT COLONY OPTIMIZATION
// ============================================
export interface AntColonyConfig {
  antCount: number;
  pheromoneDecay: number;       // Evaporation rate (0.1-0.5)
  pheromoneStrength: number;    // Deposit strength
  alpha: number;                // Pheromone importance (1-5)
  beta: number;                 // Heuristic importance (1-5)
  iterations: number;
}

export interface PheromoneTrail {
  from: string;
  to: string;
  strength: number;
}

const DEFAULT_ANT_CONFIG: AntColonyConfig = {
  antCount: 30,
  pheromoneDecay: 0.3,
  pheromoneStrength: 1.0,
  alpha: 2,
  beta: 3,
  iterations: 50
};

// ============================================
// BEE COLONY ALGORITHM
// ============================================
export interface BeeColonyConfig {
  employedBees: number;
  onlookerBees: number;
  scoutBees: number;
  abandonmentLimit: number;     // Trials before abandoning food source
  iterations: number;
}

export interface FoodSource {
  id: string;
  position: number[];           // Strategy parameters
  fitness: number;
  trials: number;               // Failed improvement attempts
}

const DEFAULT_BEE_CONFIG: BeeColonyConfig = {
  employedBees: 25,
  onlookerBees: 25,
  scoutBees: 5,
  abandonmentLimit: 10,
  iterations: 50
};

// ============================================
// SWARM INTELLIGENCE ENGINE
// ============================================
export class SwarmIntelligenceEngine {
  private swarmConfig: SwarmConfig;
  private antConfig: AntColonyConfig;
  private beeConfig: BeeColonyConfig;
  private monteCarloEngine = createMonteCarloEngine({ simulations: 500 });
  
  // Swarm state
  private particles: Particle[] = [];
  private globalBest: number[] = [];
  private globalBestFitness: number = 0;
  
  // Ant colony state
  private pheromoneMatrix: Map<string, number> = new Map();
  
  // Bee colony state
  private foodSources: FoodSource[] = [];
  
  // Discovered strategies
  private discoveredStrategies: StrategyProfile[] = [];
  
  constructor(
    swarmConfig: Partial<SwarmConfig> = {},
    antConfig: Partial<AntColonyConfig> = {},
    beeConfig: Partial<BeeColonyConfig> = {}
  ) {
    this.swarmConfig = { ...DEFAULT_SWARM_CONFIG, ...swarmConfig };
    this.antConfig = { ...DEFAULT_ANT_CONFIG, ...antConfig };
    this.beeConfig = { ...DEFAULT_BEE_CONFIG, ...beeConfig };
  }
  
  // ============================================
  // PARTICLE SWARM OPTIMIZATION
  // ============================================
  
  /**
   * Run Particle Swarm Optimization to find optimal strategy parameters
   */
  async runPSO(marketCondition: MarketCondition = MARKET_CONDITIONS.normal): Promise<{
    bestPosition: number[];
    bestFitness: number;
    convergenceHistory: number[];
    strategy: StrategyProfile;
  }> {
    logger.info('Starting Particle Swarm Optimization', {
      component: 'SwarmIntelligence',
      particles: this.swarmConfig.particleCount,
      iterations: this.swarmConfig.iterations
    });
    
    // Initialize particles
    this.initializeParticles();
    
    const convergenceHistory: number[] = [];
    
    // Main PSO loop
    for (let iter = 0; iter < this.swarmConfig.iterations; iter++) {
      // Evaluate all particles
      await this.evaluateParticles(marketCondition);
      
      // Update velocities and positions
      this.updateParticles();
      
      convergenceHistory.push(this.globalBestFitness);
      
      // Early stopping if converged
      if (iter > 10 && this.hasConverged(convergenceHistory)) {
        logger.info('PSO converged early', {
          component: 'SwarmIntelligence',
          iteration: iter,
          fitness: this.globalBestFitness
        });
        break;
      }
    }
    
    const strategy = this.positionToStrategy(this.globalBest, 'PSO-Optimized');
    this.discoveredStrategies.push(strategy);
    
    logger.info('PSO complete', {
      component: 'SwarmIntelligence',
      bestFitness: this.globalBestFitness.toFixed(4),
      strategy: strategy.name
    });
    
    return {
      bestPosition: this.globalBest,
      bestFitness: this.globalBestFitness,
      convergenceHistory,
      strategy
    };
  }
  
  /**
   * Initialize particle swarm
   */
  private initializeParticles(): void {
    this.particles = [];
    this.globalBestFitness = 0;
    
    for (let i = 0; i < this.swarmConfig.particleCount; i++) {
      const position = this.generateRandomPosition();
      const velocity = this.generateRandomVelocity();
      
      this.particles.push({
        id: `particle-${i}`,
        position,
        velocity,
        personalBest: [...position],
        personalBestFitness: 0,
        currentFitness: 0
      });
    }
  }
  
  /**
   * Generate random position in parameter space
   */
  private generateRandomPosition(): number[] {
    return PARAMETER_KEYS.map(key => {
      const [min, max] = PARAMETER_BOUNDS[key as keyof typeof PARAMETER_BOUNDS];
      return min + Math.random() * (max - min);
    });
  }
  
  /**
   * Generate random velocity
   */
  private generateRandomVelocity(): number[] {
    return PARAMETER_KEYS.map(() => 
      (Math.random() - 0.5) * 2 * this.swarmConfig.maxVelocity
    );
  }
  
  /**
   * Evaluate all particles
   */
  private async evaluateParticles(marketCondition: MarketCondition): Promise<void> {
    for (const particle of this.particles) {
      const strategy = this.positionToStrategy(particle.position, particle.id);
      
      try {
        const result = await this.monteCarloEngine.runSimulation(strategy, marketCondition);
        particle.currentFitness = this.calculateFitness(result);
        
        // Update personal best
        if (particle.currentFitness > particle.personalBestFitness) {
          particle.personalBest = [...particle.position];
          particle.personalBestFitness = particle.currentFitness;
        }
        
        // Update global best
        if (particle.currentFitness > this.globalBestFitness) {
          this.globalBest = [...particle.position];
          this.globalBestFitness = particle.currentFitness;
        }
      } catch {
        particle.currentFitness = 0;
      }
    }
  }
  
  /**
   * Update particle velocities and positions
   */
  private updateParticles(): void {
    for (const particle of this.particles) {
      for (let d = 0; d < this.swarmConfig.dimensions; d++) {
        // Cognitive component (personal best attraction)
        const cognitive = this.swarmConfig.cognitiveWeight * Math.random() * 
          (particle.personalBest[d] - particle.position[d]);
        
        // Social component (global best attraction)
        const social = this.swarmConfig.socialWeight * Math.random() * 
          (this.globalBest[d] - particle.position[d]);
        
        // Update velocity
        particle.velocity[d] = this.swarmConfig.inertiaWeight * particle.velocity[d] +
          cognitive + social;
        
        // Clamp velocity
        particle.velocity[d] = Math.max(
          -this.swarmConfig.maxVelocity,
          Math.min(this.swarmConfig.maxVelocity, particle.velocity[d])
        );
        
        // Update position
        particle.position[d] += particle.velocity[d];
        
        // Clamp position to bounds
        const [min, max] = PARAMETER_BOUNDS[PARAMETER_KEYS[d] as keyof typeof PARAMETER_BOUNDS];
        particle.position[d] = Math.max(min, Math.min(max, particle.position[d]));
      }
    }
  }
  
  // ============================================
  // ANT COLONY OPTIMIZATION
  // ============================================
  
  /**
   * Run Ant Colony Optimization for strategy path discovery
   * Discovers optimal combinations of strategy features
   */
  async runACO(): Promise<{
    bestPath: string[];
    bestFitness: number;
    discoveredRoutes: string[][];
  }> {
    logger.info('Starting Ant Colony Optimization', {
      component: 'SwarmIntelligence',
      ants: this.antConfig.antCount,
      iterations: this.antConfig.iterations
    });
    
    // Define strategy feature nodes
    const featureNodes = [
      'mlFilter', 'noMlFilter',
      'multiChain', 'singleChain',
      'mempoolMonitor', 'noMempoolMonitor',
      'regimeAdaptive', 'staticRegime',
      'flashLoan', 'noFlashLoan',
      'highFreq', 'medFreq', 'lowFreq',
      'aggressive', 'balanced', 'conservative'
    ];
    
    // Initialize pheromone matrix
    this.initializePheromones(featureNodes);
    
    let bestPath: string[] = [];
    let bestFitness = 0;
    const discoveredRoutes: string[][] = [];
    
    for (let iter = 0; iter < this.antConfig.iterations; iter++) {
      const iterationPaths: string[][] = [];
      const iterationFitnesses: number[] = [];
      
      // Each ant constructs a solution
      for (let ant = 0; ant < this.antConfig.antCount; ant++) {
        const path = this.constructAntPath(featureNodes);
        iterationPaths.push(path);
        
        // Evaluate path
        const strategy = this.pathToStrategy(path);
        try {
          const result = await this.monteCarloEngine.runSimulation(strategy, MARKET_CONDITIONS.normal);
          const fitness = this.calculateFitness(result);
          iterationFitnesses.push(fitness);
          
          if (fitness > bestFitness) {
            bestFitness = fitness;
            bestPath = [...path];
          }
          
          if (fitness > 0.5) {
            discoveredRoutes.push(path);
          }
        } catch {
          iterationFitnesses.push(0);
        }
      }
      
      // Update pheromones
      this.updatePheromones(iterationPaths, iterationFitnesses);
      
      // Evaporate pheromones
      this.evaporatePheromones();
    }
    
    logger.info('ACO complete', {
      component: 'SwarmIntelligence',
      bestFitness: bestFitness.toFixed(4),
      discoveredRoutes: discoveredRoutes.length
    });
    
    return { bestPath, bestFitness, discoveredRoutes };
  }
  
  /**
   * Initialize pheromone matrix
   */
  private initializePheromones(nodes: string[]): void {
    this.pheromoneMatrix.clear();
    
    for (const from of nodes) {
      for (const to of nodes) {
        if (from !== to) {
          this.pheromoneMatrix.set(`${from}->${to}`, 1.0);
        }
      }
    }
  }
  
  /**
   * Construct a path for one ant
   */
  private constructAntPath(nodes: string[]): string[] {
    const path: string[] = [];
    const visited = new Set<string>();
    
    // Group nodes by category
    const categories = [
      ['mlFilter', 'noMlFilter'],
      ['multiChain', 'singleChain'],
      ['mempoolMonitor', 'noMempoolMonitor'],
      ['regimeAdaptive', 'staticRegime'],
      ['flashLoan', 'noFlashLoan'],
      ['highFreq', 'medFreq', 'lowFreq'],
      ['aggressive', 'balanced', 'conservative']
    ];
    
    for (const category of categories) {
      const available = category.filter(n => !visited.has(n));
      if (available.length === 0) continue;
      
      // Calculate probabilities based on pheromones
      const probabilities = this.calculateTransitionProbabilities(
        path[path.length - 1] || '',
        available
      );
      
      // Roulette wheel selection
      const selected = this.rouletteSelect(available, probabilities);
      path.push(selected);
      visited.add(selected);
      
      // Mark conflicting nodes as visited
      for (const node of category) {
        visited.add(node);
      }
    }
    
    return path;
  }
  
  /**
   * Calculate transition probabilities
   */
  private calculateTransitionProbabilities(from: string, candidates: string[]): number[] {
    const probabilities: number[] = [];
    let total = 0;
    
    for (const to of candidates) {
      const pheromone = this.pheromoneMatrix.get(`${from}->${to}`) || 1.0;
      const heuristic = 1.0; // Could add domain-specific heuristic
      
      const prob = Math.pow(pheromone, this.antConfig.alpha) * 
                   Math.pow(heuristic, this.antConfig.beta);
      probabilities.push(prob);
      total += prob;
    }
    
    // Normalize
    return probabilities.map(p => p / total);
  }
  
  /**
   * Roulette wheel selection
   */
  private rouletteSelect(candidates: string[], probabilities: number[]): string {
    const r = Math.random();
    let cumulative = 0;
    
    for (let i = 0; i < candidates.length; i++) {
      cumulative += probabilities[i];
      if (r <= cumulative) {
        return candidates[i];
      }
    }
    
    return candidates[candidates.length - 1];
  }
  
  /**
   * Update pheromones based on ant solutions
   */
  private updatePheromones(paths: string[][], fitnesses: number[]): void {
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      const fitness = fitnesses[i];
      
      for (let j = 0; j < path.length - 1; j++) {
        const key = `${path[j]}->${path[j + 1]}`;
        const current = this.pheromoneMatrix.get(key) || 1.0;
        this.pheromoneMatrix.set(key, current + this.antConfig.pheromoneStrength * fitness);
      }
    }
  }
  
  /**
   * Evaporate pheromones
   */
  private evaporatePheromones(): void {
    for (const [key, value] of this.pheromoneMatrix.entries()) {
      this.pheromoneMatrix.set(key, value * (1 - this.antConfig.pheromoneDecay));
    }
  }
  
  /**
   * Convert feature path to strategy
   */
  private pathToStrategy(path: string[]): StrategyProfile {
    const hasFeature = (feature: string) => path.includes(feature);
    
    // Determine trades per day based on frequency
    let tradesPerDay = 100;
    if (hasFeature('highFreq')) tradesPerDay = 300;
    else if (hasFeature('lowFreq')) tradesPerDay = 30;
    
    // Determine success rate based on aggressiveness
    let baseSuccessRate = 0.6;
    if (hasFeature('aggressive')) baseSuccessRate = 0.55;
    else if (hasFeature('conservative')) baseSuccessRate = 0.7;
    
    // Determine profit/loss based on aggressiveness
    let avgProfitPerTrade = 0.03;
    let avgLossPerTrade = 0.015;
    if (hasFeature('aggressive')) {
      avgProfitPerTrade = 0.05;
      avgLossPerTrade = 0.025;
    } else if (hasFeature('conservative')) {
      avgProfitPerTrade = 0.02;
      avgLossPerTrade = 0.008;
    }
    
    return {
      name: `ACO-${path.join('-').substring(0, 30)}`,
      baseSuccessRate,
      avgProfitPerTrade,
      avgLossPerTrade,
      tradesPerDay,
      gasPerTrade: hasFeature('flashLoan') ? 0.005 : 0.002,
      slippageTolerance: hasFeature('multiChain') ? 0.008 : 0.004,
      executionLatency: hasFeature('highFreq') ? 20 : hasFeature('lowFreq') ? 150 : 75,
      strategyType: hasFeature('flashLoan') ? 'arbitrage' : 
                   hasFeature('mempoolMonitor') ? 'mev' : 'liquidity',
      mlFilterEnabled: hasFeature('mlFilter'),
      multiChainEnabled: hasFeature('multiChain'),
      mempoolMonitoring: hasFeature('mempoolMonitor')
    };
  }
  
  // ============================================
  // BEE COLONY ALGORITHM
  // ============================================
  
  /**
   * Run Artificial Bee Colony algorithm
   */
  async runABC(marketCondition: MarketCondition = MARKET_CONDITIONS.normal): Promise<{
    bestSource: FoodSource;
    allSources: FoodSource[];
    convergenceHistory: number[];
  }> {
    logger.info('Starting Artificial Bee Colony', {
      component: 'SwarmIntelligence',
      employedBees: this.beeConfig.employedBees,
      iterations: this.beeConfig.iterations
    });
    
    // Initialize food sources
    this.initializeFoodSources();
    
    const convergenceHistory: number[] = [];
    
    for (let iter = 0; iter < this.beeConfig.iterations; iter++) {
      // Employed bee phase
      await this.employedBeePhase(marketCondition);
      
      // Onlooker bee phase
      await this.onlookerBeePhase(marketCondition);
      
      // Scout bee phase
      await this.scoutBeePhase(marketCondition);
      
      const bestFitness = Math.max(...this.foodSources.map(s => s.fitness));
      convergenceHistory.push(bestFitness);
    }
    
    // Sort by fitness
    this.foodSources.sort((a, b) => b.fitness - a.fitness);
    const bestSource = this.foodSources[0];
    
    // Convert to strategy and store
    const strategy = this.positionToStrategy(bestSource.position, 'ABC-Optimized');
    this.discoveredStrategies.push(strategy);
    
    logger.info('ABC complete', {
      component: 'SwarmIntelligence',
      bestFitness: bestSource.fitness.toFixed(4)
    });
    
    return {
      bestSource,
      allSources: this.foodSources,
      convergenceHistory
    };
  }
  
  /**
   * Initialize food sources
   */
  private initializeFoodSources(): void {
    this.foodSources = [];
    
    for (let i = 0; i < this.beeConfig.employedBees; i++) {
      this.foodSources.push({
        id: `food-${i}`,
        position: this.generateRandomPosition(),
        fitness: 0,
        trials: 0
      });
    }
  }
  
  /**
   * Employed bee phase - exploit current food sources
   */
  private async employedBeePhase(marketCondition: MarketCondition): Promise<void> {
    for (const source of this.foodSources) {
      // Generate neighbor solution
      const neighborPosition = this.generateNeighborPosition(source.position);
      const neighborStrategy = this.positionToStrategy(neighborPosition, source.id);
      
      try {
        const result = await this.monteCarloEngine.runSimulation(neighborStrategy, marketCondition);
        const neighborFitness = this.calculateFitness(result);
        
        // Greedy selection
        if (neighborFitness > source.fitness) {
          source.position = neighborPosition;
          source.fitness = neighborFitness;
          source.trials = 0;
        } else {
          source.trials++;
        }
      } catch {
        source.trials++;
      }
    }
  }
  
  /**
   * Onlooker bee phase - probabilistic selection based on fitness
   */
  private async onlookerBeePhase(marketCondition: MarketCondition): Promise<void> {
    // Calculate selection probabilities
    const totalFitness = this.foodSources.reduce((sum, s) => sum + s.fitness, 0);
    const probabilities = this.foodSources.map(s => 
      totalFitness > 0 ? s.fitness / totalFitness : 1 / this.foodSources.length
    );
    
    for (let i = 0; i < this.beeConfig.onlookerBees; i++) {
      // Select food source probabilistically
      const selectedIndex = this.selectFoodSource(probabilities);
      const source = this.foodSources[selectedIndex];
      
      // Generate and evaluate neighbor
      const neighborPosition = this.generateNeighborPosition(source.position);
      const neighborStrategy = this.positionToStrategy(neighborPosition, `onlooker-${i}`);
      
      try {
        const result = await this.monteCarloEngine.runSimulation(neighborStrategy, marketCondition);
        const neighborFitness = this.calculateFitness(result);
        
        if (neighborFitness > source.fitness) {
          source.position = neighborPosition;
          source.fitness = neighborFitness;
          source.trials = 0;
        } else {
          source.trials++;
        }
      } catch {
        source.trials++;
      }
    }
  }
  
  /**
   * Scout bee phase - abandon exhausted sources
   */
  private async scoutBeePhase(marketCondition: MarketCondition): Promise<void> {
    for (const source of this.foodSources) {
      if (source.trials >= this.beeConfig.abandonmentLimit) {
        // Abandon and create new random source
        source.position = this.generateRandomPosition();
        source.trials = 0;
        
        // Evaluate new source
        const strategy = this.positionToStrategy(source.position, source.id);
        try {
          const result = await this.monteCarloEngine.runSimulation(strategy, marketCondition);
          source.fitness = this.calculateFitness(result);
        } catch {
          source.fitness = 0;
        }
      }
    }
  }
  
  /**
   * Generate neighbor position
   */
  private generateNeighborPosition(position: number[]): number[] {
    const neighbor = [...position];
    const dim = Math.floor(Math.random() * position.length);
    const partnerIndex = Math.floor(Math.random() * this.foodSources.length);
    const partner = this.foodSources[partnerIndex];
    
    // Modification
    const phi = (Math.random() - 0.5) * 2; // Random in [-1, 1]
    neighbor[dim] = position[dim] + phi * (position[dim] - partner.position[dim]);
    
    // Clamp to bounds
    const [min, max] = PARAMETER_BOUNDS[PARAMETER_KEYS[dim] as keyof typeof PARAMETER_BOUNDS];
    neighbor[dim] = Math.max(min, Math.min(max, neighbor[dim]));
    
    return neighbor;
  }
  
  /**
   * Select food source using roulette wheel
   */
  private selectFoodSource(probabilities: number[]): number {
    const r = Math.random();
    let cumulative = 0;
    
    for (let i = 0; i < probabilities.length; i++) {
      cumulative += probabilities[i];
      if (r <= cumulative) return i;
    }
    
    return probabilities.length - 1;
  }
  
  // ============================================
  // COMBINED SWARM DISCOVERY
  // ============================================
  
  /**
   * Run all swarm algorithms in parallel for maximum discovery
   */
  async runCombinedDiscovery(marketCondition: MarketCondition = MARKET_CONDITIONS.normal): Promise<{
    strategies: StrategyProfile[];
    psoResult: Awaited<ReturnType<SwarmIntelligenceEngine['runPSO']>>;
    acoResult: Awaited<ReturnType<SwarmIntelligenceEngine['runACO']>>;
    abcResult: Awaited<ReturnType<SwarmIntelligenceEngine['runABC']>>;
  }> {
    logger.info('Starting Combined Swarm Discovery', {
      component: 'SwarmIntelligence'
    });
    
    // Run all algorithms
    const [psoResult, acoResult, abcResult] = await Promise.all([
      this.runPSO(marketCondition),
      this.runACO(),
      this.runABC(marketCondition)
    ]);
    
    // Collect all discovered strategies
    const strategies = [...this.discoveredStrategies];
    
    // Add best ABC source as strategy
    if (abcResult.bestSource) {
      strategies.push(this.positionToStrategy(abcResult.bestSource.position, 'ABC-Best'));
    }
    
    // Add best ACO path as strategy
    if (acoResult.bestPath.length > 0) {
      strategies.push(this.pathToStrategy(acoResult.bestPath));
    }
    
    logger.info('Combined Swarm Discovery complete', {
      component: 'SwarmIntelligence',
      strategiesDiscovered: strategies.length,
      bestPSOFitness: psoResult.bestFitness.toFixed(4),
      bestACOFitness: acoResult.bestFitness.toFixed(4),
      bestABCFitness: abcResult.bestSource.fitness.toFixed(4)
    });
    
    return {
      strategies,
      psoResult,
      acoResult,
      abcResult
    };
  }
  
  // ============================================
  // UTILITY METHODS
  // ============================================
  
  /**
   * Convert position to strategy profile
   */
  private positionToStrategy(position: number[], name: string): StrategyProfile {
    return {
      name,
      baseSuccessRate: position[0],
      avgProfitPerTrade: position[1],
      avgLossPerTrade: position[2],
      tradesPerDay: Math.round(position[3]),
      gasPerTrade: position[4],
      slippageTolerance: position[5],
      executionLatency: Math.round(position[6]),
      strategyType: 'arbitrage',
      mlFilterEnabled: true,
      multiChainEnabled: false,
      mempoolMonitoring: true
    };
  }
  
  /**
   * Calculate fitness from simulation result
   */
  private calculateFitness(result: {
    winRate: number;
    sharpeRatio: number;
    profitFactor: number;
    maxDrawdown: number;
  }): number {
    let fitness = 0;
    
    fitness += Math.min(0.3, result.winRate * 0.4);
    fitness += Math.min(0.3, Math.max(0, (result.sharpeRatio + 1) / 4) * 0.3);
    fitness += Math.min(0.2, result.profitFactor / 4 * 0.2);
    fitness += Math.min(0.2, Math.max(0, 1 - result.maxDrawdown) * 0.2);
    
    return fitness;
  }
  
  /**
   * Check if PSO has converged
   */
  private hasConverged(history: number[]): boolean {
    if (history.length < 10) return false;
    
    const recent = history.slice(-10);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / recent.length;
    
    return Math.sqrt(variance) < 0.001;
  }
  
  /**
   * Get all discovered strategies
   */
  getDiscoveredStrategies(): StrategyProfile[] {
    return [...this.discoveredStrategies];
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================
let swarmInstance: SwarmIntelligenceEngine | null = null;

export function getSwarmIntelligenceEngine(
  swarmConfig?: Partial<SwarmConfig>,
  antConfig?: Partial<AntColonyConfig>,
  beeConfig?: Partial<BeeColonyConfig>
): SwarmIntelligenceEngine {
  if (!swarmInstance) {
    swarmInstance = new SwarmIntelligenceEngine(swarmConfig, antConfig, beeConfig);
  }
  return swarmInstance;
}

export { swarmInstance as swarmIntelligence };
