/**
 * GOVERNANCE API - Stage Control & System Management Endpoints
 * 
 * Provides API endpoints for:
 * - Stage progression and status
 * - Profit ramp tier management
 * - Execution gate control
 * - System locks and pauses
 * - Cryptara status
 */

import express from 'express';
import { composer, SystemScope, LockType } from '../governance/composer';
import { stageController } from '../governance/stage-controller';
import { profitRampGovernor } from '../governance/profit-ramp-governor';
import { executionGate, ExecutionMode } from '../governance/execution-gate';
import { cryptaraController } from '../cryptara/cryptara-controller';
import { executeStage6 } from '../stages/stage-6-profit-ramp';
import { executeStage7 } from '../stages/stage-7-ui-check';
import { executeStage8 } from '../stages/stage-8-dry-run';

const router = express.Router();

// ============================================================================
// COMPOSER ENDPOINTS
// ============================================================================

// GET /api/crypto/governance/composer/status
router.get('/composer/status', (req, res) => {
  try {
    const state = composer.getState();
    const commandHistory = composer.getCommandHistory(10);

    res.json({
      success: true,
      state,
      recentCommands: commandHistory,
      canExecute: composer.canExecute(),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/crypto/governance/composer/pause
router.post('/composer/pause', (req, res) => {
  try {
    const { reason } = req.body;
    
    if (!reason) {
      return res.status(400).json({ success: false, error: 'Reason required' });
    }

    composer.pauseSystem(reason);

    res.json({
      success: true,
      message: 'System paused',
      reason,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/crypto/governance/composer/resume
router.post('/composer/resume', (req, res) => {
  try {
    composer.resumeSystem();

    res.json({
      success: true,
      message: 'System resumed',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/crypto/governance/composer/scope
router.post('/composer/scope', (req, res) => {
  try {
    const { scope } = req.body;
    
    if (!Object.values(SystemScope).includes(scope)) {
      return res.status(400).json({ success: false, error: 'Invalid scope' });
    }

    const success = composer.setScope(scope);

    res.json({
      success,
      scope,
      message: success ? 'Scope updated' : 'Failed to update scope',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// STAGE CONTROLLER ENDPOINTS
// ============================================================================

// GET /api/crypto/governance/stages
router.get('/stages', (req, res) => {
  try {
    const currentStage = stageController.getCurrentStage();
    const allStates = stageController.getAllStageStates();
    const allDefinitions = stageController.getAllStageDefinitions();
    const progress = stageController.getProgressSummary();

    res.json({
      success: true,
      currentStage,
      stages: allStates.map(state => {
        const definition = allDefinitions.find(d => d.id === state.stageId);
        return {
          ...state,
          definition,
        };
      }),
      progress,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/crypto/governance/stages/:id
router.get('/stages/:id', (req, res) => {
  try {
    const stageId = parseInt(req.params.id);
    
    if (isNaN(stageId) || stageId < 1 || stageId > 9) {
      return res.status(400).json({ success: false, error: 'Invalid stage ID' });
    }

    const state = stageController.getStageState(stageId);
    const definition = stageController.getStageDefinition(stageId);

    res.json({
      success: true,
      stage: {
        ...state,
        definition,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/crypto/governance/stages/:id/start
router.post('/stages/:id/start', (req, res) => {
  try {
    const stageId = parseInt(req.params.id);
    
    if (isNaN(stageId) || stageId < 1 || stageId > 9) {
      return res.status(400).json({ success: false, error: 'Invalid stage ID' });
    }

    const success = stageController.startStage(stageId);

    res.json({
      success,
      stageId,
      message: success ? `Stage ${stageId} started` : `Failed to start stage ${stageId}`,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/crypto/governance/stages/advance
router.post('/stages/advance', (req, res) => {
  try {
    const canAdvance = stageController.canAdvance();
    
    if (!canAdvance) {
      return res.status(400).json({
        success: false,
        error: 'Cannot advance - current stage not PASS',
      });
    }

    const success = stageController.advanceStage();

    res.json({
      success,
      currentStage: stageController.getCurrentStage(),
      message: success ? 'Advanced to next stage' : 'Failed to advance',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// STAGE EXECUTION ENDPOINTS
// ============================================================================

// POST /api/crypto/governance/stages/6/execute
router.post('/stages/6/execute', async (req, res) => {
  try {
    console.log('[GovernanceAPI] Executing Stage 6...');
    const result = await executeStage6();

    res.json({
      success: result.success,
      message: result.message,
      policy: result.policy,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/crypto/governance/stages/7/execute
router.post('/stages/7/execute', async (req, res) => {
  try {
    console.log('[GovernanceAPI] Executing Stage 7...');
    const result = await executeStage7();

    res.json({
      success: result.success,
      message: result.message,
      results: result.results,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/crypto/governance/stages/8/execute
router.post('/stages/8/execute', async (req, res) => {
  try {
    console.log('[GovernanceAPI] Executing Stage 8...');
    const result = await executeStage8();

    res.json({
      success: result.success,
      message: result.message,
      steps: result.steps,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// PROFIT RAMP ENDPOINTS
// ============================================================================

// GET /api/crypto/governance/ramp/status
router.get('/ramp/status', (req, res) => {
  try {
    const currentTier = profitRampGovernor.getCurrentTier();
    const allTiers = profitRampGovernor.getAllTierStatuses();
    const policy = profitRampGovernor.getRampPolicy();
    const todayMetrics = profitRampGovernor.getTodayMetrics();

    res.json({
      success: true,
      currentTier,
      tiers: allTiers,
      policy,
      todayMetrics,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/crypto/governance/ramp/activate/:tier
router.post('/ramp/activate/:tier', (req, res) => {
  try {
    const tier = parseInt(req.params.tier);
    const { monteCarloJustification } = req.body;
    
    if (isNaN(tier) || tier < 1 || tier > 6) {
      return res.status(400).json({ success: false, error: 'Invalid tier' });
    }

    const success = profitRampGovernor.activateTier(tier, monteCarloJustification);

    res.json({
      success,
      tier,
      message: success ? `Tier ${tier} activated` : `Failed to activate tier ${tier}`,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/crypto/governance/ramp/anomaly
router.post('/ramp/anomaly', (req, res) => {
  try {
    const { description, severity } = req.body;
    
    if (!description || !severity) {
      return res.status(400).json({ success: false, error: 'Description and severity required' });
    }

    if (!['low', 'medium', 'high'].includes(severity)) {
      return res.status(400).json({ success: false, error: 'Invalid severity' });
    }

    profitRampGovernor.recordAnomaly(description, severity as any);

    res.json({
      success: true,
      message: 'Anomaly recorded',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// EXECUTION GATE ENDPOINTS
// ============================================================================

// GET /api/crypto/governance/gate/status
router.get('/gate/status', (req, res) => {
  try {
    const status = executionGate.getStatus();
    const metrics = executionGate.getMetrics();
    const recentResults = executionGate.getRecentResults(20);

    res.json({
      success: true,
      status,
      metrics,
      recentResults,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/crypto/governance/gate/mode
router.post('/gate/mode', (req, res) => {
  try {
    const { mode } = req.body;
    
    if (!Object.values(ExecutionMode).includes(mode)) {
      return res.status(400).json({ success: false, error: 'Invalid mode' });
    }

    const success = executionGate.setMode(mode);

    res.json({
      success,
      mode,
      message: success ? `Mode set to ${mode}` : 'Failed to set mode',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/crypto/governance/gate/open
router.post('/gate/open', (req, res) => {
  try {
    const { reason } = req.body;
    
    if (!reason) {
      return res.status(400).json({ success: false, error: 'Reason required' });
    }

    executionGate.open(reason);

    res.json({
      success: true,
      message: 'Execution gate opened',
      reason,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/crypto/governance/gate/close
router.post('/gate/close', (req, res) => {
  try {
    const { reason } = req.body;
    
    if (!reason) {
      return res.status(400).json({ success: false, error: 'Reason required' });
    }

    executionGate.close(reason);

    res.json({
      success: true,
      message: 'Execution gate closed',
      reason,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// CRYPTARA ENDPOINTS
// ============================================================================

// GET /api/crypto/governance/cryptara/status
router.get('/cryptara/status', (req, res) => {
  try {
    const mode = cryptaraController.getMode();
    const metrics = cryptaraController.getMetrics();
    const isolation = cryptaraController.verifyIsolation();
    const recentAnalyses = cryptaraController.getRecentAnalyses(5);

    res.json({
      success: true,
      mode,
      metrics,
      isolation,
      recentAnalyses: recentAnalyses.map(a => ({
        id: a.id,
        timestamp: a.timestamp,
        recommendation: a.output.recommendation,
        confidence: a.output.confidence,
        binding: a.binding,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// SYSTEM OVERVIEW ENDPOINT
// ============================================================================

// GET /api/crypto/governance/overview
router.get('/overview', (req, res) => {
  try {
    const composerState = composer.getState();
    const stageProgress = stageController.getProgressSummary();
    const currentTier = profitRampGovernor.getCurrentTier();
    const gateStatus = executionGate.getStatus();
    const cryptaraMode = cryptaraController.getMode();

    res.json({
      success: true,
      overview: {
        composer: {
          scope: composerState.currentScope,
          paused: composerState.isSystemPaused,
          emergency: composerState.emergencyShutdown,
          activeLocks: composerState.activeLocks.length,
        },
        stage: {
          current: stageProgress.currentStage,
          total: stageProgress.totalStages,
          passed: stageProgress.passedStages,
          completion: stageProgress.completionPercentage,
        },
        ramp: currentTier,
        gate: {
          mode: gateStatus.mode,
          open: gateStatus.isOpen,
          canExecute: gateStatus.canExecute,
        },
        cryptara: {
          mode: cryptaraMode,
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export { router as governanceApi };
