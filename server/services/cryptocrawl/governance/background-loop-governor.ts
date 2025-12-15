/**
 * BACKGROUND LOOP GOVERNOR
 * 
 * Controls timers, intervals, and schedulers across the CryptoCrawler system.
 * 
 * HARD RULES:
 * - Nothing runs "forever" silently
 * - All background processes must be registered
 * - Maximum lifetime enforcement
 * - Audit trail for all background operations
 */

import logger from '../../../logger.js';
import { EventEmitter } from 'events';

// ============================================
// TYPE DEFINITIONS
// ============================================

export type LoopType = 'INTERVAL' | 'TIMEOUT' | 'SCHEDULER' | 'CONTINUOUS';
export type LoopStatus = 'RUNNING' | 'PAUSED' | 'STOPPED' | 'EXPIRED' | 'FAILED';

export interface RegisteredLoop {
  id: string;
  name: string;
  type: LoopType;
  status: LoopStatus;
  owner: string;
  intervalMs: number;
  maxIterations: number;
  currentIterations: number;
  maxLifetimeMs: number;
  startTime: number;
  lastRunTime: number | null;
  totalRuntime: number;
  errors: number;
  maxErrors: number;
  callback: (() => void | Promise<void>) | null;
  timerId: NodeJS.Timeout | null;
}

export interface LoopRegistrationOptions {
  name: string;
  type: LoopType;
  owner: string;
  intervalMs: number;
  maxIterations?: number;      // 0 = unlimited (but still bounded by lifetime)
  maxLifetimeMs?: number;      // Default: 24 hours
  maxErrors?: number;          // Max consecutive errors before stop
  callback: () => void | Promise<void>;
}

export interface GovernorStatistics {
  totalLoops: number;
  running: number;
  paused: number;
  stopped: number;
  expired: number;
  failed: number;
  totalIterations: number;
  totalErrors: number;
  oldestLoop: { id: string; age: number } | null;
}

// ============================================
// BACKGROUND LOOP GOVERNOR CLASS
// ============================================

export class BackgroundLoopGovernor extends EventEmitter {
  private static instance: BackgroundLoopGovernor;
  
  private loops: Map<string, RegisteredLoop> = new Map();
  private loopIdCounter: number = 0;
  
  // Global limits (HARD LOCKED)
  private readonly MAX_CONCURRENT_LOOPS = 50;
  private readonly DEFAULT_MAX_LIFETIME = 24 * 60 * 60 * 1000; // 24 hours
  private readonly DEFAULT_MAX_ITERATIONS = 100000;
  private readonly DEFAULT_MAX_ERRORS = 10;
  private readonly MIN_INTERVAL_MS = 100; // Minimum 100ms between iterations
  
  // Global pause flag
  private globalPause: boolean = false;
  
  // Watchdog interval
  private watchdogInterval: NodeJS.Timeout | null = null;
  private readonly WATCHDOG_INTERVAL = 60000; // Check every minute
  
  private constructor() {
    super();
    this.startWatchdog();
    
    logger.info('[LoopGovernor] Background Loop Governor initialized', {
      maxConcurrentLoops: this.MAX_CONCURRENT_LOOPS,
      defaultMaxLifetime: `${this.DEFAULT_MAX_LIFETIME / 3600000}h`
    });
  }
  
  static getInstance(): BackgroundLoopGovernor {
    if (!BackgroundLoopGovernor.instance) {
      BackgroundLoopGovernor.instance = new BackgroundLoopGovernor();
    }
    return BackgroundLoopGovernor.instance;
  }
  
  // ============================================
  // LOOP REGISTRATION
  // ============================================
  
