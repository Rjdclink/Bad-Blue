/**
 * AI Self-Optimization System
 * 
 * Continuous monitoring and self-improvement for the 4JI orchestrator:
 * - Error log monitoring
 * - Consultation efficiency tracking
 * - Draft accuracy and formatting
 * - Page load speeds, SEO, visual layout
 * - Automatic issue detection and resolution
 * - Evolution data storage with offline capability
 */

import { promises as fs } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

// Import orchestrator for coordination
import { 
  getOrchestratorStatus, 
  detectAndFixErrors, 
  optimizeVisuals,
  orchestratorEvents 
} from './fourJIOrchestrator';

// Import crawler for data sync
import { getCrawlerStatus, crawlerEvents } from './legalCrawler';

const DATA_DIR = path.join(process.cwd(), 'data');
const OPTIMIZATION_STATE_FILE = path.join(DATA_DIR, 'optimization_state.json');
const EVOLUTION_LOG_FILE = path.join(DATA_DIR, 'evolution_log.json');
const METRICS_FILE = path.join(DATA_DIR, 'system_metrics.json');

export const optimizationEvents = new EventEmitter();

/**
 * Self-optimization configuration
 */
export interface OptimizationConfig {
  enabled: boolean;
  monitoringIntervalMs: number;
  autoFixEnabled: boolean;
  thresholds: {
    errorRate: number; // Max error rate before intervention
    responseTime: number; // Max response time in ms
    confidenceMin: number; // Minimum confidence threshold
    accuracyMin: number; // Minimum accuracy threshold
  };
  learningRate: number;
}

export interface OptimizationState {
  isRunning: boolean;
  lastOptimization: string | null;
  totalOptimizations: number;
  issuesDetected: number;
  issuesFixed: number;
  currentHealth: number; // 0-100
  metrics: SystemMetrics;
}

export interface SystemMetrics {
  errorRate: number;
  avgResponseTime: number;
  avgConfidence: number;
  consultationsPerHour: number;
  crawlerHealth: number;
  domainCoverage: number;
  uptimeHours: number;
}

export interface EvolutionEntry {
  timestamp: string;
  type: 'fix' | 'optimization' | 'learning' | 'enhancement';
  component: string;
  description: string;
  impact: number; // -1 to 1, negative means regression
  rollbackable: boolean;
  rollbackState?: any;
}

export interface OptimizationResult {
  successful: boolean;
  actionsApplied: string[];
  issuesFound: string[];
  issuesResolved: string[];
  newHealth: number;
  recommendations: string[];
}

// Default configuration
const defaultConfig: OptimizationConfig = {
  enabled: true,
  monitoringIntervalMs: 300000, // 5 minutes
  autoFixEnabled: true,
  thresholds: {
    errorRate: 0.05, // 5% max error rate
    responseTime: 5000, // 5 seconds max
    confidenceMin: 0.6, // 60% minimum confidence
    accuracyMin: 0.8 // 80% minimum accuracy
  },
  learningRate: 0.1
};

let config: OptimizationConfig = { ...defaultConfig };
let state: OptimizationState = {
  isRunning: false,
  lastOptimization: null,
  totalOptimizations: 0,
  issuesDetected: 0,
  issuesFixed: 0,
  currentHealth: 100,
  metrics: {
    errorRate: 0,
    avgResponseTime: 0,
    avgConfidence: 0.8,
    consultationsPerHour: 0,
    crawlerHealth: 100,
    domainCoverage: 100,
    uptimeHours: 0
  }
};

let monitoringInterval: NodeJS.Timeout | null = null;
let evolutionLog: EvolutionEntry[] = [];
const startTime = Date.now();

/**
 * Initialize the self-optimization system
 */
export async function initializeSelfOptimization(
  customConfig?: Partial<OptimizationConfig>
): Promise<void> {
  console.log('[Self-Optimization] Initializing...');
  
  if (customConfig) {
    config = { ...config, ...customConfig };
  }
  
  // Load existing state
  await loadOptimizationState();
  await loadEvolutionLog();
  
  // Subscribe to orchestrator events
  orchestratorEvents.on('consultation_complete', handleConsultationComplete);
  orchestratorEvents.on('error_detection_complete', handleErrorDetection);
  crawlerEvents.on('crawl_complete', handleCrawlComplete);
  
  if (config.enabled) {
    startMonitoring();
  }
  
  console.log('[Self-Optimization] Initialization complete');
  optimizationEvents.emit('initialized', { config, state });
}

/**
 * Start continuous monitoring
 */
