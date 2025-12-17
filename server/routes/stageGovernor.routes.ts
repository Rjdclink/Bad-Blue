/**
 * CryptoCrawler Stage Governor API Routes
 * 
 * Provides REST API endpoints for controlling the staged autonomy system
 * 
 * SECURITY: All routes require authentication
 * AUTHORITY: Stage advancement requires CRAWLER_ROOT role
 */

import express from 'express';
import { createLogger } from '../logger';
import {
  getStageGovernor,
  riskGovernor,
  type UnpauseRequest,
  type StageNumber,
} from '../services/cryptocrawl/governance';

const log = createLogger('stage-governor-routes');
const router = express.Router();

// ============================================================================
// STATUS ENDPOINTS
// ============================================================================

/**
 * GET /api/governance/stage
 * Get current stage state and configuration
 */
router.get('/stage', async (_req, res) => {
  try {
    const state = getStageGovernor().getState();
    const config = getStageGovernor().getConfig();
    const canExecute = getStageGovernor().canExecute();
    const advancementStatus = getStageGovernor().checkAdvancementReady();
    
    res.json({
      success: true,
      data: {
        state,
        config,
        canExecute,
        advancementStatus,
      },
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to get stage state', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to get stage state',
    });
  }
});

/**
 * GET /api/governance/risk
 * Get risk governor status
 */
router.get('/risk', async (_req, res) => {
  try {
    const status = riskGovernor.getStatus();
    
    res.json({
      success: true,
      data: status,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to get risk status', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to get risk status',
    });
  }
});

/**
 * GET /api/governance/profit-ladder
 * Get profit ladder tiers and unlock status
 */
router.get('/profit-ladder', async (_req, res) => {
  try {
    const ladder = getStageGovernor().getProfitLadder();
    
    res.json({
      success: true,
      data: {
        tiers: ladder,
        currentProfit: getStageGovernor().getState().profitThisStage,
        dailyTarget: getStageGovernor().getConfig().dailyProfitTarget,
        maxDailyProfit: getStageGovernor().getConfig().maxDailyProfit,
      },
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to get profit ladder', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to get profit ladder',
    });
  }
});

/**
 * GET /api/governance/advisory-cycles
 * Get recent advisory cycle results (Stage 1)
 */
router.get('/advisory-cycles', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const cycles = getStageGovernor().getAdvisoryCycles(limit);
    
    res.json({
      success: true,
      data: {
        cycles,
        count: cycles.length,
        stage: getStageGovernor().getState().currentStage,
      },
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to get advisory cycles', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to get advisory cycles',
    });
  }
});

/**
 * GET /api/governance/rules
 * Get global governance rules
 */
router.get('/rules', async (_req, res) => {
  try {
    res.json({
      success: true,
      data: {
        rules: GLOBAL_RULES,
        evolutionLock: true, // Always on unless explicitly lifted
        killSwitchArmed: getStageGovernor().getState().killSwitchArmed,
      },
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to get rules', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to get rules',
    });
  }
});

// ============================================================================
// CONTROL ENDPOINTS
// ============================================================================

/**
 * POST /api/governance/unpause
 * UNPAUSE the system (explicit authorization required)
 * 
 * Body: {
 *   stage: number (1-6),
 *   scope: string[],
 *   duration: number (ms, 0 = until next pause),
 *   authority: string
 * }
 */
router.post('/unpause', async (req, res) => {
  try {
    const { stage, scope, duration, authority } = req.body;
    
    // Validate required fields
    if (!stage || !authority) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: stage and authority',
      });
    }
    
    const request: UnpauseRequest = {
      stage: stage as StageNumber,
      scope: scope || [],
      duration: duration || 0,
      authority,
      timestamp: Date.now(),
    };
    
    log.info('UNPAUSE request received', { request });
    
    const result = getStageGovernor().processUnpause(request);
    
    if (result.success) {
      log.info('System UNPAUSED', { stage, authority });
    } else {
      log.warn('UNPAUSE request denied', { reason: result.message });
    }
    
    res.json({
      success: result.success,
      message: result.message,
      currentState: getStageGovernor().getState(),
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to process UNPAUSE', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to process UNPAUSE',
    });
  }
});

/**
 * POST /api/governance/pause
 * PAUSE the system (can be called by anyone, always succeeds)
 * 
 * Body: {
 *   reason: string,
 *   authority: string
 * }
 */
router.post('/pause', async (req, res) => {
  try {
    const { reason, authority } = req.body;
    
    if (!reason || !authority) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: reason and authority',
      });
    }
    
    log.info('PAUSE request received', { reason, authority });
    
    getStageGovernor().pause(reason, authority);
    
    res.json({
      success: true,
      message: 'System paused',
      currentState: getStageGovernor().getState(),
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to process PAUSE', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to process PAUSE',
    });
  }
});

/**
 * POST /api/governance/kill-switch
 * Engage KILL SWITCH (emergency halt)
 * 
 * Body: {
 *   reason: string,
 *   authority: string
 * }
 */
