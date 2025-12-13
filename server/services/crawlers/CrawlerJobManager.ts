/**
 * Crawler Job Manager - Production-Grade Job Lifecycle Management
 * 
 * CONTINUOUS OPERATION MODE:
 * - Crawlers run continuously, gathering data indefinitely
 * - Satellite/geo visualization refreshes in real-time
 * - Reports are compiled incrementally at tier milestones:
 *   - BASIC (4 min): Quick initial intelligence snapshot
 *   - ENHANCED (8 min): Expanded data collection snapshot
 *   - FULL (12 min): Comprehensive analysis snapshot
 *   - EYE_OF_GOD (18 min): Maximum depth PANTHEON doomsday snapshot
 * - Images/data displayed incrementally as each tier completes
 * - No hard stop - system keeps running until manually stopped or circuit breaker trips
 * 
 * Features:
 * - Append-only crawl results with immediate persistence
 * - Soft vs hard failure classification for circuit breaker
 * - Continuous refresh with tier-based report snapshots
 * - Real-time status polling for UI updates
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Report tiers for PANTHEON Doomsday crawler system
 * Each tier represents a snapshot milestone - system continues after each tier
 */
export enum ReportTier {
  BASIC = 'BASIC',           // 4 minutes - Quick initial intelligence
  ENHANCED = 'ENHANCED',     // 8 minutes - Expanded data collection  
  FULL = 'FULL',             // 12 minutes - Comprehensive analysis
  EYE_OF_GOD = 'EYE_OF_GOD', // 18 minutes - Maximum depth doomsday mode
  CONTINUOUS = 'CONTINUOUS', // Beyond 18 min - Ongoing surveillance mode
}

/**
 * Time thresholds for each report tier (in milliseconds)
 * These are MILESTONES, not stop points
 */
export const REPORT_TIER_THRESHOLDS: Record<ReportTier, number> = {
  [ReportTier.BASIC]: 4 * 60 * 1000,        // 4 minutes
  [ReportTier.ENHANCED]: 8 * 60 * 1000,     // 8 minutes
  [ReportTier.FULL]: 12 * 60 * 1000,        // 12 minutes
  [ReportTier.EYE_OF_GOD]: 18 * 60 * 1000,  // 18 minutes
  [ReportTier.CONTINUOUS]: Infinity,         // No limit - runs until stopped
};

/**
 * Human-readable tier names
 */
export const REPORT_TIER_NAMES: Record<ReportTier, string> = {
  [ReportTier.BASIC]: 'Basic Report',
  [ReportTier.ENHANCED]: 'Enhanced Report',
  [ReportTier.FULL]: 'Full Report',
  [ReportTier.EYE_OF_GOD]: 'Eye of God',
  [ReportTier.CONTINUOUS]: 'Continuous Surveillance',
};

/**
 * Doomsday clock display configuration for each tier
 */
export interface DoomsdayClockTier {
  tier: ReportTier;
  name: string;
  thresholdMs: number;
  thresholdMinutes: number;
  description: string;
  color: string;
  icon: string;
}

export const DOOMSDAY_CLOCK_TIERS: DoomsdayClockTier[] = [
  {
    tier: ReportTier.BASIC,
    name: 'Basic Report',
    thresholdMs: 4 * 60 * 1000,
    thresholdMinutes: 4,
    description: 'Initial intelligence scan',
    color: '#3b82f6', // blue
    icon: '🔍',
  },
  {
    tier: ReportTier.ENHANCED,
    name: 'Enhanced Report', 
    thresholdMs: 8 * 60 * 1000,
    thresholdMinutes: 8,
    description: 'Expanded data collection',
    color: '#22c55e', // green
    icon: '📊',
  },
  {
    tier: ReportTier.FULL,
    name: 'Full Report',
    thresholdMs: 12 * 60 * 1000,
    thresholdMinutes: 12,
    description: 'Comprehensive analysis',
    color: '#f59e0b', // amber
    icon: '📋',
  },
  {
    tier: ReportTier.EYE_OF_GOD,
    name: 'Eye of God',
    thresholdMs: 18 * 60 * 1000,
    thresholdMinutes: 18,
    description: 'Maximum depth PANTHEON doomsday',
    color: '#ef4444', // red
    icon: '👁️',
  },
];

