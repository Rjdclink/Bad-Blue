import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { sql } from 'drizzle-orm';
import { db } from '../../../db.js';
import { multiProviderRpcManager, type SupportedChain } from '../api/blockchain-providers.js';
import { getVenueCapabilities } from '../discovery/venue-capability-registry.js';
import { loadDynamicChainRegistry } from '../core/dynamic-chain-registry.js';
import { stageManager } from '../governance/stage-management.js';
import { marketDataProviders } from '../intelligence/market-data-providers.js';
import { getCryptoCrawlerRuntimeAttestation, isRuntimeIdentitySafe } from '../runtime/runtime-attestation.js';

const router = express.Router();

const RPC_CHAINS: SupportedChain[] = [
  'ethereum',
  'polygon',
  'arbitrum',
  'optimism',
  'base',
  'avalanche',
  'bsc',
];

const CRYPTO_LOG_COMPONENTS = new Set([
  'AlchemyArbitrageDetector',
  'AlchemyIntegration',
  'AlchemyPendingTx',
  'AlchemyTokenAPI',
  'AutomaticStageProgression',
  'CanonicalExecutionScheduler',
  'CexFeeResolver',
  'CexPrivateAuthority',
  'ConcurrentExecutionWiring',
  'CryptoCoreRuntime',
  'CryptoRuntimeObservability',
  'DynamicChainRegistry',
  'ExecutionScheduler',
  'MeasuredOpportunityGraph',
  'OpportunityGraph',
  'TelemetryBootstrap',
  'ZeroCapitalEngine',
]);

function safeBooleanEnvironment(name: string): boolean {
  return process.env[name] === 'true';
}

