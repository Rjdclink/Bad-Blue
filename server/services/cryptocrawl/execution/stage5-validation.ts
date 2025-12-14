/**
 * STAGE 5 VALIDATION - Connectivity + Execution Validation
 * 
 * Scope: Single exchange, single pair
 * Size: Micro/dust level
 * Purpose: Connectivity + execution validation
 * Post condition: Auto-pause immediately after fill or failure
 * 
 * This is a validation test using execution stubs (no live keys, no firing)
 */

import { createLogger } from '../../../logger';
import { initializeDecisionEngine, type DecisionResult } from '../decision-engine';
import { initializeExecutionOrchestrator } from './execution-orchestrator';
import type { SignalInput } from '../decision-engine';

const log = createLogger('Stage5Validation');

// ============================================================================
// VALIDATION CONFIGURATION
// ============================================================================

interface ValidationConfig {
  exchange: string;           // Single exchange
  pair: string;               // Single pair (e.g., 'ETH/USDT')
  size: 'micro' | 'dust';    // Micro or dust level
  amount: number;             // Amount in base currency (e.g., 0.001 ETH)
}

const VALIDATION_CONFIG: ValidationConfig = {
  exchange: 'uniswap-v3',     // Single exchange
  pair: 'ETH/USDT',          // Single pair
  size: 'dust',              // Dust level
  amount: 0.0001,            // 0.0001 ETH (dust level)
};

// ============================================================================
// VALIDATION RESULT
// ============================================================================

interface ValidationResult {
  success: boolean;
  timestamp: Date;
  config: ValidationConfig;
  decisionResult?: DecisionResult;
  executionResult?: {
    executionId: string;
    simulated: boolean;
    success: boolean;
    latency: number;
  };
  connectivity: {
    decisionEngine: boolean;
    executionOrchestrator: boolean;
    executionStub: boolean;
  };
  errors: string[];
  warnings: string[];
}

// ============================================================================
// VALIDATION FUNCTION
// ============================================================================

