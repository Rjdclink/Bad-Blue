/**
 * Higher-Order Faucet Mesh with Monte Carlo Learning
 * 
 * A self-learning transaction flow system that:
 * 1. Uses Monte Carlo simulations to predict optimal strategies
 * 2. Learns from execution results to improve future decisions
 * 3. Adapts in real-time to avoid compliance violations
 * 4. Forms a mesh network of faucet strategies that evolve together
 */

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { ChainId } from '../eden/types.js';
import { getFacetHandler, COMPLIANCE_THRESHOLDS, type FacetType } from './facet-handler.js';

// ============================================================================
// MONTE CARLO LEARNING ENGINE
// ============================================================================

export interface MonteCarloState {
  iteration: number;
  explorationRate: number;
  learningRate: number;
  strategyWeights: Map<string, number>;
  violationMemory: Map<string, number>;
  successfulPatterns: StrategyPattern[];
  rewardHistory: number[];
  cumulativeReward: number;
}

export interface StrategyPattern {
  id: string;
  amountRange: [number, number];
  timeRange: [number, number];
  chainPreference: ChainId[];
  exchangePreference: string[];
  successRate: number;
  usageCount: number;
  lastUsed: number;
}

export interface SimulationResult {
  pattern: StrategyPattern;
  violations: string[];
  reward: number;
  executionTime: number;
}

export interface MeshNode {
  id: string;
  state: MonteCarloState;
  connections: string[];
  specialization: 'explorer' | 'exploiter' | 'balanced';
  performance: number;
}

// ============================================================================
// HIGHER-ORDER FAUCET MESH
// ============================================================================

export class HigherOrderFaucetMesh {
  private nodes: Map<string, MeshNode> = new Map();
  private globalState: MonteCarloState;
  private facetHandler = getFacetHandler();
  private isLearning = false;
  private learningInterval: NodeJS.Timeout | null = null;

  // Configuration
  private readonly MONTE_CARLO_ITERATIONS = 100;
  private readonly EXPLORATION_DECAY = 0.995;
  private readonly MIN_EXPLORATION = 0.05;
  private readonly LEARNING_RATE = 0.1;
  private readonly MESH_SIZE = 5;

  constructor() {
    this.globalState = this.initializeState();
    this.initializeMesh();
    
    logger.info('HigherOrderFaucetMesh initialized', {
      component: 'FaucetMesh',
      meshSize: this.MESH_SIZE,
      monteCarloIterations: this.MONTE_CARLO_ITERATIONS,
    });
  }

  private initializeState(): MonteCarloState {
    return {
      iteration: 0,
      explorationRate: 0.3,
      learningRate: this.LEARNING_RATE,
      strategyWeights: new Map([
        ['conservative', 1.0],
        ['moderate', 1.0],
        ['aggressive', 1.0],
        ['stealth', 1.0],
        ['burst', 1.0],
      ]),
      violationMemory: new Map(),
      successfulPatterns: [],
      rewardHistory: [],
      cumulativeReward: 0,
    };
  }

  private initializeMesh(): void {
    const specializations: Array<'explorer' | 'exploiter' | 'balanced'> = 
      ['explorer', 'exploiter', 'balanced', 'explorer', 'exploiter'];
    
    for (let i = 0; i < this.MESH_SIZE; i++) {
      const nodeId = `mesh-node-${i}`;
      const node: MeshNode = {
        id: nodeId,
        state: this.initializeState(),
        connections: [],
        specialization: specializations[i],
        performance: 0,
      };
      
      // Create mesh connections (each node connects to 2 others)
      node.connections = [
        `mesh-node-${(i + 1) % this.MESH_SIZE}`,
        `mesh-node-${(i + 2) % this.MESH_SIZE}`,
      ];
      
      this.nodes.set(nodeId, node);
    }
  }

  // ==========================================================================
  // MONTE CARLO SIMULATION
  // ==========================================================================

  /**
   * Run Monte Carlo simulation to find optimal strategy
   */
  async runMonteCarloSimulation(targetVolume: number): Promise<StrategyPattern> {
    const results: SimulationResult[] = [];
    
    for (let i = 0; i < this.MONTE_CARLO_ITERATIONS; i++) {
      const pattern = this.generateRandomPattern();
      const simResult = this.simulatePattern(pattern, targetVolume);
      results.push(simResult);
      
      // Update violation memory
      for (const v of simResult.violations) {
        const count = this.globalState.violationMemory.get(v) || 0;
        this.globalState.violationMemory.set(v, count + 1);
      }
    }
    
    // Select best pattern based on reward
    results.sort((a, b) => b.reward - a.reward);
    const bestPattern = results[0].pattern;
    
    // Update successful patterns if no violations
    if (results[0].violations.length === 0) {
      bestPattern.successRate = (bestPattern.successRate * bestPattern.usageCount + 1) / (bestPattern.usageCount + 1);
      bestPattern.usageCount++;
      bestPattern.lastUsed = Date.now();
      
      this.globalState.successfulPatterns.push(bestPattern);
      if (this.globalState.successfulPatterns.length > 100) {
        this.globalState.successfulPatterns.shift();
      }
    }
    
    // Decay exploration rate
    this.globalState.explorationRate = Math.max(
      this.MIN_EXPLORATION,
      this.globalState.explorationRate * this.EXPLORATION_DECAY
    );
    
    this.globalState.iteration++;
    
    return bestPattern;
  }

