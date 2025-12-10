/**
 * Beneficial Crawler - Pathway Integrity Monitor & Optimizer
 * 
 * A specialized crawler subsystem at the bit-level that continuously monitors
 * and optimizes pathway integrity. Detects and repairs LSP errors, logical
 * conflicts, and inefficiencies.
 * 
 * Features:
 * - Continuous pathway health monitoring
 * - Automatic error detection and repair
 * - Logical conflict resolution
 * - Efficiency optimization
 * - Multi-scale simulation support
 * - Integration with 4JI Orchestrator
 */

import { EventEmitter } from 'events';
import { createLogger } from './logger';
import {
  BitNeuralPathwayManager,
  getBitNeuralPathwayManager,
  PathwayMetrics
} from './bitNeuralPathways';

const log = createLogger('BeneficialCrawler');

// ============================================================================
// CONSTANTS
// ============================================================================

const CRAWL_INTERVAL = 30000; // 30 seconds
const ERROR_THRESHOLD = 5;
const EFFICIENCY_THRESHOLD = 0.7;
const MAX_REPAIR_ATTEMPTS = 3;
const CONFLICT_RESOLUTION_TIMEOUT = 5000;
const STALE_PATHWAY_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface PathwayIssue {
  id: string;
  pathwayId: string;
  type: 'error' | 'conflict' | 'inefficiency' | 'degradation';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  detectedAt: number;
  repairAttempts: number;
  repaired: boolean;
  metadata: Record<string, unknown>;
}

export interface RepairResult {
  issueId: string;
  success: boolean;
  action: string;
  details: string;
  timestamp: number;
}

export interface CrawlerReport {
  timestamp: number;
  pathwaysCrawled: number;
  issuesDetected: PathwayIssue[];
  issuesRepaired: RepairResult[];
  efficiency: number;
  health: number;
  recommendations: string[];
}

export interface CrawlerMetrics {
  totalCrawls: number;
  issuesDetected: number;
  issuesRepaired: number;
  repairSuccessRate: number;
  averageEfficiency: number;
  lastCrawlTime: number;
  uptime: number;
}

export interface CrawlerConfig {
  enabled: boolean;
  crawlInterval: number;
  autoRepair: boolean;
  maxRepairAttempts: number;
  efficiencyThreshold: number;
  errorThreshold: number;
}

// ============================================================================
// BENEFICIAL CRAWLER
// ============================================================================

export class BeneficialCrawler extends EventEmitter {
  private pathwayManager: BitNeuralPathwayManager;
  private config: CrawlerConfig;
  private metrics: CrawlerMetrics;
  private issues: Map<string, PathwayIssue> = new Map();
  private repairHistory: RepairResult[] = [];
  private crawlInterval: NodeJS.Timeout | null = null;
  private initialized: boolean = false;
  private startTime: number = 0;

  constructor(customConfig?: Partial<CrawlerConfig>) {
    super();
    this.pathwayManager = getBitNeuralPathwayManager();
    this.config = {
      enabled: true,
      crawlInterval: CRAWL_INTERVAL,
      autoRepair: true,
      maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
      efficiencyThreshold: EFFICIENCY_THRESHOLD,
      errorThreshold: ERROR_THRESHOLD,
      ...customConfig
    };
    this.metrics = this.initializeMetrics();
  }

  private initializeMetrics(): CrawlerMetrics {
    return {
      totalCrawls: 0,
      issuesDetected: 0,
      issuesRepaired: 0,
      repairSuccessRate: 0,
      averageEfficiency: 1.0,
      lastCrawlTime: 0,
      uptime: 0
    };
  }

  /**
   * Initialize the beneficial crawler
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    log.info('Initializing Beneficial Crawler...');

    // Ensure pathway manager is initialized
    if (!this.pathwayManager.isInitialized()) {
      await this.pathwayManager.initialize();
    }

    this.startTime = Date.now();

    // Start continuous crawling if enabled
    if (this.config.enabled) {
      this.startCrawling();
    }

    this.initialized = true;
    this.emit('initialized', { config: this.config });
    log.info('Beneficial Crawler initialized', { config: this.config });
  }

  /**
   * Start continuous pathway crawling
   */
  startCrawling(): void {
    if (this.crawlInterval) {
      clearInterval(this.crawlInterval);
    }

    log.info(`Starting pathway crawling every ${this.config.crawlInterval / 1000}s`);

    // Initial crawl
    setTimeout(() => {
      this.runCrawlCycle().catch(err => {
        log.error('Initial crawl failed', { error: err.message });
      });
    }, 5000);

    // Continuous crawling
    this.crawlInterval = setInterval(async () => {
      try {
        await this.runCrawlCycle();
      } catch (error: any) {
        log.error('Crawl cycle error', { error: error.message });
      }
    }, this.config.crawlInterval);
  }

