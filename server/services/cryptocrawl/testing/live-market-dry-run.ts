import { getEnv } from '../../../config.js';
import fs from 'fs';
import { TradingViewEngine, type TechnicalAnalysis } from '../babel/tradingview-integration.js';
import { alchemyIntegration, type MempoolAnalysis } from '../capital-free/alchemy-integration.js';
import { networkHealth } from '../bridge/network-health.js';
import { gasOracle } from '../bridge/gas-oracle.js';
import { getCryptara } from '../../cryptara/index.js';
import type { ChainId } from '../bridge/types.js';
import type { GateEvaluation } from '../../cryptara/marketGates/index.js';

type ReadinessStatus = 'pass' | 'warn' | 'block';

interface ChecklistItem {
  id: string;
  status: ReadinessStatus;
  detail: string;
}

interface TradingViewSnapshot {
  symbol: string;
  timeframe: string;
  signal: TechnicalAnalysis['summary']['signal'];
  dataProvenance: TechnicalAnalysis['dataProvenance'];
  sourceTimestamp: number;
  strength: number;
  latencyMs: number;
  timestamp: number;
  pivot: number;
}

interface DryRunReport {
  generatedAt: string;
  durationMs: number;
  inputs: {
    symbols: string[];
    timeframe: string;
    chain: ChainId;
    expectedProfitUsd: number;
    notionalUsd: number;
  };
  telemetry: {
    tradingView: TradingViewSnapshot[];
    alchemy: {
      started: boolean;
      stats: ReturnType<typeof alchemyIntegration.getStatistics>;
      mempool: MempoolAnalysis;
    };
    networkHealth: {
      chain: ChainId;
      latencyMs: number;
      isHealthy: boolean;
      blockHeight: number;
    } | null;
    gasOracle: {
      chain: ChainId;
      gweiPrice: number;
      usdCost: number;
      congestionLevel: 'low' | 'medium' | 'high';
    } | null;
  };
  economics: {
    venueFeeBps: number;
    expectedSlippageBps: number;
    feeUsd: number;
    slippageUsd: number;
    gasUsd: number;
    netExpectedProfitUsd: number;
  };
  gateEvaluation: {
    decision: GateEvaluation['decision'];
    blockReasons: string[];
    signalCount: number;
  };
  checklist: ChecklistItem[];
  readiness: 'ready' | 'ready_with_warnings' | 'blocked';
}

