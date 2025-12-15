/**
 * Arbitrage Agents API Routes
 * 
 * Exposes the 6-agent verification and control system via REST API
 */

import { Router } from 'express';
import { arbitrageControl } from '../services/cryptocrawl/governance/arbitrage-agents.js';
import logger from '../logger.js';

const router = Router();

// ============================================================================
// GET ENDPOINTS - Status and Information
// ============================================================================

/**
 * GET /api/arbitrage/status
 * Get overall arbitrage system status
 */
router.get('/status', async (req, res) => {
  try {
    const config = arbitrageControl.getConfig();
    const profitLadder = arbitrageControl.getProfitLadder();
    const agentResults = arbitrageControl.getAgentResults();
    
    res.json({
      success: true,
      status: {
        mode: config.mode,
        exposureTarget: config.exposureTarget,
        evolutionLockOn: config.evolutionLockOn,
        autoPauseOn: config.autoPauseOn,
        killSwitchReachable: config.killSwitchReachable,
        profitOnlyReinvestment: config.profitOnlyReinvestment,
        currentTier: profitLadder.currentTier,
        dailyTarget: profitLadder.tiers[profitLadder.currentTier - 1].dailyTarget,
        agentsRun: agentResults.length,
        agentsPassed: agentResults.filter(r => r.passed).length,
      },
    });
  } catch (error) {
    logger.error('[ArbitrageAPI] Error getting status:', error);
    res.status(500).json({ success: false, error: 'Failed to get status' });
  }
});

/**
 * GET /api/arbitrage/config
 * Get full configuration
 */
router.get('/config', async (req, res) => {
  try {
    const config = arbitrageControl.getConfig();
    res.json({ success: true, config });
  } catch (error) {
    logger.error('[ArbitrageAPI] Error getting config:', error);
    res.status(500).json({ success: false, error: 'Failed to get config' });
  }
});

/**
 * GET /api/arbitrage/profit-ladder
 * Get profit ladder configuration and status
 */
router.get('/profit-ladder', async (req, res) => {
  try {
    const profitLadder = arbitrageControl.getProfitLadder();
    res.json({ success: true, profitLadder });
  } catch (error) {
    logger.error('[ArbitrageAPI] Error getting profit ladder:', error);
    res.status(500).json({ success: false, error: 'Failed to get profit ladder' });
  }
});

/**
 * GET /api/arbitrage/agents
 * Get all agent verification results
 */
router.get('/agents', async (req, res) => {
  try {
    const results = arbitrageControl.getAgentResults();
    res.json({ success: true, agents: results });
  } catch (error) {
    logger.error('[ArbitrageAPI] Error getting agent results:', error);
    res.status(500).json({ success: false, error: 'Failed to get agent results' });
  }
});

/**
 * GET /api/arbitrage/signals
 * Get signal detection history
 */
router.get('/signals', async (req, res) => {
  try {
    const signals = arbitrageControl.getSignalHistory();
    res.json({ success: true, signals });
  } catch (error) {
    logger.error('[ArbitrageAPI] Error getting signals:', error);
    res.status(500).json({ success: false, error: 'Failed to get signals' });
  }
});

/**
 * GET /api/arbitrage/executions
 * Get execution history
 */
router.get('/executions', async (req, res) => {
  try {
    const executions = arbitrageControl.getExecutionHistory();
    res.json({ success: true, executions });
  } catch (error) {
    logger.error('[ArbitrageAPI] Error getting executions:', error);
    res.status(500).json({ success: false, error: 'Failed to get executions' });
  }
});

// ============================================================================
// POST ENDPOINTS - Agent Verification
// ============================================================================

/**
 * POST /api/arbitrage/verify-all
 * Run full 6-agent verification sequence
 */
router.post('/verify-all', async (req, res) => {
  try {
    logger.info('[ArbitrageAPI] Starting full verification sequence');
    
    const result = await arbitrageControl.runAllAgents();
    
    res.json({
      success: result.success,
      message: result.success 
        ? 'All agents passed - AUTOMATIC mode enabled'
        : 'Verification incomplete - some agents failed',
      results: result.results.map(r => ({
        agent: r.agent,
        name: r.name,
        passed: r.passed,
        deliverable: r.deliverable,
        checkCount: r.checks.length,
        checksPassed: r.checks.filter(c => c.passed).length,
      })),
      finalAcceptance: result.finalAcceptance,
    });
  } catch (error) {
    logger.error('[ArbitrageAPI] Error running verification:', error);
    res.status(500).json({ success: false, error: 'Verification failed with error' });
  }
});

