// Master Pipeline - Integration with Stealth Superiority System
// Connects Starburst Snake, Lux Swarm, and Stealth systems for crushing performance

import { Wallet, providers } from 'ethers';
import type { Opportunity } from '../core/lux-swarm';
import { LuxSwarm } from '../core/lux-swarm.js';
import { executeWithMaxProfit, multiRelay, flashLoans, ultraLowLatency } from '../execution/index.js';
import { RealtimeDataStream } from '../scanner/realtime-stream.js';
import { ReinforcementLearningBidder } from '../learning/reinforcement-learning-bidder.js';
import { DynamicScalePhysics } from '../scaling/dynamic-scale-physics.js';
import { OperationalIntegrity } from '../integrity/operational-integrity.js';
import { ValidatorBribingAdvanced } from '../mev/validator-bribing-advanced.js';
import { TripleDipExtractor } from '../mev/triple-dip-extractor.js';
import { StealthSuperiority, type StealthMetrics } from '../stealth/index.js';
import logger from '../../../logger.js';
import { getCryptara } from '../../cryptara/index.js';
import { networkHealth } from '../bridge/network-health.js';
import { gasOracle } from '../bridge/gas-oracle.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { PER_CHAIN_RISK } from '../config/perChainRisk.js';
import { TradingViewEngine } from '../babel/tradingview-integration.js';
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';

const { JsonRpcProvider } = providers;

class MasterPipeline {
  private running = false;
  private realtimeStream: RealtimeDataStream | null = null;
  private rlBidder: ReinforcementLearningBidder;
  private scalePhysics: DynamicScalePhysics;
  private integrity: OperationalIntegrity;
  private validatorBribing: ValidatorBribingAdvanced;
  private tripleDip: TripleDipExtractor;
  private opportunitiesProcessed = 0;
  private totalProfit = 0;
  private connectorReadiness: {
    networkHealth: { ready: boolean; detail: string };
    gasOracle: { ready: boolean; detail: string };
    tradingView: { ready: boolean; detail: string; mode: 'live' | 'degraded' | 'simulated' };
    alchemy: { ready: boolean; detail: string; mode: 'live' | 'degraded' };
  } = {
    networkHealth: { ready: false, detail: 'Not initialized' },
    gasOracle: { ready: false, detail: 'Not initialized' },
    tradingView: { ready: false, detail: 'Not initialized', mode: 'simulated' },
    alchemy: { ready: false, detail: 'Not initialized', mode: 'degraded' },
  };
  private stealthSystem: StealthSuperiority | null = null;
  private wallet: Wallet | null = null;
  private providers: Map<string, providers.JsonRpcProvider> = new Map();

  constructor() {
    this.rlBidder = new ReinforcementLearningBidder();
    this.scalePhysics = new DynamicScalePhysics();
    this.integrity = new OperationalIntegrity();
    this.validatorBribing = new ValidatorBribingAdvanced();
    this.tripleDip = new TripleDipExtractor();
  }

