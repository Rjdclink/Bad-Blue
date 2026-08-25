// Master Pipeline - Integration with Stealth Superiority System
// Connects Starburst Snake, Lux Swarm, and Stealth systems for crushing performance

import { Wallet, providers } from 'ethers';
import type { Opportunity } from '../core/lux-swarm';
import { LuxSwarm } from '../core/lux-swarm.js';
import { assessSharedExecutionEnvironment, executeWithMaxProfit, getSharedExecutionCapabilities, multiRelay, ultraLowLatency } from '../execution/index.js';
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
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { PER_CHAIN_RISK } from '../config/perChainRisk.js';
import { TradingViewEngine } from '../babel/tradingview-integration.js';
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { multiProviderRpcManager, type SupportedChain } from '../api/blockchain-providers.js';

type ConnectorReadiness = {
  networkHealth: { ready: boolean; detail: string };
  gasOracle: { ready: boolean; detail: string };
  tradingView: { ready: boolean; detail: string; mode: 'live' | 'degraded' | 'simulated' };
  alchemy: { ready: boolean; detail: string; mode: 'live' | 'degraded' };
};

type DeploymentExecutionReadiness = {
  rpcReady: boolean;
  walletReady: boolean;
  centralizedExchangeReady: boolean;
  genericOnChainPayloadBuilder: boolean;
  structuredOnChainPayloadBuilder: boolean;
  autonomousRoutePlanner: boolean;
  flashLoanReceiverSupport: boolean;
  explicitPayloadRequired: boolean;
  liveExecutionEnabled: boolean;
  liveExecutionConfirmed: boolean;
};

type DeploymentReadinessPass = {
  passNumber: number;
  status: 'pass' | 'warn' | 'fail';
  issues: Array<{ id: string; severity: 'warn' | 'block'; detail: string; remediation: string }>;
  connectorReadiness: ConnectorReadiness;
  cryptara: {
    liveSignalReady: boolean;
    tradingView: { ready: boolean; mode: string; detail: string };
    alchemy: { ready: boolean; mode: string; detail: string };
    directive: ReturnType<ReturnType<typeof getCryptara>['getAutonomousDirective']>;
    sentiment?: { overallSentiment: number; fearGreedIndex: number; dominantNarrative: string };
    monteCarlo?: { simulationId: string; optimalStrategy: string; maxDrawdown: number; valueAtRisk: number };
  };
  execution: DeploymentExecutionReadiness;
};

