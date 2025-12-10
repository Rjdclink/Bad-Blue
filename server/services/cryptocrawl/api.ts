// API Routes for CryptoCrawl Dashboard
import { Router } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Request, Response, NextFunction } from 'express';
import { 
  authenticateWithPassword, 
  requireCryptoCrawlAuth,
  revokeSession,
  getSessionInfo
} from './auth/passwordAuth';

const dashboardApi = Router();
const adminApi = Router();

// ============================================
// AUTHENTICATION ROUTES (Public - No auth required)
// ============================================

// POST /api/crypto/auth - Authenticate with master password
// NO email required - just password (crptcrwlr)
dashboardApi.post('/auth', (req, res) => {
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
      token: result.token,
      expiresAt: result.expiresAt,
      message: 'Welcome to CryptoCrawl. Use token in Authorization header for protected routes.'
    });
  } else {
    res.status(401).json({
      success: false,
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
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({
      authenticated: false,
      message: 'Not authenticated. POST to /api/crypto/auth with password to login.'
    });
  }
  
  const token = authHeader.substring(7);
  const info = getSessionInfo(token);
  
  res.json({
    authenticated: info.valid,
    expiresIn: info.expiresIn,
    message: info.valid ? 'Session active' : 'Session expired or invalid'
  });
});

// Mock data store (replace with actual database in production)
let systemRunning = false;
let systemStartedAt: Date | null = null;

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
  }
};

const mockOpportunities: any[] = [];

const mockBalances = {
  chains: [
    { chain: 'ethereum', native: 0.5, tokens: [{ symbol: 'USDC', balance: 1000 }, { symbol: 'USDT', balance: 500 }] },
    { chain: 'polygon', native: 100, tokens: [{ symbol: 'USDC', balance: 250 }] },
    { chain: 'arbitrum', native: 0.25, tokens: [{ symbol: 'USDC', balance: 750 }] }
  ],
  totalValue: 2500
};

const mockTradeHistory: Array<{
  timestamp: number;
  asset: string;
  profit: number;
  success: boolean;
  txHash: string;
}> = [];

// WebSocket server
const wss = new WebSocketServer({ noServer: true });

// Broadcast to all connected clients
function broadcast(data: any) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// WebSocket connection handler
wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
  console.log('[CryptoCrawl] New WebSocket connection');
  
  // Send initial stats
  ws.send(JSON.stringify({
    type: 'stats',
    data: {
      totalProfit: mockStats.profit.today,
      totalTrades: mockStats.trades.total,
      successfulTrades: mockStats.trades.successful,
      successRate: parseFloat(mockStats.trades.successRate) / 100
    }
  }));
  
  ws.on('close', () => {
    console.log('[CryptoCrawl] WebSocket disconnected');
  });
  
  ws.on('error', (error) => {
    console.error('[CryptoCrawl] WebSocket error:', error);
  });
});

// API Routes

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
  const limit = parseInt(req.query.limit as string) || 50;
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
  
  // Mock withdrawal - in production, this would interact with actual wallets
  const mockTxHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
  
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

// Admin Routes (require authentication)

// GET /admin/crypto/status - Get system status
adminApi.get('/status', (req, res) => {
  const uptime = systemStartedAt ? Date.now() - systemStartedAt.getTime() : 0;
  
  res.json({
    running: systemRunning,
    cryptoCrawl: {
      enabled: systemRunning,
      gasOracle: systemRunning,
      balanceMonitor: systemRunning,
      networkHealth: systemRunning
    },
    startedAt: systemStartedAt ? systemStartedAt.toISOString() : null,
    uptime
  });
});

// GET /admin/crypto/health - Get system health
adminApi.get('/health', (req, res) => {
  const uptime = systemStartedAt ? Date.now() - systemStartedAt.getTime() : 0;
  
  res.json({
    status: systemRunning ? 'healthy' : 'stopped',
    uptime,
    cryptoCrawl: {
      enabled: systemRunning,
      gasOracle: systemRunning,
      balanceMonitor: systemRunning,
      networkHealth: systemRunning
    },
    checks: {
      database: { healthy: true, latency: Math.floor(Math.random() * 20) + 5 },
      rpcEndpoints: [
        { chain: 'ethereum', healthy: true, latency: Math.floor(Math.random() * 100) + 50 },
        { chain: 'polygon', healthy: true, latency: Math.floor(Math.random() * 80) + 30 },
        { chain: 'arbitrum', healthy: true, latency: Math.floor(Math.random() * 60) + 20 }
      ],
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
      eventLoop: Math.random() * 5
    }
  });
});

// POST /admin/crypto/start - Start the system
adminApi.post('/start', requireCryptoCrawlAuth, (req, res) => {
  if (!systemRunning) {
    systemRunning = true;
    systemStartedAt = new Date();
  } else {
    // Toggle off if already running
    systemRunning = false;
    systemStartedAt = null;
  }
  
  broadcast({
    type: 'update',
    data: {
      status: systemRunning ? 'running' : 'stopped',
      stats: {
        totalProfit: mockStats.profit.today,
        totalTrades: mockStats.trades.total,
        successfulTrades: mockStats.trades.successful,
        successRate: parseFloat(mockStats.trades.successRate) / 100
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
  
  broadcast({
    type: 'update',
    data: {
      status: 'stopped',
      stats: {
        totalProfit: mockStats.profit.today,
        totalTrades: mockStats.trades.total,
        successfulTrades: mockStats.trades.successful,
        successRate: parseFloat(mockStats.trades.successRate) / 100
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

// Mock data generator (for testing)
function generateMockData() {
  // Update stats randomly
  if (systemRunning) {
    const profit = Math.random() * 50;
    const success = Math.random() > 0.2;
    const assets = ['ETH/USDC', 'MATIC/USDT', 'ARB/ETH', 'WBTC/USDC', 'LINK/ETH'];
    const asset = assets[Math.floor(Math.random() * assets.length)];
    
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
    
    mockStats.trades.successRate = ((mockStats.trades.successful / mockStats.trades.total) * 100).toFixed(1);
    mockStats.performance.avgProfitPerTrade = (mockStats.profit.allTime / mockStats.trades.total).toFixed(2);
    mockStats.performance.lastUpdate = new Date().toISOString();
    
    if (profit > mockStats.performance.bestTrade.profit) {
      mockStats.performance.bestTrade = { profit, asset, timestamp: Date.now() };
    }
    
    // Add to trade history
    mockTradeHistory.unshift({
      timestamp: Date.now(),
      asset,
      profit: success ? profit : -profit * 0.1,
      success,
      txHash: `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`
    });
    
    // Keep only last 100 trades
    if (mockTradeHistory.length > 100) {
      mockTradeHistory.pop();
    }
    
    // Broadcast updated stats
    broadcast({
      type: 'stats',
      data: {
        totalProfit: mockStats.profit.today,
        totalTrades: mockStats.trades.total,
        successfulTrades: mockStats.trades.successful,
        successRate: parseFloat(mockStats.trades.successRate) / 100
      }
    });
  }
}

// Start mock data generator
setInterval(generateMockData, 10000);

export { dashboardApi, adminApi, wss };
