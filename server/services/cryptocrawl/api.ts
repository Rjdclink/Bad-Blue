// API Routes for CryptoCrawl Dashboard
import { Router } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Request, Response, NextFunction } from 'express';
import { 
  authenticateWithPassword, 
  requireCryptoCrawlAuth,
  revokeSession,
  getSessionInfo,
  isAuthConfigured
} from './auth/passwordAuth';

const dashboardApi = Router();
const adminApi = Router();

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Generate a cryptographically-styled mock transaction hash
 * Used for testing/demo purposes - replace with real tx hashes in production
 */
function generateMockTxHash(): string {
  return `0x${Array.from({ length: 64 }, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join('')}`;
}

/**
 * Safe division that handles division by zero
 */
function safeDivide(numerator: number, denominator: number, decimals: number = 2): string {
  if (denominator === 0) return '0';
  return (numerator / denominator).toFixed(decimals);
}

/**
 * Calculate available balance for a token across all chains
 */
function getAvailableBalance(token: string): number {
  let total = 0;
  for (const chain of mockBalances.chains) {
    if (token.toUpperCase() === chain.nativeToken) {
      total += chain.native;
    }
    for (const t of chain.tokens) {
      if (t.symbol.toUpperCase() === token.toUpperCase()) {
        total += t.balance;
      }
    }
  }
  return total;
}

// ============================================
// AUTHENTICATION ROUTES (Public - No auth required)
// ============================================

// GET /api/crypto/auth/status - Check if auth is configured (new route)
dashboardApi.get('/auth/status', (req, res) => {
  res.json({
    configured: isAuthConfigured(),
    message: isAuthConfigured() 
      ? 'Authentication is configured and available' 
      : 'Authentication not configured. Set CRYPTOCRAWL_EMAIL and CRYPTOCRAWL_PASSWORD to enable.'
  });
});

// POST /api/crypto/auth - Authenticate with master password
// NO email required - just password (crptcrwlr)
dashboardApi.post('/auth', (req, res) => {
  if (!isAuthConfigured()) {
    return res.status(503).json({
      success: false,
      configured: false,
      error: 'Authentication not configured',
      message: 'CRYPTOCRAWL_EMAIL and CRYPTOCRAWL_PASSWORD environment variables must be set'
    });
  }
  
  const { password } = req.body;
  
  if (!password) {
    return res.status(400).json({
      success: false,
      error: 'Password required. No email needed.'
    });
  }
  
  const result = authenticateWithPassword(password);
  
  if (result.success) {
    res.json({
      success: true,
      configured: true,
      token: result.token,
      expiresAt: result.expiresAt,
      message: 'Welcome to CryptoCrawl. Use token in Authorization header for protected routes.'
    });
  } else {
    res.status(401).json({
      success: false,
      configured: true,
      error: result.error || 'Invalid password'
    });
  }
});

// POST /api/crypto/logout - End session
dashboardApi.post('/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    revokeSession(token);
  }
  
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// GET /api/crypto/session - Check if authenticated
dashboardApi.get('/session', (req, res) => {
  if (!isAuthConfigured()) {
    return res.json({
      authenticated: false,
      configured: false,
      message: 'Authentication not configured. Set CRYPTOCRAWL_EMAIL and CRYPTOCRAWL_PASSWORD to enable.'
    });
  }
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({
      authenticated: false,
      configured: true,
      message: 'Not authenticated. POST to /api/crypto/auth with password to login.'
    });
  }
  
  const token = authHeader.substring(7);
  const info = getSessionInfo(token);
  
  res.json({
    authenticated: info.valid,
    configured: true,
    expiresIn: info.expiresIn,
    message: info.valid ? 'Session active' : 'Session expired or invalid'
  });
});

// ============================================
// SYSTEM STATE & MOCK DATA
// ============================================

let systemRunning = false;
let systemStartedAt: Date | null = null;

// Health check state - tracks actual system health
const systemHealthState = {
  database: { healthy: true, lastCheck: Date.now(), latency: 0 },
  rpcEndpoints: new Map<string, { healthy: boolean; latency: number; lastCheck: number }>(),
  gasSponsor: { enabled: false, policyId: process.env.ALCHEMY_GAS_POLICY_ID || null }
};

// Initialize RPC health state
['ethereum', 'polygon', 'arbitrum', 'avalanche', 'bsc'].forEach(chain => {
  systemHealthState.rpcEndpoints.set(chain, { healthy: true, latency: 0, lastCheck: Date.now() });
});

