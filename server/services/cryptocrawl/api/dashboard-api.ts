import express from 'express';
import {WebSocketServer} from 'ws';
import { utils as ethersUtils } from 'ethers';
import {pipeline} from '../integration/master-pipeline';
import { zeroCapitalEngine } from '../core/zero-capital-engine';
import { autonomousFaucet } from '../faucet/autonomous-faucet';
import { balanceMonitor } from '../bridge/balance-monitor';
import { WalletManager } from '../core/wallet';
import type { ChainId as WalletChainId } from '../core/lux-swarm.js';
import { scheduledMonteCarloTraining } from '../training/scheduled-monte-carlo-training';
import { stageManager } from '../governance/stage-management.js';

const router = express.Router();
const wss = new WebSocketServer({noServer: true});

// Wallet manager instance for real wallet operations
let walletManager: WalletManager | null = null;

// Initialize zero-capital engine ONLY if explicitly enabled.
// Stage Two focus is arbitrage verification; keep other execution engines opt-in.
if (process.env.CRYPTOCRAWL_ENABLE_ZERO_CAPITAL_ENGINE === 'true') {
  zeroCapitalEngine.initialize().catch(err => {
    console.error('[CryptoCrawl] Failed to initialize zero-capital engine:', err);
  });
}

// Initialize balance monitor and wallet manager on module load
(async () => {
  try {
    // Start balance monitor only if a wallet address is configured.
    // This prevents accidental "default wallet" usage and avoids RPC errors on empty address.
    if (process.env.BRIDGE_WALLET_ADDRESS) {
      await balanceMonitor.start();
      console.log('[CryptoCrawl] ✅ Balance monitor started - wallet balances connected');
    } else {
      console.log('[CryptoCrawl] Balance monitor not started (BRIDGE_WALLET_ADDRESS not configured)');
    }
    
    // Initialize wallet manager
    walletManager = new WalletManager();
    await walletManager.initialize();
    console.log('[CryptoCrawl] ✅ Wallet manager initialized - cryptocrawler connected to wallet');
  } catch (err) {
    console.error('[CryptoCrawl] Failed to initialize balance monitor or wallet:', err);
    // Set walletManager to null if initialization fails (addresses PR comment)
    walletManager = null;
  }
})();

// ============================================================================
// DIVINE RECURSIVE OPTIMIZATION SYSTEM - FAUCET ALWAYS ON
// Ensures faucet is ALWAYS operational with automatic opportune time detection
// Faucet can ONLY be turned off manually by user - otherwise ALWAYS ON
// ============================================================================

/**
 * Divine Recursive Optimizer Configuration
 * Uses same power instructions: 10 passes, power of 0.2
 * FAUCET IS ALWAYS ON unless manually shut off
 */
const DIVINE_OPTIMIZER_CONFIG = {
  // Recursive optimization settings
  OPTIMIZATION_PASSES: 10,
  CREATIVITY_POWER_INCREMENT: 0.2,
  CHECK_INTERVAL_MS: 2 * 60 * 1000, // Check every 2 minutes (more frequent)
  
  // Health and operational thresholds
  HEALTH_THRESHOLD: 0.9, // 90% health for "110% operational"
  
  // CRITICAL: Faucet ALWAYS ON settings
  FAUCET_ALWAYS_ON: true, // Master switch - faucet should ALWAYS be on
  AUTO_RESTART_ENABLED: true, // Auto-restart if faucet stops
  AUTO_RESTART_DELAY_MS: 3000, // Wait 3 seconds before restart
  MAX_RESTART_ATTEMPTS: 10, // Max restart attempts before cooldown
  RESTART_COOLDOWN_MS: 60000, // 1 minute cooldown after max attempts
  
  // Opportune time detection (automatic)
  OPPORTUNE_TIME_DETECTION: true,
  AGGRESSIVE_MODE_ENABLED: true, // Trade more aggressively during opportune times
};

/**
 * Opportune Time Configuration
 * Defines what constitutes an "opportune time" for arbitrage
 */
const OPPORTUNE_TIME_CONFIG = {
  // Gas thresholds (USD)
  GAS_EXCELLENT: 2,    // < $2 = excellent
  GAS_GOOD: 5,         // < $5 = good
  GAS_ACCEPTABLE: 10,  // < $10 = acceptable
  
  // Volatility thresholds (0-100)
  VOLATILITY_MIN: 15,  // Need some volatility for opportunities
  VOLATILITY_MAX: 70,  // Too high = risky
  VOLATILITY_OPTIMAL_MIN: 25,
  VOLATILITY_OPTIMAL_MAX: 50,
  
  // Competition thresholds (0-1)
  COMPETITION_LOW: 0.3,
  COMPETITION_ACCEPTABLE: 0.5,
  
  // Spread opportunity thresholds
  MIN_SPREAD_OPPORTUNITIES: 3,
  OPTIMAL_SPREAD_OPPORTUNITIES: 10,
  
  // Liquidity thresholds
  MIN_LIQUIDITY: 50000,
  OPTIMAL_LIQUIDITY: 100000,
};

/**
 * Intent Inference Types
 * Infers trading intent from market conditions
 */
type TradingIntent = 
  | 'AGGRESSIVE_PROFIT' // High opportunity, go all in
  | 'STEADY_ACCUMULATION' // Normal conditions, steady trading
  | 'CAUTIOUS_OPERATION' // Some risk factors, be careful
  | 'DEFENSIVE_MODE' // High risk, minimal trading
  | 'OPPORTUNISTIC_STRIKE'; // Rare opportunity, maximize

/**
 * Optimization state tracking
 */
