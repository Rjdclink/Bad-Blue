import express from 'express';
import {WebSocketServer} from 'ws';
import {pipeline} from '../integration/master-pipeline';
import { zeroCapitalEngine } from '../core/zero-capital-engine';
import { autonomousFaucet } from '../faucet/autonomous-faucet';
import { balanceMonitor } from '../bridge/balance-monitor';
import { WalletManager } from '../core/wallet';
import { scheduledMonteCarloTraining } from '../training/scheduled-monte-carlo-training';

const router = express.Router();
const wss = new WebSocketServer({noServer: true});

// Wallet manager instance for real wallet operations
let walletManager: WalletManager | null = null;

// Initialize zero-capital engine on module load
zeroCapitalEngine.initialize().catch(err => {
  console.error('[CryptoCrawl] Failed to initialize zero-capital engine:', err);
});

// Initialize balance monitor and wallet manager on module load
(async () => {
  try {
    // Start balance monitor for real-time balance tracking
    await balanceMonitor.start();
    console.log('[CryptoCrawl] ✅ Balance monitor started - wallet balances connected');
    
    // Initialize wallet manager
    walletManager = new WalletManager();
    await walletManager.initialize();
    console.log('[CryptoCrawl] ✅ Wallet manager initialized - cryptocrawler connected to wallet');
  } catch (err) {
    console.error('[CryptoCrawl] Failed to initialize balance monitor or wallet:', err);
  }
})();

// AUTO-START: Initialize autonomous faucet on module load (Divine Auto-Activation)
// This ensures arbitrage begins automatically when server starts with valid RPC connections
setTimeout(() => {
  console.log('[CryptoCrawl] 🚀 Divine Auto-Start: Initiating autonomous faucet...');
  if (!autonomousFaucet.isActive()) {
    autonomousFaucet.runAutonomousLoop().catch(err => {
      console.error('[CryptoCrawl] Failed to auto-start autonomous faucet:', err);
    });
    console.log('[CryptoCrawl] ✅ Autonomous faucet started - Zero-capital arbitrage ACTIVE');
  }
}, 5000); // 5 second delay to allow RPC connections to initialize

// AUTO-START: Initialize scheduled Monte Carlo training for profitability optimization
// Runs daily at low traffic hours (3 AM UTC by default) for continuous improvement
setTimeout(() => {
  console.log('[CryptoCrawl] 🎓 Starting scheduled Monte Carlo training system...');
  scheduledMonteCarloTraining.start();
  console.log('[CryptoCrawl] ✅ Monte Carlo training scheduled - profitability optimization ACTIVE');
}, 10000); // 10 second delay to allow other systems to initialize first

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
  enabled: true,  // FAUCET IS ON BY DEFAULT - Divine determination
  autoOptimize: true,
  profitableTimesOnly: true,
  antiDetectionEnabled: true,
  dailyTarget: 35000,
  sessionStartTime: Date.now(),
};

