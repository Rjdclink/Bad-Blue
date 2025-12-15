/**
 * Monte Carlo Real-World Calibration System
 * 
 * Calibrates Monte Carlo models using real-world measurements:
 * - Latency model (p50/p90/p95)
 * - Slippage model (by pair + size bucket)
 * - Fill model (maker fill probability + partial fill rate)
 * - Failure model (reject/timeout rate + retry impact)
 * - Regime model (volatility buckets: low/med/high)
 * 
 * Measurements are captured per order and aggregated for calibration
 */

import { createLogger } from '../logger';

const log = createLogger('MonteCarloCalibration');

// ============================================================================
// TYPES
// ============================================================================

export interface OrderMeasurement {
  timestamp_send: number;
  timestamp_ack?: number;
  timestamp_fill?: number;
  pair: string;
  side: 'buy' | 'sell';
  type: 'maker' | 'taker';
  requested_price: number;
  avg_fill_price?: number;
  qty_requested: number;
  qty_filled: number;
  fees_paid: number;
  slippage_bps_realized: number;
  order_result: 'filled' | 'partial' | 'cancel' | 'reject' | 'timeout';
}

export interface LatencyModel {
  p50: number;
  p90: number;
  p95: number;
}

export interface SlippageModel {
  pair: string;
  sizeBucket: 'small' | 'medium' | 'large' | 'xlarge';
  p50: number;
  p90: number;
  p95: number;
}

export interface FillModel {
  pair: string;
  maker_fill_probability: number;
  partial_fill_rate: number;
}

export interface FailureModel {
  reject_rate: number;
  timeout_rate: number;
  retry_impact: number;
}

export interface RegimeModel {
  current: 'low' | 'medium' | 'high';
  volatility_threshold_low: number;
  volatility_threshold_high: number;
}

export interface CalibrationSnapshot {
  run_id: string;
  timestamp: number;
  latency: LatencyModel;
  slippage: SlippageModel[];
  fill: FillModel[];
  failure: FailureModel;
  regime: RegimeModel;
  sample_size: number;
  frozen: boolean;
}

export interface ValidationResult {
  pass: boolean;
  latency_pass: boolean;
  slippage_pass: boolean;
  fill_pass: boolean;
  failure_pass: boolean;
  details: {
    latency_within_p95: number;
    slippage_within_p95: number;
    fill_rate_accuracy: number;
    failure_rate_accuracy: number;
  };
}

// ============================================================================
// CALIBRATION ENGINE
// ============================================================================

export class MonteCarloCalibrationEngine {
  private measurements: OrderMeasurement[] = [];
  private currentSnapshot: CalibrationSnapshot | null = null;
  private validationHistory: ValidationResult[] = [];
  private frozen: boolean = false;

  constructor() {
    log.info('Monte Carlo Calibration Engine initialized');
  }

  /**
   * Record a new order measurement
   */
  recordMeasurement(measurement: OrderMeasurement): void {
    if (this.frozen) {
      log.warn('Cannot record measurement - calibration is frozen');
      return;
    }

    this.measurements.push(measurement);
    log.debug('Measurement recorded', {
      pair: measurement.pair,
      result: measurement.order_result,
      slippage: measurement.slippage_bps_realized,
    });

    // Auto-calibrate after every 200 measurements
    if (this.measurements.length % 200 === 0) {
      this.calibrate();
    }
  }

  /**
   * Calibrate models based on recent measurements
   */
  calibrate(sampleSize: number = 200): CalibrationSnapshot {
    const recentMeasurements = this.measurements.slice(-sampleSize);

    if (recentMeasurements.length === 0) {
      throw new Error('No measurements available for calibration');
    }

    log.info('Calibrating Monte Carlo models', {
      sampleSize: recentMeasurements.length,
    });

    // Calculate latency model
    const latency = this.calculateLatencyModel(recentMeasurements);

    // Calculate slippage models by pair/size
    const slippage = this.calculateSlippageModels(recentMeasurements);

    // Calculate fill models
    const fill = this.calculateFillModels(recentMeasurements);

    // Calculate failure model
    const failure = this.calculateFailureModel(recentMeasurements);

    // Determine regime
    const regime = this.determineRegime(recentMeasurements);

    this.currentSnapshot = {
      run_id: this.generateRunId(),
      timestamp: Date.now(),
      latency,
      slippage,
      fill,
      failure,
      regime,
      sample_size: recentMeasurements.length,
      frozen: false,
    };

    log.info('Calibration complete', {
      run_id: this.currentSnapshot.run_id,
      latency_p50: latency.p50,
      latency_p95: latency.p95,
      pairs: slippage.length,
    });

    return this.currentSnapshot;
  }

  /**
   * Freeze current calibration (no updates until unfrozen)
   */
  freeze(): void {
    if (this.currentSnapshot) {
      this.frozen = true;
      this.currentSnapshot.frozen = true;
      log.info('Calibration frozen', { run_id: this.currentSnapshot.run_id });
    }
  }

