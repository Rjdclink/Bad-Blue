/**
 * LEXARA OPTIMIZATION SCHEDULER
 * 
 * Manages the execution cadence for Lexara's Monte Carlo optimization cycles.
 * 
 * Execution Cadence:
 * - Three scheduled optimization cycles per day
 * - Deliberately staggered between other Monte Carlo runs
 * - Prevents overlap and resource contention
 * 
 * Default Schedule:
 * - 02:00 UTC - Night cycle (low traffic period)
 * - 10:00 UTC - Morning cycle (before peak usage)
 * - 18:00 UTC - Evening cycle (after peak usage)
 * 
 * Safety Constraints:
 * - Never introduces latency during user interactions
 * - Skips scheduled cycles if a cycle is already running
 * - Monitors system load before initiating cycles
 */

import { EventEmitter } from 'events';
import { createLogger } from '../logger';
import {
  lexaraMCOptimizer,
  lexaraMCOptimizerEvents,
  type OptimizationCycleResult,
} from './LexaraMonteCarloOptimizer';

const log = createLogger('LexaraOptimizationScheduler');

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Scheduled Cycle Configuration
 */
export interface ScheduledCycle {
  id: string;
  name: string;
  hourUTC: number;
  minuteUTC: number;
  enabled: boolean;
  lastRun: Date | null;
  nextRun: Date | null;
  successCount: number;
  failureCount: number;
}

/**
 * Scheduler Configuration
 */
export interface SchedulerConfig {
  /** Enable/disable the scheduler */
  enabled: boolean;
  /** Minimum interval between any two cycles in milliseconds */
  minIntervalMs: number;
  /** Maximum system load percentage to allow optimization */
  maxSystemLoadPercent: number;
  /** Time zone for logging (cycles always run on UTC) */
  logTimeZone: string;
  /** Whether to run missed cycles on startup */
  catchUpMissedCycles: boolean;
  /** Maximum time a cycle can run before being considered stuck */
  maxCycleDurationMs: number;
}

/**
 * Scheduler State
 */
export interface SchedulerState {
  isActive: boolean;
  scheduledCycles: ScheduledCycle[];
  nextScheduledRun: Date | null;
  currentCycleId: string | null;
  totalScheduledRuns: number;
  totalSuccessfulRuns: number;
  totalFailedRuns: number;
  lastError: string | null;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default Schedule - Three cycles per day, staggered
 */
const DEFAULT_SCHEDULED_CYCLES: Omit<ScheduledCycle, 'lastRun' | 'nextRun' | 'successCount' | 'failureCount'>[] = [
  {
    id: 'night-cycle',
    name: 'Night Optimization Cycle',
    hourUTC: 2,
    minuteUTC: 0,
    enabled: true,
  },
  {
    id: 'morning-cycle',
    name: 'Morning Optimization Cycle',
    hourUTC: 10,
    minuteUTC: 0,
    enabled: true,
  },
  {
    id: 'evening-cycle',
    name: 'Evening Optimization Cycle',
    hourUTC: 18,
    minuteUTC: 0,
    enabled: true,
  },
];

/**
 * Default Scheduler Configuration
 */
const DEFAULT_CONFIG: SchedulerConfig = {
  enabled: true,
  minIntervalMs: 4 * 60 * 60 * 1000, // 4 hours minimum between cycles
  maxSystemLoadPercent: 80,
  logTimeZone: 'UTC',
  catchUpMissedCycles: false,
  maxCycleDurationMs: 30 * 60 * 1000, // 30 minutes max
};

// ============================================================================
// SCHEDULER ENGINE
// ============================================================================

export const schedulerEvents = new EventEmitter();

/**
 * Lexara Optimization Scheduler
 */
class LexaraOptimizationScheduler {
  private static instance: LexaraOptimizationScheduler;
  
  private config: SchedulerConfig;
  private state: SchedulerState;
  private checkInterval: NodeJS.Timeout | null = null;
  private cycleTimeout: NodeJS.Timeout | null = null;
  
  private constructor() {
    this.config = { ...DEFAULT_CONFIG };
    
    // Initialize scheduled cycles
    const cycles: ScheduledCycle[] = DEFAULT_SCHEDULED_CYCLES.map(cycle => ({
      ...cycle,
      lastRun: null,
      nextRun: this.calculateNextRun(cycle.hourUTC, cycle.minuteUTC),
      successCount: 0,
      failureCount: 0,
    }));
    
    this.state = {
      isActive: false,
      scheduledCycles: cycles,
      nextScheduledRun: this.findNextScheduledRun(cycles),
      currentCycleId: null,
      totalScheduledRuns: 0,
      totalSuccessfulRuns: 0,
      totalFailedRuns: 0,
      lastError: null,
    };
  }
  
  static getInstance(): LexaraOptimizationScheduler {
    if (!LexaraOptimizationScheduler.instance) {
      LexaraOptimizationScheduler.instance = new LexaraOptimizationScheduler();
    }
    return LexaraOptimizationScheduler.instance;
  }
  
  // ============================================================================
  // PUBLIC API
  // ============================================================================
  
