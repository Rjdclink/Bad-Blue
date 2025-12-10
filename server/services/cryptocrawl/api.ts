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
const mockStats = {
  profit: {
    today: 0,
    total: 0
  },
  trades: {
    total: 0,
    successful: 0,
    failed: 0,
    successRate: '0'
  }
};

const mockOpportunities: any[] = [];

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
    opportunities: mockOpportunities.slice(0, 10)
  });
});

// Admin Routes (require authentication)

// POST /admin/crypto/start - Start the system
adminApi.post('/start', requireCryptoCrawlAuth, (req, res) => {
  systemRunning = !systemRunning;
  
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
  systemRunning = false;
  
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
    status: 'stopped'
  });
});

// Mock data generator (for testing)
function generateMockData() {
  // Update stats randomly
  if (systemRunning) {
    mockStats.profit.today += Math.random() * 50;
    mockStats.trades.total++;
    
    if (Math.random() > 0.2) {
      mockStats.trades.successful++;
    } else {
      mockStats.trades.failed++;
    }
    
    mockStats.trades.successRate = ((mockStats.trades.successful / mockStats.trades.total) * 100).toFixed(1);
    
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