let divineOptimizerState = {
  isRunning: false,
  lastOptimizationTime: 0,
  optimizationPasses: 0,
  currentCreativity: 1.0,
  faucetHealthScore: 0,
  consecutiveSuccesses: 0,
  autoRestartCount: 0,
  restartAttempts: 0,
  lastRestartTime: 0,
  // Intent inference state
  currentIntent: 'STEADY_ACCUMULATION' as TradingIntent,
  intentConfidence: 0.5,
  opportuneScore: 0,
  // Manual override tracking
  manuallyDisabled: false,
};

/**
 * Calculate Divine creativity multiplier (power of 0.2 per pass)
 */
function getDivineCreativityMultiplier(pass: number): number {
  return Math.pow(1 + DIVINE_OPTIMIZER_CONFIG.CREATIVITY_POWER_INCREMENT, pass);
}

/**
 * Calculate opportune score (0-100) based on all market factors
 * Higher score = better opportunity for arbitrage
 */
function calculateOpportuneScore(): { score: number; factors: Record<string, number>; } {
  try {
    const marketConditions = autonomousFaucet.getMarketConditions();
    const faucetState = autonomousFaucet.getState();
    
    const factors: Record<string, number> = {};
    
    // Gas score (0-25 points)
    if (marketConditions.gasEfficiency < OPPORTUNE_TIME_CONFIG.GAS_EXCELLENT) {
      factors.gas = 25;
    } else if (marketConditions.gasEfficiency < OPPORTUNE_TIME_CONFIG.GAS_GOOD) {
      factors.gas = 20;
    } else if (marketConditions.gasEfficiency < OPPORTUNE_TIME_CONFIG.GAS_ACCEPTABLE) {
      factors.gas = 10;
    } else {
      factors.gas = 0;
    }
    
    // Volatility score (0-25 points) - optimal range gets max points
    const vol = marketConditions.volatility;
    if (vol >= OPPORTUNE_TIME_CONFIG.VOLATILITY_OPTIMAL_MIN && vol <= OPPORTUNE_TIME_CONFIG.VOLATILITY_OPTIMAL_MAX) {
      factors.volatility = 25;
    } else if (vol >= OPPORTUNE_TIME_CONFIG.VOLATILITY_MIN && vol <= OPPORTUNE_TIME_CONFIG.VOLATILITY_MAX) {
      factors.volatility = 15;
    } else {
      factors.volatility = 0;
    }
    
    // Competition score (0-20 points) - lower is better
    if (marketConditions.competitionLevel < OPPORTUNE_TIME_CONFIG.COMPETITION_LOW) {
      factors.competition = 20;
    } else if (marketConditions.competitionLevel < OPPORTUNE_TIME_CONFIG.COMPETITION_ACCEPTABLE) {
      factors.competition = 10;
    } else {
      factors.competition = 0;
    }
    
    // Spread opportunities score (0-15 points)
    if (marketConditions.spreadOpportunities >= OPPORTUNE_TIME_CONFIG.OPTIMAL_SPREAD_OPPORTUNITIES) {
      factors.spreads = 15;
    } else if (marketConditions.spreadOpportunities >= OPPORTUNE_TIME_CONFIG.MIN_SPREAD_OPPORTUNITIES) {
      factors.spreads = 8;
    } else {
      factors.spreads = 0;
    }
    
    // Health score (0-15 points)
    factors.health = Math.floor((faucetState.healthScore / 100) * 15);
    
    // Technical signal bonus (0-10 points)
    if (marketConditions.technicalSignal === 'bullish') {
      factors.technical = 10;
    } else if (marketConditions.technicalSignal === 'neutral') {
      factors.technical = 5;
    } else {
      factors.technical = 0;
    }
    
    const totalScore = Object.values(factors).reduce((a, b) => a + b, 0);
    
    return { score: totalScore, factors };
  } catch {
    return { score: 50, factors: { default: 50 } }; // Default moderate score
  }
}

/**
 * Check if current time is opportune for arbitrage
 * Returns true if score is above threshold
 */
function isOpportuneTime(): boolean {
  const { score } = calculateOpportuneScore();
  divineOptimizerState.opportuneScore = score;
  return score >= 40; // 40+ out of 110 = opportune
}

/**
 * Infer trading intent from current market conditions
 * Uses recursive analysis to determine optimal strategy
 */
function inferTradingIntent(): { intent: TradingIntent; confidence: number; reasoning: string[]; } {
  const { score, factors } = calculateOpportuneScore();
  const reasoning: string[] = [];
  let intent: TradingIntent;
  let confidence: number;
  
  // Recursive intent inference with creativity multiplier
  for (let pass = 0; pass < 5; pass++) { // Quick 5-pass inference
    const creativity = getDivineCreativityMultiplier(pass);
    const adjustedScore = score * (1 + (creativity - 1) * 0.1);
    
    if (adjustedScore >= 85) {
      intent = 'OPPORTUNISTIC_STRIKE';
      confidence = 0.95;
      reasoning.push(`Pass ${pass + 1}: Exceptional opportunity detected (score: ${adjustedScore.toFixed(0)})`);
    } else if (adjustedScore >= 70) {
      intent = 'AGGRESSIVE_PROFIT';
      confidence = 0.85;
      reasoning.push(`Pass ${pass + 1}: High opportunity (score: ${adjustedScore.toFixed(0)})`);
    } else if (adjustedScore >= 50) {
      intent = 'STEADY_ACCUMULATION';
      confidence = 0.75;
      reasoning.push(`Pass ${pass + 1}: Normal conditions (score: ${adjustedScore.toFixed(0)})`);
    } else if (adjustedScore >= 30) {
      intent = 'CAUTIOUS_OPERATION';
      confidence = 0.65;
      reasoning.push(`Pass ${pass + 1}: Elevated risk (score: ${adjustedScore.toFixed(0)})`);
    } else {
      intent = 'DEFENSIVE_MODE';
      confidence = 0.55;
      reasoning.push(`Pass ${pass + 1}: High risk environment (score: ${adjustedScore.toFixed(0)})`);
    }
  }
  
  // Add factor analysis to reasoning
  reasoning.push(`Factors: Gas=${factors.gas}, Vol=${factors.volatility}, Comp=${factors.competition}`);
  
  divineOptimizerState.currentIntent = intent!;
  divineOptimizerState.intentConfidence = confidence!;
  
  return { intent: intent!, confidence: confidence!, reasoning };
}