class MasterPipeline {
  private running = false;
  private initialized = false;
  private strictConnectors = false;
  private realtimeStream: RealtimeDataStream | null = null;
  private rlBidder: ReinforcementLearningBidder;
  private scalePhysics: DynamicScalePhysics;
  private integrity: OperationalIntegrity;
  private validatorBribing: ValidatorBribingAdvanced;
  private tripleDip: TripleDipExtractor;
  private opportunitiesProcessed = 0;
  private totalProfit = 0;
  private connectorReadiness: ConnectorReadiness = {
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

  private isStrictConnectorMode(): boolean {
    return process.env.CRYPTO_REQUIRE_LIVE_CONNECTORS === 'true' || process.env.NODE_ENV === 'production';
  }

  private hasLiveWalletSigner(): boolean {
    return !!process.env.WALLET_PRIVATE_KEY?.trim();
  }

  private hasCentralizedExchangeCredentials(): boolean {
    const krakenReady = !!(
      process.env.KRAKEN_API_KEY?.trim() &&
      process.env.KRAKEN_API_SECRET?.trim()
    );
    const okxReady = !!(
      process.env.OKX_API_KEY?.trim() &&
      process.env.OKX_API_SECRET?.trim() &&
      process.env.OKX_API_PASSPHRASE?.trim()
    );
    return krakenReady || okxReady;
  }

  /**
   * Initialize the pipeline with stealth systems
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log('🚀 Master Pipeline initializing with Stealth Superiority...');
    this.strictConnectors = this.isStrictConnectorMode();

    // Initialize stealth system
    this.stealthSystem = new StealthSuperiority();

    // In production, initialize wallet and providers from WalletManager
    // For now, create placeholder
    if (process.env.WALLET_PRIVATE_KEY) {
      this.wallet = new Wallet(process.env.WALLET_PRIVATE_KEY);
    }

    // Initialize providers for supported chains
    const chains: SupportedChain[] = ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism'];
    await multiProviderRpcManager.initialize(['ethereum', ...chains]);
    for (const chain of chains) {
      const operationalProvider = await multiProviderRpcManager.getProvider(chain, 'json_rpc');
      this.providers.set(chain, operationalProvider.http);
    }

    // Initialize stealth system if wallet is available
    if (this.wallet && this.providers.size > 0) {
      await this.stealthSystem.initialize(this.wallet, this.providers);
    }

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
    const tvReadiness = await TradingViewEngine.checkReadiness({ strictLive: this.strictConnectors });
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

    const alchemyReadiness = await alchemyIntegration.readinessCheck({ strictLive: this.strictConnectors });
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
        strictConnectors: this.strictConnectors,
        blockingFailures,
      });
    }

    if (this.strictConnectors && blockingFailures.length > 0) {
      throw new Error(`Live connector readiness failed: ${blockingFailures.join(' | ')}`);
    }

    this.initialized = blockingFailures.length === 0;

    if (!this.initialized) {
      logger.warn('Master pipeline remains non-ready after initialization due to connector degradations', {
        component: 'MasterPipeline',
        blockingFailures,
      });
      return;
    }

    console.log('✅ Master Pipeline initialized with stealth systems');
  }

  async reviewDeploymentReadiness(options?: { passes?: number; strictConnectors?: boolean }): Promise<{
    generatedAt: string;
    requestedPasses: number;
    strictConnectors: boolean;
    passes: DeploymentReadinessPass[];
    stableClearPasses: number;
    finalStatus: 'ready' | 'ready_with_warnings' | 'blocked';
    recommendations: string[];
  }> {
    const requestedPasses = Math.max(1, Math.min(5, options?.passes ?? 2));
    const strictConnectors = options?.strictConnectors ?? this.isStrictConnectorMode();

    let pipelineInitializationError: string | undefined;
    try {
      await this.initialize();
    } catch (error) {
      pipelineInitializationError = error instanceof Error ? error.message : String(error);
      logger.warn('Master pipeline readiness review proceeding after initialization failure', {
        component: 'MasterPipeline',
        strictConnectors,
        error: pipelineInitializationError,
      });
    }

    const cryptara = getCryptara({
      enabled: true,
      surveillanceMode: 'scheduled',
      faucetTriggered: true,
      monteCarloInterval: 6,
    });

    let cryptaraInitializationError: string | undefined;
    try {
      await cryptara.initialize();
    } catch (error) {
      cryptaraInitializationError = error instanceof Error ? error.message : String(error);
      logger.warn('Cryptara readiness review proceeding after initialization failure', {
        component: 'MasterPipeline',
        error: cryptaraInitializationError,
      });
    }

    const passResults: DeploymentReadinessPass[] = [];

    let stableClearPasses = 0;
    const recommendationSet = new Set<string>();
    const strictLive = strictConnectors;

    for (let passNumber = 1; passNumber <= requestedPasses; passNumber++) {
      const [tvReadiness, alchemyReadiness, cryptaraReadiness] = await Promise.all([
        TradingViewEngine.checkReadiness({ strictLive }),
        alchemyIntegration.readinessCheck({ strictLive }),
        cryptara.validateLiveSignalReadiness({ strictLive }),
      ]);

      let sentiment: { overallSentiment: number; fearGreedIndex: number; dominantNarrative: string } | undefined;
      try {
        const result = await cryptara.analyzeSentiment();
        sentiment = {
          overallSentiment: result.overallSentiment,
          fearGreedIndex: result.fearGreedIndex,
          dominantNarrative: result.dominantNarrative,
        };
      } catch {
        sentiment = undefined;
      }

      let monteCarlo: { simulationId: string; optimalStrategy: string; maxDrawdown: number; valueAtRisk: number } | undefined;
      try {
        const result = await cryptara.runMonteCarloSimulation();
        monteCarlo = {
          simulationId: result.simulationId,
          optimalStrategy: result.optimalStrategy,
          maxDrawdown: result.riskMetrics.maxDrawdown,
          valueAtRisk: result.riskMetrics.valueAtRisk,
        };
      } catch {
        monteCarlo = undefined;
      }

      const directive = cryptara.getAutonomousDirective();
      const rpcReady = multiProviderRpcManager.getHealth('ethereum').some(observation => observation.http.success);
      const walletReady = this.hasLiveWalletSigner();
      const centralizedExchangeReady = this.hasCentralizedExchangeCredentials();
      const sharedExecution = getSharedExecutionCapabilities();
      const sharedExecutionEnv = assessSharedExecutionEnvironment();
      const liveExecutionEnabled = process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true';
      const liveExecutionConfirmed = process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK';

      const issues: Array<{ id: string; severity: 'warn' | 'block'; detail: string; remediation: string }> = [];

      if (pipelineInitializationError) {
        issues.push({
          id: 'pipeline-initialize',
          severity: 'block',
          detail: pipelineInitializationError,
          remediation: 'Resolve connector and execution readiness blockers, then rerun deployment review until initialization succeeds cleanly.',
        });
      }

      if (cryptaraInitializationError) {
        issues.push({
          id: 'cryptara-initialize',
          severity: 'block',
          detail: cryptaraInitializationError,
          remediation: 'Resolve live-signal readiness and strict-mode initialization blockers before enabling Cryptara governance or production surveillance.',
        });
      }

      if (!tvReadiness.ready) {
        issues.push({
          id: 'tradingview-live',
          severity: strictConnectors ? 'block' : 'warn',
          detail: tvReadiness.detail,
          remediation: 'Enable TradingView live analysis or keep simulation mode limited to non-production dry runs.',
        });
      }

      if (!alchemyReadiness.ready) {
        issues.push({
          id: 'alchemy-enhanced-telemetry',
          severity: 'warn',
          detail: alchemyReadiness.detail,
          remediation: 'Configure ALCHEMY_API_KEY if Alchemy-specific enhanced telemetry is required; shared RPC providers remain eligible.',
        });
      }

      if (!cryptaraReadiness.liveSignalReady) {
        issues.push({
          id: 'cryptara-live-stack',
          severity: strictConnectors ? 'block' : 'warn',
          detail: `Cryptara live signal stack degraded: ${cryptaraReadiness.tradingView.detail}; ${cryptaraReadiness.rpc.detail}`,
          remediation: 'Require live TradingView and at least one chain-verified shared RPC provider before production deployment.',
        });
      }

      if (!rpcReady) {
        issues.push({
          id: 'rpc-connector',
          severity: 'block',
          detail: 'No primary RPC URL is configured for realtime stream or execution.',
          remediation: 'Configure at least one chain-verified RPC provider before enabling production execution.',
        });
      }

      if (!walletReady) {
        issues.push({
          id: 'wallet-signer',
          severity: 'block',
          detail: 'WALLET_PRIVATE_KEY is not configured for transaction signing.',
          remediation: 'Set WALLET_PRIVATE_KEY in the deployment environment before enabling live execution.',
        });
      }

      if (!liveExecutionEnabled || !liveExecutionConfirmed) {
        issues.push({
          id: 'live-execution-switches',
          severity: 'block',
          detail: 'Live execution guard env vars are not fully enabled and confirmed.',
          remediation: 'Set CRYPTO_ARBITRAGE_LIVE_EXECUTION=true and CRYPTO_ARBITRAGE_LIVE_CONFIRMATION=I_ACCEPT_LIVE_ORDER_RISK only after validation passes cleanly.',
        });
      }

      if (sharedExecutionEnv.noExecutionGuardEnabled && sharedExecutionEnv.liveExecutionEnabled) {
        issues.push({
          id: 'execution-guard-conflict',
          severity: 'block',
          detail: 'NO_EXECUTION=true conflicts with CRYPTO_ARBITRAGE_LIVE_EXECUTION=true.',
          remediation: 'Disable NO_EXECUTION only after deployment review passes and live execution is explicitly intended.',
        });
      }

      if (sharedExecutionEnv.placeholderExecutionAllowed) {
        issues.push({
          id: 'placeholder-execution-enabled',
          severity: 'block',
          detail: 'CRYPTO_ALLOW_PLACEHOLDER_EXECUTION=true permits stub transaction payloads.',
          remediation: 'Set CRYPTO_ALLOW_PLACEHOLDER_EXECUTION=false for any environment that claims deployment readiness.',
        });
      }

      if (sharedExecutionEnv.liveExecutionEnabled && !strictConnectors) {
        issues.push({
          id: 'live-execution-without-strict-connectors',
          severity: 'block',
          detail: 'Live execution is enabled while strict live connector enforcement is disabled.',
          remediation: 'Require CRYPTO_REQUIRE_LIVE_CONNECTORS=true and CRYPTARA_REQUIRE_LIVE_SIGNALS=true before enabling live execution.',
        });
      }

      if (sharedExecutionEnv.liveExecutionEnabled && !sharedExecutionEnv.anyLiveRouteReady) {
        issues.push({
          id: 'no-live-execution-route',
          severity: 'block',
          detail: 'Live execution is enabled but no fully configured execution route is available.',
          remediation: 'Configure Kraken/OKX credentials for centralized execution and/or implement the on-chain payload builder plus signer/RPC path before enabling live execution.',
        });
      }

      if (!sharedExecution.structuredOnChainPayloadBuilder) {
        issues.push({
          id: 'onchain-payload-adapter',
          severity: 'block',
          detail: 'The shared on-chain executor cannot yet build structured swap payloads from execution plans.',
          remediation: 'Provide a structured on-chain payload builder before enabling live on-chain execution.',
        });
      }

      if (!sharedExecution.autonomousRoutePlanner) {
        issues.push({
          id: 'autonomous-route-planner',
          severity: 'block',
          detail: 'Cryptocrawl still lacks an autonomous route planner that converts market opportunities into structured on-chain execution plans.',
          remediation: 'Implement an opportunity-to-onchainPlan adapter that produces token addresses, amounts, and venue paths from validated arbitrage opportunities.',
        });
      }

      if (!sharedExecution.flashLoanReceiverSupport) {
        issues.push({
          id: 'flashloan-receiver-layer',
          severity: 'block',
          detail: 'Zero-capital execution still lacks a deployable flash-loan receiver contract integration.',
          remediation: 'Deploy and wire the flash-loan receiver contract plus callback encoding before enabling zero-capital live execution.',
        });
      }

      if (sharedExecutionEnv.zeroCapitalExecutionEnabled && !sharedExecutionEnv.zeroCapitalReceiverConfigured) {
        issues.push({
          id: 'flashloan-receiver-address',
          severity: 'block',
          detail: 'ZERO_CAPITAL_ENABLE_EXECUTION=true but ZERO_CAPITAL_FLASHLOAN_RECEIVER is not configured.',
          remediation: 'Deploy the flash-loan receiver contract and set ZERO_CAPITAL_FLASHLOAN_RECEIVER before enabling zero-capital live execution.',
        });
      }

      if (sharedExecutionEnv.zeroCapitalExecutionEnabled && !sharedExecutionEnv.flashbotsAuthConfigured) {
        issues.push({
          id: 'flashbots-auth',
          severity: 'block',
          detail: 'ZERO_CAPITAL_ENABLE_EXECUTION=true but no FLASHBOTS_AUTH_KEY or fallback execution signer is configured.',
          remediation: 'Set FLASHBOTS_AUTH_KEY for Ethereum bundle submission or at minimum provide WALLET_PRIVATE_KEY for zero-capital execution signing.',
        });
      }

      if (!centralizedExchangeReady) {
        issues.push({
          id: 'centralized-exchange-adapter',
          severity: 'warn',
          detail: 'No Kraken or OKX credential set is configured for centralized execution routes.',
          remediation: 'Configure Kraken or OKX API credentials if centralized venue routing is required; otherwise keep execution on the on-chain path only.',
        });
      }

      if (directive.maxSlippageBps > 35) {
        issues.push({
          id: 'slippage-guard',
          severity: 'warn',
          detail: `Autonomous directive currently allows max slippage ${directive.maxSlippageBps}bps.`,
          remediation: 'Tighten slippage via better liquidity selection, lower congestion windows, or more defensive notional scaling before production use.',
        });
      }

      if (!directive.preferredExecutionModes.includes('zero_capital')) {
        issues.push({
          id: 'zero-capital-path',
          severity: 'warn',
          detail: 'Zero-capital execution is not currently preferred by the autonomous directive.',
          remediation: 'Feed validated zero-capital execution outcomes back into Cryptara until the strategy qualifies as a preferred execution mode.',
        });
      }

      if (monteCarlo && monteCarlo.maxDrawdown > 0.2) {
        issues.push({
          id: 'monte-carlo-drawdown',
          severity: 'warn',
          detail: `Monte Carlo drawdown estimate is ${Math.round(monteCarlo.maxDrawdown * 100)}%.`,
          remediation: 'Reduce notional size or route aggressiveness until simulated drawdown is within deployment tolerances.',
        });
      }

      const status: 'pass' | 'warn' | 'fail' = issues.some(issue => issue.severity === 'block')
        ? 'fail'
        : issues.length > 0
          ? 'warn'
          : 'pass';

      if (status === 'pass') {
        stableClearPasses += 1;
      } else {
        stableClearPasses = 0;
      }

      for (const issue of issues) {
        recommendationSet.add(issue.remediation);
      }

      passResults.push({
        passNumber,
        status,
        issues,
        connectorReadiness: {
          networkHealth: { ...this.connectorReadiness.networkHealth },
          gasOracle: { ...this.connectorReadiness.gasOracle },
          tradingView: { ...this.connectorReadiness.tradingView },
          alchemy: { ...this.connectorReadiness.alchemy },
        },
        cryptara: {
          liveSignalReady: cryptaraReadiness.liveSignalReady,
          tradingView: { ...cryptaraReadiness.tradingView },
          alchemy: { ...cryptaraReadiness.alchemy },
          directive,
          ...(sentiment ? { sentiment } : {}),
          ...(monteCarlo ? { monteCarlo } : {}),
        },
        execution: {
          rpcReady,
          walletReady,
          centralizedExchangeReady,
          genericOnChainPayloadBuilder: sharedExecution.genericOnChainPayloadBuilder,
          structuredOnChainPayloadBuilder: sharedExecution.structuredOnChainPayloadBuilder,
          autonomousRoutePlanner: sharedExecution.autonomousRoutePlanner,
          flashLoanReceiverSupport: sharedExecution.flashLoanReceiverSupport,
          explicitPayloadRequired: sharedExecution.explicitPayloadRequired,
          liveExecutionEnabled,
          liveExecutionConfirmed,
        },
      });
    }

    const finalStatus: 'ready' | 'ready_with_warnings' | 'blocked' = stableClearPasses >= 2
      ? 'ready'
      : passResults.some(pass => pass.status === 'fail')
        ? 'blocked'
        : 'ready_with_warnings';

    return {
      generatedAt: new Date().toISOString(),
      requestedPasses,
      strictConnectors,
      passes: passResults,
      stableClearPasses,
      finalStatus,
      recommendations: Array.from(recommendationSet),
    };
  }

  /**
   * Start the main pipeline loop
   */
  async run(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.initialized) {
      throw new Error('Master Pipeline is not connector-ready. Run reviewDeploymentReadiness() and resolve blockers before starting live operations.');
    }

    this.running = true;
    logger.info('Master Pipeline started with advanced MEV systems', {
      component: 'MasterPipeline'
    });

    try {
      // Initialize realtime data stream
      this.realtimeStream = new RealtimeDataStream({
        chain: 'ethereum',
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
      if (process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true') {
        logger.warn('Master pipeline opportunity rejected: generic LuxSwarm execution is not authoritative', {
          component: 'MasterPipeline',
          opportunityId: opp.asset,
          chain: opp.chain,
          reason: 'live execution must use the canonical verified arbitrage plan path with measured economics',
        });
        return;
      }

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
      let gasEstimateError: string | undefined;
      try {
        const gp = await gasOracle.getGasPrice(opp.chain as any);
        gasGwei = gp.gweiPrice;
        estimatedGasUsd = gp.usdCost;
      } catch (error) {
        gasGwei = undefined;
        gasEstimateError = error instanceof Error ? error.message : String(error);
      }

      if (gasEstimateError) {
        logger.warn('Opportunity rejected before execution: gas estimate unavailable', {
          component: 'MasterPipeline',
          opportunityId: opp.asset,
          chain: opp.chain,
          error: gasEstimateError,
        });
        return;
      }

      const expectedSlippageBps = Math.max(
        5,
        Math.min(
          Math.min(risk.maxSlippageBps, directive.maxSlippageBps),
          8 + (mempool ? mempool.totalPending / 1000 : 0) * 3 + (technicalSignal ? Math.max(0, 60 - technicalSignal.summary.strength) / 8 : 0),
        ),
      );

      if (process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true' && !('settlement' in opp)) {
        logger.warn('Opportunity rejected before execution: measured settlement context is unavailable', {
          component: 'MasterPipeline',
          opportunityId: opp.asset,
          chain: opp.chain,
          reason: 'estimated slippage and fees cannot authorize a live generic opportunity',
        });
        return;
      }

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

      if (process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true' && !('onchainPlan' in opp)) {
        logger.warn('Opportunity rejected before execution: structured on-chain plan is unavailable', {
          component: 'MasterPipeline',
          opportunityId: opp.asset,
          chain: opp.chain,
          reason: 'generic LuxSwarm opportunities do not contain token-addressed route and settlement metadata',
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
            volatilityRegime: {
              gasPriceGwei: gasGwei,
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
            pair: opp.pair || opp.asset,
            profit: Math.max(tripleDipResult.netProfit, netExpectedProfitUsd),
            type: 'simple',
            expectedFeeUsd: feeUsd,
            expectedSlippageBps,
            usedZeroCapital: false,
            skipCryptaraFeedback: true,
          });
        }
      });

      const realizedEconomics = result.normalized?.realized;
      const realizedFeeUsd = realizedEconomics?.exchangeFeeUsd ?? realizedEconomics?.gasUsd;
      const hasMeasuredSettlementEconomics = result.success && result.settlementConfirmed === true &&
        Number.isFinite(result.profit) &&
        Number.isFinite(realizedFeeUsd) &&
        Number.isFinite(realizedEconomics?.slippageBps);

      if (hasMeasuredSettlementEconomics) {
        this.opportunitiesProcessed++;
        this.totalProfit += result.profit!;

          await recordCryptaraExecutionEvidence({
            source: 'master_pipeline',
            opportunityId: opp.asset,
            chain: String(opp.chain).toLowerCase(),
            symbol: marketSymbol,
            strategy: 'triple_dip_execute_with_max_profit',
            success: true,
            expectedProfitUsd: netExpectedProfitUsd,
            realizedProfitUsd: result.profit!,
            feeUsd: realizedFeeUsd!,
            slippageBps: realizedEconomics!.slippageBps!,
            latencyMs: chainLatencyMs || 0,
            usedZeroCapital: false,
            timestamp: Date.now(),
            settlementConfirmed: result.normalized?.settlementConfirmed,
            provenance: result.normalized?.provenance,
            settlement: result.normalized,
          }, gate);
        
        // Record outcome for RL learning
        this.rlBidder.recordOutcome(gasContext, optimalBid, true);
        this.scalePhysics.recordProfit(result.profit);

        logger.info('Opportunity executed successfully', {
          component: 'MasterPipeline',
          opportunityId: opp.asset,
          profit: result.profit,
          totalProfit: this.totalProfit,
          totalProcessed: this.opportunitiesProcessed
        });
      } else if (result.success || result.status === 'settlement_unknown' || result.status === 'submitted') {
        logger.info('Opportunity submitted or settled without complete economics; omitting outcome evidence', {
          component: 'MasterPipeline',
          opportunityId: opp.asset,
          transactionHash: result.txHash,
          status: result.status,
        });
        this.scalePhysics.recordProfit(null);
      } else {
        logger.info('Opportunity execution failed without a measured settlement; omitting outcome evidence', {
          component: 'MasterPipeline',
          opportunityId: opp.asset,
          status: result.status,
          error: result.error,
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