export enum JobStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  PARTIAL_REPORT_AVAILABLE = 'PARTIAL_REPORT_AVAILABLE',
  COMPLETED = 'COMPLETED',
  COMPLETED_WITH_WARNINGS = 'COMPLETED_WITH_WARNINGS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  // New status for user-initiated hard stop
  STOPPED_BY_USER = 'STOPPED_BY_USER',
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
  // Whether to run continuously (no automatic stop after target tier)
  continuousMode: boolean;
  // Minimum tier to reach before allowing manual stop (optional)
  minimumTier: ReportTier;
  // Maximum total attempts (0 = unlimited in continuous mode)
  maxAttempts: number;
  // Diminishing returns: quit if last N attempts have < M successes
  diminishingReturns: {
    windowSize: number;  // N
    minSuccesses: number; // M
    enabled: boolean;    // Can disable in continuous mode
  };
  // Report compilation interval for continuous refresh
  reportCompileIntervalMs: number;
  // Report compilation batch size
  reportCompileBatchSize: number;
  // Circuit breaker threshold (hard failures) - always active
  circuitBreakerThreshold: number;
  // Satellite/geo refresh interval for real-time updates
  satelliteRefreshIntervalMs: number;
}

/**
 * Tiered report snapshot with tier-specific metadata
 * Each tier represents a milestone snapshot, not a stop point
 */
export interface JobReport {
  id: string;
  jobId: string;
  version: number;
  compiledAt: Date;
  isPartial: boolean;
  // Snapshot tier (which milestone this report represents)
  snapshotTier: ReportTier;
  // Current active tier
  currentTier: ReportTier;
  // Progress toward each tier (percentage)
  tierProgress: Record<ReportTier, number>;
  // Tier completion timestamps (when each snapshot was captured)
  tierCompletedAt: Partial<Record<ReportTier, Date>>;
  // Tier-specific report snapshots
  tierSnapshots: Partial<Record<ReportTier, {
    capturedAt: Date;
    resultCount: number;
    data: any[];
    summary: string;
  }>>;
  totalResults: number;
  successCount: number;
  failureCount: number;
  softFailures: number;
  hardFailures: number;
  data: any[];
  summary?: string;
  // Tier-specific summaries
  tierSummaries: Partial<Record<ReportTier, string>>;
}

export interface CrawlJob {
  id: string;
  status: JobStatus;
  config: JobConfig;
  targets: string[];
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  
  // Current tier milestone reached
  currentTier: ReportTier;
  // Tiers that have been completed (snapshots captured)
  completedTiers: ReportTier[];
  
  // Metrics
  totalAttempts: number;
  successCount: number;
  softFailureCount: number;
  hardFailureCount: number;
  
  // Stop reason (only set when job actually stops)
  stopReason?: 'manual_stop' | 'max_attempts' | 'diminishing_returns' | 'circuit_breaker' | 'cancelled';
  
  // Report tracking
  latestReportVersion: number;
  lastReportCompileTime?: Date;
  // Last satellite refresh
  lastSatelliteRefresh?: Date;
}

/**
 * Live report state - fills in as information becomes available
 * This is the continuously updating view that the UI subscribes to
 */
export interface LiveReportState {
  jobId: string;
  // Current elapsed time
  elapsedMs: number;
  // Current tier milestone
  currentTier: ReportTier;
  // Progress toward next tier (percentage)
  nextTierProgress: number;
  // Completed tier snapshots
  completedTiers: ReportTier[];
  // Live data stream - fills in as results arrive
  liveData: {
    id: string;
    timestamp: Date;
    source: string;
    category: string;
    data: any;
    confidence: number;
  }[];
  // Tier snapshots - captured at milestone times
  tierSnapshots: Record<ReportTier, {
    capturedAt: Date;
    dataCount: number;
    summary: string;
    data: any[];
  } | null>;
  // Real-time stats
  stats: {
    totalResults: number;
    successRate: number;
    dataPointsPerMinute: number;
    activeSources: string[];
  };
  // Satellite/geo state
  satelliteState: {
    lastRefresh: Date;
    isLive: boolean;
    coordinates?: { lat: number; lng: number }[];
  };
}

/**
 * Doomsday Clock State - Real-time status for UI display
 * Shows progress through each tier with countdown/countup display
 */
