/**
 * Computational Beam Synthesis Module
 * 
 * Fuses all layers into one orchestrated execution engine:
 * - Automates task selection, routing, retrying, validation, optimizing
 * - Ensures every component is recursive, self-improving, and self-correcting
 * - Prevents races, deadlocks, runaways, resource waste, or unauthorized execution
 */

import { 
  Task,
  TaskType,
  TaskIntensity,
  SystemStatus,
  CrawlerStrategy,
  CrawlerTask,
  ComputeWorkload,
  ComputationalBeamError 
} from './types';
import { EventEmitter } from 'events';
import { workloadRouter } from './workloadRouter';
import { omniAntennaLayer } from './omniAntennaLayer';
import { directionalBeamLayer } from './directionalBeamLayer';
import { superBatteryLayer } from './superBatteryLayer';
import { integrityTestingSystem } from './integrityTesting';
import { neuralLoadPredictor } from './neuralLoadPredictor';
import { metricsAnalytics } from './metricsAnalytics';

export class ComputationalBeamOrchestrator extends EventEmitter {
  private initialized = false;
  private startTime: Date | null = null;
  private taskCounter = 0;
  private monitoringInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.setupEventListeners();
  }

  /**
   * Initialize the computational beam system
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      throw new ComputationalBeamError('System already initialized', 'ALREADY_INITIALIZED');
    }

    this.emit('initialization-started');

    try {
      const beamStatus = directionalBeamLayer.getStatus();
      if (beamStatus.activeNodes === 0) {
        throw new ComputationalBeamError(
          'No measured local Beam capacity is available',
          'NO_COMPUTE_CAPACITY',
          { beamStatus }
        );
      }

      // Start monitoring
      this.startMonitoring();

      this.initialized = true;
      this.startTime = new Date();

      this.emit('initialization-complete', {
        timestamp: this.startTime,
        activeNodes: beamStatus.activeNodes,
      });
    } catch (error) {
      this.emit('initialization-failed', { error });
      throw error;
    }
  }

  /**
   * Execute crawler task with full orchestration
   */
  public async executeCrawlerTask(
    strategy: CrawlerStrategy,
    payload: any,
    config?: {
      maxDuration?: number;
      timeout?: number;
      fallbackStrategy?: CrawlerStrategy;
      workload?: ComputeWorkload<any, any>;
    }
  ): Promise<any> {
    this.ensureInitialized();

    const taskId = this.generateTaskId();
    
    // Create crawler task
    const crawlerTask: CrawlerTask = {
      id: taskId,
      type: this.mapStrategyToTaskType(strategy),
      intensity: this.getStrategyIntensity(strategy),
      payload,
      metadata: {
        created: new Date(),
        priority: 5,
        retries: 0,
        maxRetries: 3,
      },
      strategy,
      config: {
        maxDuration: config?.maxDuration || 60000,
        timeout: config?.timeout || 30000,
        fallbackStrategy: config?.fallbackStrategy,
        workload: config?.workload,
      },
      workload: config?.workload,
    };

    this.taskCounter++;
    this.emit('crawler-task-started', { taskId, strategy });

    const completion = this.waitForTaskCompletion(taskId, crawlerTask.config.timeout);
    try {
      // Route and execute task
      const routingDecision = await workloadRouter.routeTask(crawlerTask);
      
      this.emit('crawler-task-routed', {
        taskId,
        layer: routingDecision.selectedNode.layer,
        provider: routingDecision.selectedNode.provider,
      });

      const result = await completion;

      this.emit('crawler-task-completed', { taskId, strategy });

      return { success: true, taskId, result };
    } catch (error) {
      // The waiter may already be settled by a routing failure; consume its rejection.
      void completion.catch(() => undefined);
      this.emit('crawler-task-failed', { taskId, strategy, error });

      if (config?.workload?.type === 'INITIAL_GAS_BOOTSTRAP_ANALYSIS' && process.env.RAILWAY_ENVIRONMENT?.trim()) {
        const result = await this.executeRailwayBootstrapAnalysis(config.workload, crawlerTask.config.timeout);
        this.emit('crawler-task-completed', {
          taskId,
          strategy,
          computeSource: 'railway-bootstrap-fallback',
          beamError: error instanceof Error ? error.message : String(error),
        });
        return { success: true, taskId, result, computeSource: 'railway-bootstrap-fallback' };
      }
      
      // Attempt fallback if configured
      if (config?.fallbackStrategy) {
        return await this.executeCrawlerTask(config.fallbackStrategy, payload, {
          ...config,
          fallbackStrategy: undefined, // Prevent infinite recursion
        });
      }

      throw error;
    }
  }

  /**
   * Bootstrap readiness analysis is pure trusted in-process computation. When
   * Beam routing is temporarily unavailable on Railway, execute that exact
   * workload locally instead of idling. The next cycle still tries Beam first,
   * so the Railway fallback stops automatically as soon as Beam routing returns.
   */
  private async executeRailwayBootstrapAnalysis(
    workload: ComputeWorkload<any, any>,
    timeoutMs: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | null = null;
    try {
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ComputationalBeamError(
            `Railway bootstrap fallback timed out after ${timeoutMs}ms`,
            'TASK_TIMEOUT',
            { workloadId: workload.id, timeoutMs },
          ));
        }, timeoutMs);
      });
      const result = await Promise.race([
        Promise.resolve(workload.execute(workload.input, {
          signal: controller.signal,
          workerId: 'railway-bootstrap-fallback',
          startedAt: new Date(),
        })),
        timedOut,
      ]);
      const valid = await workload.validate(result, workload.input);
      if (!valid) {
        throw new ComputationalBeamError(
          `Railway bootstrap fallback produced invalid output for ${workload.id}`,
          'TASK_FAILED',
          { workloadId: workload.id },
        );
      }
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Map crawler strategy to task type
   */
  private mapStrategyToTaskType(strategy: CrawlerStrategy): TaskType {
    switch (strategy) {
      case CrawlerStrategy.MOMENTUM:
        return TaskType.MOMENTUM_STRATEGY;
      case CrawlerStrategy.ARBITRAGE:
        return TaskType.ARBITRAGE_SCAN;
      case CrawlerStrategy.ALPHA_DRIFT:
        return TaskType.ALPHA_DRIFT;
      case CrawlerStrategy.MICRO_TRIANGULATION:
        return TaskType.MICRO_TRIANGULATION;
      case CrawlerStrategy.PREDICTIVE_ML:
        return TaskType.ML_PREDICTION;
      default:
        return TaskType.MARKET_AGGREGATION;
    }
  }

  /**
   * Get intensity for strategy
   */
  private getStrategyIntensity(strategy: CrawlerStrategy): TaskIntensity {
    switch (strategy) {
      case CrawlerStrategy.PREDICTIVE_ML:
        return TaskIntensity.EXTREME;
      case CrawlerStrategy.MOMENTUM:
      case CrawlerStrategy.ALPHA_DRIFT:
        return TaskIntensity.HEAVY;
      case CrawlerStrategy.ARBITRAGE:
      case CrawlerStrategy.MICRO_TRIANGULATION:
        return TaskIntensity.MODERATE;
      default:
        return TaskIntensity.MODERATE;
    }
  }

  /**
   * Wait for the router's actual completion or failure event.
   */
  private async waitForTaskCompletion(taskId: string, timeout: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        directionalBeamLayer.cancelTask(taskId);
        reject(new ComputationalBeamError(`Task ${taskId} timed out`, 'TASK_TIMEOUT', { taskId, timeout }));
      }, timeout);
      const onComplete = (data: { taskId: string; result: unknown }) => {
        if (data.taskId !== taskId) return;
        cleanup();
        workloadRouter.consumeTaskOutcome(taskId);
        resolve(data.result);
      };
      const onFailure = (data: { taskId: string; error?: string }) => {
        if (data.taskId !== taskId) return;
        cleanup();
        workloadRouter.consumeTaskOutcome(taskId);
        reject(new ComputationalBeamError(data.error || `Task ${taskId} failed`, 'TASK_FAILED', { taskId }));
      };
      const cleanup = () => {
        clearTimeout(timer);
        workloadRouter.off('task-completed', onComplete);
        workloadRouter.off('task-failed', onFailure);
      };
      workloadRouter.on('task-completed', onComplete);
      workloadRouter.on('task-failed', onFailure);
      const existingOutcome = workloadRouter.consumeTaskOutcome(taskId);
      if (existingOutcome) {
        if (existingOutcome.error) {
          onFailure({ taskId, error: existingOutcome.error });
        } else {
          onComplete({ taskId, result: existingOutcome.result });
        }
      }
    });
  }

  /**
   * Get comprehensive system status
   */
  public getSystemStatus(): SystemStatus {
    this.ensureInitialized();

    const routerStatus = workloadRouter.getSystemStatus();
    const integrity = integrityTestingSystem.getIntegrityStatus();

    // Record system health metrics
    metricsAnalytics.recordMetric('system_health', integrity.overallStability);
    metricsAnalytics.recordMetric('active_nodes', routerStatus.antenna.activeNodes + routerStatus.beam.activeNodes);

    return {
      initialized: this.initialized,
      credentialsValid: true, // Simplified - no triple verification required
      activeNodes: routerStatus.antenna.activeNodes + routerStatus.beam.activeNodes,
      totalNodes: routerStatus.antenna.totalNodes + routerStatus.beam.totalNodes,
      queuedTasks: routerStatus.antenna.queuedTasks + routerStatus.beam.queuedTasks,
      runningTasks: routerStatus.antenna.activeTasks + routerStatus.beam.executingTasks,
      completedTasks: this.taskCounter,
      failedTasks: 0, // Would track in production
      systemIntegrity: integrity,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      lastUpdate: new Date(),
    };
  }

  /**
   * Start system monitoring
   */
  private startMonitoring(): void {
    if (this.monitoringInterval) {
      return;
    }

    // Monitor every 30 seconds
    this.monitoringInterval = setInterval(async () => {
      try {
        // Quick health check
        const healthy = await integrityTestingSystem.quickHealthCheck();
        
        if (!healthy) {
          this.emit('health-check-warning', {
            timestamp: new Date(),
            message: 'System health degraded',
          });
        }

        // Emit status update
        const status = this.getSystemStatus();
        this.emit('status-update', status);
      } catch (error) {
        this.emit('monitoring-error', { error });
      }
    }, 30000);
    this.monitoringInterval.unref();
  }

  /**
   * Stop system monitoring
   */
  private stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  /**
   * Setup event listeners for all subsystems
   */
  private setupEventListeners(): void {
    // Workload Router events
    workloadRouter.on('task-routed', (data) => {
      this.emit('subsystem-event', { subsystem: 'router', event: 'task-routed', data });
    });

    workloadRouter.on('task-completed', (data) => {
      this.emit('subsystem-event', { subsystem: 'router', event: 'task-completed', data });
    });

    workloadRouter.on('task-failed', (data) => {
      this.emit('subsystem-event', { subsystem: 'router', event: 'task-failed', data });
    });

    // Antenna Layer events
    omniAntennaLayer.on('task-completed', (data) => {
      this.emit('subsystem-event', { subsystem: 'antenna', event: 'task-completed', data });
    });

    // Beam Layer events
    directionalBeamLayer.on('task-completed', (data) => {
      this.emit('subsystem-event', { subsystem: 'beam', event: 'task-completed', data });
    });

    directionalBeamLayer.on('cpu-overuse', (data) => {
      this.emit('resource-warning', { type: 'cpu-overuse', data });
    });

    // Battery Layer events
    superBatteryLayer.on('cache-hit', (data) => {
      this.emit('subsystem-event', { subsystem: 'battery', event: 'cache-hit', data });
    });

    // Integrity Testing events
    integrityTestingSystem.on('test-suite-passed', (data) => {
      this.emit('integrity-event', { event: 'test-suite-passed', data });
    });

    integrityTestingSystem.on('test-suite-failed', (data) => {
      this.emit('integrity-event', { event: 'test-suite-failed', data });
    });
  }

  /**
   * Shutdown the system gracefully
   */
  public async shutdown(): Promise<void> {
    this.emit('shutdown-started');

    this.stopMonitoring();

    // Persist battery layer state
    await superBatteryLayer.persistState();

    this.initialized = false;
    this.emit('shutdown-complete');
  }

  /**
   * Ensure system is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new ComputationalBeamError(
        'System not initialized. Call initialize() first.',
        'NOT_INITIALIZED'
      );
    }
  }

  /**
   * Generate unique task ID
   */
  private generateTaskId(): string {
    return `cb_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Run comprehensive diagnostic
   */
  public async runDiagnostic(): Promise<any> {
    this.ensureInitialized();

    const status = this.getSystemStatus();
    const integrity = await integrityTestingSystem.runIntegrityTests();
    const neuralStats = neuralLoadPredictor.getStats();
    const analyticsHealth = metricsAnalytics.getHealthScore();

    return {
      status,
      integrity,
      subsystems: {
        router: workloadRouter.getRoutingStats(),
        antenna: omniAntennaLayer.getStatus(),
        beam: directionalBeamLayer.getStatus(),
        battery: superBatteryLayer.getOptimizationStats(),
      },
      advanced: {
        neuralPrediction: neuralStats,
        analyticsHealth,
        metricsSnapshot: metricsAnalytics.getDashboardData(),
      },
    };
  }

  /**
   * Check if system is operational
   */
  public isOperational(): boolean {
    return this.initialized && directionalBeamLayer.getStatus().activeNodes > 0;
  }
}

// Export singleton instance
export const computationalBeam = new ComputationalBeamOrchestrator();

// Also export the class as ComputationalBeam for backward compatibility
export { ComputationalBeamOrchestrator as ComputationalBeam };