  /**
   * Register a new background loop
   * REQUIRED for any timed/scheduled operation
   */
  registerLoop(options: LoopRegistrationOptions): string {
    // Check concurrent loop limit
    const runningCount = this.getRunningCount();
    if (runningCount >= this.MAX_CONCURRENT_LOOPS) {
      throw new Error(`Maximum concurrent loops (${this.MAX_CONCURRENT_LOOPS}) exceeded`);
    }
    
    // Validate interval
    if (options.intervalMs < this.MIN_INTERVAL_MS) {
      throw new Error(`Minimum interval is ${this.MIN_INTERVAL_MS}ms`);
    }
    
    const id = `LOOP-${++this.loopIdCounter}-${Date.now()}`;
    
    const loop: RegisteredLoop = {
      id,
      name: options.name,
      type: options.type,
      status: 'STOPPED',
      owner: options.owner,
      intervalMs: options.intervalMs,
      maxIterations: options.maxIterations ?? this.DEFAULT_MAX_ITERATIONS,
      currentIterations: 0,
      maxLifetimeMs: options.maxLifetimeMs ?? this.DEFAULT_MAX_LIFETIME,
      startTime: 0,
      lastRunTime: null,
      totalRuntime: 0,
      errors: 0,
      maxErrors: options.maxErrors ?? this.DEFAULT_MAX_ERRORS,
      callback: options.callback,
      timerId: null
    };
    
    this.loops.set(id, loop);
    
    logger.info('[LoopGovernor] Loop registered', {
      id,
      name: options.name,
      type: options.type,
      intervalMs: options.intervalMs,
      maxLifetime: `${loop.maxLifetimeMs / 3600000}h`
    });
    
    return id;
  }
  
  // ============================================
  // LOOP CONTROL
  // ============================================
  
  /**
   * Start a registered loop
   */
  startLoop(id: string): boolean {
    const loop = this.loops.get(id);
    if (!loop) {
      logger.warn('[LoopGovernor] Loop not found', { id });
      return false;
    }
    
    if (loop.status === 'RUNNING') {
      return true; // Already running
    }
    
    if (this.globalPause) {
      logger.warn('[LoopGovernor] Cannot start loop - global pause active', { id });
      return false;
    }
    
    loop.status = 'RUNNING';
    loop.startTime = Date.now();
    loop.errors = 0;
    
    // Set up the timer based on type
    this.scheduleNext(loop);
    
    logger.info('[LoopGovernor] Loop started', {
      id,
      name: loop.name
    });
    
    return true;
  }
  
  /**
   * Stop a loop
   */
  stopLoop(id: string, reason: string = 'Manual stop'): boolean {
    const loop = this.loops.get(id);
    if (!loop) {
      return false;
    }
    
    if (loop.timerId) {
      clearTimeout(loop.timerId);
      loop.timerId = null;
    }
    
    loop.status = 'STOPPED';
    loop.totalRuntime += Date.now() - loop.startTime;
    
    logger.info('[LoopGovernor] Loop stopped', {
      id,
      name: loop.name,
      reason,
      iterations: loop.currentIterations
    });
    
    this.emit('loopStopped', { id, loop, reason });
    
    return true;
  }
  
  /**
   * Pause a loop (can be resumed)
   */
  pauseLoop(id: string): boolean {
    const loop = this.loops.get(id);
    if (!loop || loop.status !== 'RUNNING') {
      return false;
    }
    
    if (loop.timerId) {
      clearTimeout(loop.timerId);
      loop.timerId = null;
    }
    
    loop.status = 'PAUSED';
    
    logger.info('[LoopGovernor] Loop paused', {
      id,
      name: loop.name
    });
    
    return true;
  }
  
  /**
   * Resume a paused loop
   */
  resumeLoop(id: string): boolean {
    const loop = this.loops.get(id);
    if (!loop || loop.status !== 'PAUSED') {
      return false;
    }
    
    if (this.globalPause) {
      logger.warn('[LoopGovernor] Cannot resume - global pause active');
      return false;
    }
    
    loop.status = 'RUNNING';
    this.scheduleNext(loop);
    
    logger.info('[LoopGovernor] Loop resumed', {
      id,
      name: loop.name
    });
    
    return true;
  }
  
  /**
   * Unregister a loop (removes it completely)
   */
  unregisterLoop(id: string): boolean {
    const loop = this.loops.get(id);
    if (!loop) {
      return false;
    }
    
    this.stopLoop(id, 'Unregistered');
    this.loops.delete(id);
    
    logger.info('[LoopGovernor] Loop unregistered', {
      id,
      name: loop.name
    });
    
    return true;
  }
  
  // ============================================
  // LOOP EXECUTION
  // ============================================
  
  private scheduleNext(loop: RegisteredLoop): void {
    if (loop.status !== 'RUNNING') return;
    
    loop.timerId = setTimeout(async () => {
      await this.executeIteration(loop);
    }, loop.intervalMs);
  }
  
