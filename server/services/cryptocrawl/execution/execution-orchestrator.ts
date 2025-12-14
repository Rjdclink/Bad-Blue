/**
 * EXECUTION ORCHESTRATOR (STAGE 5)
 * 
 * Orchestrates execution flow from decision engine to execution stub.
 * Provides integration point between decision engine and execution layer.
 * 
 * STUB MODE ONLY - No live keys, no firing
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../../logger';
import type { DecisionResult } from '../decision-engine';
import { ExecutionStub, type ExecutionRequest, type ExecutionStubResult } from './execution-stub';

const log = createLogger('ExecutionOrchestrator');

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface ExecutionOrchestratorConfig {
  enabled: boolean;
  requireDecisionEngine: boolean;
  executionStub: {
    enabled: boolean;
    simulateLatency: boolean;
    latencyMs: number;
    simulateSuccessRate: number;
  };
}

export interface OrchestratedExecution {
  executionId: string;
  decisionResult: DecisionResult;
  executionResult: ExecutionStubResult;
  timestamp: Date;
  status: 'pending' | 'executed' | 'failed' | 'rejected';
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: ExecutionOrchestratorConfig = {
  enabled: true,
  requireDecisionEngine: true,
  executionStub: {
    enabled: true,
    simulateLatency: true,
    latencyMs: 50,
    simulateSuccessRate: 0.95,
  },
};

// ============================================================================
// EXECUTION ORCHESTRATOR CLASS
// ============================================================================

export class ExecutionOrchestrator extends EventEmitter {
  private config: ExecutionOrchestratorConfig;
  private executionStub: ExecutionStub;
  private initialized: boolean = false;
  private executionHistory: OrchestratedExecution[] = [];

  constructor(config?: Partial<ExecutionOrchestratorConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.executionStub = new ExecutionStub(this.config.executionStub);
    log.info('Execution Orchestrator created', { config: this.config });
  }

  /**
   * Initialize the orchestrator
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      log.warn('Execution Orchestrator already initialized');
      return;
    }

    log.info('Initializing Execution Orchestrator - STUB MODE');

    await this.executionStub.initialize();

    this.initialized = true;
    this.executionHistory = [];

    log.info('Execution Orchestrator initialized - STUB MODE (no live keys, no firing)');
    this.emit('initialized', { timestamp: new Date(), stubMode: true });
  }

  /**
   * Orchestrate execution from decision result
   */
  async orchestrateExecution(decisionResult: DecisionResult): Promise<OrchestratedExecution> {
    if (!this.initialized) {
      throw new Error('Execution Orchestrator not initialized. Call initialize() first.');
    }

    if (!this.config.enabled) {
      log.warn('Execution Orchestrator is disabled');
      return {
        executionId: `orch-${Date.now()}`,
        decisionResult,
        executionResult: {
          success: false,
          simulated: true,
          executionId: `stub-disabled`,
          timestamp: new Date(),
          latency: 0,
          error: 'Execution orchestrator is disabled',
        },
        timestamp: new Date(),
        status: 'rejected',
      };
    }

    // Validate decision result
    if (decisionResult.verdict !== 'PASS') {
      log.warn('Execution orchestration rejected - decision verdict is not PASS', {
        verdict: decisionResult.verdict,
        decisionId: decisionResult.decisionId,
      });

      return {
        executionId: `orch-${Date.now()}`,
        decisionResult,
        executionResult: {
          success: false,
          simulated: true,
          executionId: `stub-rejected`,
          timestamp: new Date(),
          latency: 0,
          error: `Decision verdict is ${decisionResult.verdict}, not PASS`,
        },
        timestamp: new Date(),
        status: 'rejected',
      };
    }

    // Extract opportunity from decision result
    if (!decisionResult.fusedSignal?.opportunity) {
      log.warn('Execution orchestration rejected - no opportunity in fused signal', {
        decisionId: decisionResult.decisionId,
      });

      return {
        executionId: `orch-${Date.now()}`,
        decisionResult,
        executionResult: {
          success: false,
          simulated: true,
          executionId: `stub-no-opportunity`,
          timestamp: new Date(),
          latency: 0,
          error: 'No opportunity in fused signal',
        },
        timestamp: new Date(),
        status: 'rejected',
      };
    }

    const opportunity = decisionResult.fusedSignal.opportunity;

    // Create execution request
    const executionRequest: ExecutionRequest = {
      decisionResult,
      opportunity: {
        asset: opportunity.asset,
        pair: opportunity.pair,
        chain: opportunity.chain,
        profitEstimate: opportunity.profitEstimate,
        confidence: opportunity.confidence,
      },
      executionParams: {
        // Stub mode - no actual gas parameters needed
        gasLimit: 200000,
      },
    };

    // Execute via stub
    log.info('Orchestrating execution via stub', {
      decisionId: decisionResult.decisionId,
      asset: opportunity.asset,
      chain: opportunity.chain,
      profitEstimate: opportunity.profitEstimate,
    });

    const executionResult = await this.executionStub.execute(executionRequest);

    const orchestratedExecution: OrchestratedExecution = {
      executionId: executionResult.executionId,
      decisionResult,
      executionResult,
      timestamp: new Date(),
      status: executionResult.success ? 'executed' : 'failed',
    };

    // Store in history
    this.executionHistory.push(orchestratedExecution);
    if (this.executionHistory.length > 1000) {
      this.executionHistory.shift();
    }

    log.info('Execution orchestration complete', {
      executionId: orchestratedExecution.executionId,
      status: orchestratedExecution.status,
      simulated: executionResult.simulated,
    });

    this.emit('execution-orchestrated', orchestratedExecution);

    return orchestratedExecution;
  }

  /**
   * Get execution history
   */
  getExecutionHistory(limit: number = 100): OrchestratedExecution[] {
    return this.executionHistory.slice(-limit);
  }

  /**
   * Get orchestrator status
   */
  getStatus(): {
    initialized: boolean;
    enabled: boolean;
    stubMode: true;
    executionCount: number;
    config: ExecutionOrchestratorConfig;
  } {
    return {
      initialized: this.initialized,
      enabled: this.config.enabled,
      stubMode: true,
      executionCount: this.executionHistory.length,
      config: { ...this.config },
    };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ExecutionOrchestratorConfig>): void {
    this.config = { ...this.config, ...updates };
    if (updates.executionStub) {
      this.executionStub.updateConfig(updates.executionStub);
    }
    log.info('Execution Orchestrator configuration updated', { updates });
  }

  /**
   * Shutdown orchestrator
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down Execution Orchestrator...');
    await this.executionStub.shutdown();
    this.initialized = false;
    this.executionHistory = [];
    this.removeAllListeners();
    log.info('Execution Orchestrator shutdown complete');
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

let executionOrchestratorInstance: ExecutionOrchestrator | null = null;

export function getExecutionOrchestrator(config?: Partial<ExecutionOrchestratorConfig>): ExecutionOrchestrator {
  if (!executionOrchestratorInstance) {
    executionOrchestratorInstance = new ExecutionOrchestrator(config);
  }
  return executionOrchestratorInstance;
}

export async function initializeExecutionOrchestrator(config?: Partial<ExecutionOrchestratorConfig>): Promise<ExecutionOrchestrator> {
  const orchestrator = getExecutionOrchestrator(config);
  await orchestrator.initialize();
  return orchestrator;
}

export default ExecutionOrchestrator;