async function databaseEvidence(): Promise<{ ready: boolean; detail: string }> {
  try {
    await db.execute(sql`SELECT 1`);
    return { ready: true, detail: 'SELECT 1 succeeded' };
  } catch (error) {
    return {
      ready: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function rpcEvidence() {
  return RPC_CHAINS.map(chain => {
    const providers = multiProviderRpcManager.getHealth(chain).map(observation => ({
      provider: observation.provider,
      state: observation.http.state,
      healthy: observation.http.success,
      latencyMs: observation.http.latencyMs,
      observedAt: observation.http.observedAt,
      lastError: observation.http.lastError || null,
    }));
    return {
      chain,
      requiredForCoreCexDiscovery: false,
      healthy: providers.some(provider => provider.healthy),
      providers,
    };
  });
}

async function canonicalCoreEvidence(): Promise<{
  discovery: {
    available: boolean;
    lastCompletedAt: number | null;
    evaluatedSymbols: number;
    deterministicPositive: number;
    eligibleCandidates: number;
  };
  scheduler: ReturnType<(typeof import('../execution/canonical-execution-scheduler.js'))['canonicalExecutionScheduler']['getStats']>;
}> {
  const [discoveryModule, schedulerModule] = await Promise.all([
    import('../discovery/opportunity-graph.js'),
    import('../execution/canonical-execution-scheduler.js'),
  ]);
  const latest = discoveryModule.measuredOpportunityGraph.getLatestCycle();
  return {
    discovery: {
      available: latest !== null,
      lastCompletedAt: latest?.completedAt ?? null,
      evaluatedSymbols: latest?.evaluatedSymbols ?? 0,
      deterministicPositive: latest?.deterministicPositive ?? 0,
      eligibleCandidates: latest?.eligibleCandidates ?? 0,
    },
    scheduler: schedulerModule.canonicalExecutionScheduler.getStats(),
  };
}

interface RealLogRow {
  timestamp: string | number | null;
  level: string;
  message: string;
  component: string | null;
  data: Record<string, unknown>;
}

function isCryptoCrawlerLog(row: Record<string, unknown>): boolean {
  const component = typeof row.component === 'string' ? row.component : '';
  if (CRYPTO_LOG_COMPONENTS.has(component)) return true;
  const message = typeof row.message === 'string' ? row.message : '';
  return /cryptocrawl|cryptara|\bCEX\b|opportunitygraph|execution scheduler|zerocapital|dynamic.?scale|stage.?manager|alchemy/i.test(message);
}

async function readRecentCryptoLogs(limit: number): Promise<{
  available: boolean;
  source: string;
  reason: string | null;
  logs: RealLogRow[];
}> {
  const logPath = path.resolve(process.cwd(), 'logs', 'combined.log');
  const maxBytes = 2 * 1024 * 1024;
  try {
    const stat = await fs.stat(logPath);
    const bytesToRead = Math.min(stat.size, maxBytes);
    const start = Math.max(0, stat.size - bytesToRead);
    const handle = await fs.open(logPath, 'r');
    let buffer: Buffer;
    try {
      buffer = Buffer.alloc(bytesToRead);
      await handle.read(buffer, 0, bytesToRead, start);
    } finally {
      await handle.close();
    }

    const lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
    if (start > 0 && lines.length > 0) lines.shift();
    const logs: RealLogRow[] = [];
    for (let index = lines.length - 1; index >= 0 && logs.length < limit; index--) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(lines[index]) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!isCryptoCrawlerLog(parsed)) continue;
      const { timestamp, level, message, component, service: _service, pid: _pid, ...data } = parsed;
      logs.push({
        timestamp: typeof timestamp === 'string' || typeof timestamp === 'number' ? timestamp : null,
        level: typeof level === 'string' ? level : 'unknown',
        message: typeof message === 'string' ? message : '',
        component: typeof component === 'string' ? component : null,
        data,
      });
    }
    return {
      available: true,
      source: 'logs/combined.log',
      reason: null,
      logs,
    };
  } catch (error) {
    return {
      available: false,
      source: 'logs/combined.log',
      reason: error instanceof Error ? error.message : String(error),
      logs: [],
    };
  }
}

// Truthful replacement for the legacy decorative health surface.
router.get('/health', async (_req, res) => {
  try {
    const [database, core] = await Promise.all([
      databaseEvidence(),
      canonicalCoreEvidence(),
    ]);
    const runtime = getCryptoCrawlerRuntimeAttestation();
    const rpc = rpcEvidence();
    const identitySafe = isRuntimeIdentitySafe(runtime);
    const coreOperational = core.scheduler.running && core.discovery.available;
    const status = !identitySafe
      ? 'unhealthy'
      : database.ready && coreOperational
        ? 'healthy'
        : 'degraded';

    return res.json({
      success: status !== 'unhealthy',
      status,
      observedAt: Date.now(),
      runtime,
      checks: {
        database,
        cexCore: {
          ready: coreOperational,
          requiredForCoreCexDiscovery: true,
          discovery: core.discovery,
          scheduler: core.scheduler,
        },
        rpc: {
          requiredForCoreCexDiscovery: false,
          chains: rpc,
        },
      },
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      status: 'unhealthy',
      observedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Canonical, non-secret configuration posture. No hard-coded trading thresholds.
router.get('/config', (_req, res) => {
  const dynamicChains = loadDynamicChainRegistry().map(chain => ({
    id: chain.id,
    family: chain.family,
    nativeAsset: chain.nativeAsset,
    sponsoredBootstrap: chain.sponsoredBootstrap,
    executionMode: chain.executionMode,
  }));
  return res.json({
    success: true,
    authority: 'canonical_runtime_sources',
    mutableHere: false,
    executionPosture: {
      noExecutionGuardEnabled: safeBooleanEnvironment('NO_EXECUTION'),
      liveExecutionEnabled: safeBooleanEnvironment('CRYPTO_ARBITRAGE_LIVE_EXECUTION'),
      liveExecutionConfirmed: process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK',
      zeroCapitalExecutionEnabled: safeBooleanEnvironment('ZERO_CAPITAL_ENABLE_EXECUTION'),
      krakenConfigured: Boolean(process.env.KRAKEN_API_KEY?.trim() && process.env.KRAKEN_API_SECRET?.trim()),
      okxConfigured: Boolean(
        process.env.OKX_API_KEY?.trim()
        && process.env.OKX_API_SECRET?.trim()
        && process.env.OKX_API_PASSPHRASE?.trim()
      ),
    },
    venues: getVenueCapabilities(),
    chains: dynamicChains,
    governance: stageManager.getState(),
    marketDataProviders: marketDataProviders.getProviderStatuses(),
    runtime: getCryptoCrawlerRuntimeAttestation(),
  });
});

router.post('/config', (_req, res) => res.status(409).json({
  success: false,
  error: 'This endpoint is diagnostics-only. CryptoCrawler runtime authority is configuration/env/governance state, not an in-memory decorative admin config.',
}));

router.get('/logs', async (req, res) => {
  const requested = Number(req.query.limit);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(500, Math.floor(requested))) : 100;
  const result = await readRecentCryptoLogs(limit);
  return res.json({
    success: true,
    available: result.available,
    source: result.source,
    reason: result.reason,
    count: result.logs.length,
    logs: result.logs,
  });
});

export const truthfulAdminDiagnostics = router;