const mockStats = {
  profit: {
    today: 0,
    thisWeek: 0,
    thisMonth: 0,
    allTime: 0
  },
  trades: {
    total: 0,
    successful: 0,
    failed: 0,
    successRate: '0'
  },
  performance: {
    avgProfitPerTrade: '0',
    bestTrade: { profit: 0, asset: 'N/A', timestamp: 0 },
    lastUpdate: new Date().toISOString()
  },
  gasSavings: {
    totalSaved: 0,
    sponsoredTxCount: 0,
    avgSavingsPerTx: '0'
  }
};

const mockOpportunities: any[] = [];

const mockBalances = {
  chains: [
    { chain: 'ethereum', nativeToken: 'ETH', native: 0.5, tokens: [{ symbol: 'USDC', balance: 1000 }, { symbol: 'USDT', balance: 500 }] },
    { chain: 'polygon', nativeToken: 'MATIC', native: 100, tokens: [{ symbol: 'USDC', balance: 250 }] },
    { chain: 'arbitrum', nativeToken: 'ETH', native: 0.25, tokens: [{ symbol: 'USDC', balance: 750 }] },
    { chain: 'avalanche', nativeToken: 'AVAX', native: 5, tokens: [{ symbol: 'USDC', balance: 200 }] },
    { chain: 'bsc', nativeToken: 'BNB', native: 2, tokens: [{ symbol: 'USDT', balance: 300 }] }
  ],
  totalValue: 3500
};

const mockTradeHistory: Array<{
  timestamp: number;
  asset: string;
  profit: number;
  success: boolean;
  txHash: string;
  gasSponsored: boolean;
  gasSaved: number;
}> = [];

// ============================================
// WEBSOCKET SERVER
// ============================================

const wss = new WebSocketServer({ noServer: true });

function broadcast(data: any) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
  console.log('[CryptoCrawl] New WebSocket connection');
  
  ws.send(JSON.stringify({
    type: 'stats',
    data: {
      totalProfit: mockStats.profit.today,
      totalTrades: mockStats.trades.total,
      successfulTrades: mockStats.trades.successful,
      successRate: mockStats.trades.total > 0 ? parseFloat(mockStats.trades.successRate) / 100 : 0,
      gasSavings: mockStats.gasSavings
    }
  }));
  
  ws.on('close', () => {
    console.log('[CryptoCrawl] WebSocket disconnected');
  });
  
  ws.on('error', (error) => {
    console.error('[CryptoCrawl] WebSocket error:', error);
  });
});

// ============================================
// PUBLIC API ROUTES
// ============================================

// GET /api/crypto/stats - Get current statistics
dashboardApi.get('/stats', (req, res) => {
  res.json(mockStats);
});

// GET /api/crypto/opportunities - Get current opportunities
dashboardApi.get('/opportunities', (req, res) => {
  res.json({
    opportunities: mockOpportunities.slice(0, 10),
    count: mockOpportunities.length
  });
});

// GET /api/crypto/balances - Get wallet balances
dashboardApi.get('/balances', (req, res) => {
  res.json(mockBalances);
});

// GET /api/crypto/history - Get trade history
dashboardApi.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  res.json({
    trades: mockTradeHistory.slice(0, limit)
  });
});

// POST /api/crypto/withdraw - Withdraw funds (requires auth)
dashboardApi.post('/withdraw', requireCryptoCrawlAuth, (req, res) => {
  const { amount, token, toAddress } = req.body;
  
  if (!amount || !token || !toAddress) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: amount, token, toAddress'
    });
  }
  
  if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid Ethereum address format'
    });
  }
  
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid withdrawal amount'
    });
  }
  
  // Validate against available balance
  const availableBalance = getAvailableBalance(token);
  if (parsedAmount > availableBalance) {
    return res.status(400).json({
      success: false,
      error: `Insufficient balance. Available: ${availableBalance} ${token}`
    });
  }
  
  const mockTxHash = generateMockTxHash();
  
  console.log(`[CryptoCrawl] Withdrawal initiated: ${parsedAmount} ${token} to ${toAddress}`);
  
  res.json({
    success: true,
    txHash: mockTxHash,
    amount: parsedAmount,
    token,
    toAddress,
    status: 'pending',
    message: 'Withdrawal initiated successfully'
  });
});

// ============================================
// GAS SPONSORSHIP ROUTES
// ============================================

// GET /api/crypto/gas-sponsor/status - Get gas sponsorship status
dashboardApi.get('/gas-sponsor/status', (req, res) => {
  const policyId = process.env.ALCHEMY_GAS_POLICY_ID;
  
  res.json({
    enabled: !!policyId,
    policyId: policyId ? `${policyId.slice(0, 8)}...${policyId.slice(-4)}` : null,
    stats: mockStats.gasSavings,
    supportedChains: ['polygon', 'arbitrum', 'avalanche', 'bsc']
  });
});