  private async executeIteration(loop: RegisteredLoop): Promise<void> {
    if (loop.status !== 'RUNNING' || this.globalPause) {
      return;
    }
    
    // Check lifetime limit
    const elapsed = Date.now() - loop.startTime;
    if (elapsed > loop.maxLifetimeMs) {
      loop.status = 'EXPIRED';
      logger.warn('[LoopGovernor] Loop expired - max lifetime reached', {
        id: loop.id,
        name: loop.name,
        lifetime: `${elapsed / 3600000}h`
      });
      this.emit('loopExpired', { id: loop.id, loop });
      return;
    }
    
    // Check iteration limit
    if (loop.maxIterations > 0 && loop.currentIterations >= loop.maxIterations) {
      loop.status = 'STOPPED';
      logger.info('[LoopGovernor] Loop completed - max iterations reached', {
        id: loop.id,
        name: loop.name,
        iterations: loop.currentIterations
      });
      this.emit('loopCompleted', { id: loop.id, loop });
      return;
    }
    
    // Execute callback
    try {
      const iterationStart = Date.now();
      
      if (loop.callback) {
        await loop.callback();
      }
      
      loop.currentIterations++;
      loop.lastRunTime = Date.now();
      loop.errors = 0; // Reset consecutive errors on success
      
      // Check if iteration took too long
      const iterationTime = Date.now() - iterationStart;
      if (iterationTime > loop.intervalMs * 0.8) {
        logger.warn('[LoopGovernor] Loop iteration slow', {
          id: loop.id,
          name: loop.name,
          iterationTime,
          interval: loop.intervalMs
        });
      }
      
    } catch (error) {
      loop.errors++;
      
      logger.error('[LoopGovernor] Loop iteration error', {
        id: loop.id,
        name: loop.name,
        error: error instanceof Error ? error.message : 'Unknown error',
        consecutiveErrors: loop.errors
      });
      
      // Check error threshold
      if (loop.errors >= loop.maxErrors) {
        loop.status = 'FAILED';
        logger.error('[LoopGovernor] Loop FAILED - max errors exceeded', {
          id: loop.id,
          name: loop.name,
          errors: loop.errors
        });
        this.emit('loopFailed', { id: loop.id, loop, error });
        return;
      }
    }
    
    // Schedule next iteration
    if (loop.status === 'RUNNING') {
      this.scheduleNext(loop);
    }
  }
  
  // ============================================
  // GLOBAL CONTROLS
  // ============================================
  
  /**
   * Pause all loops globally
   */
  globalPauseAll(reason: string): void {
    this.globalPause = true;
    
    let pausedCount = 0;
    this.loops.forEach(loop => {
      if (loop.status === 'RUNNING') {
        if (loop.timerId) {
          clearTimeout(loop.timerId);
          loop.timerId = null;
        }
        loop.status = 'PAUSED';
        pausedCount++;
      }
    });
    
    logger.warn('[LoopGovernor] GLOBAL PAUSE', {
      reason,
      pausedCount
    });
    
    this.emit('globalPause', { reason, pausedCount });
  }
  
  /**
   * Resume all paused loops
   */
  globalResumeAll(): void {
    this.globalPause = false;
    
    let resumedCount = 0;
    this.loops.forEach(loop => {
      if (loop.status === 'PAUSED') {
        loop.status = 'RUNNING';
        this.scheduleNext(loop);
        resumedCount++;
      }
    });
    
    logger.info('[LoopGovernor] GLOBAL RESUME', {
      resumedCount
    });
    
    this.emit('globalResume', { resumedCount });
  }
  
  /**
   * Stop all loops (hard stop)
   */
  stopAllLoops(reason: string): void {
    this.globalPause = true;
    
    const ids = Array.from(this.loops.keys());
    ids.forEach(id => {
      this.stopLoop(id, reason);
    });
    
    logger.warn('[LoopGovernor] ALL LOOPS STOPPED', {
      reason,
      count: ids.length
    });
  }
  
  // ============================================
  // WATCHDOG
  // ============================================
  
  private startWatchdog(): void {
    this.watchdogInterval = setInterval(() => {
      this.runWatchdog();
    }, this.WATCHDOG_INTERVAL);
  }
  
