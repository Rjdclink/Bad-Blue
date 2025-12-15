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
      const utcHour = new Date().getUTCHours();
      const risk = PER_CHAIN_RISK[opp.chain as keyof typeof PER_CHAIN_RISK] || PER_CHAIN_RISK.polygon;

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
      try {
        const gp = await gasOracle.getGasPrice(opp.chain as any);
        gasGwei = gp.gwei;
      } catch {
        gasGwei = undefined;
      }

      let gate;
      try {
        gate = cryptara.evaluateMarketGates(
          {
            chain: opp.chain,
            pairOrSymbol: opp.pair || opp.asset,
            venue: 'uniswap',
            expectedProfitUsd: opp.profitEstimate,
            volatilityRegime: { gasPriceGwei: gasGwei },
            venueLatency: {
              p50Ms: {
                chain_rpc: chainLatencyMs ?? 9999,
              },
              maxP50Ms: risk.maxLatencyMs,
            },
            slippage: {
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
        optimalGasBid: optimalBid
      });

      // Execute with operational integrity
      const result = await this.integrity.executeSafely({
        id: opp.asset,
        execute: async () => {
          return await executeWithMaxProfit({
            id: opp.asset,
            asset: opp.asset,
            chain: opp.chain,
            profit: tripleDipResult.netProfit,
            type: 'simple'
          });
        }
      });

      if (result.success) {
        this.opportunitiesProcessed++;
        this.totalProfit += result.profit || 0;
        
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
      scaleMetrics: this.scalePhysics.getMetrics(),
      streamConnected: this.realtimeStream?.isConnected() || false,
      activeListeners: this.integrity.getActiveListeners()
    };
  }
}

export const pipeline = new MasterPipeline();