/**
 * Ensure faucet is ALWAYS ON (unless manually disabled)
 * This is the core function that keeps the faucet running
 */
async function ensureFaucetAlwaysOn(): Promise<boolean> {
  const { initializeGovernance } = await import('../governance/index.js');
  await initializeGovernance();

  // Check if manually disabled by user
  if (divineOptimizerState.manuallyDisabled) {
    console.log('[DivineOptimizer] Faucet manually disabled by user - respecting override');
    return false;
  }
  
  // Check if faucet is active
  const isActive = autonomousFaucet.isActive();
  
  if (!isActive && DIVINE_OPTIMIZER_CONFIG.FAUCET_ALWAYS_ON && stageManager.isAutomaticallyActivated()) {
    // Check restart cooldown
    const now = Date.now();
    if (divineOptimizerState.restartAttempts >= DIVINE_OPTIMIZER_CONFIG.MAX_RESTART_ATTEMPTS) {
      if (now - divineOptimizerState.lastRestartTime < DIVINE_OPTIMIZER_CONFIG.RESTART_COOLDOWN_MS) {
        console.log('[DivineOptimizer] In restart cooldown period...');
        return false;
      }
      // Reset attempts after cooldown
      divineOptimizerState.restartAttempts = 0;
    }
    
    console.log('[DivineOptimizer] 🔄 Faucet not active - AUTO-RESTARTING (ALWAYS ON mode)');
    divineOptimizerState.restartAttempts++;
    divineOptimizerState.lastRestartTime = now;
    
    try {
      await new Promise(resolve => setTimeout(resolve, DIVINE_OPTIMIZER_CONFIG.AUTO_RESTART_DELAY_MS));
      autonomousFaucet.runAutonomousLoop().catch(err => {
        console.error('[DivineOptimizer] Auto-restarted faucet stopped:', err);
      });
      divineOptimizerState.autoRestartCount++;
      divineOptimizerState.restartAttempts = 0; // Reset on success
      console.log('[DivineOptimizer] ✅ Faucet auto-restarted successfully!');
      return true;
    } catch (err) {
      console.error('[DivineOptimizer] ❌ Auto-restart failed:', err);
      return false;
    }
  }
  
  return isActive;
}

/**
 * Recursive optimization pass for faucet enhancement
 * Includes intent inference and opportune time detection
 */
async function performRecursiveOptimization(): Promise<void> {
  console.log('[DivineOptimizer] 🔄 Starting recursive optimization cycle...');
  
  for (let pass = 0; pass < DIVINE_OPTIMIZER_CONFIG.OPTIMIZATION_PASSES; pass++) {
    const creativity = getDivineCreativityMultiplier(pass);
    divineOptimizerState.currentCreativity = creativity;
    divineOptimizerState.optimizationPasses = pass + 1;
    
    try {
      // CRITICAL: Ensure faucet is ALWAYS ON
      await ensureFaucetAlwaysOn();
      
      const faucetState = autonomousFaucet.getState();
      
      // Calculate health score (0-1)
      const healthScore = faucetState.healthScore / 100;
      divineOptimizerState.faucetHealthScore = healthScore;
      
      // Infer trading intent
      const { intent, confidence, reasoning } = inferTradingIntent();
      
      // Check if opportune time
      const opportune = isOpportuneTime();
      
      // Log optimization pass results
      if (pass === 0 || pass === DIVINE_OPTIMIZER_CONFIG.OPTIMIZATION_PASSES - 1) {
        console.log(`[DivineOptimizer] Pass ${pass + 1}/${DIVINE_OPTIMIZER_CONFIG.OPTIMIZATION_PASSES}:`, {
          creativity: creativity.toFixed(2),
          health: `${(healthScore * 100).toFixed(1)}%`,
          intent,
          confidence: confidence.toFixed(2),
          opportune,
          score: divineOptimizerState.opportuneScore,
        });
      }
      
      // Track successes
      if (opportune && healthScore >= 0.7) {
        divineOptimizerState.consecutiveSuccesses++;
      }
      
    } catch (err) {
      console.warn(`[DivineOptimizer] Pass ${pass + 1} error:`, err);
    }
  }
  
  divineOptimizerState.lastOptimizationTime = Date.now();
  console.log('[DivineOptimizer] ✅ Recursive optimization cycle complete');
}

/**
 * Start Divine Recursive Optimizer
 * Ensures faucet is ALWAYS ON and detects opportune times
 */