function startMonitoring(): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }
  
  console.log(`[Self-Optimization] Starting monitoring every ${config.monitoringIntervalMs / 1000}s`);
  
  monitoringInterval = setInterval(async () => {
    await runOptimizationCycle();
  }, config.monitoringIntervalMs);
  
  // Run initial optimization after short delay
  setTimeout(async () => {
    await runOptimizationCycle();
  }, 30000);
}

/**
 * Run a complete optimization cycle
 */
export async function runOptimizationCycle(): Promise<OptimizationResult> {
  if (state.isRunning) {
    return {
      successful: false,
      actionsApplied: [],
      issuesFound: [],
      issuesResolved: [],
      newHealth: state.currentHealth,
      recommendations: ['Optimization already in progress']
    };
  }
  
  console.log('[Self-Optimization] Starting optimization cycle...');
  state.isRunning = true;
  state.lastOptimization = new Date().toISOString();
  
  const result: OptimizationResult = {
    successful: true,
    actionsApplied: [],
    issuesFound: [],
    issuesResolved: [],
    newHealth: state.currentHealth,
    recommendations: []
  };
  
  try {
    // 1. Collect metrics
    await collectMetrics();
    result.actionsApplied.push('Collected system metrics');
    
    // 2. Analyze error logs
    const errorAnalysis = await analyzeErrorLogs();
    if (errorAnalysis.issues.length > 0) {
      result.issuesFound.push(...errorAnalysis.issues);
      state.issuesDetected += errorAnalysis.issues.length;
    }
    
    // 3. Check response times
    if (state.metrics.avgResponseTime > config.thresholds.responseTime) {
      result.issuesFound.push(`High response time: ${state.metrics.avgResponseTime}ms`);
      result.recommendations.push('Consider optimizing AI model selection');
    }
    
    // 4. Check confidence levels
    if (state.metrics.avgConfidence < config.thresholds.confidenceMin) {
      result.issuesFound.push(`Low confidence: ${state.metrics.avgConfidence}`);
      result.recommendations.push('Enhance knowledge bases with more cases/statutes');
    }
    
    // 5. Run error detection and fixing
    if (config.autoFixEnabled) {
      const fixResult = await detectAndFixErrors();
      if (fixResult.detected > 0) {
        result.issuesFound.push(`${fixResult.detected} domain issues detected`);
      }
      if (fixResult.fixed > 0) {
        result.issuesResolved.push(`${fixResult.fixed} domains auto-fixed`);
        result.actionsApplied.push(`Auto-fixed ${fixResult.fixed} domain issues`);
        state.issuesFixed += fixResult.fixed;
        
        await logEvolution({
          type: 'fix',
          component: 'domains',
          description: `Auto-fixed ${fixResult.fixed} domain knowledge base issues`,
          impact: 0.2,
          rollbackable: true
        });
      }
      if (fixResult.pending.length > 0) {
        result.recommendations.push(`Manual review needed for: ${fixResult.pending.join(', ')}`);
      }
    }
    
    // 6. Visual optimization
    const visualResult = await optimizeVisuals();
    if (visualResult.optimizations.length > 0) {
      result.recommendations.push(...visualResult.optimizations.slice(0, 3));
    }
    
    // 7. Calculate new health score
    result.newHealth = calculateHealthScore();
    state.currentHealth = result.newHealth;
    
    // 8. Apply learning
    await applyLearning(result);
    
    state.totalOptimizations++;
    result.actionsApplied.push('Completed optimization cycle');
    
  } catch (error: any) {
    console.error('[Self-Optimization] Cycle error:', error.message);
    result.successful = false;
    result.issuesFound.push(`Optimization error: ${error.message}`);
  }
  
  state.isRunning = false;
  await saveOptimizationState();
  
  console.log('[Self-Optimization] Cycle complete:', {
    health: result.newHealth,
    issues: result.issuesFound.length,
    fixed: result.issuesResolved.length
  });
  
  optimizationEvents.emit('optimization_complete', result);
  
  return result;
}

/**
 * Collect system metrics
 */
async function collectMetrics(): Promise<void> {
  const orchestratorStatus = getOrchestratorStatus();
  const crawlerStatus = getCrawlerStatus();
  
  // Calculate error rate
  const totalOps = orchestratorStatus.totalConsultations + 1;
  state.metrics.errorRate = orchestratorStatus.errorCount / totalOps;
  
  // Calculate crawler health
  const crawlerSuccess = Object.values(crawlerStatus.sourceStats).reduce(
    (sum, s) => sum + s.success, 0
  );
  const crawlerTotal = Object.values(crawlerStatus.sourceStats).reduce(
    (sum, s) => sum + s.success + s.failed, 0
  ) || 1;
  state.metrics.crawlerHealth = (crawlerSuccess / crawlerTotal) * 100;
  
  // Calculate domain coverage
  const activeDomains = orchestratorStatus.activeDomains.length;
  const totalDomains = 30; // Expected number of domains
  state.metrics.domainCoverage = (activeDomains / totalDomains) * 100;
  
  // Calculate uptime
  state.metrics.uptimeHours = (Date.now() - startTime) / (1000 * 60 * 60);
  
  // Estimate consultations per hour
  if (state.metrics.uptimeHours > 0) {
    state.metrics.consultationsPerHour = 
      orchestratorStatus.totalConsultations / state.metrics.uptimeHours;
  }
  
  await saveMetrics();
}