function toNumber(raw: string, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function getSymbols(): string[] {
  const raw = getEnv('CRYPTO_DRY_RUN_SYMBOLS', 'BTCUSDT,ETHUSDT,SOLUSDT');
  return raw
    .split(',')
    .map(part => part.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 8);
}

async function getTradingViewSnapshots(symbols: string[], timeframe: string): Promise<TradingViewSnapshot[]> {
  const snapshots: TradingViewSnapshot[] = [];

  for (const symbol of symbols) {
    const startedAt = Date.now();
    const analysis = await TradingViewEngine.getAnalysis(symbol, timeframe);

    snapshots.push({
      symbol,
      timeframe,
      signal: analysis.summary.signal,
      dataProvenance: analysis.dataProvenance,
      sourceTimestamp: analysis.sourceTimestamp,
      strength: analysis.summary.strength,
      latencyMs: Date.now() - startedAt,
      timestamp: analysis.timestamp,
      pivot: analysis.pivotPoints.classic.pivot,
    });
  }

  return snapshots;
}

async function runDryRun(): Promise<DryRunReport> {
  const runStartedAt = Date.now();
  const timeframe = getEnv('CRYPTO_DRY_RUN_TIMEFRAME', '1h');
  const chain: ChainId = (getEnv('CRYPTO_DRY_RUN_CHAIN', 'polygon') as ChainId);
  const symbols = getSymbols();
  const expectedProfitUsd = toNumber(getEnv('CRYPTO_DRY_RUN_EXPECTED_PROFIT_USD', '40'), 40);
  const notionalUsd = toNumber(getEnv('CRYPTO_DRY_RUN_NOTIONAL_USD', '1200'), 1200);
  const venueFeeBps = 30;

  let tradingViewSnapshots: TradingViewSnapshot[] = [];
  let alchemyStarted = false;
  let network = null as DryRunReport['telemetry']['networkHealth'];
  let gas = null as DryRunReport['telemetry']['gasOracle'];
  let gateDecision: GateEvaluation['decision'] = 'BLOCK';
  let gateBlockReasons: string[] = [];
  let gateSignalCount = 0;

  try {
    tradingViewSnapshots = await getTradingViewSnapshots(symbols, timeframe);

    try {
      await alchemyIntegration.start(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base']);
      alchemyStarted = true;
    } catch {
      alchemyStarted = false;
    }

    if (!networkHealth.isRunning()) {
      await networkHealth.start().catch(() => undefined);
    }

    const [networkHealthData, gasPrice] = await Promise.all([
      networkHealth.checkNetwork(chain).catch(() => null),
      gasOracle.getGasPrice(chain).catch(() => null),
    ]);

    if (networkHealthData) {
      network = {
        chain,
        latencyMs: networkHealthData.latency,
        isHealthy: networkHealthData.isHealthy,
        blockHeight: networkHealthData.blockHeight,
      };
    }

    if (gasPrice) {
      gas = {
        chain,
        gweiPrice: gasPrice.gweiPrice,
        usdCost: gasPrice.usdCost,
        congestionLevel: gasPrice.congestionLevel,
      };
    }

    const mempool = alchemyIntegration.getMempoolAnalysis();
    const primary = tradingViewSnapshots[0];

    const expectedSlippageBps = Math.max(
      5,
      Math.min(40, 8 + (mempool.totalPending / 1000) * 3 + Math.max(0, 60 - (primary?.strength ?? 50)) / 8),
    );

    const feeUsd = notionalUsd * (venueFeeBps / 10000);
    const slippageUsd = notionalUsd * (expectedSlippageBps / 10000);
    const gasUsd = gas?.usdCost || 0;
    const netExpectedProfitUsd = expectedProfitUsd - feeUsd - slippageUsd - gasUsd;

    const cryptara = getCryptara({
      enabled: true,
      surveillanceMode: 'scheduled',
      faucetTriggered: true,
      monteCarloInterval: 6,
    });

    await cryptara.initialize();

    try {
      const gate = cryptara.evaluateMarketGates({
        chain,
        pairOrSymbol: primary?.symbol || symbols[0] || 'BTCUSDT',
        venue: 'uniswap',
        expectedProfitUsd: netExpectedProfitUsd,
        orderFlow: {
          windowMs: 60000,
          trades: mempool.arbitrageOpportunities.slice(0, 20).map(tx => ({
            ts: tx.timestamp,
            side: 'buy' as const,
            size: Math.max(1, parseInt(tx.gas, 16) || 1),
            price: parseInt(tx.gasPrice || '0', 16),
          })),
        },
        liquidityHeatmap: {
          referencePrice: Math.max(1, primary?.pivot || 2000),
          requiredDepth: Math.max(250, notionalUsd * 0.4),
          bandBps: 50,
          bids: [{ price: Math.max(1, (primary?.pivot || 2000) * 0.998), size: Math.max(0, mempool.swapTransactions * 0.8) }],
          asks: [{ price: Math.max(1, (primary?.pivot || 2000) * 1.002), size: Math.max(0, mempool.swapTransactions * 0.8) }],
        },
        volatilityRegime: {
          gasPriceGwei: gas?.gweiPrice,
          liquidityScore: primary ? Math.max(0.1, primary.strength / 100) : undefined,
          mempoolActivity: mempool.totalPending,
        },
        venueLatency: {
          p50Ms: { chain_rpc: network?.latencyMs ?? 9999 },
          maxP50Ms: 750,
        },
        feesRebates: {
          takerFeeBps: venueFeeBps,
          makerFeeBps: 10,
          makerRebateBps: -1,
          makerOnly: false,
        },
        crossVenueFees: {
          buyVenue: 'uniswap',
          sellVenue: 'sushiswap',
          buyTakerFeeBps: venueFeeBps,
          sellTakerFeeBps: venueFeeBps,
          grossSpreadBps: Math.max(0, (expectedProfitUsd / notionalUsd) * 10000),
        },
        drawdownCaps: {
          drawdownPct: 0,
          maxDrawdownPct: 15,
        },
        profitReinvestment: {
          realizedProfitUsd: 1000,
          requestedNotionalUsd: notionalUsd,
          reinvestFraction: 0.8,
        },
        slippage: {
          expectedSlippageBps,
          maxSlippageBps: 40,
        },
        timeOfDay: {
          utcHour: new Date().getUTCHours(),
        },
      });

      gateDecision = gate.decision;
      gateBlockReasons = gate.blockReasons;
      gateSignalCount = gate.signals.length;
    } catch (error) {
      gateDecision = 'BLOCK';
      gateSignalCount = 0;
      gateBlockReasons = [
        `Gate evaluation unavailable: ${error instanceof Error ? error.message : String(error)}`,
      ];
    }

    const checklist: ChecklistItem[] = [
      {
        id: 'tradingview-signals',
        status: tradingViewSnapshots.length > 0 && tradingViewSnapshots.every(snapshot => snapshot.dataProvenance === 'live')
          ? 'pass'
          : 'block',
        detail: tradingViewSnapshots.length > 0
          ? `Captured ${tradingViewSnapshots.length} symbol analyses (${tradingViewSnapshots.map(snapshot => `${snapshot.symbol}:${snapshot.dataProvenance}`).join(', ')})`
          : 'No TradingView analyses were captured',
      },
      {
        id: 'alchemy-telemetry',
        status: alchemyStarted ? 'pass' : 'warn',
        detail: alchemyStarted
          ? 'Alchemy integration started successfully'
          : 'Alchemy integration did not start; using degraded telemetry mode',
      },
      {
        id: 'network-health',
        status: network?.isHealthy ? 'pass' : 'warn',
        detail: network
          ? `Latency ${network.latencyMs}ms, healthy=${network.isHealthy}`
          : 'Network health unavailable for selected chain',
      },
      {
        id: 'gas-oracle',
        status: gas && gas.gweiPrice > 0 ? 'pass' : 'warn',
        detail: gas
          ? `Gas ${gas.gweiPrice.toFixed(4)} gwei, estimated cost $${gas.usdCost.toFixed(4)}`
          : 'Gas quote unavailable',
      },
      {
        id: 'economics',
        status: netExpectedProfitUsd > 0 ? 'pass' : 'block',
        detail: `Net expected profit $${netExpectedProfitUsd.toFixed(4)} after fees/slippage/gas`,
      },
      {
        id: 'cryptara-gate',
        status: gateDecision === 'ALLOW' ? 'pass' : 'warn',
        detail: gateDecision === 'ALLOW'
          ? 'Gate evaluation returned ALLOW'
          : `Gate evaluation returned ${gateDecision}${gateBlockReasons.length ? ` (${gateBlockReasons.join('; ')})` : ''}`,
      },
    ];

    const blocked = checklist.some(item => item.status === 'block');
    const warned = checklist.some(item => item.status === 'warn');

    return {
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - runStartedAt,
      inputs: {
        symbols,
        timeframe,
        chain,
        expectedProfitUsd,
        notionalUsd,
      },
      telemetry: {
        tradingView: tradingViewSnapshots,
        alchemy: {
          started: alchemyStarted,
          stats: alchemyIntegration.getStatistics(),
          mempool,
        },
        networkHealth: network,
        gasOracle: gas,
      },
      economics: {
        venueFeeBps,
        expectedSlippageBps,
        feeUsd,
        slippageUsd,
        gasUsd,
        netExpectedProfitUsd,
      },
      gateEvaluation: {
        decision: gateDecision,
        blockReasons: gateBlockReasons,
        signalCount: gateSignalCount,
      },
      checklist,
      readiness: blocked ? 'blocked' : warned ? 'ready_with_warnings' : 'ready',
    };
  } finally {
    try {
      alchemyIntegration.stop();
    } catch {
      // best effort
    }

    try {
      if (networkHealth.isRunning()) {
        await networkHealth.stop();
      }
    } catch {
      // best effort
    }

    try {
      TradingViewEngine.shutdown();
    } catch {
      // best effort
    }

    try {
      const cryptara = getCryptara();
      await cryptara.shutdown();
    } catch {
      // best effort
    }
  }
}

export async function runCryptocrawlLiveDryRun(): Promise<DryRunReport> {
  return runDryRun();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCryptocrawlLiveDryRun()
    .then(report => {
      const outputFile = getEnv('CRYPTO_DRY_RUN_OUTPUT_FILE');
      if (outputFile) {
        fs.writeFileSync(outputFile, JSON.stringify(report, null, 2), 'utf8');
      }
      console.log(JSON.stringify(report, null, 2));
      console.log(
        `DRY_RUN_SUMMARY readiness=${report.readiness} gate=${report.gateEvaluation.decision} netExpectedProfitUsd=${report.economics.netExpectedProfitUsd.toFixed(6)}`,
      );
    })
    .catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[dry-run] failed:', message);
      process.exitCode = 1;
    });
}