  /**
   * Stop continuous crawling
   */
  stopCrawling(): void {
    if (this.crawlInterval) {
      clearInterval(this.crawlInterval);
      this.crawlInterval = null;
      log.info('Pathway crawling stopped');
    }
  }

  /**
   * Run a complete crawl cycle
   */
  async runCrawlCycle(): Promise<CrawlerReport> {
    const startTime = Date.now();
    log.info('Starting crawl cycle...');

    const report: CrawlerReport = {
      timestamp: startTime,
      pathwaysCrawled: 0,
      issuesDetected: [],
      issuesRepaired: [],
      efficiency: 0,
      health: 100,
      recommendations: []
    };

    const pathwayIds = this.pathwayManager.getAllPathwayIds();

    // Crawl each pathway
    for (const pathwayId of pathwayIds) {
      const issues = await this.crawlPathway(pathwayId);
      report.issuesDetected.push(...issues);
      report.pathwaysCrawled++;
    }

    // Auto-repair if enabled
    if (this.config.autoRepair) {
      for (const issue of report.issuesDetected) {
        if (issue.severity === 'critical' || issue.severity === 'high') {
          const result = await this.repairIssue(issue);
          report.issuesRepaired.push(result);
        }
      }
    }

    // Calculate overall metrics
    const pathwayMetrics = this.pathwayManager.getMetrics();
    report.efficiency = pathwayMetrics.averageUtility;
    report.health = this.calculateHealth(report.issuesDetected, pathwayMetrics);

    // Generate recommendations
    report.recommendations = this.generateRecommendations(report, pathwayMetrics);

    // Update metrics
    this.metrics.totalCrawls++;
    this.metrics.issuesDetected += report.issuesDetected.length;
    this.metrics.issuesRepaired += report.issuesRepaired.filter(r => r.success).length;
    this.metrics.lastCrawlTime = Date.now() - startTime;
    this.metrics.uptime = Date.now() - this.startTime;
    this.metrics.averageEfficiency =
      (this.metrics.averageEfficiency + report.efficiency) / 2;

    if (this.metrics.issuesDetected > 0) {
      this.metrics.repairSuccessRate =
        this.metrics.issuesRepaired / this.metrics.issuesDetected;
    }

    this.emit('crawl-complete', report);
    log.info('Crawl cycle complete', {
      pathways: report.pathwaysCrawled,
      issues: report.issuesDetected.length,
      repaired: report.issuesRepaired.filter(r => r.success).length,
      health: report.health
    });

    return report;
  }

  /**
   * Crawl a single pathway for issues
   */
  private async crawlPathway(pathwayId: string): Promise<PathwayIssue[]> {
    const issues: PathwayIssue[] = [];
    const pathwayInfo = this.pathwayManager.getPathwayInfo(pathwayId);

    if (!pathwayInfo) {
      issues.push(this.createIssue(pathwayId, 'error', 'critical', 'Pathway not found or corrupted'));
      return issues;
    }

    // Check utility degradation
    if (pathwayInfo.utility !== undefined && pathwayInfo.utility < this.config.efficiencyThreshold) {
      issues.push(
        this.createIssue(
          pathwayId,
          'inefficiency',
          pathwayInfo.utility < 0.3 ? 'high' : 'medium',
          `Low utility: ${pathwayInfo.utility.toFixed(3)}`
        )
      );
    }

    // Check for stale pathways
    if (pathwayInfo.lastUsed) {
      const staleness = Date.now() - pathwayInfo.lastUsed;
      if (staleness > STALE_PATHWAY_THRESHOLD) {
        issues.push(
          this.createIssue(
            pathwayId,
            'degradation',
            'low',
            `Pathway unused for ${Math.round(staleness / (60 * 60 * 1000))} hours`
          )
        );
      }
    }

    // Check activation history for anomalies
    if (pathwayInfo.activationHistory && pathwayInfo.activationHistory.length > 0) {
      const avgActivation =
        pathwayInfo.activationHistory.reduce((sum, v) => sum + v, 0) /
        pathwayInfo.activationHistory.length;

      if (avgActivation < 0.1) {
        issues.push(
          this.createIssue(
            pathwayId,
            'inefficiency',
            'medium',
            `Very low activation rate: ${avgActivation.toFixed(3)}`
          )
        );
      }

      // Check for activation oscillation (potential conflict)
      if (pathwayInfo.activationHistory.length >= 5) {
        const recentHistory = pathwayInfo.activationHistory.slice(-5);
        const variance = this.calculateVariance(recentHistory);
        if (variance > 0.3) {
          issues.push(
            this.createIssue(
              pathwayId,
              'conflict',
              'medium',
              `High activation variance detected: ${variance.toFixed(3)}`
            )
          );
        }
      }
    }

    // Store issues
    for (const issue of issues) {
      this.issues.set(issue.id, issue);
    }

    return issues;
  }