  /**
   * Unfreeze calibration
   */
  unfreeze(): void {
    this.frozen = false;
    if (this.currentSnapshot) {
      this.currentSnapshot.frozen = false;
    }
    log.info('Calibration unfrozen');
  }

  /**
   * Validate real-world performance against predicted model
   */
  validate(recentAttempts: OrderMeasurement[]): ValidationResult {
    if (!this.currentSnapshot) {
      throw new Error('No calibration snapshot available for validation');
    }

    const latencyCheck = this.validateLatency(recentAttempts);
    const slippageCheck = this.validateSlippage(recentAttempts);
    const fillCheck = this.validateFillRates(recentAttempts);
    const failureCheck = this.validateFailureRates(recentAttempts);

    const result: ValidationResult = {
      pass: latencyCheck.pass && slippageCheck.pass && fillCheck.pass && failureCheck.pass,
      latency_pass: latencyCheck.pass,
      slippage_pass: slippageCheck.pass,
      fill_pass: fillCheck.pass,
      failure_pass: failureCheck.pass,
      details: {
        latency_within_p95: latencyCheck.within_p95,
        slippage_within_p95: slippageCheck.within_p95,
        fill_rate_accuracy: fillCheck.accuracy,
        failure_rate_accuracy: failureCheck.accuracy,
      },
    };

    this.validationHistory.push(result);

    log.info('Validation complete', {
      pass: result.pass,
      latency_pass: result.latency_pass,
      slippage_pass: result.slippage_pass,
    });

    return result;
  }

  /**
   * Get current calibration snapshot
   */
  getSnapshot(): CalibrationSnapshot | null {
    return this.currentSnapshot;
  }

  /**
   * Get validation history
   */
  getValidationHistory(): ValidationResult[] {
    return this.validationHistory;
  }

