// Automatic Rate-Limiting System - CPU-Aware Adaptive Throttling
// Implements sigmoid burst probability, recursive rate expansion, and exponential backoff
// Optimized for 62-78% CPU utilization sweet spot

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface AutoRateLimitConfig {
  cpuLowerBound: number;           // Default: 0.62 (62%)
  cpuUpperBound: number;           // Default: 0.78 (78%)
  cpuEquilibriumPivot: number;     // Default: 0.70 (70%)
  sigmoidK: number;                // Default: 14 (extremely responsive)
  baseRequestsPerSecond: number;
  maxRequestsPerSecond: number;
  minRequestsPerSecond: number;
  starburstBaseDelayMs: number;    // Default: 5ms
  starburstBackoffFactor: number;  // Default: 1.35
  maxStarburstWaves: number;
  samplingIntervalMs: number;
  smoothingFactor: number;
}

export interface RateLimitState {
  currentRate: number;
  cpuUtilization: number;
  burstProbability: number;
  waveNumber: number;
  currentDelay: number;
  throttleMode: 'expanding' | 'contracting' | 'stable';
  lastAdjustment: number;
  totalRequests: number;
  throttledRequests: number;
  efficiency: number;
}

export interface StarburstWaveConfig {
  waveNumber: number;
  delay: number;
  maxReplicas: number;
  cpuBudget: number;
}

export const DEFAULT_AUTO_RATE_CONFIG: AutoRateLimitConfig = {
  cpuLowerBound: 0.62,
  cpuUpperBound: 0.78,
  cpuEquilibriumPivot: 0.70,
  sigmoidK: 14,
  baseRequestsPerSecond: 25,
  maxRequestsPerSecond: 100,
  minRequestsPerSecond: 1,
  starburstBaseDelayMs: 5,
  starburstBackoffFactor: 1.35,
  maxStarburstWaves: 20,
  samplingIntervalMs: 100,
  smoothingFactor: 0.3
};

// ============================================================================
// SIGMOID BURST PROBABILITY: P(burst) = 1 / (1 + e^(-k(U - 0.70)))
// ============================================================================

export function calculateBurstProbability(cpuUtilization: number, k: number = 14, pivot: number = 0.70): number {
  const exponent = -k * (cpuUtilization - pivot);
  return 1 - (1 / (1 + Math.exp(exponent)));
}

// ============================================================================
// RECURSIVE RATE EXPANSION: NewRate = OldRate × (1 + (0.78 - U))
// ============================================================================

export function calculateNewRate(oldRate: number, cpuUtilization: number, upperBound: number = 0.78): number {
  return oldRate * (1 + (upperBound - cpuUtilization));
}

// ============================================================================
// STARBURST WAVE TIMING: Delay(n) = 5ms × 1.35^n
// ============================================================================

export function calculateWaveDelay(waveNumber: number, baseDelay: number = 5, backoffFactor: number = 1.35): number {
  return baseDelay * Math.pow(backoffFactor, waveNumber);
}

// ============================================================================
// AUTOMATIC RATE LIMITER
// ============================================================================

export class AutomaticRateLimiter {
  private config: AutoRateLimitConfig;
  private state: RateLimitState;
  private requestTimestamps: number[] = [];
  private isRunning: boolean = false;
  private monitorInterval: NodeJS.Timeout | null = null;
  private smoothedCpu: number = 0.5;
  private activeRequests: number = 0;

