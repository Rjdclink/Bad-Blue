/**
 * Crawler Job Manager - Production-Grade Job Lifecycle Management
 * 
 * Features:
 * - Append-only crawl results with immediate persistence
 * - Soft vs hard failure classification for circuit breaker
 * - Stop conditions: time budget (4-9 min), max attempts, diminishing returns
 * - Explicit job status transitions: RUNNING → PARTIAL_REPORT_AVAILABLE → COMPLETED
 * - Incremental report compilation
 * - No-cache polling support for UI
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

export enum JobStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  PARTIAL_REPORT_AVAILABLE = 'PARTIAL_REPORT_AVAILABLE',
  COMPLETED = 'COMPLETED',
  COMPLETED_WITH_WARNINGS = 'COMPLETED_WITH_WARNINGS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum FailureType {
  // Soft failures - don't count toward circuit breaker
  SOFT_404 = 'SOFT_404',
  SOFT_403 = 'SOFT_403',
  SOFT_DNS = 'SOFT_DNS',
  SOFT_INVALID_URL = 'SOFT_INVALID_URL',
  SOFT_TIMEOUT = 'SOFT_TIMEOUT',
  SOFT_RATE_LIMITED = 'SOFT_RATE_LIMITED',
  SOFT_EMPTY_RESPONSE = 'SOFT_EMPTY_RESPONSE',
  
  // Hard failures - count toward circuit breaker
  HARD_DB_WRITE = 'HARD_DB_WRITE',
  HARD_WORKER_CRASH = 'HARD_WORKER_CRASH',
  HARD_PROVIDER_AUTH = 'HARD_PROVIDER_AUTH',
  HARD_SYSTEM_ERROR = 'HARD_SYSTEM_ERROR',
  HARD_OUT_OF_MEMORY = 'HARD_OUT_OF_MEMORY',
}

export interface CrawlResult {
  id: string;
  jobId: string;
  url: string;
  success: boolean;
  data?: any;
  error?: string;
  failureType?: FailureType;
  timestamp: Date;
  latencyMs: number;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface JobConfig {
  // Time budget in milliseconds (4-9 minutes = 240000-540000ms)
  timeBudgetMs: number;
  // Maximum total attempts
  maxAttempts: number;
  // Diminishing returns: quit if last N attempts have < M successes
  diminishingReturns: {
    windowSize: number;  // N
    minSuccesses: number; // M
  };
  // Report compilation interval
  reportCompileIntervalMs: number;
  // Report compilation batch size
  reportCompileBatchSize: number;
  // Circuit breaker threshold (hard failures)
  circuitBreakerThreshold: number;
}

export interface JobReport {
  id: string;
  jobId: string;
  version: number;
  compiledAt: Date;
  isPartial: boolean;
  totalResults: number;
  successCount: number;
  failureCount: number;
  softFailures: number;
  hardFailures: number;
  data: any[];
  summary?: string;
}

export interface CrawlJob {
  id: string;
  status: JobStatus;
  config: JobConfig;
  targets: string[];
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  
  // Metrics
  totalAttempts: number;
  successCount: number;
  softFailureCount: number;
  hardFailureCount: number;
  
  // Stop reason
  stopReason?: 'time_budget' | 'max_attempts' | 'diminishing_returns' | 'circuit_breaker' | 'cancelled' | 'completed';
  
  // Report tracking
  latestReportVersion: number;
  lastReportCompileTime?: Date;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: JobConfig = {
  timeBudgetMs: 5 * 60 * 1000, // 5 minutes default (within 4-9 range)
  maxAttempts: 500,
  diminishingReturns: {
    windowSize: 20,    // Look at last 20 attempts
    minSuccesses: 3,   // Need at least 3 successes
  },
  reportCompileIntervalMs: 15000, // Compile every 15 seconds
  reportCompileBatchSize: 10,     // Or every 10 successes
  circuitBreakerThreshold: 5,     // 5 hard failures trips breaker
};

// ============================================================================
// FAILURE CLASSIFICATION
// ============================================================================

export function classifyFailure(error: Error | string, statusCode?: number): FailureType {
  const errorStr = typeof error === 'string' ? error : error.message;
  const errorLower = errorStr.toLowerCase();
  
  // Check status codes first
  if (statusCode === 404) return FailureType.SOFT_404;
  if (statusCode === 403) return FailureType.SOFT_403;
  if (statusCode === 429) return FailureType.SOFT_RATE_LIMITED;
  
  // Check error messages for soft failures
  if (errorLower.includes('enotfound') || errorLower.includes('dns')) return FailureType.SOFT_DNS;
  if (errorLower.includes('invalid url') || errorLower.includes('malformed')) return FailureType.SOFT_INVALID_URL;
  if (errorLower.includes('timeout') || errorLower.includes('etimedout') || errorLower.includes('econnreset')) return FailureType.SOFT_TIMEOUT;
  if (errorLower.includes('empty') || errorLower.includes('no content')) return FailureType.SOFT_EMPTY_RESPONSE;
  if (errorLower.includes('rate limit') || errorLower.includes('too many')) return FailureType.SOFT_RATE_LIMITED;
  if (errorLower.includes('not found') || errorLower.includes('404')) return FailureType.SOFT_404;
  if (errorLower.includes('forbidden') || errorLower.includes('403')) return FailureType.SOFT_403;
  
  // Check for hard failures
  if (errorLower.includes('database') || errorLower.includes('db write') || errorLower.includes('insert failed')) return FailureType.HARD_DB_WRITE;
  if (errorLower.includes('worker') || errorLower.includes('crash') || errorLower.includes('process')) return FailureType.HARD_WORKER_CRASH;
  if (errorLower.includes('auth') || errorLower.includes('api key') || errorLower.includes('credential')) return FailureType.HARD_PROVIDER_AUTH;
  if (errorLower.includes('memory') || errorLower.includes('heap')) return FailureType.HARD_OUT_OF_MEMORY;
  
  // Default to system error (hard)
  return FailureType.HARD_SYSTEM_ERROR;
}

export function isSoftFailure(failureType: FailureType): boolean {
  return failureType.startsWith('SOFT_');
}

export function isHardFailure(failureType: FailureType): boolean {
  return failureType.startsWith('HARD_');
}

// ============================================================================
// CRAWLER JOB MANAGER
// ============================================================================

export class CrawlerJobManager extends EventEmitter {
  private jobs: Map<string, CrawlJob> = new Map();
  private results: Map<string, CrawlResult[]> = new Map();
  private reports: Map<string, JobReport[]> = new Map();
  private recentAttempts: Map<string, boolean[]> = new Map(); // true = success, false = failure
  
  // Compile timers
  private compileTimers: Map<string, NodeJS.Timeout> = new Map();
  
  constructor() {
    super();
  }

  // ==================== JOB CREATION ====================

  createJob(targets: string[], config?: Partial<JobConfig>): CrawlJob {
    const jobId = randomUUID();
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    
    // Enforce time budget bounds (4-9 minutes)
    finalConfig.timeBudgetMs = Math.max(4 * 60 * 1000, Math.min(9 * 60 * 1000, finalConfig.timeBudgetMs));
    
    const job: CrawlJob = {
      id: jobId,
      status: JobStatus.PENDING,
      config: finalConfig,
      targets,
      createdAt: new Date(),
      totalAttempts: 0,
      successCount: 0,
      softFailureCount: 0,
      hardFailureCount: 0,
      latestReportVersion: 0,
    };

    this.jobs.set(jobId, job);
    this.results.set(jobId, []);
    this.reports.set(jobId, []);
    this.recentAttempts.set(jobId, []);

    this.emit('job:created', { jobId, job });
    console.log(`[CrawlerJobManager] Created job ${jobId} with ${targets.length} targets, time budget: ${finalConfig.timeBudgetMs / 1000}s`);

    return job;
  }

  // ==================== JOB LIFECYCLE ====================

  startJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== JobStatus.PENDING) return false;

    job.status = JobStatus.RUNNING;
    job.startedAt = new Date();

    // Start report compilation timer
    this.startCompileTimer(jobId);

    this.emit('job:started', { jobId, job });
    console.log(`[CrawlerJobManager] Started job ${jobId}`);

    return true;
  }

  // ==================== RESULT PERSISTENCE (APPEND-ONLY) ====================

  /**
   * Append a crawl result immediately - no waiting for job end
   * This is the core append-only pattern
   */
  appendResult(jobId: string, result: Omit<CrawlResult, 'id' | 'jobId' | 'timestamp'>): CrawlResult | null {
    const job = this.jobs.get(jobId);
    if (!job || job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED || job.status === JobStatus.CANCELLED) {
      return null;
    }

    // Create full result with ID and timestamp
    const fullResult: CrawlResult = {
      ...result,
      id: randomUUID(),
      jobId,
      timestamp: new Date(),
    };

    // APPEND-ONLY: Immediately persist to results buffer
    const jobResults = this.results.get(jobId) || [];
    jobResults.push(fullResult);
    this.results.set(jobId, jobResults);

    // Update job metrics
    job.totalAttempts++;
    
    if (result.success) {
      job.successCount++;
      this.trackAttempt(jobId, true);
    } else {
      const failureType = result.failureType || FailureType.HARD_SYSTEM_ERROR;
      if (isSoftFailure(failureType)) {
        job.softFailureCount++;
      } else {
        job.hardFailureCount++;
      }
      this.trackAttempt(jobId, false);
    }

    // Emit result event for real-time updates
    this.emit('result:appended', { jobId, result: fullResult });

    // Check if we should compile a report (batch threshold)
    const resultsSinceLastReport = jobResults.length - (job.latestReportVersion * job.config.reportCompileBatchSize);
    if (resultsSinceLastReport >= job.config.reportCompileBatchSize) {
      this.compileReport(jobId);
    }

    // Check stop conditions
    this.checkStopConditions(jobId);

    return fullResult;
  }

  // ==================== STOP CONDITIONS ====================

  private trackAttempt(jobId: string, success: boolean): void {
    const attempts = this.recentAttempts.get(jobId) || [];
    attempts.push(success);
    
    // Keep only the window size
    const job = this.jobs.get(jobId);
    if (job) {
      while (attempts.length > job.config.diminishingReturns.windowSize) {
        attempts.shift();
      }
    }
    
    this.recentAttempts.set(jobId, attempts);
  }

  private checkStopConditions(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== JobStatus.RUNNING && job.status !== JobStatus.PARTIAL_REPORT_AVAILABLE) {
      return;
    }

    // 1. Time budget check
    if (job.startedAt) {
      const elapsed = Date.now() - job.startedAt.getTime();
      if (elapsed >= job.config.timeBudgetMs) {
        this.stopJob(jobId, 'time_budget');
        return;
      }
    }

    // 2. Max attempts check
    if (job.totalAttempts >= job.config.maxAttempts) {
      this.stopJob(jobId, 'max_attempts');
      return;
    }

    // 3. Circuit breaker check (hard failures only)
    if (job.hardFailureCount >= job.config.circuitBreakerThreshold) {
      this.stopJob(jobId, 'circuit_breaker');
      return;
    }

    // 4. Diminishing returns check
    const attempts = this.recentAttempts.get(jobId) || [];
    if (attempts.length >= job.config.diminishingReturns.windowSize) {
      const recentSuccesses = attempts.filter(Boolean).length;
      if (recentSuccesses < job.config.diminishingReturns.minSuccesses) {
        this.stopJob(jobId, 'diminishing_returns');
        return;
      }
    }
  }

  shouldContinue(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    
    // Only continue if running or partial
    if (job.status !== JobStatus.RUNNING && job.status !== JobStatus.PARTIAL_REPORT_AVAILABLE) {
      return false;
    }

    // Check all stop conditions without triggering stop
    if (job.startedAt) {
      const elapsed = Date.now() - job.startedAt.getTime();
      if (elapsed >= job.config.timeBudgetMs) return false;
    }

    if (job.totalAttempts >= job.config.maxAttempts) return false;
    if (job.hardFailureCount >= job.config.circuitBreakerThreshold) return false;

    const attempts = this.recentAttempts.get(jobId) || [];
    if (attempts.length >= job.config.diminishingReturns.windowSize) {
      const recentSuccesses = attempts.filter(Boolean).length;
      if (recentSuccesses < job.config.diminishingReturns.minSuccesses) return false;
    }

    return true;
  }

  // ==================== JOB STOP ====================

  private stopJob(jobId: string, reason: CrawlJob['stopReason']): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.stopReason = reason;
    job.completedAt = new Date();

    // Compile final report
    this.compileReport(jobId);

    // Stop compile timer
    const timer = this.compileTimers.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.compileTimers.delete(jobId);
    }

    // Determine final status
    if (reason === 'circuit_breaker') {
      job.status = JobStatus.FAILED;
    } else if (job.softFailureCount > 0 || job.hardFailureCount > 0) {
      job.status = JobStatus.COMPLETED_WITH_WARNINGS;
    } else {
      job.status = JobStatus.COMPLETED;
    }

    this.emit('job:stopped', { jobId, job, reason });
    console.log(`[CrawlerJobManager] Stopped job ${jobId}, reason: ${reason}, status: ${job.status}`);
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
      return false;
    }

    this.stopJob(jobId, 'cancelled');
    job.status = JobStatus.CANCELLED;
    return true;
  }

  // ==================== REPORT COMPILATION ====================

  private startCompileTimer(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const timer = setInterval(() => {
      this.compileReport(jobId);
    }, job.config.reportCompileIntervalMs);

    this.compileTimers.set(jobId, timer);
  }

  compileReport(jobId: string): JobReport | null {
    const job = this.jobs.get(jobId);
    const results = this.results.get(jobId);
    if (!job || !results) return null;

    const newVersion = job.latestReportVersion + 1;
    const isPartial = job.status === JobStatus.RUNNING || job.status === JobStatus.PARTIAL_REPORT_AVAILABLE;

    // Calculate metrics
    const successResults = results.filter(r => r.success);
    const failureResults = results.filter(r => !r.success);
    const softFailures = failureResults.filter(r => r.failureType && isSoftFailure(r.failureType)).length;
    const hardFailures = failureResults.filter(r => r.failureType && isHardFailure(r.failureType)).length;

    const report: JobReport = {
      id: randomUUID(),
      jobId,
      version: newVersion,
      compiledAt: new Date(),
      isPartial,
      totalResults: results.length,
      successCount: successResults.length,
      failureCount: failureResults.length,
      softFailures,
      hardFailures,
      data: successResults.map(r => r.data).filter(Boolean),
      summary: this.generateSummary(job, results),
    };

    // Store report
    const jobReports = this.reports.get(jobId) || [];
    jobReports.push(report);
    this.reports.set(jobId, jobReports);

    // Update job
    job.latestReportVersion = newVersion;
    job.lastReportCompileTime = new Date();

    // Transition to PARTIAL_REPORT_AVAILABLE if still running
    if (job.status === JobStatus.RUNNING && newVersion > 0) {
      job.status = JobStatus.PARTIAL_REPORT_AVAILABLE;
      this.emit('job:partial_report', { jobId, report });
    }

    this.emit('report:compiled', { jobId, report });
    console.log(`[CrawlerJobManager] Compiled report v${newVersion} for job ${jobId}: ${successResults.length}/${results.length} success`);

    return report;
  }

  private generateSummary(job: CrawlJob, results: CrawlResult[]): string {
    const elapsed = job.startedAt ? Math.round((Date.now() - job.startedAt.getTime()) / 1000) : 0;
    const successRate = job.totalAttempts > 0 ? ((job.successCount / job.totalAttempts) * 100).toFixed(1) : '0';
    
    return `Job ${job.id.slice(0, 8)}: ${job.successCount}/${job.totalAttempts} successful (${successRate}%), ${elapsed}s elapsed, status: ${job.status}`;
  }

  // ==================== QUERY METHODS (No Cache) ====================

  /**
   * Get job status - always fresh, no cache
   */
  getJob(jobId: string): CrawlJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Get latest report for job - always fresh, no cache
   */
  getLatestReport(jobId: string): JobReport | null {
    const reports = this.reports.get(jobId);
    if (!reports || reports.length === 0) return null;
    return reports[reports.length - 1];
  }

  /**
   * Get all reports for job
   */
  getReports(jobId: string): JobReport[] {
    return this.reports.get(jobId) || [];
  }

  /**
   * Get results for job (append-only buffer)
   */
  getResults(jobId: string): CrawlResult[] {
    return this.results.get(jobId) || [];
  }

  /**
   * Get job status for polling (minimal response, no cache headers)
   */
  getJobStatusForPolling(jobId: string): { 
    status: JobStatus; 
    progress: number; 
    hasPartialReport: boolean;
    reportVersion: number;
    successCount: number;
    totalAttempts: number;
    elapsedMs: number;
    remainingMs: number;
  } | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    const elapsed = job.startedAt ? Date.now() - job.startedAt.getTime() : 0;
    const remaining = Math.max(0, job.config.timeBudgetMs - elapsed);
    const progress = job.config.timeBudgetMs > 0 ? Math.min(100, (elapsed / job.config.timeBudgetMs) * 100) : 0;

    return {
      status: job.status,
      progress: Math.round(progress),
      hasPartialReport: job.latestReportVersion > 0,
      reportVersion: job.latestReportVersion,
      successCount: job.successCount,
      totalAttempts: job.totalAttempts,
      elapsedMs: elapsed,
      remainingMs: remaining,
    };
  }

  // ==================== CLEANUP ====================

  cleanup(jobId: string): void {
    const timer = this.compileTimers.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.compileTimers.delete(jobId);
    }
    
    this.jobs.delete(jobId);
    this.results.delete(jobId);
    this.reports.delete(jobId);
    this.recentAttempts.delete(jobId);
  }

  cleanupOldJobs(maxAgeMs: number = 3600000): void {
    const now = Date.now();
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.completedAt && now - job.completedAt.getTime() > maxAgeMs) {
        this.cleanup(jobId);
      }
    }
  }
}

// Singleton instance
export const crawlerJobManager = new CrawlerJobManager();

export default CrawlerJobManager;
