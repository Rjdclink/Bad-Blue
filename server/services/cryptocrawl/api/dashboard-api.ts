import express from 'express';
import {WebSocketServer} from 'ws';
import {pipeline} from '../integration/master-pipeline';

const router = express.Router();
const wss = new WebSocketServer({noServer: true});

// In-memory stats (production: use Redis)
let stats = {
  totalProfit: 0,
  totalTrades: 0,
  successfulTrades: 0,
  failedTrades: 0,
  successRate: 0,
  lastUpdate: Date.now()
};

// GET /api/crypto/stats - Real-time statistics
router.get('/stats', async (req, res) => {
  const recentResults = await getRecentResults(24); // Last 24h
  
  const response = {
    profit: {
      today: recentResults.profit,
      thisWeek: await getProfitForPeriod(7),
      thisMonth: await getProfitForPeriod(30),
      allTime: stats.totalProfit
    },
    trades: {
      total: stats.totalTrades,
      successful: stats.successfulTrades,
      failed: stats.failedTrades,
      successRate: (stats.successRate * 100).toFixed(1) + '%'
    },
    performance: {
      avgProfitPerTrade: stats.successfulTrades > 0 ? (stats.totalProfit / stats.successfulTrades).toFixed(2) : '0',
      bestTrade: await getBestTrade(),
      lastUpdate: new Date(stats.lastUpdate).toISOString()
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
      successProbability: Math.random() * 0.3 + 0.7,
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
  
  try {
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

async function getWalletBalances() {
  return [
    {chain: 'polygon', native: 125.5, tokens: [{symbol: 'USDC', balance: 15420}], totalValue: 15545.5},
    {chain: 'bsc', native: 0.8, tokens: [{symbol: 'BUSD', balance: 8900}], totalValue: 9140}
  ];
}

async function executeWithdrawal(amount: number, token: string, to: string) {
  return '0x' + Math.random().toString(16).slice(2, 66);
}

async function getTradeHistory(limit: number) {
  return Array(limit).fill(null).map((_, i) => ({
    timestamp: Date.now() - i * 60000,
    asset: 'USDC/USDT',
    profit: Math.random() * 100,
    success: Math.random() > 0.2,
    txHash: '0x' + Math.random().toString(16).slice(2, 66)
  }));
}

export {router as dashboardApi, wss};