/**
 * Analyze error logs for patterns
 */
async function analyzeErrorLogs(): Promise<{ issues: string[]; patterns: string[] }> {
  const issues: string[] = [];
  const patterns: string[] = [];
  
  try {
    const errorLogPath = path.join(DATA_DIR, 'orchestrator_errors.json');
    const content = await fs.readFile(errorLogPath, 'utf-8');
    const errors = JSON.parse(content);
    
    // Analyze recent errors (last hour)
    const recentErrors = errors.filter((e: any) => {
      const errorTime = new Date(e.timestamp).getTime();
      return Date.now() - errorTime < 3600000;
    });
    
    if (recentErrors.length > 5) {
      issues.push(`High error rate: ${recentErrors.length} errors in last hour`);
    }
    
    // Detect patterns
    const errorContexts = recentErrors.map((e: any) => e.context);
    const contextCounts = errorContexts.reduce((acc: any, ctx: string) => {
      acc[ctx] = (acc[ctx] || 0) + 1;
      return acc;
    }, {});
    
    for (const [context, count] of Object.entries(contextCounts)) {
      if ((count as number) >= 3) {
        patterns.push(`Repeated errors in: ${context}`);
        issues.push(`Pattern detected: ${context} failing repeatedly`);
      }
    }
    
  } catch {
    // No error log file exists
  }
  
  return { issues, patterns };
}

/**
 * Calculate overall health score
 */