export interface DoomsdayClockState {
  jobId: string;
  isRunning: boolean;
  // Total elapsed time since start
  elapsedMs: number;
  elapsedFormatted: string; // "MM:SS" or "HH:MM:SS"
  // Current active tier being filled
  activeTier: ReportTier;
  activeTierName: string;
  // Individual clock states for each tier
  clocks: {
    tier: ReportTier;
    name: string;
    icon: string;
    color: string;
    // Progress within this tier (0-100)
    progress: number;
    // Time until this tier completes (ms), negative if completed
    timeRemainingMs: number;
    timeRemainingFormatted: string;
    // Whether this tier snapshot has been captured
    isComplete: boolean;
    completedAt?: Date;
    // Fill status - how much data has been collected for this tier
    fillPercentage: number;
    dataCount: number;
  }[];
  // Can user initiate hard stop?
  canStop: boolean;
  // Minimum tier required before stop is allowed
  minimumTierForStop: ReportTier;
  // Has minimum tier been reached?
  minimumTierReached: boolean;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: JobConfig = {
  continuousMode: true,           // Run continuously by default - no auto stop
  minimumTier: ReportTier.BASIC,  // At least get basic report before allowing stop
  maxAttempts: 0,                 // 0 = unlimited in continuous mode
  diminishingReturns: {
    windowSize: 20,
    minSuccesses: 3,
    enabled: false,               // Disabled in continuous mode
  },
  reportCompileIntervalMs: 5000,  // Compile every 5 seconds for real-time fill-in
  reportCompileBatchSize: 3,      // Or every 3 new results
  circuitBreakerThreshold: 10,    // 10 hard failures trips breaker
  satelliteRefreshIntervalMs: 2000, // Satellite refreshes every 2 seconds
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
// TIERED DATA CATEGORIES
// Each tier unlocks additional data sources/depth that fill in over time
// ============================================================================

/**
 * Data categories available at each tier
 * Each tier INCLUDES all previous tier categories plus new ones
 */
export const TIER_DATA_CATEGORIES: Record<ReportTier, string[]> = {
  [ReportTier.BASIC]: [
    'public_records',      // Basic public records
    'social_profiles',     // Public social media profiles
    'contact_info',        // Basic contact information
  ],
  [ReportTier.ENHANCED]: [
    // Includes all BASIC categories plus:
    'employment_history',  // Work history
    'education',           // Educational background
    'associates',          // Known associates
    'property_records',    // Property ownership
    'court_records',       // Court case information
  ],
  [ReportTier.FULL]: [
    // Includes all ENHANCED categories plus:
    'financial_indicators', // Financial patterns
    'travel_patterns',      // Movement/travel data
    'digital_footprint',    // Online activity patterns
    'relationship_graph',   // Social network mapping
    'timeline_analysis',    // Historical timeline
  ],
  [ReportTier.EYE_OF_GOD]: [
    // Includes all FULL categories plus:
    'deep_web_traces',      // Dark/deep web mentions
    'behavioral_analysis',  // Behavioral patterns
    'predictive_modeling',  // Future behavior predictions
    'cross_reference_intel', // Cross-database intelligence
    'anomaly_detection',    // Unusual pattern detection
    'full_dossier',         // Complete intelligence dossier
  ],
  [ReportTier.CONTINUOUS]: [
    // Real-time monitoring categories
    'live_monitoring',      // Active surveillance feed
    'alert_triggers',       // Real-time alerts
    'pattern_updates',      // Evolving pattern detection
  ],
};

/**
 * Get all data categories available up to and including a tier
 */
export function getCategoriesForTier(tier: ReportTier): string[] {
  const tiers = [ReportTier.BASIC, ReportTier.ENHANCED, ReportTier.FULL, ReportTier.EYE_OF_GOD, ReportTier.CONTINUOUS];
  const tierIndex = tiers.indexOf(tier);
  
  const categories: string[] = [];
  for (let i = 0; i <= tierIndex && i < tiers.length; i++) {
    categories.push(...TIER_DATA_CATEGORIES[tiers[i]]);
  }
  return categories;
}

/**
 * Determine which tier a data category belongs to
 */
export function getCategoryTier(category: string): ReportTier {
  for (const [tier, categories] of Object.entries(TIER_DATA_CATEGORIES)) {
    if (categories.includes(category)) {
      return tier as ReportTier;
    }
  }
  return ReportTier.BASIC; // Default to basic
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the time threshold for a given report tier
 */
export function getTierTimeThreshold(tier: ReportTier): number {
  return REPORT_TIER_THRESHOLDS[tier];
}

/**
 * Determine current tier based on elapsed time
 */
export function getCurrentTierFromElapsed(elapsedMs: number): ReportTier {
  if (elapsedMs >= REPORT_TIER_THRESHOLDS[ReportTier.EYE_OF_GOD]) {
    return ReportTier.CONTINUOUS;
  } else if (elapsedMs >= REPORT_TIER_THRESHOLDS[ReportTier.FULL]) {
    return ReportTier.EYE_OF_GOD;
  } else if (elapsedMs >= REPORT_TIER_THRESHOLDS[ReportTier.ENHANCED]) {
    return ReportTier.FULL;
  } else if (elapsedMs >= REPORT_TIER_THRESHOLDS[ReportTier.BASIC]) {
    return ReportTier.ENHANCED;
  }
  return ReportTier.BASIC; // Working toward basic
}

/**
 * Get the tier currently being filled (active tier)
 */
export function getActiveTierFromElapsed(elapsedMs: number): ReportTier {
  if (elapsedMs >= REPORT_TIER_THRESHOLDS[ReportTier.EYE_OF_GOD]) {
    return ReportTier.CONTINUOUS;
  } else if (elapsedMs >= REPORT_TIER_THRESHOLDS[ReportTier.FULL]) {
    return ReportTier.EYE_OF_GOD;
  } else if (elapsedMs >= REPORT_TIER_THRESHOLDS[ReportTier.ENHANCED]) {
    return ReportTier.FULL;
  } else if (elapsedMs >= REPORT_TIER_THRESHOLDS[ReportTier.BASIC]) {
    return ReportTier.ENHANCED;
  }
  return ReportTier.BASIC;
}

/**
 * Get all tiers that have been completed (snapshot captured)
 */
export function getCompletedTiers(elapsedMs: number): ReportTier[] {
  const completed: ReportTier[] = [];
  if (elapsedMs >= REPORT_TIER_THRESHOLDS[ReportTier.BASIC]) completed.push(ReportTier.BASIC);
  if (elapsedMs >= REPORT_TIER_THRESHOLDS[ReportTier.ENHANCED]) completed.push(ReportTier.ENHANCED);
  if (elapsedMs >= REPORT_TIER_THRESHOLDS[ReportTier.FULL]) completed.push(ReportTier.FULL);
  if (elapsedMs >= REPORT_TIER_THRESHOLDS[ReportTier.EYE_OF_GOD]) completed.push(ReportTier.EYE_OF_GOD);
  return completed;
}

/**
 * Calculate progress toward each tier (percentage filled)
 */
export function calculateTierProgress(elapsedMs: number): Record<ReportTier, number> {
  return {
    [ReportTier.BASIC]: Math.min(100, (elapsedMs / REPORT_TIER_THRESHOLDS[ReportTier.BASIC]) * 100),
    [ReportTier.ENHANCED]: Math.min(100, (elapsedMs / REPORT_TIER_THRESHOLDS[ReportTier.ENHANCED]) * 100),
    [ReportTier.FULL]: Math.min(100, (elapsedMs / REPORT_TIER_THRESHOLDS[ReportTier.FULL]) * 100),
    [ReportTier.EYE_OF_GOD]: Math.min(100, (elapsedMs / REPORT_TIER_THRESHOLDS[ReportTier.EYE_OF_GOD]) * 100),
    [ReportTier.CONTINUOUS]: 100, // Always "complete" in continuous mode
  };
}

/**
 * Get fill percentage for a specific tier based on data collected
 */
export function calculateTierFillPercentage(
  tier: ReportTier, 
  collectedCategories: string[], 
  resultsInTier: number,
  expectedMinResults: number = 10
): number {
  const tierCategories = TIER_DATA_CATEGORIES[tier];
  const matchedCategories = tierCategories.filter(cat => collectedCategories.includes(cat));
  
  // Category coverage (50% weight)
  const categoryCoverage = tierCategories.length > 0 
    ? (matchedCategories.length / tierCategories.length) * 100 
    : 0;
  
  // Result density (50% weight)  
  const resultDensity = Math.min(100, (resultsInTier / expectedMinResults) * 100);
  
  return Math.round((categoryCoverage * 0.5) + (resultDensity * 0.5));
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
  // Tier completion tracking
  private tierCompletionTimes: Map<string, Partial<Record<ReportTier, Date>>> = new Map();
  
  constructor() {
    super();
  }

  // ==================== JOB CREATION ====================

  createJob(targets: string[], config?: Partial<JobConfig>): CrawlJob {
    const jobId = randomUUID();
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    
    const job: CrawlJob = {
      id: jobId,
      status: JobStatus.PENDING,
      config: finalConfig,
      targets,
      createdAt: new Date(),
      currentTier: ReportTier.BASIC,
      completedTiers: [],
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
    this.tierCompletionTimes.set(jobId, {});

    const targetBudgetMs = getTierTimeBudget(finalConfig.targetTier);
    this.emit('job:created', { jobId, job });
    console.log(`[CrawlerJobManager] Created job ${jobId} with ${targets.length} targets, target tier: ${finalConfig.targetTier} (${targetBudgetMs / 60000} min)`);

    return job;
  }

  // ==================== JOB LIFECYCLE ====================

  startJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== JobStatus.PENDING) return false;

    job.status = JobStatus.RUNNING;
    job.startedAt = new Date();

    // Start report compilation timer for continuous updates
    this.startCompileTimer(jobId);

    this.emit('job:started', { jobId, job });
    console.log(`[CrawlerJobManager] Started job ${jobId}, target: ${REPORT_TIER_NAMES[job.config.targetTier]}`);

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

  /**
   * Check stop conditions - in continuous mode, only circuit breaker can auto-stop
   * User must manually stop via doomsday clock UI
   */
  private checkStopConditions(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== JobStatus.RUNNING && job.status !== JobStatus.PARTIAL_REPORT_AVAILABLE) {
      return;
    }

    // Update tier progress continuously
    if (job.startedAt) {
      const elapsed = Date.now() - job.startedAt.getTime();
      
      // Check for tier completions and emit events (snapshots)
      this.checkTierCompletions(jobId, elapsed);
      
      // Update current tier based on elapsed time
      job.currentTier = getCurrentTierFromElapsed(elapsed);
      job.completedTiers = getCompletedTiers(elapsed);
      
      // In continuous mode, NO automatic time-based stop
      // User must manually stop via doomsday clock
    }

    // Max attempts check (only if not unlimited)
    if (job.config.maxAttempts > 0 && job.totalAttempts >= job.config.maxAttempts) {
      this.stopJob(jobId, 'max_attempts');
      return;
    }

    // Circuit breaker check (hard failures only) - ALWAYS active
    if (job.hardFailureCount >= job.config.circuitBreakerThreshold) {
      this.stopJob(jobId, 'circuit_breaker');
      return;
    }

    // Diminishing returns check (only if enabled)
    if (job.config.diminishingReturns.enabled) {
      const attempts = this.recentAttempts.get(jobId) || [];
      if (attempts.length >= job.config.diminishingReturns.windowSize) {
        const recentSuccesses = attempts.filter(Boolean).length;
        if (recentSuccesses < job.config.diminishingReturns.minSuccesses) {
          this.stopJob(jobId, 'diminishing_returns');
          return;
        }
      }
    }
  }

  /**
   * Check and emit events for tier completions
   */
  private checkTierCompletions(jobId: string, elapsedMs: number): void {
    const tierTimes = this.tierCompletionTimes.get(jobId) || {};
    const tiers = [ReportTier.BASIC, ReportTier.ENHANCED, ReportTier.FULL, ReportTier.EYE_OF_GOD];
    
    for (const tier of tiers) {
      if (!tierTimes[tier] && elapsedMs >= REPORT_TIER_BUDGETS[tier]) {
        tierTimes[tier] = new Date();
        this.tierCompletionTimes.set(jobId, tierTimes);
        
        // Emit tier completion event
        this.emit('tier:completed', { 
          jobId, 
          tier, 
          tierName: REPORT_TIER_NAMES[tier],
          completedAt: tierTimes[tier] 
        });
        
        console.log(`[CrawlerJobManager] Job ${jobId} completed ${REPORT_TIER_NAMES[tier]} tier`);
        
        // Compile a report at each tier milestone
        this.compileReport(jobId);
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
      const targetBudget = getTierTimeBudget(job.config.targetTier);
      if (elapsed >= targetBudget) return false;
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
    } else if (reason === 'manual_stop') {
      job.status = JobStatus.STOPPED_BY_USER;
    } else if (job.softFailureCount > 0 || job.hardFailureCount > 0) {
      job.status = JobStatus.COMPLETED_WITH_WARNINGS;
    } else {
      job.status = JobStatus.COMPLETED;
    }

    this.emit('job:stopped', { jobId, job, reason });
    console.log(`[CrawlerJobManager] Stopped job ${jobId}, reason: ${reason}, status: ${job.status}`);
  }

  /**
   * User-initiated hard stop via doomsday clock UI
   * Only allowed if minimum tier has been reached
   */
  hardStop(jobId: string): { success: boolean; error?: string; finalReport?: JobReport } {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { success: false, error: 'Job not found' };
    }

    if (job.status !== JobStatus.RUNNING && job.status !== JobStatus.PARTIAL_REPORT_AVAILABLE) {
      return { success: false, error: 'Job is not running' };
    }

    // Check if minimum tier has been reached
    const elapsed = job.startedAt ? Date.now() - job.startedAt.getTime() : 0;
    const minimumThreshold = REPORT_TIER_THRESHOLDS[job.config.minimumTier];
    
    if (elapsed < minimumThreshold) {
      const remainingMs = minimumThreshold - elapsed;
      const remainingSec = Math.ceil(remainingMs / 1000);
      return { 
        success: false, 
        error: `Cannot stop yet. ${REPORT_TIER_NAMES[job.config.minimumTier]} requires ${remainingSec}s more` 
      };
    }

    // Execute hard stop
    this.stopJob(jobId, 'manual_stop');
    
    const finalReport = this.getLatestReport(jobId);
    
    this.emit('job:hard_stop', { jobId, job, initiatedBy: 'user' });
    console.log(`[CrawlerJobManager] User initiated hard stop for job ${jobId} at tier ${job.currentTier}`);

    return { success: true, finalReport: finalReport || undefined };
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

  // ==================== DOOMSDAY CLOCK STATE ====================

  /**
   * Get the current doomsday clock state for UI display
   * Returns real-time progress through each tier
   */
  getDoomsdayClockState(jobId: string): DoomsdayClockState | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    const elapsed = job.startedAt ? Date.now() - job.startedAt.getTime() : 0;
    const results = this.results.get(jobId) || [];
    const tierCompletionTimes = this.tierCompletionTimes.get(jobId) || {};
    
    // Format elapsed time
    const formatTime = (ms: number): string => {
      const totalSec = Math.floor(Math.abs(ms) / 1000);
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      const sign = ms < 0 ? '-' : '';
      if (min >= 60) {
        const hr = Math.floor(min / 60);
        const remainMin = min % 60;
        return `${sign}${hr}:${remainMin.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
      }
      return `${sign}${min}:${sec.toString().padStart(2, '0')}`;
    };

    // Build clock states for each tier
    const clocks = DOOMSDAY_CLOCK_TIERS.map(tierConfig => {
      const threshold = tierConfig.thresholdMs;
      const isComplete = elapsed >= threshold;
      const progress = Math.min(100, (elapsed / threshold) * 100);
      const timeRemaining = threshold - elapsed;
      
      // Count results that belong to this tier's categories
      const tierCategories = TIER_DATA_CATEGORIES[tierConfig.tier];
      const tierResults = results.filter(r => {
        const category = r.metadata?.category as string || 'public_records';
        return tierCategories.includes(category);
      });

      return {
        tier: tierConfig.tier,
        name: tierConfig.name,
        icon: tierConfig.icon,
        color: tierConfig.color,
        progress: Math.round(progress * 10) / 10,
        timeRemainingMs: timeRemaining,
        timeRemainingFormatted: formatTime(timeRemaining),
        isComplete,
        completedAt: tierCompletionTimes[tierConfig.tier],
        fillPercentage: calculateTierFillPercentage(
          tierConfig.tier,
          results.map(r => r.metadata?.category as string || 'public_records'),
          tierResults.length
        ),
        dataCount: tierResults.length,
      };
    });

    // Check if minimum tier for stop has been reached
    const minimumThreshold = REPORT_TIER_THRESHOLDS[job.config.minimumTier];
    const minimumTierReached = elapsed >= minimumThreshold;

    return {
      jobId,
      isRunning: job.status === JobStatus.RUNNING || job.status === JobStatus.PARTIAL_REPORT_AVAILABLE,
      elapsedMs: elapsed,
      elapsedFormatted: formatTime(elapsed),
      activeTier: getActiveTierFromElapsed(elapsed),
      activeTierName: REPORT_TIER_NAMES[getActiveTierFromElapsed(elapsed)],
      clocks,
      canStop: minimumTierReached,
      minimumTierForStop: job.config.minimumTier,
      minimumTierReached,
    };
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

    // Calculate elapsed time and tier progress
    const elapsed = job.startedAt ? Date.now() - job.startedAt.getTime() : 0;
    const tierProgress = calculateTierProgress(elapsed);
    const currentTier = getCurrentTierFromElapsed(elapsed);
    const tierCompletionTimes = this.tierCompletionTimes.get(jobId) || {};

    // Generate tier-specific summaries
    const tierSummaries: Partial<Record<ReportTier, string>> = {};
    for (const tier of job.completedTiers) {
      tierSummaries[tier] = this.generateTierSummary(tier, job, results);
    }

    const report: JobReport = {
      id: randomUUID(),
      jobId,
      version: newVersion,
      compiledAt: new Date(),
      isPartial,
      currentTier,
      tierProgress,
      tierCompletedAt: tierCompletionTimes,
      totalResults: results.length,
      successCount: successResults.length,
      failureCount: failureResults.length,
      softFailures,
      hardFailures,
      data: successResults.map(r => r.data).filter(Boolean),
      summary: this.generateSummary(job, results),
      tierSummaries,
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
    console.log(`[CrawlerJobManager] Compiled report v${newVersion} for job ${jobId}: ${successResults.length}/${results.length} success, tier: ${REPORT_TIER_NAMES[currentTier]}`);

    return report;
  }

  private generateTierSummary(tier: ReportTier, job: CrawlJob, results: CrawlResult[]): string {
    const successCount = results.filter(r => r.success).length;
    const tierName = REPORT_TIER_NAMES[tier];
    const budget = REPORT_TIER_BUDGETS[tier] / 60000; // Convert to minutes
    
    switch (tier) {
      case ReportTier.BASIC:
        return `${tierName} (${budget}min): Quick scan complete with ${successCount} data points`;
      case ReportTier.ENHANCED:
        return `${tierName} (${budget}min): Expanded intelligence with ${successCount} verified sources`;
      case ReportTier.FULL:
        return `${tierName} (${budget}min): Comprehensive analysis with ${successCount} cross-referenced records`;
      case ReportTier.EYE_OF_GOD:
        return `${tierName} (${budget}min): Maximum depth PANTHEON doomsday scan with ${successCount} intelligence artifacts`;
      default:
        return `${tierName}: ${successCount} results`;
    }
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
   * Get job status for polling with tier information (minimal response, no cache headers)
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
    // Tier information
    targetTier: ReportTier;
    targetTierName: string;
    currentTier: ReportTier;
    currentTierName: string;
    completedTiers: ReportTier[];
    tierProgress: Record<ReportTier, number>;
  } | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    const elapsed = job.startedAt ? Date.now() - job.startedAt.getTime() : 0;
    const targetBudget = getTierTimeBudget(job.config.targetTier);
    const remaining = Math.max(0, targetBudget - elapsed);
    const progress = targetBudget > 0 ? Math.min(100, (elapsed / targetBudget) * 100) : 0;
    const tierProgress = calculateTierProgress(elapsed);
    const currentTier = getCurrentTierFromElapsed(elapsed);
    const completedTiers = getCompletedTiers(elapsed);

    return {
      status: job.status,
      progress: Math.round(progress),
      hasPartialReport: job.latestReportVersion > 0,
      reportVersion: job.latestReportVersion,
      successCount: job.successCount,
      totalAttempts: job.totalAttempts,
      elapsedMs: elapsed,
      remainingMs: remaining,
      // Tier information
      targetTier: job.config.targetTier,
      targetTierName: REPORT_TIER_NAMES[job.config.targetTier],
      currentTier,
      currentTierName: REPORT_TIER_NAMES[currentTier],
      completedTiers,
      tierProgress,
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
    this.tierCompletionTimes.delete(jobId);
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