  private generateRandomPattern(): StrategyPattern {
    const chains: ChainId[] = ['polygon', 'arbitrum', 'optimism', 'bsc', 'avalanche'];
    const exchanges = ['binance', 'coinbase', 'kraken', 'kucoin', 'bybit', 'okx', 'gate', 'gemini'];
    
    // Use learned weights to bias generation
    const weights = this.globalState.strategyWeights;
    const totalWeight = Array.from(weights.values()).reduce((a, b) => a + b, 0);
    
    let strategyType: string;
    let r = Math.random() * totalWeight;
    for (const [type, weight] of weights) {
      r -= weight;
      if (r <= 0) {
        strategyType = type;
        break;
      }
    }
    strategyType = strategyType! || 'moderate';
    
    // Generate pattern based on strategy type
    let amountRange: [number, number];
    let timeRange: [number, number];
    
    switch (strategyType) {
      case 'conservative':
        amountRange = [100, 400];
        timeRange = [120000, 600000];
        break;
      case 'aggressive':
        amountRange = [500, 1500];
        timeRange = [30000, 120000];
        break;
      case 'stealth':
        amountRange = [75, 300];
        timeRange = [180000, 900000];
        break;
      case 'burst':
        amountRange = [200, 800];
        timeRange = [45000, 180000];
        break;
      default: // moderate
        amountRange = [150, 800];
        timeRange = [45000, 420000];
    }
    
    // Add variance
    const variance = 0.3 + Math.random() * 0.3;
    amountRange[0] *= (1 - variance / 2);
    amountRange[1] *= (1 + variance / 2);
    
    // Select chains (never include first chain at end - anti-circular)
    const selectedChains = chains.slice(0, 3 + Math.floor(Math.random() * 2));
    
    return {
      id: randomUUID(),
      amountRange: amountRange as [number, number],
      timeRange: timeRange as [number, number],
      chainPreference: selectedChains,
      exchangePreference: exchanges.slice(0, 4 + Math.floor(Math.random() * 4)),
      successRate: 0,
      usageCount: 0,
      lastUsed: 0,
    };
  }

  private simulatePattern(pattern: StrategyPattern, targetVolume: number): SimulationResult {
    const violations: string[] = [];
    const startTime = Date.now();
    
    // Generate simulated transactions
    const txs = this.generateSimulatedTransactions(pattern, targetVolume);
    
    // Check all violations
    violations.push(...this.checkViolations(txs));
    
    // Calculate reward
    let reward = 100; // Base reward
    reward -= violations.length * 25; // Penalty per violation
    reward += txs.length * 0.5; // Bonus for transaction count
    reward += (targetVolume - Math.abs(targetVolume - txs.reduce((s, t) => s + t.amt, 0))) * 0.01;
    
    // Bonus for using learned successful patterns
    if (this.globalState.successfulPatterns.some(p => 
      p.amountRange[0] === pattern.amountRange[0] && 
      p.timeRange[0] === pattern.timeRange[0]
    )) {
      reward += 20;
    }
    
    return {
      pattern,
      violations,
      reward: Math.max(0, reward),
      executionTime: Date.now() - startTime,
    };
  }

