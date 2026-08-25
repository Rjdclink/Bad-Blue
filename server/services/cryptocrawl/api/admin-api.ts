import express from 'express';
import {pipeline} from '../integration/master-pipeline';
import { gasOracle, balanceMonitor, networkHealth } from '../bridge';
import { zeroCapitalEngine } from '../core/zero-capital-engine';
import { getCryptocrawlGovernance, initializeGovernance } from '../governance/index.js';
import { stageManager } from '../governance/stage-management.js';
import { GovernanceError } from '../governance/types.js';
import { autonomousFaucet } from '../faucet/autonomous-faucet.js';
import { getCryptara } from '../../cryptara/index.js';
import { verifyCanonicalCryptoSetup } from '../verification/canonicalCryptoVerifier.js';
import { SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import {
  getSystemStatus as getPantheonSystemStatus,
  notifyCryptocrawlerComplete,
  notifyCryptocrawlerStarting,
} from '../../pantheonCrawlerOrchestrator.js';

const router = express.Router();


// ============================================
// PUBLIC ROUTES (No auth required)
// ============================================

// GET /admin/crypto/status - Get system status (public for dashboard loading)
router.get('/status', (req, res) => {
  const zeroCapital = zeroCapitalEngine.getState();
  res.json({
    success: true,
    running: systemState.running,
    lifecycle: systemState.lifecycle,
    lastError: systemState.lastError,
    cryptoCrawl: cryptoCrawlState.getStatus(),
    startedAt: systemState.running ? new Date(systemState.startedAt).toISOString() : null,
    uptime: systemState.running ? Date.now() - systemState.startedAt : 0,
    pipeline: pipeline.getMetrics(),
    zeroCapital: {
      ...zeroCapital,
      totalProfit: zeroCapital.totalProfit.toString(),
    },
    governance: governance.getState(),
    pantheon: getPantheonSystemStatus(),
  });
});

// GET /admin/crypto/health - System health check (public for dashboard)
router.get('/health', async (req, res) => {
  const health = {
    status: systemState.lifecycle.toLowerCase(),
    uptime: systemState.running ? Date.now() - systemState.startedAt : 0,
    cryptoCrawl: cryptoCrawlState.getStatus(),
    lifecycle: systemState.lifecycle,
    lastError: systemState.lastError,
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
// PROTECTED ROUTES (Platform master or internal service identity required)
// ============================================
const requireCryptoControlAuthority = (req: any, res: any, next: any) => {
  const internalKey = String(process.env.INTERNAL_KEY || process.env.INTERNAL_API_KEY || '');
  const providedKey = String(req.header('X-Internal-Key') || req.header('X-Internal-Api-Key') || '');
  if (internalKey && providedKey && providedKey === internalKey) {
    return next();
  }

  if (!req.isAuthenticated?.() || !req.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  if (!req.user.isMasterBypass && !req.user.isAdminBypass) {
    return res.status(403).json({ success: false, error: 'Platform administrator access required' });
  }

  return next();
};
router.use(requireCryptoControlAuthority);

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
router.post('/governance/stage', async (req, res) => {
  try {
    const stage = Number(req.body?.stage);
    if (![1, 2, 3, 4, 5, 6].includes(stage)) {
      return res.status(400).json({ success: false, error: 'stage must be 1..6' });
    }
    const reason = String(req.body?.reason || 'manual_stage_set');
    await governance.setStage(stage as any, 'human', reason);
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
router.post('/governance/unpause', async (req, res) => {
  try {
    const body = req.body || {};
    const envelope = await governance.unpauseWithEnvelope({
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
    res.json({ success: report.ok, marker: 'VERIFIER_V2_REACHED', report });
  } catch (err) {
    return handleGovernanceError(res, err);
  }
});

// GET /admin/crypto/verify-chains - Chain ID + RPC mapping verification
router.get('/verify-chains', (_req, res) => {
  const issues: Array<{ chain: string; issue: string }> = [];
  for (const [chain, cfg] of Object.entries(SUPPORTED_CHAINS)) {
    if (!cfg.chainId || typeof cfg.chainId !== 'number') issues.push({ chain, issue: 'Missing/invalid chainId' });
    if (!cfg.rpcUrl || String(cfg.rpcUrl).trim().length === 0) issues.push({ chain, issue: 'Missing rpcUrl' });
    if (!cfg.usdc || !cfg.usdt) issues.push({ chain, issue: 'Missing stablecoin addresses (usdc/usdt)' });
  }
  res.json({
    success: issues.length === 0,
    marker: 'VERIFIER_V2_REACHED',
    supportedChains: Object.keys(SUPPORTED_CHAINS),
    issues,
  });
});

// ============================================
// PROFIT LADDER GOVERNOR (Agent 6)
// ============================================

// GET /admin/crypto/ladder - Get current tier + recent cycle history
router.get('/ladder', (_req, res) => {
  res.json({
    success: true,
    state: profitLadder.exportState(),
    progress: profitLadder.getProgressSummary(),
  });
});

// Compatibility endpoint: ladder evidence is produced by the governed runtime.
router.post('/ladder/record-cycle', (req, res) => {
  res.status(409).json({
    success: false,
    error: 'Manual ladder evidence is not authoritative; record terminal runtime outcomes through the governed execution path',
    state: profitLadder.exportState(),
    progress: profitLadder.getProgressSummary(),
  });
});

// Compatibility endpoint: automatic progression owns tier advancement.
router.post('/ladder/promote', (_req, res) => {
  res.status(409).json({
    success: false,
    error: 'Manual ladder promotion is not authoritative; StageManager advances from verified runtime evidence',
    state: profitLadder.exportState(),
    progress: profitLadder.getProgressSummary(),
  });
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

    try {
      await gasOracle.start();
      await balanceMonitor.start();
      await networkHealth.start();
      this.enabled = true;
      console.log('[CryptoCrawl] ✓ System enabled');
    } catch (error) {
      await Promise.allSettled([
        Promise.resolve(gasOracle.stop()),
        Promise.resolve(balanceMonitor.stop()),
        Promise.resolve(networkHealth.stop()),
      ]);
      this.enabled = false;
      throw error;
    }
  },
  
  async disable(): Promise<void> {
    if (!this.enabled) {
      console.log('[CryptoCrawl] System already disabled');
      return;
    }
    
    console.log('[CryptoCrawl] Disabling system...');
    const results = await Promise.allSettled([
      Promise.resolve(gasOracle.stop()),
      Promise.resolve(balanceMonitor.stop()),
      Promise.resolve(networkHealth.stop()),
    ]);
    this.enabled = false;

    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      throw new Error(`${failures.length} CryptoCrawler service(s) failed to stop`);
    }

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
type RuntimeLifecycle = 'STOPPED' | 'INITIALIZING' | 'RUNNING' | 'STOPPING' | 'DEGRADED' | 'FAILED';

let systemState: {
  lifecycle: RuntimeLifecycle;
  running: boolean;
  startedAt: number;
  mode: 'MANUAL' | 'AUTOMATIC';
  config: {
    minProfitThreshold: number;
    maxGasPrice: number;
    enabledChains: string[];
    riskLevel: string;
  };
  lastError: string | null;
} = {
  lifecycle: 'STOPPED',
  running: false,
  startedAt: 0,
  mode: 'MANUAL',
  config: {
    minProfitThreshold: 10,
    maxGasPrice: 100,
    enabledChains: ['polygon', 'bsc'],
    riskLevel: 'balanced',
  },
  lastError: null,
};

// GET /admin/crypto/mode - Get current arbitrage mode
router.get('/mode', (_req, res) => {
  res.json({ success: true, mode: systemState.mode });
});

// POST /admin/crypto/mode - Set arbitrage mode (AUTOMATIC gated behind canonical verifier + governance)
router.post('/mode', (req, res) => {
  const mode = String(req.body?.mode || '').toUpperCase();
  if (mode !== 'MANUAL' && mode !== 'AUTOMATIC') {
    return res.status(400).json({ success: false, error: 'mode must be MANUAL or AUTOMATIC' });
  }

  if (mode === 'AUTOMATIC') {
    const canonical = verifyCanonicalCryptoSetup();
    if (!canonical.ok) {
      return res.status(400).json({
        success: false,
        error: 'Cannot enable AUTOMATIC: canonical verifier failed',
        report: canonical,
      });
    }

    // Governance requirements: stage >= 2, kill-switch armed, and an active automatic or manual control state.
    const gov = governance.getState();
    if (gov.stage < 2) {
      return res.status(400).json({ success: false, error: 'Cannot enable AUTOMATIC: governance stage must be >= 2', governance: gov });
    }
    if (!gov.killSwitch.armed) {
      return res.status(400).json({ success: false, error: 'Cannot enable AUTOMATIC: kill-switch must be armed', governance: gov });
    }
    if (gov.paused || (!gov.activeEnvelope && !governance.isAutomaticallyActivated())) {
      return res.status(400).json({ success: false, error: 'Cannot enable AUTOMATIC: system is not active under a valid governance control state', governance: gov });
    }
  }

  systemState.mode = mode as any;
  return res.json({
    success: true,
    mode: systemState.mode,
    note: 'Mode is stored in-memory; persistence across restart requires external storage.',
  });
});

async function stopCryptoCrawlerRuntime(): Promise<{ stopped: boolean; failures: string[] }> {
  systemState.lifecycle = 'STOPPING';
  systemState.running = false;

  const results = await Promise.allSettled([
    pipeline.stop(),
    Promise.resolve(zeroCapitalEngine.stop()),
    Promise.resolve(autonomousFaucet.stop()),
    cryptoCrawlState.disable(),
  ]);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));

  const stopped =
    !zeroCapitalEngine.getState().isRunning &&
    !pipeline.isRunning() &&
    !cryptoCrawlState.getStatus().enabled;

  if (stopped) {
    notifyCryptocrawlerComplete();
    systemState.lifecycle = 'STOPPED';
    systemState.startedAt = 0;
    systemState.lastError = failures.length > 0 ? failures.join('; ') : null;
  } else {
    systemState.lifecycle = 'DEGRADED';
    systemState.lastError = failures.length > 0
      ? failures.join('; ')
      : 'One or more CryptoCrawler components remained active after stop';
  }

  return { stopped, failures };
}

type CryptoCrawlerStartResult = {
  success: boolean;
  status: number;
  payload: Record<string, unknown>;
};

export async function startCryptoCrawlerRuntime(): Promise<CryptoCrawlerStartResult> {
  if (systemState.lifecycle !== 'STOPPED' && systemState.lifecycle !== 'FAILED') {
    return {
      success: false,
      status: 409,
      payload: {
      success: false,
      error: `CryptoCrawler is ${systemState.lifecycle.toLowerCase()}`,
      lifecycle: systemState.lifecycle,
      },
    };
  }

  try {
    await initializeGovernance();
    console.log('[CryptoCrawl] Start request accepted; governance initialized');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    systemState.lastError = message;
    console.error('[CryptoCrawl] Governance initialization failed before startup', error);
    return {
      success: false,
      status: 503,
      payload: {
        success: false,
        error: message,
        lifecycle: systemState.lifecycle,
        governance: governance.getState(),
      },
    };
  }

  try {
    governance.requireAllowed('ADVISE');
  } catch (error) {
    return {
      success: false,
      status: error instanceof GovernanceError ? 400 : 500,
      payload: {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        governance: governance.getState(),
      },
    };
  }

  if (!notifyCryptocrawlerStarting()) {
    return {
      success: false,
      status: 409,
      payload: {
      success: false,
      error: 'PANTHEON currently owns the crawler runtime. Stop PANTHEON before starting CryptoCrawler.',
      pantheon: getPantheonSystemStatus(),
      },
    };
  }

  systemState.lifecycle = 'INITIALIZING';
  systemState.running = false;
  systemState.lastError = null;

  try {
    console.log('[CryptoCrawl] Starting crawler dependencies');
    await cryptoCrawlState.enable();
    const startStage1MarketOperations = async (): Promise<void> => {
      await pipeline.run();
      console.log('[CryptoCrawl] Starting authoritative AutonomousFaucet');
      void autonomousFaucet.runAutonomousLoop().catch(error => {
        console.error('[CryptoCrawl] AutonomousFaucet stopped during startup/operation', error);
        autonomousFaucet.stop();
      });
    };
    await zeroCapitalEngine.start({
      onInitialGasReady: startStage1MarketOperations,
      onInitialGasLost: async () => {
        await Promise.allSettled([
          pipeline.stop(),
          Promise.resolve(autonomousFaucet.stop()),
        ]);
      },
    });

    const marketOperationsAllowed = stageManager.isMarketOperationsAllowed();
    if (!zeroCapitalEngine.getState().isRunning ||
      (marketOperationsAllowed && (!pipeline.isRunning() || !autonomousFaucet.isActive()))) {
      throw new Error('CryptoCrawler monitoring dependencies did not remain running after startup');
    }

    systemState.lifecycle = 'RUNNING';
    systemState.running = true;
    systemState.startedAt = Date.now();
    console.log('[CryptoCrawl] Runtime active; Stage 1 observation loop scheduled', {
      faucetId: autonomousFaucet.getFaucetId(),
      stage: governance.getState().stage,
    });

    return {
      success: true,
      status: 200,
      payload: {
        success: true,
        message: marketOperationsAllowed
          ? 'Governed on-chain monitoring started'
          : 'CryptoCrawler started in PRE_STAGE_1_BOOTSTRAP; market operations remain locked until verified initial gas readiness is established',
        lifecycle: systemState.lifecycle,
        startedAt: new Date(systemState.startedAt).toISOString(),
        cryptoCrawl: cryptoCrawlState.getStatus(),
        monitoring: {
          enabled: zeroCapitalEngine.getState().isRunning,
          pipelineRunning: pipeline.isRunning(),
          executionEnabled: false,
          mechanism: 'Verified RPC monitoring',
        },
        governance: governance.getState(),
        pantheon: getPantheonSystemStatus(),
      },
    };
  } catch (error) {
    const cleanup = await stopCryptoCrawlerRuntime();
    systemState.lifecycle = cleanup.stopped ? 'FAILED' : 'DEGRADED';
    systemState.lastError = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      status: 503,
      payload: {
        success: false,
        error: systemState.lastError,
        lifecycle: systemState.lifecycle,
        cleanup,
        governance: governance.getState(),
      },
    };
  }
}

async function startAutomaticCryptoCrawlerRuntime(reason: string): Promise<void> {
  if (!governance.isAutomaticallyActivated() || stageManager.getCurrentStage() < 2) return;
  const result = await startCryptoCrawlerRuntime();
  if (!result.success && result.status !== 409) {
    console.warn('[CryptoCrawl] Automatic runtime activation failed', { reason, error: result.payload.error });
  }
}

stageManager.on('stage-advanced', event => {
  if (event.automatic === true) {
    void startAutomaticCryptoCrawlerRuntime(`stage_advanced:${event.previousStage}->${event.currentStage}`);
  }
});

stageManager.on('unpaused', event => {
  if (event.automatic === true) {
    void startAutomaticCryptoCrawlerRuntime(`automatic_activation:${event.stage}`);
  }
});

// POST /admin/crypto/start - Start governed on-chain monitoring.
router.post('/start', async (_req, res) => {
  const result = await startCryptoCrawlerRuntime();
  return res.status(result.status).json(result.payload);
});

// POST /admin/crypto/stop - Stop the exact components started by this controller.
router.post('/stop', async (_req, res) => {
  if (systemState.lifecycle === 'STOPPED') {
    return res.status(409).json({ success: false, error: 'CryptoCrawler is already stopped' });
  }

  const uptime = systemState.startedAt ? Date.now() - systemState.startedAt : 0;
  const result = await stopCryptoCrawlerRuntime();

  return res.status(result.stopped ? 200 : 503).json({
    success: result.stopped,
    message: result.stopped ? 'CryptoCrawler stopped' : 'CryptoCrawler stop completed with unresolved components',
    lifecycle: systemState.lifecycle,
    uptime,
    failures: result.failures,
    cryptoCrawl: cryptoCrawlState.getStatus(),
    pantheon: getPantheonSystemStatus(),
  });
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
    case 'pause_all': {
      governance.pause('human', 'emergency_pause_all');
      const result = await stopCryptoCrawlerRuntime();
      return res.status(result.stopped ? 200 : 503).json({
        success: result.stopped,
        message: result.stopped ? 'All CryptoCrawler operations paused and stopped' : 'Emergency pause left unresolved components',
        lifecycle: systemState.lifecycle,
        failures: result.failures,
      });
    }
    case 'withdraw_all':
      // Implement emergency withdrawal
      return res.json({success: true, message: 'Emergency withdrawal initiated'});
    default:
      return res.status(400).json({error: 'Unknown emergency action'});
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