  constructor(config: Partial<AutoRateLimitConfig> = {}) {
    this.config = { ...DEFAULT_AUTO_RATE_CONFIG, ...config };
    this.state = {
      currentRate: this.config.baseRequestsPerSecond,
      cpuUtilization: 0.5,
      burstProbability: 0.5,
      waveNumber: 0,
      currentDelay: this.config.starburstBaseDelayMs,
      throttleMode: 'stable',
      lastAdjustment: Date.now(),
      totalRequests: 0,
      throttledRequests: 0,
      efficiency: 1.0
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.monitorInterval = setInterval(() => this.adjustRates(), this.config.samplingIntervalMs);
    logger.info('Automatic Rate Limiter started', { component: 'AutomaticRateLimiter' });
  }

  stop(): void {
    if (this.monitorInterval) clearInterval(this.monitorInterval);
    this.isRunning = false;
  }

  private adjustRates(): void {
    // Sample CPU (simulated based on active requests)
    const rawCpu = Math.min(1, this.activeRequests / 50 + 0.3 + (Math.random() - 0.5) * 0.1);
    this.smoothedCpu = this.config.smoothingFactor * rawCpu + (1 - this.config.smoothingFactor) * this.smoothedCpu;
    
    // Calculate burst probability using sigmoid
    const burstProb = calculateBurstProbability(this.smoothedCpu, this.config.sigmoidK, this.config.cpuEquilibriumPivot);
    
    // Calculate new rate using recursive expansion
    let newRate = calculateNewRate(this.state.currentRate, this.smoothedCpu, this.config.cpuUpperBound);
    newRate = Math.max(this.config.minRequestsPerSecond, Math.min(this.config.maxRequestsPerSecond, newRate));
    
    // Smooth rate transition
    this.state.currentRate = this.config.smoothingFactor * newRate + (1 - this.config.smoothingFactor) * this.state.currentRate;
    
    // Update state
    const distance = this.smoothedCpu - this.config.cpuEquilibriumPivot;
    this.state.cpuUtilization = this.smoothedCpu;
    this.state.burstProbability = burstProb;
    this.state.throttleMode = distance < -0.05 ? 'expanding' : distance > 0.05 ? 'contracting' : 'stable';
    this.state.lastAdjustment = Date.now();
    this.state.efficiency = Math.max(0, 1 - Math.abs(this.smoothedCpu - 0.70) * 5);
  }

  async canProceed(): Promise<boolean> {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter(ts => now - ts < 1000);
    
    if (this.requestTimestamps.length >= this.state.currentRate) {
      this.state.throttledRequests++;
      return false;
    }
    
    if (Math.random() > this.state.burstProbability) {
      this.state.throttledRequests++;
      return false;
    }
    
    return true;
  }

  recordRequest(): void {
    this.requestTimestamps.push(Date.now());
    this.state.totalRequests++;
    this.activeRequests++;
    setTimeout(() => { this.activeRequests = Math.max(0, this.activeRequests - 1); }, 100);
  }

  async waitForSlot(): Promise<void> {
    while (!(await this.canProceed())) {
      await new Promise(resolve => setTimeout(resolve, this.state.currentDelay + Math.random() * 10));
    }
  }

  getNextStarburstWave(): StarburstWaveConfig {
    const delay = calculateWaveDelay(this.state.waveNumber, this.config.starburstBaseDelayMs, this.config.starburstBackoffFactor);
    const cpuHeadroom = this.config.cpuUpperBound - this.state.cpuUtilization;
    
    const config: StarburstWaveConfig = {
      waveNumber: this.state.waveNumber,
      delay: cpuHeadroom < 0.05 ? delay * 3 : cpuHeadroom > 0.20 ? delay * 0.7 : delay,
      maxReplicas: Math.max(1, Math.floor(cpuHeadroom * 100)),
      cpuBudget: cpuHeadroom * 0.5
    };
    
    this.state.waveNumber = (this.state.waveNumber + 1) % this.config.maxStarburstWaves;
    this.state.currentDelay = config.delay;
    
    return config;
  }

  getState(): RateLimitState { return { ...this.state }; }
  
  emergencyThrottle(): void {
    this.state.currentRate = this.config.minRequestsPerSecond;
    this.state.throttleMode = 'contracting';
  }

  emergencyBurst(): void {
    this.state.currentRate = this.config.maxRequestsPerSecond;
    this.state.throttleMode = 'expanding';
  }

  reset(): void {
    this.requestTimestamps = [];
    this.state = {
      currentRate: this.config.baseRequestsPerSecond,
      cpuUtilization: 0.5,
      burstProbability: 0.5,
      waveNumber: 0,
      currentDelay: this.config.starburstBaseDelayMs,
      throttleMode: 'stable',
      lastAdjustment: Date.now(),
      totalRequests: 0,
      throttledRequests: 0,
      efficiency: 1.0
    };
  }
}

export const autoRateLimiter = new AutomaticRateLimiter();