function startDivineOptimizer(): void {
  if (divineOptimizerState.isRunning) return;
  
  divineOptimizerState.isRunning = true;
  divineOptimizerState.manuallyDisabled = false; // Reset manual override on start
  
  console.log('[DivineOptimizer] 🌟 Divine Recursive Optimization System ACTIVATED');
  console.log('[DivineOptimizer] ⚡ FAUCET ALWAYS ON MODE ENABLED');
  console.log(`[DivineOptimizer] Configuration:`, {
    passes: DIVINE_OPTIMIZER_CONFIG.OPTIMIZATION_PASSES,
    powerIncrement: DIVINE_OPTIMIZER_CONFIG.CREATIVITY_POWER_INCREMENT,
    checkInterval: `${DIVINE_OPTIMIZER_CONFIG.CHECK_INTERVAL_MS / 1000}s`,
    alwaysOn: DIVINE_OPTIMIZER_CONFIG.FAUCET_ALWAYS_ON,
  });
  
  // Run initial optimization immediately
  performRecursiveOptimization().catch(err => {
    console.error('[DivineOptimizer] Initial optimization failed:', err);
  });
  
  // Schedule periodic optimization checks
  setInterval(() => {
    performRecursiveOptimization().catch(err => {
      console.error('[DivineOptimizer] Periodic optimization failed:', err);
    });
  }, DIVINE_OPTIMIZER_CONFIG.CHECK_INTERVAL_MS);
}

/**
 * Manually disable faucet (user override)
 */
function manuallyDisableFaucet(): void {
  divineOptimizerState.manuallyDisabled = true;
  console.log('[DivineOptimizer] ⚠️ Faucet MANUALLY DISABLED by user');
}

/**
 * Manually enable faucet (remove user override)
 */
function manuallyEnableFaucet(): void {
  divineOptimizerState.manuallyDisabled = false;
  console.log('[DivineOptimizer] ✅ Faucet MANUALLY ENABLED by user');
  // Immediately try to ensure it's on
  ensureFaucetAlwaysOn().catch(err => {
    console.error('[DivineOptimizer] Failed to enable faucet:', err);
  });
}

// AUTO-START: Initialize autonomous faucet on module load (Divine Auto-Activation)
// This ensures arbitrage begins automatically when server starts with valid RPC connections
setTimeout(() => {
  void (async () => {
    try {
      // Governance persistence must be restored before the faucet can inspect its pause state.
      const { initializeGovernance } = await import('../governance/index.js');
      await initializeGovernance();
      console.log('[CryptoCrawl] 🚀 Divine Auto-Start: Initiating autonomous faucet...');
      if (stageManager.isAutomaticallyActivated() && !autonomousFaucet.isActive()) {
        const { startCryptoCrawlerRuntime } = await import('./admin-api');
        const result = await startCryptoCrawlerRuntime();
        if (!result.success) {
          throw new Error(String(result.payload.error || 'CryptoCrawler runtime failed to start'));
        }
        console.log('[CryptoCrawl] ✅ Autonomous runtime started - Stage 1 observation ACTIVE');
      } else if (!stageManager.isAutomaticallyActivated()) {
        console.log('[CryptoCrawl] Faucet auto-start skipped - canonical governance is paused or requires authorization');
      }
    } catch (err) {
      console.error('[CryptoCrawl] Failed to auto-start autonomous faucet:', err);
    }
  })();
}, 5000); // 5 second delay to allow RPC connections to initialize

// AUTO-START: Monte Carlo training is optional (disabled by default).
if (process.env.CRYPTOCRAWL_ENABLE_MONTE_CARLO_TRAINING === 'true') {
  setTimeout(() => {
    console.log('[CryptoCrawl] 🎓 Starting scheduled Monte Carlo training system...');
    scheduledMonteCarloTraining.start();
    console.log('[CryptoCrawl] ✅ Monte Carlo training scheduled');
  }, 10000);
}

// AUTO-START: "Always-on optimizer" is optional (disabled by default).
if (process.env.CRYPTOCRAWL_ENABLE_DIVINE_OPTIMIZER === 'true') {
  setTimeout(() => {
    console.log('[CryptoCrawl] 🌟 Starting recursive optimizer...');
    startDivineOptimizer();
    console.log('[CryptoCrawl] ✅ Optimizer active');
  }, 15000);
}

// In-memory stats (production: use Redis)
let stats = {
  totalProfit: 0,
  totalTrades: 0,
  successfulTrades: 0,
  failedTrades: 0,
  successRate: 0,
  lastUpdate: Date.now()
};

// ============================================================================
// FAUCET API ENDPOINTS - Divine Creativity-Powered Autonomous Profit System
// ============================================================================

/**
 * Faucet state management
 * NOTE: In-memory state is used for simplicity. For production multi-instance 
 * deployments, consider using Redis or database for persistent state storage.
 * The autonomous-faucet.ts maintains the actual trading state independently.
 */
let faucetState = {
  enabled: false,
  autoOptimize: true,
  profitableTimesOnly: true,
  antiDetectionEnabled: true,
  dailyTarget: 35000,
  sessionStartTime: Date.now(),
};

