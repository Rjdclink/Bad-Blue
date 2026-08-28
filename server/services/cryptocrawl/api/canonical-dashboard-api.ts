import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { canonicalExecutionScheduler } from '../execution/canonical-execution-scheduler.js';
import { ensureCanonicalCryptoCrawlerRuntimeWiring } from '../integration/canonical-runtime-wiring.js';
import { balanceMonitor } from '../bridge/balance-monitor.js';
import { stageManager } from '../governance/stage-management.js';

const router = express.Router();
const wss = new WebSocketServer({ noServer: true });

function terminalSnapshots() {
  return canonicalOpportunityState.getRecent(512)
    .filter(snapshot => snapshot.settlement?.terminal === true)
    .filter(snapshot => snapshot.realized.settlementConfirmed === true);
}

function canonicalStats() {
  const terminal = terminalSnapshots();
  const realized = terminal.filter(snapshot => Number.isFinite(snapshot.realized.realizedProfitUsd));
  const successful = realized.filter(snapshot => snapshot.realized.success === true);
  const failed = terminal.length - successful.length;
  const totalProfit = realized.reduce((sum, snapshot) => sum + (snapshot.realized.realizedProfitUsd || 0), 0);
  const best = realized
    .filter(snapshot => snapshot.realized.realizedProfitUsd !== null)
    .sort((left, right) => (right.realized.realizedProfitUsd || 0) - (left.realized.realizedProfitUsd || 0))[0];
  const successRate = terminal.length > 0 ? successful.length / terminal.length : 0;

  return {
    profit: {
      today: totalProfit,
      thisWeek: totalProfit,
      thisMonth: totalProfit,
      allTime: totalProfit,
    },
    trades: {
      total: terminal.length,
      successful: successful.length,
      failed,
      successRate: `${(successRate * 100).toFixed(1)}%`,
    },
    performance: {
      avgProfitPerTrade: terminal.length > 0 ? (totalProfit / terminal.length).toFixed(2) : '0.00',
      bestTrade: best
        ? {
            profit: best.realized.realizedProfitUsd || 0,
            asset: best.symbol,
            timestamp: best.settlement?.settledAt || best.updatedAt,
          }
        : { profit: 0, asset: 'none', timestamp: 0 },
      lastUpdate: new Date().toISOString(),
    },
    source: 'canonical_terminal_settlement',
  };
}

function canonicalOpportunities() {
  const now = Date.now();
  return canonicalOpportunityState.getRecent(100)
    .filter(snapshot => snapshot.status === 'eligible')
    .filter(snapshot => !!snapshot.plan && Number.isFinite(snapshot.plan.netProfitUsd) && snapshot.plan.netProfitUsd > 0)
    .map(snapshot => ({
      id: snapshot.opportunityId,
      asset: snapshot.symbol,
      chain: snapshot.chain,
      profit: snapshot.plan!.netProfitUsd,
      successProbability: snapshot.assessment?.probabilityOfProfitableExecution ?? null,
      tier: snapshot.assessment?.riskLevel || 'unknown',
      age: Math.max(0, now - snapshot.observedAt),
      provenance: [...snapshot.provenance],
    }));
}

function hasControlAuthority(req: any): boolean {
  const internalKey = String(process.env.INTERNAL_KEY || process.env.INTERNAL_API_KEY || '');
  const supplied = String(req.header('X-Internal-Key') || req.header('X-Internal-Api-Key') || '');
  if (internalKey && supplied && supplied === internalKey) return true;
  return !!(req.isAuthenticated?.() && req.user && (req.user.isMasterBypass || req.user.isAdminBypass));
}

router.get('/stats', (_req, res) => {
  res.json(canonicalStats());
});

router.get('/opportunities', (_req, res) => {
  const opportunities = canonicalOpportunities();
  res.json({
    count: opportunities.length,
    opportunities,
    status: opportunities.length > 0 ? 'measured' : 'empty',
    source: 'canonical_opportunity_state',
  });
});

router.get('/history', (req, res) => {
  const limit = Math.max(1, Math.min(500, Number.parseInt(String(req.query.limit || '100'), 10) || 100));
  const trades = terminalSnapshots().slice(0, limit).map(snapshot => ({
    timestamp: snapshot.settlement?.settledAt || snapshot.updatedAt,
    asset: snapshot.symbol,
    profit: snapshot.realized.realizedProfitUsd || 0,
    success: snapshot.realized.success === true,
    txHash: snapshot.settlement?.transactionHash || '',
    status: snapshot.settlement?.status || snapshot.status,
    settlementConfirmed: true,
    provenance: [...snapshot.provenance],
  }));
  res.json({ trades, source: 'canonical_terminal_settlement' });
});