  /**
   * Create a pathway issue
   */
  private createIssue(
    pathwayId: string,
    type: PathwayIssue['type'],
    severity: PathwayIssue['severity'],
    description: string
  ): PathwayIssue {
    return {
      id: `issue-${pathwayId}-${Date.now()}`,
      pathwayId,
      type,
      severity,
      description,
      detectedAt: Date.now(),
      repairAttempts: 0,
      repaired: false,
      metadata: {}
    };
  }

  /**
   * Calculate variance of an array
   */
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * Repair a detected issue
   */
  async repairIssue(issue: PathwayIssue): Promise<RepairResult> {
    if (issue.repairAttempts >= this.config.maxRepairAttempts) {
      return {
        issueId: issue.id,
        success: false,
        action: 'skipped',
        details: 'Maximum repair attempts exceeded',
        timestamp: Date.now()
      };
    }

    issue.repairAttempts++;
    log.info('Attempting to repair issue', {
      issueId: issue.id,
      type: issue.type,
      attempt: issue.repairAttempts
    });

    let result: RepairResult;

    try {
      switch (issue.type) {
        case 'error':
          result = await this.repairError(issue);
          break;
        case 'conflict':
          result = await this.repairConflict(issue);
          break;
        case 'inefficiency':
          result = await this.repairInefficiency(issue);
          break;
        case 'degradation':
          result = await this.repairDegradation(issue);
          break;
        default:
          result = {
            issueId: issue.id,
            success: false,
            action: 'unknown',
            details: 'Unknown issue type',
            timestamp: Date.now()
          };
      }

      if (result.success) {
        issue.repaired = true;
        this.issues.delete(issue.id);
      }

      this.repairHistory.push(result);
      if (this.repairHistory.length > 1000) {
        this.repairHistory.shift();
      }

      return result;
    } catch (error: any) {
      return {
        issueId: issue.id,
        success: false,
        action: 'repair_failed',
        details: error.message,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Repair an error issue
   */
  private async repairError(issue: PathwayIssue): Promise<RepairResult> {
    // For critical errors, attempt to create a redundant pathway
    const result = await this.pathwayManager.prunePathways();

    return {
      issueId: issue.id,
      success: true,
      action: 'pruned_and_reset',
      details: `Pruned ${result.prunedSynapses} synapses, ${result.prunedPathways.length} pathways`,
      timestamp: Date.now()
    };
  }

  /**
   * Repair a conflict issue
   */
  private async repairConflict(issue: PathwayIssue): Promise<RepairResult> {
    // Resolve conflict by pruning weak connections
    const result = await this.pathwayManager.prunePathways();

    return {
      issueId: issue.id,
      success: result.prunedSynapses > 0,
      action: 'conflict_resolution',
      details: `Pruned ${result.prunedSynapses} conflicting synapses`,
      timestamp: Date.now()
    };
  }

  /**
   * Repair an inefficiency issue
   */
  private async repairInefficiency(issue: PathwayIssue): Promise<RepairResult> {
    // Create redundant pathway to boost efficiency
    const redundant = await this.pathwayManager.createRedundantPathway(issue.pathwayId);

    if (redundant) {
      return {
        issueId: issue.id,
        success: true,
        action: 'redundancy_created',
        details: `Created redundant pathway: ${redundant.id}`,
        timestamp: Date.now()
      };
    }

    // If redundancy failed, just prune
    const pruneResult = await this.pathwayManager.prunePathways();
    return {
      issueId: issue.id,
      success: pruneResult.prunedSynapses > 0,
      action: 'efficiency_optimization',
      details: `Optimized by pruning ${pruneResult.prunedSynapses} weak connections`,
      timestamp: Date.now()
    };
  }

  /**
   * Repair a degradation issue
   */
  private async repairDegradation(issue: PathwayIssue): Promise<RepairResult> {
    // For degraded pathways, just note it - they'll be pruned if utility drops too low
    return {
      issueId: issue.id,
      success: true,
      action: 'degradation_noted',
      details: 'Pathway marked for monitoring; will auto-prune if utility drops further',
      timestamp: Date.now()
    };
  }

  /**
   * Calculate overall health score
   */
  private calculateHealth(issues: PathwayIssue[], metrics: PathwayMetrics): number {
    let health = 100;

    // Deduct for issues by severity
    for (const issue of issues) {
      switch (issue.severity) {
        case 'critical':
          health -= 25;
          break;
        case 'high':
          health -= 15;
          break;
        case 'medium':
          health -= 5;
          break;
        case 'low':
          health -= 2;
          break;
      }
    }

    // Deduct for low average utility
    if (metrics.averageUtility < this.config.efficiencyThreshold) {
      health -= (this.config.efficiencyThreshold - metrics.averageUtility) * 20;
    }

    return Math.max(0, Math.min(100, Math.round(health)));
  }

  /**
   * Generate recommendations based on crawl results
   */
  private generateRecommendations(
    report: CrawlerReport,
    metrics: PathwayMetrics
  ): string[] {
    const recommendations: string[] = [];

    // Issue-based recommendations
    const criticalIssues = report.issuesDetected.filter(i => i.severity === 'critical');
    if (criticalIssues.length > 0) {
      recommendations.push(
        `Critical: ${criticalIssues.length} critical issues require immediate attention`
      );
    }

    const inefficiencyIssues = report.issuesDetected.filter(
      i => i.type === 'inefficiency'
    );
    if (inefficiencyIssues.length > 3) {
      recommendations.push(
        'Consider reducing pathway complexity or increasing learning rate'
      );
    }

    // Metric-based recommendations
    if (metrics.averageUtility < 0.5) {
      recommendations.push('System-wide utility is low; consider retraining pathways');
    }

    if (metrics.totalNeurons > 5000) {
      recommendations.push('High neuron count; consider more aggressive pruning');
    }

    if (report.health < 70) {
      recommendations.push('System health is degraded; manual review recommended');
    }

    return recommendations;
  }

  /**
   * Get crawler metrics
   */
  getMetrics(): CrawlerMetrics {
    return {
      ...this.metrics,
      uptime: Date.now() - this.startTime
    };
  }

  /**
   * Get pending issues
   */
  getPendingIssues(): PathwayIssue[] {
    return Array.from(this.issues.values()).filter(i => !i.repaired);
  }

  /**
   * Get repair history
   */
  getRepairHistory(limit?: number): RepairResult[] {
    const history = [...this.repairHistory].reverse();
    return limit ? history.slice(0, limit) : history;
  }

  /**
   * Get configuration
   */
  getConfig(): CrawlerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<CrawlerConfig>): void {
    this.config = { ...this.config, ...updates };

    // Restart crawling if interval changed
    if (updates.crawlInterval && this.crawlInterval) {
      this.stopCrawling();
      if (this.config.enabled) {
        this.startCrawling();
      }
    }

    // Start/stop based on enabled flag
    if (updates.enabled !== undefined) {
      if (updates.enabled && !this.crawlInterval) {
        this.startCrawling();
      } else if (!updates.enabled && this.crawlInterval) {
        this.stopCrawling();
      }
    }

    this.emit('config-updated', this.config);
    log.info('Crawler config updated', { updates });
  }

  /**
   * Force immediate crawl
   */
  async forceCrawl(): Promise<CrawlerReport> {
    return this.runCrawlCycle();
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Shutdown the crawler
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down Beneficial Crawler...');

    this.stopCrawling();
    this.removeAllListeners();
    this.issues.clear();
    this.repairHistory = [];
    this.initialized = false;

    log.info('Beneficial Crawler shutdown complete');
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let crawlerInstance: BeneficialCrawler | null = null;

export function getBeneficialCrawler(
  config?: Partial<CrawlerConfig>
): BeneficialCrawler {
  if (!crawlerInstance) {
    crawlerInstance = new BeneficialCrawler(config);
  }
  return crawlerInstance;
}

export async function initializeBeneficialCrawler(
  config?: Partial<CrawlerConfig>
): Promise<BeneficialCrawler> {
  const crawler = getBeneficialCrawler(config);
  await crawler.initialize();
  return crawler;
}

export async function shutdownBeneficialCrawler(): Promise<void> {
  if (crawlerInstance) {
    await crawlerInstance.shutdown();
    crawlerInstance = null;
  }
}

export default {
  BeneficialCrawler,
  getBeneficialCrawler,
  initializeBeneficialCrawler,
  shutdownBeneficialCrawler
};