router.post('/kill-switch', async (req, res) => {
  try {
    const { reason, authority } = req.body;
    
    if (!reason || !authority) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: reason and authority',
      });
    }
    
    log.warn('KILL SWITCH request received', { reason, authority });
    
    getStageGovernor().engageKillSwitch(reason, authority);
    
    res.json({
      success: true,
      message: 'KILL SWITCH ENGAGED - System halted',
      currentState: getStageGovernor().getState(),
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to engage kill switch', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to engage kill switch',
    });
  }
});

/**
 * POST /api/governance/reset-kill-switch
 * Reset the kill switch (requires confirmation code)
 * 
 * Body: {
 *   authority: string,
 *   confirmation: string (must be "CONFIRM_KILL_SWITCH_RESET")
 * }
 */
router.post('/reset-kill-switch', async (req, res) => {
  try {
    const { authority, confirmation } = req.body;
    
    if (!authority || !confirmation) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: authority and confirmation',
      });
    }
    
    log.info('Kill switch reset request received', { authority });
    
    const result = getStageGovernor().resetKillSwitch(authority, confirmation);
    
    res.json({
      success: result.success,
      message: result.message,
      currentState: getStageGovernor().getState(),
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to reset kill switch', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to reset kill switch',
    });
  }
});

/**
 * POST /api/governance/report-uncertainty
 * Report an uncertainty (triggers ask-and-wait)
 * 
 * Body: {
 *   uncertainty: string
 * }
 */
router.post('/report-uncertainty', async (req, res) => {
  try {
    const { uncertainty } = req.body;
    
    if (!uncertainty) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: uncertainty',
      });
    }
    
    log.info('Uncertainty reported', { uncertainty });
    
    getStageGovernor().reportUncertainty(uncertainty);
    
    res.json({
      success: true,
      message: 'Uncertainty reported - system paused, awaiting resolution',
      currentState: getStageGovernor().getState(),
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to report uncertainty', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to report uncertainty',
    });
  }
});

/**
 * POST /api/governance/resolve-uncertainty
 * Resolve a reported uncertainty
 * 
 * Body: {
 *   uncertainty: string,
 *   resolution: string,
 *   authority: string
 * }
 */
router.post('/resolve-uncertainty', async (req, res) => {
  try {
    const { uncertainty, resolution, authority } = req.body;
    
    if (!uncertainty || !resolution || !authority) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: uncertainty, resolution, and authority',
      });
    }
    
    log.info('Resolving uncertainty', { uncertainty, resolution, authority });
    
    const resolved = getStageGovernor().resolveUncertainty(uncertainty, resolution, authority);
    
    res.json({
      success: resolved,
      message: resolved ? 'Uncertainty resolved' : 'Uncertainty not found',
      currentState: getStageGovernor().getState(),
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to resolve uncertainty', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to resolve uncertainty',
    });
  }
});

/**
 * POST /api/governance/report-anomaly
 * Report an anomaly
 * 
 * Body: {
 *   anomaly: string,
 *   severity: 'low' | 'medium' | 'high' | 'critical'
 * }
 */
router.post('/report-anomaly', async (req, res) => {
  try {
    const { anomaly, severity } = req.body;
    
    if (!anomaly || !severity) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: anomaly and severity',
      });
    }
    
    if (!['low', 'medium', 'high', 'critical'].includes(severity)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid severity: must be low, medium, high, or critical',
      });
    }
    
    log.warn('Anomaly reported', { anomaly, severity });
    
    getStageGovernor().reportAnomaly(anomaly, severity);
    
    res.json({
      success: true,
      message: `Anomaly reported with severity: ${severity}`,
      currentState: getStageGovernor().getState(),
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to report anomaly', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to report anomaly',
    });
  }
});

/**
 * POST /api/governance/mark-requirement
 * Mark a stage requirement as met
 * 
 * Body: {
 *   type: string,
 *   value: number
 * }
 */
router.post('/mark-requirement', async (req, res) => {
  try {
    const { type, value } = req.body;
    
    if (!type || value === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: type and value',
      });
    }
    
    log.info('Marking requirement', { type, value });
    
    getStageGovernor().markRequirementMet(type, value);
    
    const advancementStatus = getStageGovernor().checkAdvancementReady();
    
    res.json({
      success: true,
      message: `Requirement ${type} updated`,
      advancementStatus,
      currentConfig: getStageGovernor().getConfig(),
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to mark requirement', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to mark requirement',
    });
  }
});

/**
 * POST /api/governance/record-profit
 * Record profit and update ladder
 * 
 * Body: {
 *   amount: number
 * }
 */
router.post('/record-profit', async (req, res) => {
  try {
    const { amount } = req.body;
    
    if (amount === undefined || typeof amount !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid field: amount must be a number',
      });
    }
    
    log.info('Recording profit', { amount });
    
    const result = getStageGovernor().recordProfit(amount);
    
    res.json({
      success: result.recorded,
      data: result,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to record profit', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to record profit',
    });
  }
});

// ============================================================================
// TRADE VALIDATION ENDPOINTS
// ============================================================================

/**
 * POST /api/governance/validate-trade
 * Validate a trade proposal through Monte Carlo consensus
 * 
 * Body: TradeProposal
 */
