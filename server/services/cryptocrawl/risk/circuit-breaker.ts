/**
 * LEGACY COMPATIBILITY SHELL — risk/CircuitBreaker
 *
 * CryptoCrawler has a canonical governance/risk authority under `governance/`.
 * This older standalone breaker carried a second profit threshold, position
 * accounting, and automatic recovery authority. It is retired and fails closed.
 */

export type ChainId = 'polygon' | 'bsc' | 'avalanche' | 'arbitrum' | 'optimism' | string;
export type BreakerLevel = 'green' | 'yellow' | 'orange' | 'red';

export interface CircuitBreakerConfig {
  maxDailyLoss: number;
  maxHourlyLoss: number;
  maxConsecutiveLosses: number;
  maxPositionSize: number;
  maxTotalExposure: number;
  maxPositionsPerChain: number;
  maxExecutionsPerMinute: number;
  maxSlippage: number;
  minProfitThreshold: number;
  recoveryPeriodMs: number;
  gradualRecoverySteps: number;
}

export interface BreakerMetrics {
  dailyPnL: number;
  hourlyPnL: number;
  consecutiveLosses: number;
  totalExposure: number;
  executionsLastMinute: number;
  executionsLastHour: number;
  lastExecutionTime: number;
  positionsPerChain: Record<string, number>;
}

export interface BreakerState {
  status: 'active' | 'paused' | 'halted' | 'recovering';
  level: BreakerLevel;
  triggeredAt?: number;
  triggerReason?: string;
  recoveryProgress: number;
  metrics: BreakerMetrics;
}

export interface ExecutionRecord {
  timestamp: number;
  pnl: number;
  chain: ChainId;
  size: number;
}

const RETIRED_REASON = 'Legacy standalone risk breaker retired; canonical governance/risk authority required';

class CircuitBreaker {
  constructor(_config: Partial<CircuitBreakerConfig> = {}) {}

  canExecute(_params: {
    chain: ChainId;
    size: number;
    expectedProfit: number;
    expectedSlippage: number;
  }): { allowed: boolean; reason?: string } {
    return { allowed: false, reason: RETIRED_REASON };
  }

  openPosition(_chain: ChainId, _size: number): string {
    throw new Error(RETIRED_REASON);
  }

  recordExecution(_result: { chain: ChainId; size: number; pnl: number; success: boolean }): void {
    // Compatibility no-op; canonical settlement feedback owns realized outcomes.
  }

  closePosition(_chain: ChainId, _size: number): void {}
  releasePosition(_chain: ChainId, _size: number): void {}

  reset(_confirm: boolean): boolean {
    return false;
  }

  getState(): Readonly<BreakerState> {
    return {
      status: 'halted',
      level: 'red',
      triggerReason: RETIRED_REASON,
      recoveryProgress: 0,
      metrics: {
        dailyPnL: 0,
        hourlyPnL: 0,
        consecutiveLosses: 0,
        totalExposure: 0,
        executionsLastMinute: 0,
        executionsLastHour: 0,
        lastExecutionTime: 0,
        positionsPerChain: {},
      },
    };
  }

  getHistory(_hours: number = 24): ExecutionRecord[] {
    return [];
  }
}

export { CircuitBreaker };
export default CircuitBreaker;