router.get('/balances', async (_req, res) => {
  const portfolio = await balanceMonitor.getVerifiedPortfolioValue();
  res.status(portfolio.status === 'verified' ? 200 : 503).json({
    chains: portfolio.balances.map(balance => ({
      chain: balance.chain,
      native: balance.native,
      tokens: [
        { symbol: 'USDT', balance: balance.usdt },
        { symbol: 'USDC', balance: balance.usdc },
      ],
      totalValue: balance.totalUsd,
      provenance: balance.provenance,
    })),
    totalValue: portfolio.totalUsd,
    status: portfolio.status,
    reason: portfolio.reason || null,
    source: 'verified_portfolio_balance',
  });
});

router.get('/faucet/status', (_req, res) => {
  const scheduler = canonicalExecutionScheduler.getStats();
  const governance = stageManager.getState();
  const stats = canonicalStats();
  res.json({
    enabled: scheduler.running,
    mode: scheduler.running ? 'canonical_scheduler' : 'closed',
    executionAuthority: 'canonical_execution_scheduler',
    profitThisSession: stats.profit.allTime,
    profitThisHour: canonicalOpportunityState.getMetrics(60 * 60 * 1000).realizedNetProfitUsd,
    profitThisDay: stats.profit.today,
    dailyTarget: 0,
    dailyTargetProgress: 0,
    tradesThisHour: canonicalOpportunityState.getMetrics(60 * 60 * 1000).realizedSettlementCount,
    tradesThisDay: stats.trades.total,
    stealthLevel: 0,
    healthScore: governance.killSwitchActive ? 0 : 100,
    consecutiveFailures: scheduler.failed,
    currentWindow: 0,
    totalWindows: 0,
    autoOptimize: false,
    profitableTimesOnly: true,
    antiDetectionEnabled: false,
    syntheticTargetsEnabled: false,
  });
});

router.post('/faucet/toggle', (req: any, res) => {
  if (!hasControlAuthority(req)) {
    return res.status(403).json({ success: false, error: 'Platform administrator or internal service authority required' });
  }
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ success: false, error: 'enabled must be boolean' });
  }

  if (req.body.enabled) {
    ensureCanonicalCryptoCrawlerRuntimeWiring();
    canonicalExecutionScheduler.start();
  } else {
    canonicalExecutionScheduler.stop();
  }

  return res.json({
    success: true,
    enabled: canonicalExecutionScheduler.getStats().running,
    mode: canonicalExecutionScheduler.getStats().running ? 'canonical_scheduler' : 'closed',
    executionAuthority: 'canonical_execution_scheduler',
    note: 'Measured discovery remains independent; this toggle controls canonical execution dispatch only.',
  });
});

wss.on('connection', ws => {
  const sendStats = () => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'update',
      data: {
        stats: {
          totalProfit: canonicalStats().profit.allTime,
          totalTrades: terminalSnapshots().length,
          successfulTrades: terminalSnapshots().filter(snapshot => snapshot.realized.success === true).length,
          successRate: terminalSnapshots().length > 0
            ? terminalSnapshots().filter(snapshot => snapshot.realized.success === true).length / terminalSnapshots().length
            : 0,
        },
        timestamp: Date.now(),
        source: 'canonical_terminal_settlement',
      },
    }));
  };

  if (ws.readyState === WebSocket.OPEN) {
    const stats = canonicalStats();
    ws.send(JSON.stringify({
      type: 'stats',
      data: {
        totalProfit: stats.profit.allTime,
        totalTrades: stats.trades.total,
        successfulTrades: stats.trades.successful,
        failedTrades: stats.trades.failed,
        successRate: stats.trades.total > 0 ? stats.trades.successful / stats.trades.total : 0,
      },
    }));
  }

  const interval = setInterval(sendStats, 2_000);
  interval.unref?.();
  ws.on('close', () => clearInterval(interval));
  ws.on('error', () => clearInterval(interval));
});

export { router as dashboardApi, wss };
export default router;