  /**
   * Clear all measurements and reset
   */
  reset(): void {
    this.measurements = [];
    this.currentSnapshot = null;
    this.validationHistory = [];
    this.frozen = false;
    log.info('Calibration engine reset');
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private calculateLatencyModel(measurements: OrderMeasurement[]): LatencyModel {
    const latencies = measurements
      .filter(m => m.timestamp_ack !== undefined)
      .map(m => m.timestamp_ack! - m.timestamp_send);

    return {
      p50: this.percentile(latencies, 50),
      p90: this.percentile(latencies, 90),
      p95: this.percentile(latencies, 95),
    };
  }

  private calculateSlippageModels(measurements: OrderMeasurement[]): SlippageModel[] {
    const models: SlippageModel[] = [];
    const pairBuckets = this.groupByPairAndSize(measurements);

    for (const [key, bucket] of Object.entries(pairBuckets)) {
      const [pair, sizeBucket] = key.split(':');
      const slippages = bucket.map(m => m.slippage_bps_realized);

      models.push({
        pair,
        sizeBucket: sizeBucket as 'small' | 'medium' | 'large' | 'xlarge',
        p50: this.percentile(slippages, 50),
        p90: this.percentile(slippages, 90),
        p95: this.percentile(slippages, 95),
      });
    }

    return models;
  }

  private calculateFillModels(measurements: OrderMeasurement[]): FillModel[] {
    const models: FillModel[] = [];
    const byPair = this.groupByPair(measurements);

    for (const [pair, bucket] of Object.entries(byPair)) {
      const makerOrders = bucket.filter(m => m.type === 'maker');
      const filled = makerOrders.filter(m => m.order_result === 'filled').length;
      const partial = makerOrders.filter(m => m.order_result === 'partial').length;

      models.push({
        pair,
        maker_fill_probability: makerOrders.length > 0 ? filled / makerOrders.length : 0,
        partial_fill_rate: makerOrders.length > 0 ? partial / makerOrders.length : 0,
      });
    }

    return models;
  }

  private calculateFailureModel(measurements: OrderMeasurement[]): FailureModel {
    const rejects = measurements.filter(m => m.order_result === 'reject').length;
    const timeouts = measurements.filter(m => m.order_result === 'timeout').length;
    const total = measurements.length;

    return {
      reject_rate: total > 0 ? rejects / total : 0,
      timeout_rate: total > 0 ? timeouts / total : 0,
      retry_impact: 0.05, // Placeholder: 5% additional delay per retry
    };
  }

  private determineRegime(measurements: OrderMeasurement[]): RegimeModel {
    // Calculate price volatility (simplified)
    const prices = measurements.map(m => m.avg_fill_price || m.requested_price);
    const volatility = this.calculateVolatility(prices);

    let current: 'low' | 'medium' | 'high' = 'medium';
    if (volatility < 0.02) current = 'low';
    else if (volatility > 0.05) current = 'high';

    return {
      current,
      volatility_threshold_low: 0.02,
      volatility_threshold_high: 0.05,
    };
  }

  private validateLatency(attempts: OrderMeasurement[]): { pass: boolean; within_p95: number } {
    if (!this.currentSnapshot) {
      return { pass: false, within_p95: 0 };
    }

    const latencies = attempts
      .filter(m => m.timestamp_ack !== undefined)
      .map(m => m.timestamp_ack! - m.timestamp_send);

    const withinP95 = latencies.filter(l => l <= this.currentSnapshot.latency.p95).length;
    const rate = latencies.length > 0 ? withinP95 / latencies.length : 0;

    return {
      pass: rate >= 0.90,
      within_p95: rate,
    };
  }

  private validateSlippage(attempts: OrderMeasurement[]): { pass: boolean; within_p95: number } {
    if (!this.currentSnapshot) {
      return { pass: false, within_p95: 0 };
    }

    const pairBuckets = this.groupByPairAndSize(attempts);
    let totalChecks = 0;
    let passedChecks = 0;

    for (const [key, bucket] of Object.entries(pairBuckets)) {
      const [pair, sizeBucket] = key.split(':');
      const model = this.currentSnapshot.slippage.find(
        m => m.pair === pair && m.sizeBucket === sizeBucket
      );

      if (model) {
        const slippages = bucket.map(m => m.slippage_bps_realized);
        const withinP95 = slippages.filter(s => s <= model.p95).length;
        totalChecks += slippages.length;
        passedChecks += withinP95;
      }
    }

    const rate = totalChecks > 0 ? passedChecks / totalChecks : 0;

    return {
      pass: rate >= 0.90,
      within_p95: rate,
    };
  }

  private validateFillRates(attempts: OrderMeasurement[]): { pass: boolean; accuracy: number } {
    if (!this.currentSnapshot) {
      return { pass: false, accuracy: 0 };
    }

    const byPair = this.groupByPair(attempts);
    let totalAccuracy = 0;
    let pairCount = 0;

    for (const [pair, bucket] of Object.entries(byPair)) {
      const model = this.currentSnapshot.fill.find(m => m.pair === pair);
      if (model) {
        const makerOrders = bucket.filter(m => m.type === 'maker');
        const actualFillRate = makerOrders.filter(m => m.order_result === 'filled').length / makerOrders.length;
        const diff = Math.abs(actualFillRate - model.maker_fill_probability);
        totalAccuracy += 1 - diff;
        pairCount++;
      }
    }

    const accuracy = pairCount > 0 ? totalAccuracy / pairCount : 0;

    return {
      pass: accuracy >= 0.85,
      accuracy,
    };
  }

  private validateFailureRates(attempts: OrderMeasurement[]): { pass: boolean; accuracy: number } {
    if (!this.currentSnapshot) {
      return { pass: false, accuracy: 0 };
    }

    const actualRejectRate = attempts.filter(m => m.order_result === 'reject').length / attempts.length;
    const actualTimeoutRate = attempts.filter(m => m.order_result === 'timeout').length / attempts.length;

    const rejectDiff = Math.abs(actualRejectRate - this.currentSnapshot.failure.reject_rate);
    const timeoutDiff = Math.abs(actualTimeoutRate - this.currentSnapshot.failure.timeout_rate);

    const accuracy = 1 - (rejectDiff + timeoutDiff) / 2;

    return {
      pass: accuracy >= 0.85,
      accuracy,
    };
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private groupByPairAndSize(measurements: OrderMeasurement[]): Record<string, OrderMeasurement[]> {
    const groups: Record<string, OrderMeasurement[]> = {};

    for (const m of measurements) {
      const sizeBucket = this.getSizeBucket(m.qty_requested);
      const key = `${m.pair}:${sizeBucket}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    }

    return groups;
  }

  private groupByPair(measurements: OrderMeasurement[]): Record<string, OrderMeasurement[]> {
    const groups: Record<string, OrderMeasurement[]> = {};

    for (const m of measurements) {
      if (!groups[m.pair]) groups[m.pair] = [];
      groups[m.pair].push(m);
    }

    return groups;
  }

  private getSizeBucket(qty: number): 'small' | 'medium' | 'large' | 'xlarge' {
    if (qty < 100) return 'small';
    if (qty < 1000) return 'medium';
    if (qty < 10000) return 'large';
    return 'xlarge';
  }

  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;

    return Math.sqrt(variance);
  }

  private generateRunId(): string {
    return `cal_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let calibrationEngine: MonteCarloCalibrationEngine | null = null;

export function getCalibrationEngine(): MonteCarloCalibrationEngine {
  if (!calibrationEngine) {
    calibrationEngine = new MonteCarloCalibrationEngine();
  }
  return calibrationEngine;
}

export default { MonteCarloCalibrationEngine, getCalibrationEngine };