  private generateSimulatedTransactions(pattern: StrategyPattern, targetVolume: number): Array<{amt: number; ex: string; ch: ChainId; ts: number; type: string}> {
    const txs: Array<{amt: number; ex: string; ch: ChainId; ts: number; type: string}> = [];
    let vol = 0;
    let ts = Date.now();
    let firstChain: ChainId | null = null;
    const recentAmts: number[] = [];
    
    while (vol < targetVolume * 0.95 && txs.length < 80) {
      // Amount with variance and anti-clustering
      let amt = pattern.amountRange[0] + Math.random() * (pattern.amountRange[1] - pattern.amountRange[0]);
      amt += Math.random() * 99 + 0.01; // Avoid round numbers
      
      if (recentAmts.length > 0) {
        const last = recentAmts[recentAmts.length - 1];
        if (Math.abs(amt - last) < last * 0.05) {
          amt += (Math.random() > 0.5 ? 1 : -1) * (last * 0.15 + Math.random() * 100);
        }
      }
      
      amt = Math.max(COMPLIANCE_THRESHOLDS.OPTIMAL_SINGLE_TRANSACTION.MIN, 
                     Math.min(COMPLIANCE_THRESHOLDS.OPTIMAL_SINGLE_TRANSACTION.MAX, amt));
      
      if (vol + amt > targetVolume) break;
      
      // Chain selection - anti-circular
      let ch: ChainId;
      if (firstChain === null) {
        ch = pattern.chainPreference[Math.floor(Math.random() * pattern.chainPreference.length)];
        firstChain = ch;
      } else {
        const safe = pattern.chainPreference.filter(c => c !== firstChain);
        ch = safe.length > 0 ? safe[Math.floor(Math.random() * safe.length)] : pattern.chainPreference[0];
      }
      
      // Time with variance
      const delay = pattern.timeRange[0] + Math.random() * (pattern.timeRange[1] - pattern.timeRange[0]);
      ts += delay + (Math.random() - 0.5) * 10000;
      
      txs.push({
        amt: Math.round(amt * 100) / 100,
        ex: pattern.exchangePreference[Math.floor(Math.random() * pattern.exchangePreference.length)],
        ch,
        ts,
        type: Math.random() > 0.3 ? 'swap' : 'buy',
      });
      
      recentAmts.push(amt);
      if (recentAmts.length > 5) recentAmts.shift();
      vol += amt;
    }
    
    return txs;
  }

  private checkViolations(txs: Array<{amt: number; ex: string; ch: ChainId; ts: number; type: string}>): string[] {
    const v: string[] = [];
    if (txs.length === 0) return v;
    
    const vol = txs.reduce((s, t) => s + t.amt, 0);
    const avgAmt = vol / txs.length;
    const times = txs.slice(1).map((t, i) => t.ts - txs[i].ts);
    const avgTime = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 60000;
    
    // Key violations
    const justBelow = txs.filter(t => t.amt >= 9000 && t.amt < 10000).length;
    if (justBelow >= 2) v.push('AMT_001');
    
    const rounds = txs.filter(t => t.amt === Math.round(t.amt / 100) * 100).length;
    if (rounds >= 4) v.push('STRUCT_003');
    
    let consecAmt = 1, maxConAmt = 1;
    for (let i = 1; i < txs.length; i++) {
      if (Math.abs(txs[i].amt - txs[i-1].amt) < txs[i-1].amt * 0.05) { consecAmt++; maxConAmt = Math.max(maxConAmt, consecAmt); }
      else consecAmt = 1;
    }
    if (maxConAmt >= 3) v.push('STRUCT_004');
    
    // Circular flow
    const chs = txs.map(t => t.ch);
    if (chs.length >= 4 && chs[0] === chs[chs.length-1] && new Set(chs).size >= 3) v.push('PATT_006');
    
    // Mechanical pattern
    if (times.length >= 5) {
      const tVar = Math.sqrt(times.reduce((s, t) => s + Math.pow(t - avgTime, 2), 0) / times.length);
      if (tVar / avgTime < 0.15) v.push('PATT_001');
    }
    
    return v;
  }

  // ==========================================================================
  // MESH LEARNING & COORDINATION
  // ==========================================================================

  /**
   * Propagate learning across mesh nodes
   */
  private propagateLearning(): void {
    for (const [nodeId, node] of this.nodes) {
      // Share successful patterns with connected nodes
      for (const connId of node.connections) {
        const connNode = this.nodes.get(connId);
        if (!connNode) continue;
        
        // Share top patterns
        const topPatterns = node.state.successfulPatterns
          .filter(p => p.successRate > 0.8)
          .slice(0, 5);
        
        for (const pattern of topPatterns) {
          if (!connNode.state.successfulPatterns.some(p => p.id === pattern.id)) {
            connNode.state.successfulPatterns.push({ ...pattern, usageCount: 0 });
          }
        }
        
        // Share violation memory
        for (const [violation, count] of node.state.violationMemory) {
          const existing = connNode.state.violationMemory.get(violation) || 0;
          connNode.state.violationMemory.set(violation, Math.max(existing, count));
        }
      }
      
      // Update strategy weights based on violation memory
      this.updateStrategyWeights(node);
    }
  }