  /**
   * Initialize the pipeline with stealth systems
   */
  async initialize(): Promise<void> {
    console.log('🚀 Master Pipeline initializing with Stealth Superiority...');

    // Initialize stealth system
    this.stealthSystem = new StealthSuperiority();

    // In production, initialize wallet and providers from WalletManager
    // For now, create placeholder
    if (process.env.WALLET_PRIVATE_KEY) {
      this.wallet = new Wallet(process.env.WALLET_PRIVATE_KEY);
    }

    // Known working public RPC endpoints by chain
    const defaultRpcUrls: Record<string, string> = {
      polygon: 'https://polygon-rpc.com',
      bsc: 'https://bsc-dataseed.binance.org',
      avalanche: 'https://api.avax.network/ext/bc/C/rpc',
      arbitrum: 'https://arb1.arbitrum.io/rpc',
      optimism: 'https://mainnet.optimism.io'
    };

    // Initialize providers for supported chains
    const chains = ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism'];
    for (const chain of chains) {
      const rpcUrl = process.env[`${chain.toUpperCase()}_RPC_URL`] || defaultRpcUrls[chain];
      this.providers.set(chain, new JsonRpcProvider(rpcUrl));
    }

    // Initialize stealth system if wallet is available
    if (this.wallet && this.providers.size > 0) {
      await this.stealthSystem.initialize(this.wallet, this.providers);
    }

    const strictConnectors = process.env.CRYPTO_REQUIRE_LIVE_CONNECTORS === 'true';

    try {
      if (!networkHealth.isRunning()) {
        await networkHealth.start();
      }
      this.connectorReadiness.networkHealth = { ready: true, detail: 'Network health monitor running' };
    } catch (error) {
      this.connectorReadiness.networkHealth = {
        ready: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      if (!gasOracle.isRunning()) {
        await gasOracle.start();
      }
      this.connectorReadiness.gasOracle = { ready: true, detail: 'Gas oracle running' };
    } catch (error) {
      this.connectorReadiness.gasOracle = {
        ready: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    TradingViewEngine.initialize();
    const tvReadiness = await TradingViewEngine.checkReadiness({ strictLive: strictConnectors });
    this.connectorReadiness.tradingView = {
      ready: tvReadiness.ready,
      detail: tvReadiness.detail,
      mode: tvReadiness.mode,
    };

    try {
      await alchemyIntegration.start(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base']);
    } catch (error) {
      logger.warn('Alchemy start failed during pipeline initialization', {
        component: 'MasterPipeline',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const alchemyReadiness = await alchemyIntegration.readinessCheck({ strictLive: strictConnectors });
    this.connectorReadiness.alchemy = {
      ready: alchemyReadiness.ready,
      detail: alchemyReadiness.detail,
      mode: alchemyReadiness.ready ? 'live' : 'degraded',
    };

    const blockingFailures = Object.entries(this.connectorReadiness)
      .filter(([_, status]) => !status.ready)
      .map(([name, status]) => `${name}:${status.detail}`);

    if (blockingFailures.length > 0) {
      logger.warn('Master pipeline initialized with connector degradations', {
        component: 'MasterPipeline',
        strictConnectors,
        blockingFailures,
      });
    }

    if (strictConnectors && blockingFailures.length > 0) {
      throw new Error(`Live connector readiness failed: ${blockingFailures.join(' | ')}`);
    }

    console.log('✅ Master Pipeline initialized with stealth systems');
  }

  /**
   * Start the main pipeline loop
   */
  async run(): Promise<void> {
    if (!this.stealthSystem) {
      await this.initialize();
    }

    this.running = true;
    logger.info('Master Pipeline started with advanced MEV systems', {
      component: 'MasterPipeline'
    });

    try {
      // Initialize realtime data stream
      this.realtimeStream = new RealtimeDataStream({
        httpUrl: process.env.RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/demo'
      });

      await this.realtimeStream.initialize();

      // Set up event handlers
      this.realtimeStream.onBlock((blockNumber) => {
        this.handleNewBlock(blockNumber);
      });

      this.realtimeStream.onPendingTransaction((tx) => {
        this.handlePendingTransaction(tx);
      });

      // Initialize operational integrity
      await this.integrity.maintainContinuousIngestion();

      logger.info('Master Pipeline initialization complete', {
        component: 'MasterPipeline',
        streamConnected: this.realtimeStream.isConnected(),
        activeListeners: this.integrity.getActiveListeners()
      });
    } catch (error) {
      logger.error('Master Pipeline initialization failed', {
        component: 'MasterPipeline',
        error: error instanceof Error ? error.message : String(error)
      });
      this.running = false;
    }
  }

  private handleNewBlock(blockNumber: number): void {
    logger.debug('New block detected - scanning for opportunities', {
      component: 'MasterPipeline',
      blockNumber
    });

    // Adjust compute profile based on market conditions
    this.scalePhysics.adjustComputeProfile();
    this.scalePhysics.recordOpportunityCount(this.opportunitiesProcessed);
    
    // Optimize costs if needed
    this.scalePhysics.optimizeCosts();
  }

  private async handlePendingTransaction(tx: any): Promise<void> {
    // Analyze pending transaction for backrun opportunities
    logger.debug('Analyzing pending transaction', {
      component: 'MasterPipeline',
      txHash: tx.hash
    });

    // This would be expanded in production to detect actual opportunities
  }

  /**
   * Execute opportunities using stealth system
   */
  private async executeOpportunitiesWithStealth(opportunities: Opportunity[]): Promise<void> {
    if (!this.stealthSystem) return;

    // Filter high-priority opportunities
    const highPriority = opportunities
      .filter(opp => opp.priority >= 7 && opp.profitEstimate > 50)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 10); // Top 10 opportunities

    if (highPriority.length > 0) {
      console.log(`[PIPELINE] Executing ${highPriority.length} high-priority opportunities with stealth...`);
      
      // Execute batch with stealth superiority
      const results = await this.stealthSystem.executeBatch(highPriority);
      
      // Log results (invisibly)
      const successful = results.filter(r => r.success).length;
      if (successful > 0) {
        console.log(`[PIPELINE] Completed processing: ${successful}/${results.length} successful`);
      }
    }
  }

  /**
   * Get current opportunities from LuxSwarm
   */
  async getCurrentOpportunities(): Promise<Opportunity[]> {
    // Observe current state from LuxSwarm
    const state = LuxSwarm.observe();
    return state.opportunities;
  }

  /**
   * Get stealth metrics for monitoring
   */
  getStealthMetrics(): StealthMetrics | null {
    return this.stealthSystem?.getMetrics() || null;
  }

  async executeOpportunity(opp: Opportunity): Promise<void> {
    try {
      // ============================================================
      // CRYPTARA MARKET GATE (advisory evaluators -> hard execution gate)
      // ============================================================
      const governance = getCryptocrawlGovernance();
      const cryptara = getCryptara();
      const directive = cryptara.getAutonomousDirective();
      const utcHour = new Date().getUTCHours();
      const risk = PER_CHAIN_RISK[opp.chain as keyof typeof PER_CHAIN_RISK] || PER_CHAIN_RISK.polygon;
      const marketSymbol = ((opp.pair || opp.asset || 'BTCUSDT').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()) || 'BTCUSDT';

      if (
        directive.riskBudget === 'defensive' &&
        directive.preferredChains.length > 0 &&
        !directive.preferredChains.includes(String(opp.chain).toLowerCase())
      ) {
        logger.info('Opportunity skipped: chain outside current defensive preferred set', {
          component: 'MasterPipeline',
          chain: opp.chain,
          preferredChains: directive.preferredChains,
        });
        return;
      }

      const technicalSignal = await TradingViewEngine.getAnalysis(marketSymbol, '1h').catch(() => null);
      const mempool = (() => {
        try {
          return alchemyIntegration.getMempoolAnalysis();
        } catch {
          return null;
        }
      })();

      // Estimate realistic overheads before gate evaluation.
      const estimatedNotionalUsd = Math.max(
        250,
        Math.min(12000, opp.priority * 150 * Math.max(0.5, directive.notionalMultiplier)),
      );
      const venueFeeBps = 30;

      // Latency gate: use chain health latency as a proxy until venue-specific latency is wired.
      let chainLatencyMs: number | undefined;
      try {
        if (networkHealth.isRunning()) {
          const health = await networkHealth.checkNetwork(opp.chain as any);
          chainLatencyMs = health.latency;
        }
      } catch {
        chainLatencyMs = undefined;
      }

      // Volatility regime: use minimal inputs; integrators can supply richer metrics later.
      let gasGwei: number | undefined;
      let estimatedGasUsd = 0;
      try {
        const gp = await gasOracle.getGasPrice(opp.chain as any);
        gasGwei = gp.gweiPrice;
        estimatedGasUsd = gp.usdCost;
      } catch {
        gasGwei = undefined;
        estimatedGasUsd = 0;
      }

      const expectedSlippageBps = Math.max(
        5,
        Math.min(
          Math.min(risk.maxSlippageBps, directive.maxSlippageBps),
          8 + (mempool ? mempool.totalPending / 1000 : 0) * 3 + (technicalSignal ? Math.max(0, 60 - technicalSignal.summary.strength) / 8 : 0),
        ),
      );

      const feeUsd = estimatedNotionalUsd * (venueFeeBps / 10000);
      const slippageUsd = estimatedNotionalUsd * (expectedSlippageBps / 10000);
      const netExpectedProfitUsd = opp.profitEstimate - feeUsd - slippageUsd - estimatedGasUsd;

      if (netExpectedProfitUsd <= 0) {
        logger.warn('Opportunity rejected before execution: negative net expected profit', {
          component: 'MasterPipeline',
          opportunityId: opp.asset,
          chain: opp.chain,
          grossEstimate: opp.profitEstimate,
          feeUsd,
          slippageUsd,
          gasUsd: estimatedGasUsd,
          netExpectedProfitUsd,
        });
        return;
      }

      if (netExpectedProfitUsd < directive.minimumNetProfitUsd) {
        logger.info('Opportunity rejected by autonomous directive minimum net-profit floor', {
          component: 'MasterPipeline',
          chain: opp.chain,
          opportunityId: opp.asset,
          netExpectedProfitUsd,
          minimumNetProfitUsd: directive.minimumNetProfitUsd,
        });
        return;
      }

      let gate;
      try {
        gate = cryptara.evaluateMarketGates(
          {
            chain: opp.chain,
            pairOrSymbol: opp.pair || opp.asset,
            venue: 'uniswap',
            expectedProfitUsd: netExpectedProfitUsd,
            orderFlow: mempool ? {
              windowMs: 60_000,
              trades: mempool.arbitrageOpportunities.slice(0, 50).map(tx => ({
                ts: tx.timestamp,
                side: 'buy' as const,
                size: Math.max(1, parseInt(tx.gas, 16) || 1),
                price: parseInt(tx.gasPrice || '0', 16),
              })),
            } : undefined,
            liquidityHeatmap: {
              referencePrice: estimatedNotionalUsd,
              requiredDepth: Math.max(250, estimatedNotionalUsd * 0.4),
              bandBps: 50,
              bids: [{ price: estimatedNotionalUsd * 0.998, size: Math.max(0, (mempool?.swapTransactions || 0) * 0.8) }],
              asks: [{ price: estimatedNotionalUsd * 1.002, size: Math.max(0, (mempool?.swapTransactions || 0) * 0.8) }],
            },
            volatilityRegime: {
              gasPriceGwei: gasGwei,
              liquidityScore: technicalSignal ? Math.max(0.1, technicalSignal.summary.strength / 100) : undefined,
              mempoolActivity: mempool?.totalPending,
            },
            venueLatency: {
              p50Ms: {
                chain_rpc: chainLatencyMs ?? 9999,
              },
              maxP50Ms: risk.maxLatencyMs,
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
              grossSpreadBps: Math.max(0, (opp.profitEstimate / estimatedNotionalUsd) * 10000),
            },
            drawdownCaps: {
              drawdownPct: this.totalProfit < 0 ? Math.min(100, Math.abs(this.totalProfit) / Math.max(1, Math.abs(this.totalProfit) + 1000) * 100) : 0,
              maxDrawdownPct: 15,
            },
            profitReinvestment: {
              realizedProfitUsd: Math.max(0, this.totalProfit),
              requestedNotionalUsd: estimatedNotionalUsd,
              reinvestFraction: 0.8,
            },
            slippage: {
              expectedSlippageBps,
              maxSlippageBps: risk.maxSlippageBps,
            },
            timeOfDay: { utcHour },
          },
          {
            // Start with a minimal critical set; as integrations add real data feeds,
            // we can promote more signals to "critical".
            blockOnUnknownCritical: true,
            criticalSignals: ['volatilityRegime', 'venueLatency', 'slippage'],
          }
        );
      } catch (err) {
        logger.warn('Cryptara gate evaluation unavailable; skipping execution (ask-and-wait)', {
          component: 'MasterPipeline',
          opportunityId: opp.asset,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      if (gate.actions.requestAutoPause) {
        governance.pause('system', gate.actions.autoPauseReason || 'cryptara_auto_pause');
      }

      if (gate.decision !== 'ALLOW') {
        logger.warn('Cryptara gate blocked opportunity execution', {
          component: 'MasterPipeline',
          opportunityId: opp.asset,
          chain: opp.chain,
          pair: opp.pair,
          reasons: gate.blockReasons,
        });
        return;
      }

      // Check if opportunity should use triple-dip extraction
      const tripleDipResult = await this.tripleDip.extractTripleDip({
        id: opp.asset,
        asset: opp.asset,
        pair: opp.pair,
        chain: opp.chain,
        profitEstimate: opp.priority,
        swapSize: 10000,
        dex: 'uniswap'
      });

      // Calculate optimal gas bid using RL bidder
      const gasContext = {
        size: opp.priority,
        gasPrice: 50,
        competitorCount: 3,
        timeOfDay: new Date().getHours()
      };
      const optimalBid = this.rlBidder.calculateOptimalBid(gasContext);

      logger.info('Executing opportunity with optimized parameters', {
        component: 'MasterPipeline',
        opportunityId: opp.asset,
        tripleDipProfit: tripleDipResult.totalProfit,
        optimalGasBid: optimalBid,
        netExpectedProfitUsd,
      });

      // Execute with operational integrity
      const result = await this.integrity.executeSafely({
        id: opp.asset,
        execute: async () => {
          return await executeWithMaxProfit({
            id: opp.asset,
            asset: opp.asset,
            chain: opp.chain,
            profit: Math.max(tripleDipResult.netProfit, netExpectedProfitUsd),
            type: 'simple'
          });
        }
      });

      if (result.success) {
        this.opportunitiesProcessed++;
        this.totalProfit += result.profit || 0;

        cryptara.recordExecutionResult({
          source: 'master_pipeline',
          opportunityId: opp.asset,
          chain: String(opp.chain).toLowerCase(),
          symbol: marketSymbol,
          strategy: 'triple_dip_execute_with_max_profit',
          success: true,
          expectedProfitUsd: netExpectedProfitUsd,
          realizedProfitUsd: result.profit || netExpectedProfitUsd,
          feeUsd,
          slippageBps: expectedSlippageBps,
          latencyMs: chainLatencyMs || 0,
          usedZeroCapital: false,
          timestamp: Date.now(),
        });
        
        // Record outcome for RL learning
        this.rlBidder.recordOutcome(gasContext, optimalBid, true);
        this.scalePhysics.recordProfit(result.profit || 0);

        logger.info('Opportunity executed successfully', {
          component: 'MasterPipeline',
          opportunityId: opp.asset,
          profit: result.profit,
          totalProfit: this.totalProfit,
          totalProcessed: this.opportunitiesProcessed
        });
      } else {
        cryptara.recordExecutionResult({
          source: 'master_pipeline',
          opportunityId: opp.asset,
          chain: String(opp.chain).toLowerCase(),
          symbol: marketSymbol,
          strategy: 'triple_dip_execute_with_max_profit',
          success: false,
          expectedProfitUsd: netExpectedProfitUsd,
          realizedProfitUsd: 0,
          feeUsd,
          slippageBps: expectedSlippageBps,
          latencyMs: chainLatencyMs || 0,
          usedZeroCapital: false,
          timestamp: Date.now(),
        });
        this.rlBidder.recordOutcome(gasContext, optimalBid, false);
      }
    } catch (error) {
      logger.error('Opportunity execution failed', {
        component: 'MasterPipeline',
        opportunityId: opp.asset,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  async stop(): Promise<void> {
    this.running = false;
    
    if (this.realtimeStream) {
      await this.realtimeStream.destroy();
      this.realtimeStream = null;
    }

    if (networkHealth.isRunning()) {
      await networkHealth.stop().catch(() => undefined);
    }

    if (gasOracle.isRunning()) {
      await gasOracle.stop().catch(() => undefined);
    }

    alchemyIntegration.stop();
    TradingViewEngine.shutdown();

    logger.info('Master Pipeline stopped', {
      component: 'MasterPipeline',
      totalProcessed: this.opportunitiesProcessed,
      totalProfit: this.totalProfit
    });
  }

  getMetrics() {
    return {
      running: this.running,
      opportunitiesProcessed: this.opportunitiesProcessed,
      totalProfit: this.totalProfit,
      connectorReadiness: this.connectorReadiness,
      scaleMetrics: this.scalePhysics.getMetrics(),
      streamConnected: this.realtimeStream?.isConnected() || false,
      activeListeners: this.integrity.getActiveListeners()
    };
  }
}

export const pipeline = new MasterPipeline();