  private runWatchdog(): void {
    const now = Date.now();
    
    this.loops.forEach((loop, id) => {
      if (loop.status !== 'RUNNING') return;
      
      // Check for stale loops (no activity in 5x interval)
      if (loop.lastRunTime) {
        const timeSinceLastRun = now - loop.lastRunTime;
        if (timeSinceLastRun > loop.intervalMs * 5) {
          logger.warn('[LoopGovernor] Stale loop detected', {
            id,
            name: loop.name,
            timeSinceLastRun
          });
          
          // Attempt to restart
          this.stopLoop(id, 'Stale - restarting');
          this.startLoop(id);
        }
      }
      
      // Check for expired loops
      const elapsed = now - loop.startTime;
      if (elapsed > loop.maxLifetimeMs) {
        this.stopLoop(id, 'Lifetime expired');
        loop.status = 'EXPIRED';
      }
    });
  }
  
  // ============================================
  // QUERY METHODS
  // ============================================
  
  /**
   * Get loop by ID
   */
  getLoop(id: string): RegisteredLoop | undefined {
    return this.loops.get(id);
  }
  
  /**
   * Get all loops
   */
  getAllLoops(): RegisteredLoop[] {
    return Array.from(this.loops.values());
  }
  
  /**
   * Get loops by owner
   */
  getLoopsByOwner(owner: string): RegisteredLoop[] {
    return Array.from(this.loops.values()).filter(l => l.owner === owner);
  }
  
  /**
   * Get running loop count
   */
  getRunningCount(): number {
    return Array.from(this.loops.values()).filter(l => l.status === 'RUNNING').length;
  }
  
  /**
   * Get statistics
   */
  getStatistics(): GovernorStatistics {
    let running = 0, paused = 0, stopped = 0, expired = 0, failed = 0;
    let totalIterations = 0, totalErrors = 0;
    let oldest: { id: string; age: number } | null = null;
    
    const now = Date.now();
    
    this.loops.forEach((loop, id) => {
      switch (loop.status) {
        case 'RUNNING': running++; break;
        case 'PAUSED': paused++; break;
        case 'STOPPED': stopped++; break;
        case 'EXPIRED': expired++; break;
        case 'FAILED': failed++; break;
      }
      
      totalIterations += loop.currentIterations;
      totalErrors += loop.errors;
      
      if (loop.startTime > 0) {
        const age = now - loop.startTime;
        if (!oldest || age > oldest.age) {
          oldest = { id, age };
        }
      }
    });
    
    return {
      totalLoops: this.loops.size,
      running,
      paused,
      stopped,
      expired,
      failed,
      totalIterations,
      totalErrors,
      oldestLoop: oldest
    };
  }
  
  /**
   * Generate status report
   */
  generateStatusReport(): string {
    const stats = this.getStatistics();
    
    let report = '\n╔════════════════════════════════════════════════════════════════════╗\n';
    report += '║               BACKGROUND LOOP GOVERNOR STATUS                      ║\n';
    report += '╠════════════════════════════════════════════════════════════════════╣\n';
    report += `║ Global Pause:    ${(this.globalPause ? '🔴 ACTIVE' : '🟢 INACTIVE').padEnd(51)}║\n`;
    report += `║ Total Loops:     ${String(stats.totalLoops).padEnd(51)}║\n`;
    report += `║ Running:         ${String(stats.running).padEnd(51)}║\n`;
    report += `║ Paused:          ${String(stats.paused).padEnd(51)}║\n`;
    report += `║ Stopped:         ${String(stats.stopped).padEnd(51)}║\n`;
    report += `║ Expired:         ${String(stats.expired).padEnd(51)}║\n`;
    report += `║ Failed:          ${String(stats.failed).padEnd(51)}║\n`;
    report += '╠════════════════════════════════════════════════════════════════════╣\n';
    report += `║ Total Iterations: ${String(stats.totalIterations).padEnd(50)}║\n`;
    report += `║ Total Errors:    ${String(stats.totalErrors).padEnd(51)}║\n`;
    
    if (stats.oldestLoop) {
      report += `║ Oldest Loop:     ${stats.oldestLoop.id.substring(0, 20)} (${(stats.oldestLoop.age / 3600000).toFixed(1)}h)`.padEnd(69) + '║\n';
    }
    
    report += '╚════════════════════════════════════════════════════════════════════╝\n';
    
    return report;
  }
  
  /**
   * Cleanup - stop watchdog
   */
  cleanup(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
    this.stopAllLoops('Cleanup');
  }
}

// Export singleton instance
export const loopGovernor = BackgroundLoopGovernor.getInstance();
