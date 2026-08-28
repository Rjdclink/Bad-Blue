// Legacy compatibility surface only.
//
// The former HigherOrderFaucetMesh generated simulated transactions and optimized
// synthetic strategy patterns. It is not measured market intelligence, Monte Carlo
// risk evidence, an execution scheduler, or a compliance authority. Canonical
// CryptoCrawler uses verified opportunities, Cryptara, QuantiComp/Hyper Monte Carlo,
// governed execution, and terminal settlement feedback.

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
  chainPreference: string[];
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

/** @deprecated Synthetic mesh retired from runtime authority. */
export class HigherOrderFaucetMesh {
  async runMonteCarloSimulation(_targetVolume: number): Promise<StrategyPattern> {
    throw new Error('Legacy synthetic HigherOrderFaucetMesh is retired; use canonical measured Hyper Monte Carlo');
  }

  startLearning(): void {
    throw new Error('Legacy synthetic HigherOrderFaucetMesh learning is retired');
  }

  stopLearning(): void {
    // Compatibility-safe no-op: there is no legacy learning loop to stop.
  }

  getState(): Readonly<MonteCarloState> {
    return {
      iteration: 0,
      explorationRate: 0,
      learningRate: 0,
      strategyWeights: new Map(),
      violationMemory: new Map(),
      successfulPatterns: [],
      rewardHistory: [],
      cumulativeReward: 0,
    };
  }
}

let faucetMesh: HigherOrderFaucetMesh | null = null;

export function getFaucetMesh(): HigherOrderFaucetMesh {
  if (!faucetMesh) faucetMesh = new HigherOrderFaucetMesh();
  return faucetMesh;
}

export default HigherOrderFaucetMesh;