  /**
   * Start the scheduler
   */
  start(): void {
    if (this.state.isActive) {
      log.warn('Scheduler already active');
      return;
    }
    
    if (!this.config.enabled) {
      log.info('Scheduler is disabled in configuration');
      return;
    }
    
    log.info('🗓️ Starting Lexara Optimization Scheduler');
    log.info('Scheduled cycles:', this.state.scheduledCycles.map(c => ({
      name: c.name,
      time: `${c.hourUTC.toString().padStart(2, '0')}:${c.minuteUTC.toString().padStart(2, '0')} UTC`,
      enabled: c.enabled,
    })));
    
    this.state.isActive = true;
    
    // Check every minute for scheduled cycles
    this.checkInterval = setInterval(() => this.checkSchedule(), 60 * 1000);
    
    // Initial check
    this.checkSchedule();
    
    schedulerEvents.emit('scheduler-started', { state: this.getState() });
  }
  
  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.state.isActive) {
      return;
    }
    
    log.info('Stopping Lexara Optimization Scheduler');
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    if (this.cycleTimeout) {
      clearTimeout(this.cycleTimeout);
      this.cycleTimeout = null;
    }
    
    this.state.isActive = false;
    
    schedulerEvents.emit('scheduler-stopped', { state: this.getState() });
  }
  
  /**
   * Configure the scheduler
   */
  configure(config: Partial<SchedulerConfig>): void {
    this.config = { ...this.config, ...config };
    log.info('Scheduler configured', this.config);
  }
  
  /**
   * Get current scheduler state
   */
  getState(): SchedulerState {
    return {
      ...this.state,
      scheduledCycles: [...this.state.scheduledCycles],
    };
  }
  
  /**
   * Enable/disable a specific cycle
   */
  setCycleEnabled(cycleId: string, enabled: boolean): boolean {
    const cycle = this.state.scheduledCycles.find(c => c.id === cycleId);
    if (!cycle) {
      return false;
    }
    
    cycle.enabled = enabled;
    this.updateNextScheduledRun();
    
    log.info(`Cycle ${cycleId} ${enabled ? 'enabled' : 'disabled'}`);
    return true;
  }
  
  /**
   * Update cycle time
   */
  setCycleTime(cycleId: string, hourUTC: number, minuteUTC: number): boolean {
    const cycle = this.state.scheduledCycles.find(c => c.id === cycleId);
    if (!cycle) {
      return false;
    }
    
    if (hourUTC < 0 || hourUTC > 23 || minuteUTC < 0 || minuteUTC > 59) {
      return false;
    }
    
    cycle.hourUTC = hourUTC;
    cycle.minuteUTC = minuteUTC;
    cycle.nextRun = this.calculateNextRun(hourUTC, minuteUTC);
    this.updateNextScheduledRun();
    
    log.info(`Cycle ${cycleId} time updated to ${hourUTC}:${minuteUTC} UTC`);
    return true;
  }
  
  /**
   * Force run a cycle immediately (for testing/admin)
   */
  async forceRunCycle(cycleId?: string): Promise<OptimizationCycleResult | null> {
    if (lexaraMCOptimizer.isRunning()) {
      log.warn('Cannot force run - optimization already in progress');
      return null;
    }
    
    const cycle = cycleId 
      ? this.state.scheduledCycles.find(c => c.id === cycleId)
      : this.state.scheduledCycles[0];
    
    if (!cycle) {
      return null;
    }
    
    log.info(`Force running cycle: ${cycle.name}`);
    return this.executeCycle(cycle);
  }
  
  /**
   * Get time until next scheduled run
   */
  getTimeUntilNextRun(): number | null {
    if (!this.state.nextScheduledRun) {
      return null;
    }
    return this.state.nextScheduledRun.getTime() - Date.now();
  }
  
  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================
  
  /**
   * Check if any scheduled cycle should run
   */
  private checkSchedule(): void {
    if (!this.state.isActive) {
      return;
    }
    
    const now = new Date();
    
    for (const cycle of this.state.scheduledCycles) {
      if (!cycle.enabled || !cycle.nextRun) {
        continue;
      }
      
      // Check if it's time to run this cycle
      if (now >= cycle.nextRun) {
        // Check minimum interval constraint
        if (this.checkMinInterval(cycle)) {
          this.triggerCycle(cycle);
        } else {
          log.debug(`Skipping cycle ${cycle.id} - too soon since last run`);
          // Update next run time
          cycle.nextRun = this.calculateNextRun(cycle.hourUTC, cycle.minuteUTC);
        }
      }
    }
    
    this.updateNextScheduledRun();
  }
  
  /**
   * Check if minimum interval has passed
   */
  private checkMinInterval(cycle: ScheduledCycle): boolean {
    if (!cycle.lastRun) {
      return true;
    }
    
    const elapsed = Date.now() - cycle.lastRun.getTime();
    return elapsed >= this.config.minIntervalMs;
  }
  
  /**
   * Trigger a scheduled cycle
   */
  private async triggerCycle(cycle: ScheduledCycle): Promise<void> {
    // Check if optimizer is already running
    if (lexaraMCOptimizer.isRunning()) {
      log.debug(`Skipping cycle ${cycle.id} - optimizer busy`);
      cycle.nextRun = this.calculateNextRun(cycle.hourUTC, cycle.minuteUTC);
      return;
    }
    
    // Check system load (simplified - in production would check actual metrics)
    const estimatedLoad = this.estimateSystemLoad();
    if (estimatedLoad > this.config.maxSystemLoadPercent) {
      log.debug(`Skipping cycle ${cycle.id} - system load too high (${estimatedLoad}%)`);
      cycle.nextRun = this.calculateNextRun(cycle.hourUTC, cycle.minuteUTC);
      return;
    }
    
    log.info(`🚀 Triggering scheduled cycle: ${cycle.name}`);
    
    this.state.currentCycleId = cycle.id;
    schedulerEvents.emit('cycle-triggered', { cycle });
    
    // Set timeout for stuck cycle detection
    this.cycleTimeout = setTimeout(() => {
      log.error(`Cycle ${cycle.id} exceeded maximum duration`);
      this.state.currentCycleId = null;
    }, this.config.maxCycleDurationMs);
    
    try {
      const result = await this.executeCycle(cycle);
      
      if (result) {
        cycle.successCount++;
        this.state.totalSuccessfulRuns++;
      }
    } catch (error) {
      log.error(`Cycle ${cycle.id} failed:`, error);
      cycle.failureCount++;
      this.state.totalFailedRuns++;
      this.state.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      if (this.cycleTimeout) {
        clearTimeout(this.cycleTimeout);
        this.cycleTimeout = null;
      }
      
      this.state.currentCycleId = null;
      cycle.lastRun = new Date();
      cycle.nextRun = this.calculateNextRun(cycle.hourUTC, cycle.minuteUTC);
      this.state.totalScheduledRuns++;
      
      this.updateNextScheduledRun();
    }
  }
  
  /**
   * Execute an optimization cycle
   */
  private async executeCycle(cycle: ScheduledCycle): Promise<OptimizationCycleResult> {
    const startTime = Date.now();
    
    log.info(`Executing ${cycle.name}...`);
    
    const result = await lexaraMCOptimizer.runScheduledOptimization();
    
    const duration = Date.now() - startTime;
    log.info(`${cycle.name} completed in ${duration}ms`, {
      improvement: result.totalImprovement.toFixed(6),
      converged: result.converged,
    });
    
    schedulerEvents.emit('cycle-completed', { cycle, result, duration });
    
    return result;
  }
  
  /**
   * Calculate next run time for a cycle
   */
  private calculateNextRun(hourUTC: number, minuteUTC: number): Date {
    const now = new Date();
    const next = new Date(now);
    
    next.setUTCHours(hourUTC, minuteUTC, 0, 0);
    
    // If the time has passed today, schedule for tomorrow
    if (next <= now) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    
    return next;
  }
  
  /**
   * Find the next scheduled run across all cycles
   */
  private findNextScheduledRun(cycles: ScheduledCycle[]): Date | null {
    const enabledCycles = cycles.filter(c => c.enabled && c.nextRun);
    
    if (enabledCycles.length === 0) {
      return null;
    }
    
    return enabledCycles.reduce((earliest, cycle) => {
      if (!earliest || (cycle.nextRun && cycle.nextRun < earliest)) {
        return cycle.nextRun;
      }
      return earliest;
    }, null as Date | null);
  }
  
  /**
   * Update the next scheduled run time
   */
  private updateNextScheduledRun(): void {
    this.state.nextScheduledRun = this.findNextScheduledRun(this.state.scheduledCycles);
  }
  
  /**
   * Estimate current system load (simplified)
   */
  private estimateSystemLoad(): number {
    // In production, this would check actual CPU/memory metrics
    // For now, return a simulated value
    return 30 + Math.random() * 20; // 30-50%
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const lexaraScheduler = LexaraOptimizationScheduler.getInstance();

export function startLexaraScheduler(): void {
  lexaraScheduler.start();
}

export function stopLexaraScheduler(): void {
  lexaraScheduler.stop();
}

export function configureLexaraScheduler(config: Partial<SchedulerConfig>): void {
  lexaraScheduler.configure(config);
}

export function getLexaraSchedulerState(): SchedulerState {
  return lexaraScheduler.getState();
}

export function setLexaraCycleEnabled(cycleId: string, enabled: boolean): boolean {
  return lexaraScheduler.setCycleEnabled(cycleId, enabled);
}

export function setLexaraCycleTime(cycleId: string, hourUTC: number, minuteUTC: number): boolean {
  return lexaraScheduler.setCycleTime(cycleId, hourUTC, minuteUTC);
}

export async function forceRunLexaraCycle(cycleId?: string): Promise<OptimizationCycleResult | null> {
  return lexaraScheduler.forceRunCycle(cycleId);
}

export function getTimeUntilNextLexaraCycle(): number | null {
  return lexaraScheduler.getTimeUntilNextRun();
}

export default lexaraScheduler;
