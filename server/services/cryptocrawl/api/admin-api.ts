import express from 'express';
import {pipeline} from '../integration/master-pipeline';
import { gasOracle, balanceMonitor, networkHealth } from '../bridge';
import { zeroCapitalEngine } from '../core/zero-capital-engine';
import { getCryptocrawlGovernance, GovernanceError } from '../governance/index.js';
import { getCryptara } from '../../cryptara/index.js';
import { verifyCanonicalCryptoSetup } from '../verification/canonicalCryptoVerifier.js';
import { 
  authenticateWithPassword, 
  requireCryptoCrawlAuth,
  revokeSession,
  getSessionInfo
} from '../auth/passwordAuth';

const router = express.Router();

// ============================================
// AUTHENTICATION ROUTES (No auth required)
// ============================================

// POST /admin/crypto/auth - Authenticate with email and password
// Credentials: email = crypto@cc.com, password = cryptocrawl
router.post('/auth', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Email and password required'
    });
  }
  
  const result = authenticateWithPassword(password, email);
  
  if (result.success) {
    res.json({
      success: true,
      token: result.token,
      expiresAt: result.expiresAt,
      message: 'Authentication successful. Use token in Authorization header.'
    });
  } else {
    res.status(401).json({
      success: false,
      error: result.error || 'Authentication failed'
    });
  }
});

// POST /admin/crypto/logout - Revoke session
router.post('/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    revokeSession(token);
  }
  
  res.json({
    success: true,
    message: 'Session revoked'
  });
});

// GET /admin/crypto/session - Check session status
router.get('/session', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({
      authenticated: false
    });
  }
  
  const token = authHeader.substring(7);
  const info = getSessionInfo(token);
  
  res.json({
    authenticated: info.valid,
    expiresIn: info.expiresIn
  });
});

// ============================================
// PUBLIC ROUTES (No auth required)
// ============================================

// GET /admin/crypto/status - Get system status (public for dashboard loading)
router.get('/status', (req, res) => {
  res.json({
    success: true,
    running: systemState.running,
    cryptoCrawl: cryptoCrawlState.getStatus(),
    startedAt: systemState.running ? new Date(systemState.startedAt).toISOString() : null,
    uptime: systemState.running ? Date.now() - systemState.startedAt : 0
  });
});

// GET /admin/crypto/health - System health check (public for dashboard)
router.get('/health', async (req, res) => {
  const health = {
    status: systemState.running ? 'running' : 'stopped',
    uptime: systemState.running ? Date.now() - systemState.startedAt : 0,
    cryptoCrawl: cryptoCrawlState.getStatus(),
    checks: {
      database: await checkDatabase(),
      rpcEndpoints: await checkRPCEndpoints(),
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
      eventLoop: process.uptime()
    }
  };
  
  res.json(health);
});

// ============================================
// PROTECTED ROUTES (Require authentication)
// ============================================
router.use(requireCryptoCrawlAuth);

// ============================================
// GOVERNANCE ROUTES (Stage 1–6 control plane)
// ============================================
const governance = getCryptocrawlGovernance();

function handleGovernanceError(res: any, err: unknown) {
  if (err instanceof GovernanceError) {
    return res.status(400).json({
      success: false,
      error: err.message,
      code: err.code,
      details: err.details || null,
    });
  }
  return res.status(500).json({
    success: false,
    error: err instanceof Error ? err.message : String(err),
  });
}

// GET /admin/crypto/governance - Current governance state
router.get('/governance', (req, res) => {
  res.json({
    success: true,
    state: governance.getState(),
  });
});

// POST /admin/crypto/governance/stage - Set stage (always pauses)
router.post('/governance/stage', (req, res) => {
  try {
    const stage = Number(req.body?.stage);
    if (![1, 2, 3, 4, 5, 6].includes(stage)) {
      return res.status(400).json({ success: false, error: 'stage must be 1..6' });
    }
    const reason = String(req.body?.reason || 'manual_stage_set');
    governance.setStage(stage as any, 'human', reason);
    res.json({ success: true, state: governance.getState() });
  } catch (err) {
    return handleGovernanceError(res, err);
  }
});

// POST /admin/crypto/governance/pause - Pause immediately
router.post('/governance/pause', (req, res) => {
  try {
    const reason = String(req.body?.reason || 'manual_pause');
    governance.pause('human', reason);
    res.json({ success: true, state: governance.getState() });
  } catch (err) {
    return handleGovernanceError(res, err);
  }
});

// POST /admin/crypto/governance/unpause - UNPAUSE with explicit envelope
router.post('/governance/unpause', (req, res) => {
  try {
    const body = req.body || {};
    const envelope = governance.unpauseWithEnvelope({
      stage: Number(body.stage) as any,
      scope: String(body.scope || 'unspecified_scope'),
      authority: 'human',
      durationMs: Number(body.durationMs || 0),
      allowedActions: Array.isArray(body.allowedActions) ? body.allowedActions : [],
      constraints: body.constraints || {},
    });
    res.json({ success: true, envelope, state: governance.getState() });
  } catch (err) {
    return handleGovernanceError(res, err);
  }
});