  private updateStrategyWeights(node: MeshNode): void {
    const totalViolations = Array.from(node.state.violationMemory.values()).reduce((a, b) => a + b, 0);
    if (totalViolations === 0) return;
    
    // Reduce weight for strategies that cause violations
    const structuringViolations = ['STRUCT_001', 'STRUCT_002', 'STRUCT_003', 'STRUCT_004']
      .reduce((sum, v) => sum + (node.state.violationMemory.get(v) || 0), 0);
    
    if (structuringViolations > totalViolations * 0.3) {
      const currentWeight = node.state.strategyWeights.get('aggressive') || 1;
      node.state.strategyWeights.set('aggressive', currentWeight * 0.9);
      node.state.strategyWeights.set('stealth', (node.state.strategyWeights.get('stealth') || 1) * 1.1);
    }
    
    const patternViolations = ['PATT_001', 'PATT_006']
      .reduce((sum, v) => sum + (node.state.violationMemory.get(v) || 0), 0);
    
    if (patternViolations > totalViolations * 0.3) {
      node.state.strategyWeights.set('burst', (node.state.strategyWeights.get('burst') || 1) * 0.8);
      node.state.strategyWeights.set('moderate', (node.state.strategyWeights.get('moderate') || 1) * 1.1);
    }
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  /**
   * Get optimal transaction plan using Monte Carlo learning
   */
  async getOptimalPlan(targetVolume: number): Promise<{
    pattern: StrategyPattern;
    confidence: number;
    expectedViolationRate: number;
  }> {
    const pattern = await this.runMonteCarloSimulation(targetVolume);
    
    // Calculate confidence based on historical performance
    const similarPatterns = this.globalState.successfulPatterns.filter(p =>
      Math.abs(p.amountRange[0] - pattern.amountRange[0]) < 100
    );
    
    const avgSuccessRate = similarPatterns.length > 0
      ? similarPatterns.reduce((s, p) => s + p.successRate, 0) / similarPatterns.length
      : 0.5;
    
    const totalViolations = Array.from(this.globalState.violationMemory.values()).reduce((a, b) => a + b, 0);
    const expectedViolationRate = totalViolations > 0
      ? totalViolations / (this.globalState.iteration * this.MONTE_CARLO_ITERATIONS)
      : 0;
    
    return {
      pattern,
      confidence: avgSuccessRate,
      expectedViolationRate: Math.min(expectedViolationRate, 0.05), // Cap at 5%
    };
  }

  /**
   * Execute transaction using learned optimal strategy
   */
  async executeWithLearning(
    targetAmount: number,
    chain: ChainId,
    expectedProfit: number
  ): Promise<boolean> {
    const plan = await this.getOptimalPlan(targetAmount);
    
    // Use facet handler with learned parameters
    const tx = await this.facetHandler.planTransaction(
      targetAmount * (plan.pattern.amountRange[0] / 500), // Scale based on learned range
      chain,
      expectedProfit,
      plan.confidence
    );
    
    if (!tx) return false;
    
    // Record result for learning
    const success = await this.facetHandler.executeTransaction(tx);
    
    // Update learning state
    if (success) {
      this.globalState.cumulativeReward += 10;
      this.globalState.rewardHistory.push(10);
    } else {
      this.globalState.cumulativeReward -= 5;
      this.globalState.rewardHistory.push(-5);
    }
    
    // Keep history bounded
    if (this.globalState.rewardHistory.length > 1000) {
      this.globalState.rewardHistory.shift();
    }
    
    // Periodically propagate learning
    if (this.globalState.iteration % 10 === 0) {
      this.propagateLearning();
    }
    
    return success;
  }

  /**
   * Start continuous learning loop
   */
  startLearning(): void {
    if (this.isLearning) return;
    this.isLearning = true;
    
    this.learningInterval = setInterval(() => {
      this.runMonteCarloSimulation(COMPLIANCE_THRESHOLDS.DISTRIBUTION.MAX_DAILY_VOLUME || 7500)
        .catch(e => logger.warn('Learning iteration failed', { error: String(e) }));
    }, 60000); // Learn every minute
    
    logger.info('FaucetMesh learning started', { component: 'FaucetMesh' });
  }

  /**
   * Stop learning loop
   */
  stopLearning(): void {
    this.isLearning = false;
    if (this.learningInterval) {
      clearInterval(this.learningInterval);
      this.learningInterval = null;
    }
    logger.info('FaucetMesh learning stopped', { component: 'FaucetMesh' });
  }

  /**
   * Get current learning state
   */
  getState(): {
    globalState: MonteCarloState;
    meshNodes: number;
    totalPatterns: number;
    avgReward: number;
  } {
    const avgReward = this.globalState.rewardHistory.length > 0
      ? this.globalState.rewardHistory.reduce((a, b) => a + b, 0) / this.globalState.rewardHistory.length
      : 0;
    
    return {
      globalState: this.globalState,
      meshNodes: this.nodes.size,
      totalPatterns: this.globalState.successfulPatterns.length,
      avgReward,
    };
  }
}

// Singleton instance
let faucetMesh: HigherOrderFaucetMesh | null = null;

export function getFaucetMesh(): HigherOrderFaucetMesh {
  if (!faucetMesh) {
    faucetMesh = new HigherOrderFaucetMesh();
  }
  return faucetMesh;
}

export { HigherOrderFaucetMesh as default };