/**
 * POST /api/arbitrage/agent/:number
 * Run specific agent verification
 */
router.post('/agent/:number', async (req, res) => {
  try {
    const agentNumber = parseInt(req.params.number, 10);
    
    if (agentNumber < 1 || agentNumber > 6) {
      return res.status(400).json({ success: false, error: 'Agent number must be 1-6' });
    }
    
    let result;
    switch (agentNumber) {
      case 1:
        result = await arbitrageControl.runAgent1();
        break;
      case 2:
        result = await arbitrageControl.runAgent2();
        break;
      case 3:
        result = await arbitrageControl.runAgent3();
        break;
      case 4:
        result = await arbitrageControl.runAgent4();
        break;
      case 5:
        result = await arbitrageControl.runAgent5();
        break;
      case 6:
        result = await arbitrageControl.runAgent6();
        break;
      default:
        return res.status(400).json({ success: false, error: 'Invalid agent number' });
    }
    
    res.json({
      success: result.passed,
      agent: result,
    });
  } catch (error) {
    logger.error('[ArbitrageAPI] Error running agent:', error);
    res.status(500).json({ success: false, error: 'Agent verification failed' });
  }
});

/**
 * POST /api/arbitrage/promote-tier
 * Attempt to promote to the next profit tier
 */
router.post('/promote-tier', async (req, res) => {
  try {
    const { authority } = req.body;
    
    if (!authority) {
      return res.status(400).json({ success: false, error: 'Authority (UNPAUSE issuer) required' });
    }
    
    const result = await arbitrageControl.attemptTierPromotion(authority);
    
    res.json(result);
  } catch (error) {
    logger.error('[ArbitrageAPI] Error promoting tier:', error);
    res.status(500).json({ success: false, error: 'Tier promotion failed' });
  }
});

/**
 * POST /api/arbitrage/record-cycle
 * Record a cycle result (profitable or not)
 */
router.post('/record-cycle', async (req, res) => {
  try {
    const { profitable } = req.body;
    
    if (typeof profitable !== 'boolean') {
      return res.status(400).json({ success: false, error: 'profitable (boolean) required' });
    }
    
    arbitrageControl.recordCycleResult(profitable);
    
    const profitLadder = arbitrageControl.getProfitLadder();
    const currentTier = profitLadder.tiers[profitLadder.currentTier - 1];
    
    res.json({
      success: true,
      message: `Cycle recorded as ${profitable ? 'profitable' : 'unprofitable'}`,
      consecutiveProfitableCycles: currentTier.consecutiveProfitableCycles,
      cyclesRequiredForPromotion: currentTier.consecutiveProfitableCyclesRequired,
    });
  } catch (error) {
    logger.error('[ArbitrageAPI] Error recording cycle:', error);
    res.status(500).json({ success: false, error: 'Failed to record cycle' });
  }
});

// ============================================================================
// GLOBAL RULES ENDPOINT
// ============================================================================

/**
 * GET /api/arbitrage/rules
 * Get the global non-negotiable rules
 */
router.get('/rules', async (req, res) => {
  res.json({
    success: true,
    rules: {
      global: [
        'Profit-only capital (zero external capital)',
        'Auto-pause is absolute; any anomaly pauses immediately',
        'No silent scope expansion; every increase requires explicit UNPAUSE',
        'All changes reversible within one cycle',
        'Human veto and kill-switch always available',
        'Exposure target ≈ 6% (accepted), never unbounded',
      ],
      promotionRules: {
        minConsecutiveProfitable: 3,
        scalingOrder: [
          '1. Increase frequency (+1 parallel route per tier)',
          '2. Widen venue breadth (unlock two venues per promotion)',
          '3. Widen pair breadth',
          '4. Increase position sizing (LAST)',
        ],
        cooldownReduction: '30% (still mandatory)',
        venueHeadroom: '+10% after clean cycles',
        humanUnpauseRequired: 'For each tier increase',
        automaticRelock: 'On variance spikes or boundary pressure',
      },
      profitLadder: [
        '$200/day (Tier 1)',
        '$400/day (Tier 2)',
        '$800/day (Tier 3)',
        '$1,600/day (Tier 4)',
        '$3,200/day (Tier 5)',
        '$6,400/day (Tier 6)',
        '$12,800/day (Tier 7)',
        '$25,000/day (Tier 8)',
        '$35,000/day (Tier 9)',
      ],
    },
  });
});

export default router;
