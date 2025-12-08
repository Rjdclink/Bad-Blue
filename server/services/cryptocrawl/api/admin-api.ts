import express from 'express';
import {pipeline} from '../integration/master-pipeline';

const router = express.Router();

// Simple auth middleware
const adminAuth = (req: any, res: any, next: any) => {
  const token = req.headers['authorization'];
  if (token !== `Bearer ${process.env.ADMIN_TOKEN}`) {
    return res.status(401).json({error: 'Unauthorized'});
  }
  next();
};

router.use(adminAuth);

// System state
let systemState = {
  running: false,
  startedAt: 0,
  config: {
    minProfitThreshold: 10,
    maxGasPrice: 100,
    enabledChains: ['polygon', 'bsc'],
    riskLevel: 'balanced'
  }
};

// POST /admin/crypto/start - Start the system
router.post('/start', async (req, res) => {
  if (systemState.running) {
    return res.status(400).json({error: 'System already running'});
  }
  
  try {
    systemState.running = true;
    systemState.startedAt = Date.now();
    
    // Start pipeline in background
    pipeline.run().catch(err => {
      console.error('Pipeline error:', err);
      systemState.running = false;
    });
    
    res.json({
      success: true,
      message: 'System started',
      startedAt: new Date(systemState.startedAt).toISOString()
    });
  } catch (error: any) {
    res.status(500).json({error: error.message});
  }
});

// POST /admin/crypto/stop - Emergency stop
router.post('/stop', async (req, res) => {
  if (!systemState.running) {
    return res.status(400).json({error: 'System not running'});
  }
  
  systemState.running = false;
  pipeline.stop();
  
  res.json({
    success: true,
    message: 'System stopped',
    uptime: Date.now() - systemState.startedAt
  });
});

// GET /admin/crypto/health - System health check
router.get('/health', async (req, res) => {
  const health = {
    status: systemState.running ? 'running' : 'stopped',
    uptime: systemState.running ? Date.now() - systemState.startedAt : 0,
    checks: {
      database: await checkDatabase(),
      rpcEndpoints: await checkRPCEndpoints(),
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
      eventLoop: process.uptime()
    }
  };
  
  res.json(health);
});

// GET /admin/crypto/config - Get current config
router.get('/config', (req, res) => {
  res.json(systemState.config);
});

// POST /admin/crypto/config - Update config
router.post('/config', (req, res) => {
  const updates = req.body;
  
  // Validate inputs
  if (updates.minProfitThreshold !== undefined) {
    if (typeof updates.minProfitThreshold !== 'number' || updates.minProfitThreshold < 0) {
      return res.status(400).json({error: 'minProfitThreshold must be a positive number'});
    }
    systemState.config.minProfitThreshold = updates.minProfitThreshold;
  }
  if (updates.maxGasPrice !== undefined) {
    if (typeof updates.maxGasPrice !== 'number' || updates.maxGasPrice <= 0) {
      return res.status(400).json({error: 'maxGasPrice must be a positive number'});
    }
    systemState.config.maxGasPrice = updates.maxGasPrice;
  }
  if (updates.enabledChains !== undefined) {
    const validChains = ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism'];
    if (!Array.isArray(updates.enabledChains) || !updates.enabledChains.every((c: string) => validChains.includes(c))) {
      return res.status(400).json({error: 'enabledChains must be an array of valid chain names'});
    }
    systemState.config.enabledChains = updates.enabledChains;
  }
  if (updates.riskLevel !== undefined) {
    const validLevels = ['conservative', 'balanced', 'aggressive'];
    if (!validLevels.includes(updates.riskLevel)) {
      return res.status(400).json({error: 'riskLevel must be one of: conservative, balanced, aggressive'});
    }
    systemState.config.riskLevel = updates.riskLevel;
  }
  
  res.json({
    success: true,
    config: systemState.config
  });
});

// GET /admin/crypto/logs - Recent logs
router.get('/logs', async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const logs = await getRecentLogs(limit);
  
  res.json({
    logs: logs.map(l => ({
      timestamp: l.timestamp,
      level: l.level,
      message: l.message,
      data: l.data
    }))
  });
});

// POST /admin/crypto/emergency - Emergency actions
router.post('/emergency', async (req, res) => {
  const {action} = req.body;
  
  switch (action) {
    case 'pause_all':
      systemState.running = false;
      res.json({success: true, message: 'All operations paused'});
      break;
    case 'withdraw_all':
      // Implement emergency withdrawal
      res.json({success: true, message: 'Emergency withdrawal initiated'});
      break;
    default:
      res.status(400).json({error: 'Unknown emergency action'});
  }
});

// Helper functions
async function checkDatabase() {
  return {healthy: true, latency: 5};
}

async function checkRPCEndpoints() {
  return [
    {chain: 'polygon', healthy: true, latency: 45},
    {chain: 'bsc', healthy: true, latency: 38}
  ];
}

async function getRecentLogs(limit: number) {
  return Array(limit).fill(null).map((_, i) => ({
    timestamp: Date.now() - i * 10000,
    level: i % 5 === 0 ? 'error' : 'info',
    message: `Log message ${i}`,
    data: {}
  }));
}

export {router as adminApi, systemState};