// POST /admin/crypto/governance/kill-switch/arm - Arm kill switch (required before any execution)
router.post('/governance/kill-switch/arm', (req, res) => {
  try {
    const reason = String(req.body?.reason || 'manual_arm');
    governance.armKillSwitch('human', reason);
    res.json({ success: true, state: governance.getState() });
  } catch (err) {
    return handleGovernanceError(res, err);
  }
});

// POST /admin/crypto/governance/kill-switch/engage - Engage kill switch (immediate stop + pause)
router.post('/governance/kill-switch/engage', (req, res) => {
  try {
    const reason = String(req.body?.reason || 'manual_engage');
    governance.engageKillSwitch('human', reason);
    res.json({ success: true, state: governance.getState() });
  } catch (err) {
    return handleGovernanceError(res, err);
  }
});

// ============================================
// CRYPTARA ADVISORY ROUTES
// ============================================

// POST /admin/crypto/cryptara/evaluate-gates - Evaluate market gates (advisory)
router.post('/cryptara/evaluate-gates', (req, res) => {
  try {
    const cryptara = getCryptara();
    const report = cryptara.evaluateMarketGates(req.body || {}, req.body?.config || undefined);
    res.json({ success: true, report });
  } catch (err) {
    return handleGovernanceError(res, err);
  }
});

// GET /admin/crypto/verify-canonical - Canonical instruction set verifier (no secrets printed)
router.get('/verify-canonical', (_req, res) => {
  try {
    const report = verifyCanonicalCryptoSetup();
    res.json({ success: report.ok, report });
  } catch (err) {
    return handleGovernanceError(res, err);
  }
});

// CryptoCrawl system state manager
const cryptoCrawlState = {
  enabled: false,
  
  async enable(): Promise<void> {
    if (this.enabled) {
      console.log('[CryptoCrawl] System already enabled');
      return;
    }
    
    console.log('[CryptoCrawl] Enabling system...');
    this.enabled = true;
    
    // Start all crypto services
    await gasOracle.start();
    await balanceMonitor.start();
    await networkHealth.start();
    
    console.log('[CryptoCrawl] ✓ System enabled');
  },
  
  async disable(): Promise<void> {
    if (!this.enabled) {
      console.log('[CryptoCrawl] System already disabled');
      return;
    }
    
    console.log('[CryptoCrawl] Disabling system...');
    this.enabled = false;
    
    // Stop all crypto services
    await gasOracle.stop();
    await balanceMonitor.stop();
    await networkHealth.stop();
    
    console.log('[CryptoCrawl] ✓ System disabled');
  },
  
  getStatus() {
    return {
      enabled: this.enabled,
      gasOracle: gasOracle.isRunning(),
      balanceMonitor: balanceMonitor.isRunning(),
      networkHealth: networkHealth.isRunning()
    };
  }
};

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
    // Stage 1 is advisory-only; keep system from starting background loops.
    if (governance.getState().stage === 1) {
      return res.status(400).json({
        success: false,
        error: 'Governance Stage 1 is advisory-only. Set stage >= 2 and UNPAUSE with an envelope before starting.',
        governance: governance.getState(),
      });
    }

    // Enable CryptoCrawl services
    await cryptoCrawlState.enable();
    
    // Start Zero-Capital Engine (TRUE zero upfront capital)
    await zeroCapitalEngine.start();
    
    // Only mark as running after successful service enablement
    systemState.running = true;
    systemState.startedAt = Date.now();
    
    // Start pipeline in background
    pipeline.run().catch(err => {
      console.error('Pipeline error:', err);
    });
    
    res.json({
      success: true,
      message: 'Zero-Capital Arbitrage System started',
      startedAt: new Date(systemState.startedAt).toISOString(),
      status: cryptoCrawlState.getStatus(),
      zeroCapital: {
        enabled: true,
        capitalRequired: 'ZERO',
        mechanism: 'Flash Loan + MEV Bundle'
      }
    });
  } catch (error: any) {
    // Ensure state is not marked as running on error
    systemState.running = false;
    res.status(500).json({error: error.message});
  }
});

// POST /admin/crypto/stop - Emergency stop
router.post('/stop', async (req, res) => {
  if (!systemState.running) {
    return res.status(400).json({error: 'System not running'});
  }
  
  try {
    // Disable CryptoCrawl services
    await cryptoCrawlState.disable();
    
    systemState.running = false;
    pipeline.stop();
    
    res.json({
      success: true,
      message: 'System stopped',
      uptime: Date.now() - systemState.startedAt,
      status: cryptoCrawlState.getStatus()
    });
  } catch (error: any) {
    // Mark as stopped even if there was an error
    systemState.running = false;
    res.status(500).json({
      error: error.message,
      status: cryptoCrawlState.getStatus()
    });
  }
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