// POST /api/crypto/gas-sponsor/estimate - Estimate gas savings for a transaction
dashboardApi.post('/gas-sponsor/estimate', requireCryptoCrawlAuth, (req, res) => {
  const { chain, txType, gasLimit } = req.body;
  
  if (!chain || !txType) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: chain, txType'
    });
  }
  
  // Mock gas price estimation by chain
  const gasPrices: Record<string, number> = {
    ethereum: 30,  // gwei
    polygon: 80,
    arbitrum: 0.1,
    avalanche: 25,
    bsc: 5
  };
  
  const gasPrice = gasPrices[chain.toLowerCase()] || 20;
  const estimatedGas = gasLimit || 200000;
  const estimatedCostGwei = gasPrice * estimatedGas;
  const estimatedCostUSD = (estimatedCostGwei / 1e9) * 2000; // Assuming $2000 ETH price
  
  const policyId = process.env.ALCHEMY_GAS_POLICY_ID;
  
  res.json({
    success: true,
    chain,
    txType,
    gasLimit: estimatedGas,
    gasPrice: `${gasPrice} gwei`,
    estimatedCostGwei,
    estimatedCostUSD: estimatedCostUSD.toFixed(4),
    sponsorshipAvailable: !!policyId,
    potentialSavings: policyId ? estimatedCostUSD.toFixed(4) : '0'
  });
});

// ============================================
// ADMIN API ROUTES
// ============================================

// GET /admin/crypto/status - Get system status
adminApi.get('/status', (req, res) => {
  const uptime = systemStartedAt ? Date.now() - systemStartedAt.getTime() : 0;
  const policyId = process.env.ALCHEMY_GAS_POLICY_ID;
  
  res.json({
    running: systemRunning,
    cryptoCrawl: {
      enabled: systemRunning,
      gasOracle: systemRunning,
      balanceMonitor: systemRunning,
      networkHealth: systemRunning,
      gasSponsor: !!policyId
    },
    startedAt: systemStartedAt ? systemStartedAt.toISOString() : null,
    uptime,
    gasSponsorPolicy: policyId ? `${policyId.slice(0, 8)}...` : null
  });
});

// GET /admin/crypto/health - Get system health with real metrics
adminApi.get('/health', (req, res) => {
  const uptime = systemStartedAt ? Date.now() - systemStartedAt.getTime() : 0;
  const memUsage = process.memoryUsage();
  const policyId = process.env.ALCHEMY_GAS_POLICY_ID;
  
  // Get RPC endpoint health
  const rpcHealth = Array.from(systemHealthState.rpcEndpoints.entries()).map(([chain, state]) => ({
    chain,
    healthy: state.healthy,
    latency: state.latency,
    lastCheck: new Date(state.lastCheck).toISOString()
  }));
  
  res.json({
    status: systemRunning ? 'healthy' : 'stopped',
    uptime,
    cryptoCrawl: {
      enabled: systemRunning,
      gasOracle: systemRunning,
      balanceMonitor: systemRunning,
      networkHealth: systemRunning,
      gasSponsor: {
        enabled: !!policyId,
        policyConfigured: !!policyId
      }
    },
    checks: {
      database: systemHealthState.database,
      rpcEndpoints: rpcHealth,
      memoryUsage: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024),
        unit: 'MB'
      },
      uptime: {
        seconds: Math.floor(uptime / 1000),
        formatted: formatUptime(uptime)
      }
    }
  });
});