router.post('/validate-trade', async (req, res) => {
  try {
    const proposal = req.body;
    
    // Validate required fields
    const requiredFields = ['id', 'pair', 'exchange', 'direction', 'entryPrice', 'targetPrice', 'stopLoss', 'proposedSize'];
    for (const field of requiredFields) {
      if (proposal[field] === undefined) {
        return res.status(400).json({
          success: false,
          error: `Missing required field: ${field}`,
        });
      }
    }
    
    // Add defaults
    proposal.timestamp = proposal.timestamp || Date.now();
    proposal.expectedProfit = proposal.expectedProfit || 0;
    proposal.expectedFees = proposal.expectedFees || 0;
    proposal.expectedSlippage = proposal.expectedSlippage || 0.01;
    proposal.latencyMs = proposal.latencyMs || 100;
    
    log.info('Validating trade proposal', { proposalId: proposal.id });
    
    const validation = await riskGovernor.validateTrade(proposal);
    
    res.json({
      success: true,
      data: validation,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to validate trade', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to validate trade',
    });
  }
});

/**
 * POST /api/governance/record-trade-result
 * Record the result of a trade
 * 
 * Body: {
 *   proposalId: string,
 *   result: 'win' | 'loss',
 *   pnl: number
 * }
 */
router.post('/record-trade-result', async (req, res) => {
  try {
    const { proposalId, result, pnl } = req.body;
    
    if (!proposalId || !result || pnl === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: proposalId, result, and pnl',
      });
    }
    
    if (!['win', 'loss'].includes(result)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid result: must be win or loss',
      });
    }
    
    log.info('Recording trade result', { proposalId, result, pnl });
    
    riskGovernor.recordTradeResult(proposalId, result, pnl);
    
    res.json({
      success: true,
      message: 'Trade result recorded',
      metrics: riskGovernor.getMetrics(),
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to record trade result', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to record trade result',
    });
  }
});

// ============================================================================
// CAPITAL MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * GET /api/governance/capital
 * Get capital allocation status
 */
router.get('/capital', async (_req, res) => {
  try {
    const capital = riskGovernor.getCapitalAllocation();
    const metrics = riskGovernor.getMetrics();
    
    res.json({
      success: true,
      data: {
        capital,
        utilization: metrics.utilizationPercent,
        currentCapitalAtRisk: metrics.currentCapitalAtRisk,
        currentPositionCount: metrics.currentPositionCount,
      },
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to get capital allocation', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to get capital allocation',
    });
  }
});

/**
 * POST /api/governance/allocate-capital
 * Allocate capital for a trade
 * 
 * Body: {
 *   amount: number
 * }
 */
router.post('/allocate-capital', async (req, res) => {
  try {
    const { amount } = req.body;
    
    if (amount === undefined || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount: must be a positive number',
      });
    }
    
    const allocated = riskGovernor.allocateCapital(amount);
    
    res.json({
      success: allocated,
      message: allocated ? 'Capital allocated' : 'Insufficient capital',
      capital: riskGovernor.getCapitalAllocation(),
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to allocate capital', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to allocate capital',
    });
  }
});

/**
 * POST /api/governance/release-capital
 * Release capital after trade closes
 * 
 * Body: {
 *   amount: number
 * }
 */
router.post('/release-capital', async (req, res) => {
  try {
    const { amount } = req.body;
    
    if (amount === undefined || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount: must be a positive number',
      });
    }
    
    riskGovernor.releaseCapital(amount);
    
    res.json({
      success: true,
      message: 'Capital released',
      capital: riskGovernor.getCapitalAllocation(),
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to release capital', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to release capital',
    });
  }
});

// ============================================================================
// CIRCUIT BREAKER ENDPOINTS
// ============================================================================

/**
 * GET /api/governance/circuit-breaker
 * Get circuit breaker status
 */
router.get('/circuit-breaker', async (_req, res) => {
  try {
    const state = riskGovernor.getCircuitBreakerState();
    
    res.json({
      success: true,
      data: state,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to get circuit breaker state', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to get circuit breaker state',
    });
  }
});

// ============================================================================
// RESET ENDPOINTS
// ============================================================================

/**
 * POST /api/governance/reset-hourly
 * Reset hourly metrics
 */
router.post('/reset-hourly', async (_req, res) => {
  try {
    riskGovernor.resetHourlyMetrics();
    
    res.json({
      success: true,
      message: 'Hourly metrics reset',
      metrics: riskGovernor.getMetrics(),
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to reset hourly metrics', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to reset hourly metrics',
    });
  }
});

/**
 * POST /api/governance/reset-daily
 * Reset daily metrics
 */
router.post('/reset-daily', async (_req, res) => {
  try {
    riskGovernor.resetDailyMetrics();
    getStageGovernor().resetDailyProfit();
    
    res.json({
      success: true,
      message: 'Daily metrics reset',
      metrics: riskGovernor.getMetrics(),
      stageState: getStageGovernor().getState(),
      timestamp: Date.now(),
    });
  } catch (error: any) {
    log.error('Failed to reset daily metrics', { error: error?.message });
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to reset daily metrics',
    });
  }
});

export default router;
