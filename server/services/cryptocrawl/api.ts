// API Routes for CryptoCrawl Dashboard
import { Router } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';

const dashboardApi = Router();
const adminApi = Router();

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

// Admin Routes (require authentication in production)

// POST /admin/crypto/start - Start the system
adminApi.post('/start', (req, res) => {
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
adminApi.post('/stop', (req, res) => {
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