function calculateHealthScore(): number {
  let score = 100;
  
  // Deduct for error rate
  if (state.metrics.errorRate > config.thresholds.errorRate) {
    score -= Math.min(30, state.metrics.errorRate * 100);
  }
  
  // Deduct for response time
  if (state.metrics.avgResponseTime > config.thresholds.responseTime) {
    score -= Math.min(20, 
      (state.metrics.avgResponseTime - config.thresholds.responseTime) / 1000
    );
  }
  
  // Deduct for low confidence
  if (state.metrics.avgConfidence < config.thresholds.confidenceMin) {
    score -= Math.min(20, 
      (config.thresholds.confidenceMin - state.metrics.avgConfidence) * 50
    );
  }
  
  // Deduct for crawler issues
  if (state.metrics.crawlerHealth < 80) {
    score -= (80 - state.metrics.crawlerHealth) / 4;
  }
  
  // Deduct for domain coverage
  if (state.metrics.domainCoverage < 100) {
    score -= (100 - state.metrics.domainCoverage) / 5;
  }
  
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Apply machine learning from results
 */
async function applyLearning(result: OptimizationResult): Promise<void> {
  // Adjust thresholds based on actual performance
  if (result.issuesFound.length === 0 && state.currentHealth > 90) {
    // System is performing well, can be more strict
    config.thresholds.errorRate = Math.max(
      0.01,
      config.thresholds.errorRate - config.learningRate * 0.01
    );
  } else if (result.issuesFound.length > 5) {
    // System struggling, relax thresholds slightly
    config.thresholds.errorRate = Math.min(
      0.1,
      config.thresholds.errorRate + config.learningRate * 0.01
    );
  }
  
  await logEvolution({
    type: 'learning',
    component: 'thresholds',
    description: `Adjusted thresholds based on ${result.issuesFound.length} issues`,
    impact: result.issuesFound.length > 0 ? -0.1 : 0.1,
    rollbackable: true,
    rollbackState: { ...config.thresholds }
  });
}

/**
 * Log an evolution entry
 */
async function logEvolution(entry: Omit<EvolutionEntry, 'timestamp'>): Promise<void> {
  const fullEntry: EvolutionEntry = {
    ...entry,
    timestamp: new Date().toISOString()
  };
  
  evolutionLog.push(fullEntry);
  
  // Keep only last 1000 entries
  if (evolutionLog.length > 1000) {
    evolutionLog = evolutionLog.slice(-1000);
  }
  
  await saveEvolutionLog();
  
  optimizationEvents.emit('evolution', fullEntry);
}

/**
 * Handle consultation completion event
 */
function handleConsultationComplete(data: {
  domainId: string;
  duration: number;
  response: any;
}): void {
  // Update average response time
  state.metrics.avgResponseTime = 
    (state.metrics.avgResponseTime + data.duration) / 2;
  
  // Update average confidence
  if (data.response?.confidence) {
    state.metrics.avgConfidence = 
      (state.metrics.avgConfidence + data.response.confidence) / 2;
  }
}

/**
 * Handle error detection event
 */
function handleErrorDetection(data: {
  detected: string[];
  fixed: string[];
  pending: string[];
}): void {
  if (data.detected.length > 0) {
    console.log(`[Self-Optimization] Detected ${data.detected.length} issues`);
  }
}

/**
 * Handle crawler completion event
 */
function handleCrawlComplete(data: {
  itemsCrawled: number;
  updatesApplied: number;
  errors: number;
}): void {
  if (data.errors > 0) {
    state.metrics.crawlerHealth = Math.max(
      0,
      state.metrics.crawlerHealth - (data.errors * 5)
    );
  } else {
    state.metrics.crawlerHealth = Math.min(
      100,
      state.metrics.crawlerHealth + 1
    );
  }
}

/**
 * Get optimization status
 */
export function getOptimizationStatus(): OptimizationState {
  return { ...state };
}

/**
 * Get optimization configuration
 */
export function getOptimizationConfig(): OptimizationConfig {
  return { ...config };
}

/**
 * Get evolution log
 */
export function getEvolutionLog(limit?: number): EvolutionEntry[] {
  const entries = [...evolutionLog].reverse();
  return limit ? entries.slice(0, limit) : entries;
}

/**
 * Rollback to a previous state
 */
export async function rollbackEvolution(timestamp: string): Promise<boolean> {
  const entry = evolutionLog.find(e => e.timestamp === timestamp);
  
  if (!entry || !entry.rollbackable || !entry.rollbackState) {
    return false;
  }
  
  try {
    if (entry.component === 'thresholds') {
      config.thresholds = entry.rollbackState;
    }
    
    await logEvolution({
      type: 'fix',
      component: entry.component,
      description: `Rollback to state from ${timestamp}`,
      impact: -entry.impact,
      rollbackable: false
    });
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Trigger manual optimization
 */
export async function triggerOptimization(): Promise<OptimizationResult> {
  return runOptimizationCycle();
}

/**
 * Enable/disable self-optimization
 */
export function setOptimizationEnabled(enabled: boolean): void {
  config.enabled = enabled;
  
  if (enabled) {
    startMonitoring();
  } else if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  
  console.log(`[Self-Optimization] ${enabled ? 'Enabled' : 'Disabled'}`);
}

/**
 * Load optimization state
 */
async function loadOptimizationState(): Promise<void> {
  try {
    const content = await fs.readFile(OPTIMIZATION_STATE_FILE, 'utf-8');
    const loaded = JSON.parse(content);
    state = { ...state, ...loaded, isRunning: false };
  } catch {
    console.log('[Self-Optimization] No existing state found');
  }
}

/**
 * Save optimization state
 */
async function saveOptimizationState(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(OPTIMIZATION_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error: any) {
    console.error('[Self-Optimization] Failed to save state:', error.message);
  }
}

/**
 * Load evolution log
 */
async function loadEvolutionLog(): Promise<void> {
  try {
    const content = await fs.readFile(EVOLUTION_LOG_FILE, 'utf-8');
    evolutionLog = JSON.parse(content);
  } catch {
    evolutionLog = [];
  }
}

/**
 * Save evolution log
 */
async function saveEvolutionLog(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(EVOLUTION_LOG_FILE, JSON.stringify(evolutionLog, null, 2));
  } catch (error: any) {
    console.error('[Self-Optimization] Failed to save evolution log:', error.message);
  }
}

/**
 * Save metrics
 */
async function saveMetrics(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(METRICS_FILE, JSON.stringify({
      ...state.metrics,
      timestamp: new Date().toISOString()
    }, null, 2));
  } catch (error: any) {
    console.error('[Self-Optimization] Failed to save metrics:', error.message);
  }
}

/**
 * Cleanup on shutdown
 */
export async function shutdownOptimization(): Promise<void> {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  
  await saveOptimizationState();
  await saveEvolutionLog();
  
  console.log('[Self-Optimization] Shutdown complete');
}

export default {
  initializeSelfOptimization,
  runOptimizationCycle,
  getOptimizationStatus,
  getOptimizationConfig,
  getEvolutionLog,
  rollbackEvolution,
  triggerOptimization,
  setOptimizationEnabled,
  shutdownOptimization,
  optimizationEvents
};