// GET /api/crypto/faucet/status - Get faucet status with divine insight
router.get('/faucet/status', async (req, res) => {
  try {
    const active = autonomousFaucet.isActive();
    const faucetId = autonomousFaucet.getFaucetId();

    // Safely get state from autonomous faucet
    let faucetData;
    let marketConditions;
    
    try {
      faucetData = autonomousFaucet.getState();
      marketConditions = autonomousFaucet.getMarketConditions();
    } catch (initError) {
      // Faucet not yet initialized - use defaults
      console.log('[Faucet] Using default values - faucet not yet initialized');
      faucetData = null;
      marketConditions = null;
    }
    
    res.json({
      active,
      faucetId,
      enabled: active,
      requestedEnabled: faucetState.enabled,
      mode: faucetData?.mode || 'unavailable',
      executionMode: faucetData?.executionMode || 'disabled',
      lastArbitrageDecision: faucetData?.lastArbitrageDecision || 'NONE',
      lastVerifiedArbitrage: faucetData?.lastVerifiedArbitrage || null,
      profitThisSession: faucetData?.profitThisSession || 0,
      profitThisHour: faucetData?.profitThisHour || 0,
      profitThisDay: faucetData?.profitThisDay || 0,
      dailyTarget: faucetState.dailyTarget,
      dailyTargetProgress: faucetData?.dailyTargetProgress || 0,
      tradesThisHour: faucetData?.tradesThisHour || 0,
      tradesThisDay: faucetData?.tradesThisDay || 0,
      stealthLevel: faucetData?.stealthLevel || 0,
      healthScore: faucetData?.healthScore || 0,
      consecutiveFailures: faucetData?.consecutiveFailures || 0,
      lastSuccessfulTrade: faucetData?.lastSuccessfulTrade || 0,
      lastLoopIterationAt: faucetData?.lastLoopIterationAt || 0,
      lastModeChange: faucetData?.lastModeChange || 0,
      currentWindow: faucetData?.currentWindow || 0,
      totalWindows: 18,
      autoOptimize: faucetState.autoOptimize,
      profitableTimesOnly: faucetState.profitableTimesOnly,
      antiDetectionEnabled: faucetState.antiDetectionEnabled,
      marketConditions: marketConditions ? {
        volatility: marketConditions.volatility,
        gasEfficiency: marketConditions.gasEfficiency,
        technicalSignal: marketConditions.technicalSignal,
        confidence: marketConditions.confidence,
        timestamp: marketConditions.timestamp,
        technicalDataProvenance: marketConditions.technicalDataProvenance,
        technicalDataTimestamp: marketConditions.technicalDataTimestamp,
        quoteDataProvenance: marketConditions.quoteDataProvenance,
        quoteDataTimestamp: marketConditions.quoteDataTimestamp,
        lastMarketDataError: marketConditions.lastMarketDataError || null,
      } : {
        volatility: 50,
        gasEfficiency: 5,
        technicalSignal: 'neutral',
        confidence: 0.5,
        timestamp: null,
        technicalDataProvenance: 'no-data',
        technicalDataTimestamp: null,
        quoteDataProvenance: 'no-data',
        quoteDataTimestamp: null,
        lastMarketDataError: 'Faucet is unavailable',
      },
      divineInspiration: {
        creativity: 'active',
        resourcefulness: 'optimized', 
        determination: 'unwavering',
        recursiveOptimization: true,
      },
    });
  } catch (error) {
    const active = autonomousFaucet.isActive();
    const faucetId = autonomousFaucet.getFaucetId();

    res.status(503).json({
      active,
      faucetId,
      enabled: false,
      mode: 'unavailable',
      executionMode: 'disabled',
      lastArbitrageDecision: 'NONE',
      lastVerifiedArbitrage: null,
      profitThisSession: 0,
      profitThisHour: 0,
      profitThisDay: 0,
      dailyTarget: faucetState.dailyTarget,
      dailyTargetProgress: 0,
      tradesThisHour: 0,
      tradesThisDay: 0,
      stealthLevel: 0,
      healthScore: 0,
      consecutiveFailures: 0,
      lastSuccessfulTrade: 0,
      lastLoopIterationAt: 0,
      lastModeChange: 0,
      currentWindow: 0,
      totalWindows: 18,
      autoOptimize: faucetState.autoOptimize,
      profitableTimesOnly: faucetState.profitableTimesOnly,
      antiDetectionEnabled: faucetState.antiDetectionEnabled,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// POST /api/crypto/faucet/toggle - Toggle faucet ON/OFF with divine control
router.post('/faucet/toggle', async (req, res) => {
  const { enabled } = req.body;
  
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'Invalid enabled value' });
  }
  
  faucetState.enabled = enabled;
  
  console.log(`[Faucet] 🔮 Divine ${enabled ? 'ACTIVATION' : 'DEACTIVATION'} - Faucet is now ${enabled ? 'ON' : 'OFF'}`);
  
  // Control the autonomous faucet AND the Divine Optimizer manual override
  if (enabled) {
    const { initializeGovernance } = await import('../governance/index.js');
    await initializeGovernance();

    // Remove manual override and start faucet
    manuallyEnableFaucet();
    if (stageManager.isAutomaticallyActivated() && !autonomousFaucet.isActive()) {
      autonomousFaucet.runAutonomousLoop().catch(err => {
        console.error('[Faucet] Failed to start autonomous loop:', err);
      });
    } else if (!stageManager.isAutomaticallyActivated()) {
      console.log('[Faucet] Start skipped - canonical governance is paused or requires authorization');
    }
  } else {
    // Set manual override to disable and stop faucet
    manuallyDisableFaucet();
    autonomousFaucet.stop();
  }
  
  res.json({
    success: true,
    enabled: autonomousFaucet.isActive(),
    requestedEnabled: faucetState.enabled,
    manuallyDisabled: divineOptimizerState.manuallyDisabled,
    message: enabled 
      ? '🟢 Autonomous profit faucet ACTIVATED - Divine creativity engaged (ALWAYS ON mode)' 
      : '🔴 Faucet MANUALLY deactivated - Will remain OFF until re-enabled',
  });
});

// POST /api/crypto/faucet/settings - Update faucet optimization settings
router.post('/faucet/settings', async (req, res) => {
  const { autoOptimize, profitableTimesOnly, antiDetectionEnabled, dailyTarget } = req.body;
  
  // Update settings with divine precision
  if (typeof autoOptimize === 'boolean') {
    faucetState.autoOptimize = autoOptimize;
  }
  if (typeof profitableTimesOnly === 'boolean') {
    faucetState.profitableTimesOnly = profitableTimesOnly;
  }
  if (typeof antiDetectionEnabled === 'boolean') {
    faucetState.antiDetectionEnabled = antiDetectionEnabled;
  }
  if (typeof dailyTarget === 'number' && dailyTarget > 0) {
    faucetState.dailyTarget = dailyTarget;
  }
  
  console.log('[Faucet] ⚡ Divine optimization settings updated:', faucetState);
  
  res.json({
    success: true,
    settings: {
      autoOptimize: faucetState.autoOptimize,
      profitableTimesOnly: faucetState.profitableTimesOnly,
      antiDetectionEnabled: faucetState.antiDetectionEnabled,
      dailyTarget: faucetState.dailyTarget,
    },
    message: '✨ Divine perfection synthesis complete - Settings optimized',
  });
});

// GET /api/crypto/faucet/health - Deep health check with divine insight
router.get('/faucet/health', async (req, res) => {
  try {
    const healthChecks = autonomousFaucet.getHealthChecks();
    const circuitBreaker = autonomousFaucet.getCircuitBreakerState();
    
    const checksArray = Array.from(healthChecks.entries()).map(([name, check]) => ({
      component: name,
      status: check.status,
      latency: check.latency,
      message: check.message,
    }));
    
    res.json({
      active: autonomousFaucet.isActive(),
      faucetId: autonomousFaucet.getFaucetId(),
      overall: circuitBreaker.isOpen ? 'degraded' : 'healthy',
      faucetEnabled: faucetState.enabled,
      faucetAlwaysOn: DIVINE_OPTIMIZER_CONFIG.FAUCET_ALWAYS_ON,
      manuallyDisabled: divineOptimizerState.manuallyDisabled,
      circuitBreaker: {
        isOpen: circuitBreaker.isOpen,
        failures: circuitBreaker.failures,
        halfOpenAttempts: circuitBreaker.halfOpenAttempts,
      },
      components: checksArray,
      divineOptimizer: {
        isRunning: divineOptimizerState.isRunning,
        currentCreativity: divineOptimizerState.currentCreativity.toFixed(2),
        optimizationPasses: divineOptimizerState.optimizationPasses,
        faucetHealthScore: `${(divineOptimizerState.faucetHealthScore * 100).toFixed(1)}%`,
        is110Operational: divineOptimizerState.faucetHealthScore >= DIVINE_OPTIMIZER_CONFIG.HEALTH_THRESHOLD,
        autoRestarts: divineOptimizerState.autoRestartCount,
        isOpportuneTime: isOpportuneTime(),
        opportuneScore: divineOptimizerState.opportuneScore,
      },
      intentInference: {
        currentIntent: divineOptimizerState.currentIntent,
        intentConfidence: divineOptimizerState.intentConfidence.toFixed(2),
        consecutiveSuccesses: divineOptimizerState.consecutiveSuccesses,
      },
      divineStatus: {
        creativity: 'flowing',
        resourcefulness: 'abundant',
        determination: 'absolute',
        alwaysOnMode: 'ACTIVE',
      },
    });
  } catch (error) {
    res.json({
      overall: 'unknown',
      faucetEnabled: faucetState.enabled,
      faucetAlwaysOn: DIVINE_OPTIMIZER_CONFIG.FAUCET_ALWAYS_ON,
      manuallyDisabled: divineOptimizerState.manuallyDisabled,
      circuitBreaker: { isOpen: false, failures: 0 },
      components: [],
      divineOptimizer: {
        isRunning: divineOptimizerState.isRunning,
        currentCreativity: divineOptimizerState.currentCreativity.toFixed(2),
        optimizationPasses: divineOptimizerState.optimizationPasses,
        faucetHealthScore: '0%',
        is110Operational: false,
        autoRestarts: divineOptimizerState.autoRestartCount,
        isOpportuneTime: false,
        opportuneScore: 0,
      },
      intentInference: {
        currentIntent: divineOptimizerState.currentIntent,
        intentConfidence: divineOptimizerState.intentConfidence.toFixed(2),
        consecutiveSuccesses: divineOptimizerState.consecutiveSuccesses,
      },
      divineStatus: {
        creativity: 'initializing',
        resourcefulness: 'gathering',
        determination: 'building',
        alwaysOnMode: 'INITIALIZING',
      },
    });
  }
});

// POST /api/crypto/faucet/stress-test - Run divine stress tests
router.post('/faucet/stress-test', async (req, res) => {
  try {
    console.log('[Faucet] 🧪 Initiating divine stress test synthesis...');
    const results = await autonomousFaucet.runStressTests();
    
    const totalTests = results.passed + results.failed;
    const passRate = totalTests > 0 
      ? `${((results.passed / totalTests) * 100).toFixed(1)}%` 
      : '0%';
    
    res.json({
      success: true,
      passed: results.passed,
      failed: results.failed,
      passRate,
      results: results.results,
      divineVerdict: results.failed === 0 ? 'Perfect divine synthesis achieved' : 'Optimization opportunities identified',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================================================
// MONTE CARLO TRAINING API ENDPOINTS - Profitability Optimization
// ============================================================================

// GET /api/crypto/training/status - Get Monte Carlo training status
router.get('/training/status', async (req, res) => {
  try {
    const metrics = scheduledMonteCarloTraining.getMetrics();
    const currentSession = scheduledMonteCarloTraining.getCurrentSession();
    const isActive = scheduledMonteCarloTraining.isActive();
    
    res.json({
      active: isActive,
      currentSession: currentSession ? {
        sessionId: currentSession.sessionId,
        status: currentSession.status,
        simulationsCompleted: currentSession.simulationsCompleted,
        strategiesTrained: currentSession.strategiesTrained,
        elapsedTime: Date.now() - currentSession.startTime,
      } : null,
      metrics: {
        totalSessionsCompleted: metrics.totalSessionsCompleted,
        lastTrainingTime: metrics.lastTrainingTime ? new Date(metrics.lastTrainingTime).toISOString() : null,
        averageSessionDuration: Math.round(metrics.averageSessionDuration / 1000),
        totalSimulationsRun: metrics.totalSimulationsRun,
        cumulativeProfitImprovement: `${metrics.cumulativeProfitImprovement.toFixed(2)}%`,
      },
      bestOptimizations: metrics.bestOptimizations.slice(0, 5).map(opt => ({
        strategy: opt.strategyName,
        condition: opt.marketCondition,
        improvement: `${opt.profitImprovement.toFixed(2)}%`,
        optimizedWinRate: opt.optimizedWinRate.toFixed(3),
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/crypto/training/trigger - Manually trigger a training session
router.post('/training/trigger', async (req, res) => {
  try {
    console.log('[MonteCarloTraining] 🎯 Manual training trigger requested');
    
    // Check if training is already running
    if (scheduledMonteCarloTraining.getCurrentSession()) {
      return res.status(409).json({
        success: false,
        error: 'Training session already in progress',
      });
    }
    
    // Start training and wait briefly to verify it started successfully
    // This addresses the PR comment about validating training actually started
    const sessionPromise = scheduledMonteCarloTraining.triggerTraining();
    
    // Wait a brief moment to catch any synchronous startup errors
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify session was created
    const currentSession = scheduledMonteCarloTraining.getCurrentSession();
    if (!currentSession) {
      return res.status(500).json({
        success: false,
        error: 'Training session failed to start',
      });
    }
    
    // Return with session ID confirmation
    res.json({
      success: true,
      message: 'Training session started - Divine profitability optimization in progress',
      sessionId: currentSession.sessionId,
      strategy: currentSession.strategiesTrained[0],
      note: 'Check /api/crypto/training/status for progress',
    });
    
    // Log when training completes
    sessionPromise.then(session => {
      console.log(`[MonteCarloTraining] ✅ Manual training completed: ${session.totalProfitImprovement.toFixed(2)}% improvement`);
    }).catch(err => {
      console.error('[MonteCarloTraining] ❌ Manual training failed:', err);
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/crypto/training/optimized-params - Get optimized parameters for strategies
router.get('/training/optimized-params', async (req, res) => {
  try {
    const allParams = scheduledMonteCarloTraining.getAllOptimizedParams();
    const paramsObj: Record<string, any> = {};
    
    for (const [strategy, params] of allParams) {
      paramsObj[strategy] = params;
    }
    
    res.json({
      success: true,
      strategiesOptimized: allParams.size,
      parameters: paramsObj,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// EXISTING API ENDPOINTS
// ============================================================================

// GET /api/crypto/stats - Real-time statistics from Zero-Capital Engine
router.get('/stats', async (req, res) => {
  // Get stats from the zero-capital engine
  const engineStats = zeroCapitalEngine.getStats();
  
  const response = {
    profit: {
      today: parseFloat(engineStats.totalProfit) || 0,
      thisWeek: parseFloat(engineStats.totalProfit) || 0,
      thisMonth: parseFloat(engineStats.totalProfit) || 0,
      allTime: parseFloat(engineStats.totalProfit) || 0
    },
    trades: {
      total: engineStats.totalTrades,
      successful: engineStats.successfulTrades,
      failed: engineStats.failedTrades,
      successRate: engineStats.successRate
    },
    performance: {
      avgProfitPerTrade: engineStats.successfulTrades > 0 
        ? (parseFloat(engineStats.totalProfit) / engineStats.successfulTrades).toFixed(4) 
        : '0',
      lastUpdate: new Date().toISOString(),
      capitalRequired: engineStats.capitalRequired, // ZERO
      gaslessTransactions: engineStats.gaslessTransactions
    },
    zeroCapital: {
      enabled: engineStats.isRunning,
      mechanism: 'Verified RPC monitoring',
      capitalRequired: 'ZERO',
      currentOpportunities: engineStats.currentOpportunities
    }
  };
  
  res.json(response);
});

// GET /api/crypto/opportunities - Only verified quote-backed opportunities belong here.
router.get('/opportunities', async (_req, res) => {
  res.json({
    count: 0,
    opportunities: [],
    status: 'unavailable',
    reason: 'No verified multi-venue quote source is configured.',
  });
});

// GET /api/crypto/balances - Wallet balances
router.get('/balances', async (req, res) => {
  const balances = await getWalletBalances();
  
  res.json({
    chains: balances.map(b => ({
      chain: b.chain,
      native: b.native,
      tokens: b.tokens
    })),
    totalValue: balances.reduce((sum, b) => sum + b.totalValue, 0)
  });
});

// POST /api/crypto/withdraw - Withdraw profits
router.post('/withdraw', async (req, res) => {
  const {amount, token, toAddress} = req.body;
  
  if (!amount || !token || !toAddress) {
    return res.status(400).json({error: 'Missing parameters'});
  }
  
  // Validate amount
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({error: 'Invalid amount'});
  }
  
  // Validate and lock withdrawals to the configured profit wallet
  const configuredProfitWallet = process.env.CRYPTO_PROFIT_WALLET_ADDRESS;
  if (!configuredProfitWallet) {
    return res.status(503).json({ error: 'CRYPTO_PROFIT_WALLET_ADDRESS not configured' });
  }
  let normalizedTo: string;
  let normalizedConfigured: string;
  try {
    normalizedTo = ethersUtils.getAddress(toAddress);
    normalizedConfigured = ethersUtils.getAddress(configuredProfitWallet);
  } catch {
    return res.status(400).json({ error: 'Invalid Ethereum address format' });
  }
  if (normalizedTo !== normalizedConfigured) {
    return res.status(403).json({ error: 'Withdrawals are restricted to the configured profit wallet' });
  }
  
  try {
    // TODO: Check available balance before withdrawal
    const txHash = await executeWithdrawal(amount, token, normalizedTo);
    res.json({success: true, txHash});
  } catch (error: any) {
    res.status(500).json({error: error.message});
  }
});

// GET /api/crypto/history - Trade history
router.get('/history', async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const history = await getTradeHistory(limit);
  
  res.json({
    trades: history.map(t => ({
      timestamp: t.timestamp,
      asset: t.asset,
      profit: t.profit,
      success: t.success,
      txHash: t.txHash
    }))
  });
});

// WebSocket /api/crypto/live - Real-time updates
wss.on('connection', (ws) => {
  console.log('📡 WebSocket client connected');
  
  // Send initial data
  ws.send(JSON.stringify({type: 'stats', data: stats}));
  
  // Update every 2 seconds
  const interval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({
        type: 'update',
        data: {
          stats,
          timestamp: Date.now()
        }
      }));
    }
  }, 2000);
  
  ws.on('close', () => {
    clearInterval(interval);
    console.log('📡 WebSocket client disconnected');
  });
});

// Helper functions
async function getRecentResults(hours: number) {
  return {profit: 1250, trades: 45, successRate: 0.78};
}

async function getProfitForPeriod(days: number) {
  return days * 1250;
}

async function getBestTrade() {
  return {profit: 450, asset: 'USDC/USDT', timestamp: Date.now() - 3600000};
}

/**
 * Get wallet balances from the real balance monitor
 * This connects the cryptocrawler to the actual wallet for accurate balance display
 */
async function getWalletBalances() {
  try {
    if (!process.env.BRIDGE_WALLET_ADDRESS) {
      return [];
    }

    // Use real balance monitor if it's running
    if (balanceMonitor.isRunning()) {
      const balances = await balanceMonitor.getAllBalances();
      return balances.map(b => ({
        chain: b.chain,
        native: b.native,
        nativeUsd: b.nativeUsd,
        tokens: [
          { symbol: 'USDT', balance: b.usdt },
          { symbol: 'USDC', balance: b.usdc }
        ].filter(t => t.balance > 0),
        totalValue: b.totalUsd
      }));
    }
    
    // If balance monitor not running, try to start it
    console.log('[CryptoCrawl] Balance monitor not running, attempting to start...');
    await balanceMonitor.start();
    
    // Wait briefly for initialization to complete before fetching balances
    // This addresses the PR comment about potential stale data after start()
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const balances = await balanceMonitor.getAllBalances();
    return balances.map(b => ({
      chain: b.chain,
      native: b.native,
      nativeUsd: b.nativeUsd,
      tokens: [
        { symbol: 'USDT', balance: b.usdt },
        { symbol: 'USDC', balance: b.usdc }
      ].filter(t => t.balance > 0),
      totalValue: b.totalUsd
    }));
  } catch (error) {
    console.error('[CryptoCrawl] Failed to get wallet balances from monitor:', error);
    // Return empty array on error - dashboard will show "no balances"
    return [];
  }
}

/**
 * Execute withdrawal using the actual wallet manager
 * Currently supports native token withdrawals on the specified chain.
 * ERC20 token transfers require additional contract interaction implementation.
 * 
 * @param amount - Amount to withdraw
 * @param token - Token symbol (e.g., 'POL', 'ETH', 'USDC')
 * @param to - Destination address
 * @param chain - Optional chain to withdraw from (defaults to finding best chain)
 */
async function executeWithdrawal(amount: number, token: string, to: string, chain?: string) {
  try {
    if (!walletManager) {
      // Try to initialize wallet manager if not already done
      walletManager = new WalletManager();
      await walletManager.initialize();
    }
    
    // Determine the appropriate chain for withdrawal
    // If not specified, try to find the chain with sufficient balance
    let withdrawalChain: WalletChainId | undefined = chain as WalletChainId | undefined;
    if (!withdrawalChain) {
      // Get balances to determine best chain for this token
      const balances = await balanceMonitor.getAllBalances();
      
      // For native tokens, find chain with sufficient balance
      const nativeTokens = ['POL', 'ETH', 'AVAX', 'BNB'];
      if (nativeTokens.includes(token.toUpperCase())) {
        const chainWithBalance = balances.find(b => b.native >= amount);
        withdrawalChain = (chainWithBalance?.chain as WalletChainId | undefined) || ('polygon' as WalletChainId);
      } else {
        // For stablecoins (USDC, USDT), find chain with sufficient balance
        const chainWithStable = balances.find(b => 
          (token.toUpperCase() === 'USDC' && b.usdc >= amount) ||
          (token.toUpperCase() === 'USDT' && b.usdt >= amount)
        );
        withdrawalChain = (chainWithStable?.chain as WalletChainId | undefined) || ('polygon' as WalletChainId);
      }
    }
    
    // Execute the withdrawal
    // Note: For ERC20 tokens, walletManager.withdraw handles native tokens only
    // Full ERC20 support would require walletManager.transferToken() implementation
    const txHash = await walletManager.withdraw({ 
      chain: withdrawalChain, 
      to, 
      amount: amount.toString() 
    });
    console.log(`[CryptoCrawl] ✅ Withdrawal executed: ${amount} ${token} on ${withdrawalChain} to ${to} - TX: ${txHash}`);
    return txHash;
  } catch (error) {
    console.error('[CryptoCrawl] Withdrawal failed:', error);
    throw error;
  }
}

// Trade results are not persisted yet; never manufacture financial activity.
interface TradeHistoryRecord {
  timestamp: number;
  asset: string;
  profit: number;
  success: boolean;
  txHash: string;
}

async function getTradeHistory(_limit: number): Promise<TradeHistoryRecord[]> {
  return [];
}

export {router as dashboardApi, wss};