// GET /api/crypto/faucet/status - Get faucet status with divine insight
router.get('/faucet/status', async (req, res) => {
  try {
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
      enabled: faucetState.enabled,
      mode: faucetData?.mode || 'open',
      profitThisSession: faucetData?.profitThisSession || 0,
      profitThisHour: faucetData?.profitThisHour || 0,
      profitThisDay: faucetData?.profitThisDay || 0,
      dailyTarget: faucetState.dailyTarget,
      dailyTargetProgress: faucetData?.dailyTargetProgress || 0,
      tradesThisHour: faucetData?.tradesThisHour || 0,
      tradesThisDay: faucetData?.tradesThisDay || 0,
      stealthLevel: faucetData?.stealthLevel || 0,
      healthScore: faucetData?.healthScore || 100,
      consecutiveFailures: faucetData?.consecutiveFailures || 0,
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
      } : {
        volatility: 50,
        gasEfficiency: 5,
        technicalSignal: 'neutral',
        confidence: 0.5,
      },
      divineInspiration: {
        creativity: 'active',
        resourcefulness: 'optimized', 
        determination: 'unwavering',
        recursiveOptimization: true,
      },
    });
  } catch (error) {
    // Return optimistic defaults if faucet not initialized
    res.json({
      enabled: faucetState.enabled,
      mode: 'open',
      profitThisSession: 0,
      profitThisHour: 0,
      profitThisDay: 0,
      dailyTarget: faucetState.dailyTarget,
      dailyTargetProgress: 0,
      tradesThisHour: 0,
      tradesThisDay: 0,
      stealthLevel: 0,
      healthScore: 100,
      consecutiveFailures: 0,
      currentWindow: 0,
      totalWindows: 18,
      autoOptimize: faucetState.autoOptimize,
      profitableTimesOnly: faucetState.profitableTimesOnly,
      antiDetectionEnabled: faucetState.antiDetectionEnabled,
      divineInspiration: {
        creativity: 'active',
        resourcefulness: 'optimized',
        determination: 'unwavering',
        recursiveOptimization: true,
      },
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
  
  // Control the autonomous faucet
  if (enabled) {
    // Start the autonomous faucet with divine determination
    if (!autonomousFaucet.isActive()) {
      autonomousFaucet.runAutonomousLoop().catch(err => {
        console.error('[Faucet] Failed to start autonomous loop:', err);
      });
    }
  } else {
    // Stop the faucet gracefully
    autonomousFaucet.stop();
  }
  
  res.json({
    success: true,
    enabled: faucetState.enabled,
    message: enabled 
      ? '🟢 Autonomous profit faucet ACTIVATED - Divine creativity engaged' 
      : '🔴 Faucet deactivated',
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
      overall: circuitBreaker.isOpen ? 'degraded' : 'healthy',
      faucetEnabled: faucetState.enabled,
      circuitBreaker: {
        isOpen: circuitBreaker.isOpen,
        failures: circuitBreaker.failures,
        halfOpenAttempts: circuitBreaker.halfOpenAttempts,
      },
      components: checksArray,
      divineStatus: {
        creativity: 'flowing',
        resourcefulness: 'abundant',
        determination: 'absolute',
      },
    });
  } catch (error) {
    res.json({
      overall: 'unknown',
      faucetEnabled: faucetState.enabled,
      circuitBreaker: { isOpen: false, failures: 0 },
      components: [],
      divineStatus: {
        creativity: 'initializing',
        resourcefulness: 'gathering',
        determination: 'building',
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
    
    // Start training asynchronously
    const sessionPromise = scheduledMonteCarloTraining.triggerTraining();
    
    // Return immediately with session ID
    res.json({
      success: true,
      message: 'Training session started - profitability optimization in progress',
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
      enabled: true,
      mechanism: 'Flash Loan + MEV Bundle',
      capitalRequired: 'ZERO',
      currentOpportunities: engineStats.currentOpportunities
    }
  };
  
  res.json(response);
});

// GET /api/crypto/opportunities - Current opportunities
router.get('/opportunities', async (req, res) => {
  const opportunities = await pipeline.getCurrentOpportunities();
  
  res.json({
    count: opportunities.length,
    opportunities: opportunities.slice(0, 50).map(opp => ({
      id: `${opp.asset}-${opp.chain}-${opp.timestamp}`,
      asset: opp.asset,
      chain: opp.chain,
      profit: opp.profitEstimate,
      successProbability: 0.85, // TODO: Calculate from historical data
      tier: opp.priority > 70 ? 'A' : opp.priority > 40 ? 'B' : 'C',
      age: Date.now() - opp.timestamp
    }))
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
  
  // Validate Ethereum address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
    return res.status(400).json({error: 'Invalid Ethereum address format'});
  }
  
  try {
    // TODO: Check available balance before withdrawal
    const txHash = await executeWithdrawal(amount, token, toAddress);
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
 * Connects the cryptocrawler wallet to perform real withdrawals
 */
async function executeWithdrawal(amount: number, token: string, to: string) {
  try {
    if (!walletManager) {
      // Try to initialize wallet manager if not already done
      walletManager = new WalletManager();
      await walletManager.initialize();
    }
    
    // For native token withdrawals, use the withdraw function
    // Note: Currently supports native token withdrawals
    // For ERC20 tokens like USDC/USDT, additional implementation would be needed
    const chain = 'polygon'; // Default to polygon for withdrawals
    const txHash = await walletManager.withdraw({ chain, to, amount: amount.toString() });
    console.log(`[CryptoCrawl] ✅ Withdrawal executed: ${amount} ${token} to ${to} - TX: ${txHash}`);
    return txHash;
  } catch (error) {
    console.error('[CryptoCrawl] Withdrawal failed:', error);
    throw error;
  }
}

// Helper: Get trade history (STUB - Replace with database queries)
async function getTradeHistory(limit: number) {
  // TODO: Query from crypto_transactions table
  console.warn('⚠️ STUB: getTradeHistory not yet implemented');
  return Array(limit).fill(null).map((_, i) => ({
    timestamp: Date.now() - i * 60000,
    asset: 'USDC/USDT',
    profit: Math.random() * 100,
    success: Math.random() > 0.2,
    txHash: '0x' + Math.random().toString(16).slice(2, 66)
  }));
}

export {router as dashboardApi, wss};