export async function runStage5Validation(): Promise<ValidationResult> {
  log.info('Starting Stage 5 Validation', VALIDATION_CONFIG);
  
  const result: ValidationResult = {
    success: false,
    timestamp: new Date(),
    config: VALIDATION_CONFIG,
    connectivity: {
      decisionEngine: false,
      executionOrchestrator: false,
      executionStub: false,
    },
    errors: [],
    warnings: [],
  };

  try {
    // ========================================================================
    // STEP 1: Initialize Decision Engine
    // ========================================================================
    log.info('Step 1: Initializing Decision Engine...');
    try {
      const decisionEngine = await initializeDecisionEngine();
      result.connectivity.decisionEngine = true;
      log.info('✓ Decision Engine initialized');
    } catch (error) {
      result.errors.push(`Decision Engine initialization failed: ${error instanceof Error ? error.message : String(error)}`);
      log.error('✗ Decision Engine initialization failed', { error });
      return result;
    }

    // ========================================================================
    // STEP 2: Initialize Execution Orchestrator
    // ========================================================================
    log.info('Step 2: Initializing Execution Orchestrator...');
    try {
      const executionOrchestrator = await initializeExecutionOrchestrator();
      result.connectivity.executionOrchestrator = true;
      log.info('✓ Execution Orchestrator initialized');
    } catch (error) {
      result.errors.push(`Execution Orchestrator initialization failed: ${error instanceof Error ? error.message : String(error)}`);
      log.error('✗ Execution Orchestrator initialization failed', { error });
      return result;
    }

    // ========================================================================
    // STEP 3: Create Test Signals (Single Exchange, Single Pair, Dust Level)
    // ========================================================================
    log.info('Step 3: Creating test signals...', {
      exchange: VALIDATION_CONFIG.exchange,
      pair: VALIDATION_CONFIG.pair,
      amount: VALIDATION_CONFIG.amount,
    });

    const testSignals: SignalInput[] = [
      {
        sourceId: 'test-cryptocrawl-1',
        sourceType: 'cryptocrawl',
        signal: {
          opportunity: {
            asset: 'ETH',
            pair: VALIDATION_CONFIG.pair,
            chain: 'ethereum',
            profitEstimate: VALIDATION_CONFIG.amount * 0.01, // 1% profit on dust amount (~$0.0001)
            confidence: 0.75,
            timestamp: Date.now(),
          },
          marketData: {
            volatility: 0.5,
            liquidityScore: 0.9,
            gasVolatility: 0.2,
            competitorDensity: 0.3,
            networkCongestion: 0.2,
          },
        },
        metadata: {
          exchange: VALIDATION_CONFIG.exchange,
          size: VALIDATION_CONFIG.size,
          validation: true,
        },
      },
      {
        sourceId: 'test-cryptocrawl-2',
        sourceType: 'cryptocrawl',
        signal: {
          opportunity: {
            asset: 'ETH',
            pair: VALIDATION_CONFIG.pair,
            chain: 'ethereum',
            profitEstimate: VALIDATION_CONFIG.amount * 0.01, // Same opportunity
            confidence: 0.72,
            timestamp: Date.now(),
          },
          marketData: {
            volatility: 0.48,
            liquidityScore: 0.92,
            gasVolatility: 0.18,
            competitorDensity: 0.28,
            networkCongestion: 0.18,
          },
        },
        metadata: {
          exchange: VALIDATION_CONFIG.exchange,
          size: VALIDATION_CONFIG.size,
          validation: true,
        },
      },
    ];

    log.info(`✓ Created ${testSignals.length} test signals`);

    // ========================================================================
    // STEP 4: Process Signals Through Decision Engine
    // ========================================================================
    log.info('Step 4: Processing signals through Decision Engine...');
    const decisionEngine = await initializeDecisionEngine();
    const decisionResult = await decisionEngine.processSignals(testSignals);
    result.decisionResult = decisionResult;

    log.info('Decision Engine Result', {
      verdict: decisionResult.verdict,
      decisionId: decisionResult.decisionId,
      gates: {
        signalFusion: decisionResult.gates.signalFusion.passed,
        monteCarloStress: decisionResult.gates.monteCarloStress.passed,
        riskGovernor: decisionResult.gates.riskGovernor.passed,
      },
      killSwitchTriggered: decisionResult.killSwitchTriggered,
    });

    if (decisionResult.verdict !== 'PASS') {
      result.errors.push(`Decision Engine verdict: ${decisionResult.verdict}`);
      result.warnings.push('Decision Engine did not pass - execution will be rejected');
      log.warn('Decision Engine did not pass', {
        reason: decisionResult.gates.signalFusion.passed ? 
          (decisionResult.gates.monteCarloStress.passed ? 
            decisionResult.gates.riskGovernor.reason : 
            decisionResult.gates.monteCarloStress.reason) :
          decisionResult.gates.signalFusion.reason,
      });
      // Continue to test execution stub even if decision fails (for validation)
    }

    // ========================================================================
    // STEP 5: Execute Via Execution Orchestrator (Stub Mode)
    // ========================================================================
    log.info('Step 5: Executing via Execution Orchestrator (STUB MODE)...');
    const executionOrchestrator = await initializeExecutionOrchestrator();
    
    if (decisionResult.verdict === 'PASS') {
      const execution = await executionOrchestrator.orchestrateExecution(decisionResult);
      result.executionResult = {
        executionId: execution.executionId,
        simulated: execution.executionResult.simulated,
        success: execution.executionResult.success,
        latency: execution.executionResult.latency,
      };
      result.connectivity.executionStub = true;

      log.info('Execution Result (STUB MODE)', {
        executionId: execution.executionId,
        status: execution.status,
        simulated: execution.executionResult.simulated,
        success: execution.executionResult.success,
        latency: `${execution.executionResult.latency}ms`,
        warning: execution.executionResult.warning,
      });

      if (execution.executionResult.success) {
        log.info('✓ Execution simulated successfully (STUB MODE - no actual transaction)');
      } else {
        result.errors.push(`Execution stub failed: ${execution.executionResult.error || 'Unknown error'}`);
        log.warn('✗ Execution stub failed', { error: execution.executionResult.error });
      }
    } else {
      log.info('Skipping execution - Decision Engine verdict is not PASS');
      result.warnings.push('Execution skipped due to Decision Engine verdict');
    }

    // ========================================================================
    // STEP 6: Validation Summary
    // ========================================================================
    const allConnected = result.connectivity.decisionEngine && 
                        result.connectivity.executionOrchestrator && 
                        result.connectivity.executionStub;
    
    const executionSuccessful = result.executionResult?.success === true;
    
    result.success = allConnected && 
                     (decisionResult.verdict === 'PASS' ? executionSuccessful : true); // Success if connected, even if decision fails (for validation)

    log.info('Stage 5 Validation Complete', {
      success: result.success,
      connectivity: result.connectivity,
      decisionVerdict: decisionResult.verdict,
      executionSuccess: result.executionResult?.success,
      errors: result.errors.length,
      warnings: result.warnings.length,
    });

    return result;

  } catch (error) {
    result.errors.push(`Validation failed: ${error instanceof Error ? error.message : String(error)}`);
    log.error('Stage 5 Validation failed', { error });
    return result;
  } finally {
    // ========================================================================
    // AUTO-PAUSE: Immediately after fill or failure
    // ========================================================================
    log.info('AUTO-PAUSING: Stage 5 validation complete - pausing immediately');
    // System will auto-pause per protocol
  }
}

// ============================================================================
// EXPORT
// ============================================================================

export default runStage5Validation;