/**
 * Format uptime in human-readable format
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// POST /admin/crypto/start - Start the system
adminApi.post('/start', requireCryptoCrawlAuth, (req, res) => {
  if (!systemRunning) {
    systemRunning = true;
    systemStartedAt = new Date();
    console.log('[CryptoCrawl] System started');
  } else {
    systemRunning = false;
    systemStartedAt = null;
    console.log('[CryptoCrawl] System stopped (toggle)');
  }
  
  broadcast({
    type: 'update',
    data: {
      status: systemRunning ? 'running' : 'stopped',
      stats: {
        totalProfit: mockStats.profit.today,
        totalTrades: mockStats.trades.total,
        successfulTrades: mockStats.trades.successful,
        successRate: mockStats.trades.total > 0 ? parseFloat(mockStats.trades.successRate) / 100 : 0
      }
    }
  });
  
  res.json({
    success: true,
    message: systemRunning ? 'System started' : 'System stopped',
    status: systemRunning ? 'running' : 'stopped'
  });
});

// POST /admin/crypto/stop - Emergency stop
adminApi.post('/stop', requireCryptoCrawlAuth, (req, res) => {
  const uptime = systemStartedAt ? Date.now() - systemStartedAt.getTime() : 0;
  systemRunning = false;
  systemStartedAt = null;
  
  console.log('[CryptoCrawl] Emergency stop executed');
  
  broadcast({
    type: 'update',
    data: {
      status: 'stopped',
      stats: {
        totalProfit: mockStats.profit.today,
        totalTrades: mockStats.trades.total,
        successfulTrades: mockStats.trades.successful,
        successRate: mockStats.trades.total > 0 ? parseFloat(mockStats.trades.successRate) / 100 : 0
      }
    }
  });
  
  res.json({
    success: true,
    message: 'Emergency stop executed',
    status: 'stopped',
    uptime
  });
});

// POST /admin/crypto/gas-sponsor/configure - Configure gas sponsorship
adminApi.post('/gas-sponsor/configure', requireCryptoCrawlAuth, (req, res) => {
  const { enabled, policyId } = req.body;
  
  // In production, this would update the gas policy configuration
  systemHealthState.gasSponsor.enabled = enabled;
  if (policyId) {
    systemHealthState.gasSponsor.policyId = policyId;
  }
  
  console.log(`[CryptoCrawl] Gas sponsor configured: enabled=${enabled}`);
  
  res.json({
    success: true,
    message: 'Gas sponsorship configuration updated',
    gasSponsor: {
      enabled: systemHealthState.gasSponsor.enabled,
      policyConfigured: !!systemHealthState.gasSponsor.policyId
    }
  });
});

// ============================================
// MOCK DATA GENERATOR
// ============================================

function generateMockData() {
  if (!systemRunning) return;
  
  const profit = Math.random() * 50;
  const success = Math.random() > 0.2;
  const assets = ['ETH/USDC', 'MATIC/USDT', 'ARB/ETH', 'WBTC/USDC', 'LINK/ETH', 'AVAX/USDC', 'BNB/USDT'];
  const asset = assets[Math.floor(Math.random() * assets.length)];
  
  // Determine if this tx would be gas sponsored
  const gasSponsored = !!process.env.ALCHEMY_GAS_POLICY_ID && Math.random() > 0.3;
  const gasSaved = gasSponsored ? Math.random() * 5 : 0; // $0-5 saved per sponsored tx
  
  mockStats.profit.today += profit;
  mockStats.profit.thisWeek += profit;
  mockStats.profit.thisMonth += profit;
  mockStats.profit.allTime += profit;
  mockStats.trades.total++;
  
  if (success) {
    mockStats.trades.successful++;
  } else {
    mockStats.trades.failed++;
  }
  
  // Safe division for success rate and avg profit
  mockStats.trades.successRate = safeDivide(mockStats.trades.successful * 100, mockStats.trades.total, 1);
  mockStats.performance.avgProfitPerTrade = safeDivide(mockStats.profit.allTime, mockStats.trades.total, 2);
  mockStats.performance.lastUpdate = new Date().toISOString();
  
  // Update gas savings stats
  if (gasSponsored) {
    mockStats.gasSavings.totalSaved += gasSaved;
    mockStats.gasSavings.sponsoredTxCount++;
    mockStats.gasSavings.avgSavingsPerTx = safeDivide(
      mockStats.gasSavings.totalSaved, 
      mockStats.gasSavings.sponsoredTxCount, 
      4
    );
  }
  
  if (profit > mockStats.performance.bestTrade.profit) {
    mockStats.performance.bestTrade = { profit, asset, timestamp: Date.now() };
  }
  
  // Add to trade history
  mockTradeHistory.unshift({
    timestamp: Date.now(),
    asset,
    profit: success ? profit : -profit * 0.1,
    success,
    txHash: generateMockTxHash(),
    gasSponsored,
    gasSaved
  });
  
  // Keep only last 100 trades
  if (mockTradeHistory.length > 100) {
    mockTradeHistory.pop();
  }
  
  // Simulate RPC health check updates
  systemHealthState.rpcEndpoints.forEach((state, chain) => {
    state.latency = Math.floor(Math.random() * 100) + 20;
    state.healthy = state.latency < 500;
    state.lastCheck = Date.now();
  });
  
  // Broadcast updated stats
  broadcast({
    type: 'stats',
    data: {
      totalProfit: mockStats.profit.today,
      totalTrades: mockStats.trades.total,
      successfulTrades: mockStats.trades.successful,
      successRate: mockStats.trades.total > 0 ? parseFloat(mockStats.trades.successRate) / 100 : 0,
      gasSavings: mockStats.gasSavings
    }
  });
}

// Start mock data generator (every 10 seconds)
setInterval(generateMockData, 10000);

export { dashboardApi, adminApi, wss };
