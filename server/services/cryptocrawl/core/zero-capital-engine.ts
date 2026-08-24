/**
 * AUTONOMOUS ZERO-CAPITAL ARBITRAGE ENGINE
 * =========================================
 * 
 * CORE PHILOSOPHY: Capital-Free Autonomy
 * - System begins with ZERO initial capital
 * - ALL operations leverage meta-liquidity orchestration
 * - Gas, collateral, and trading exposure are temporarily sourced from:
 *   - Flash loans (Aave, Balancer, Uniswap - 0% to 0.09% fee)
 *   - Recursive yield mechanisms
 *   - Gas station networks (meta-transactions)
 * - Each action self-funds the next: PERPETUAL BOOTSTRAP LOOP
 * 
 * THE SECRET: Flash loans + MEV bundles allow us to:
 * 1. Borrow millions in a single transaction
 * 2. Execute arbitrage with borrowed funds
 * 3. Repay loan + fee from profits
 * 4. Keep remaining profit
 * 5. ALL IN ONE ATOMIC TRANSACTION - no upfront capital needed
 * 
 * GAS SOLUTION: Flashbots bundles pay miners from arbitrage profits
 * - Transaction 1: Flash loan borrow
 * - Transaction 2: Execute arbitrage
 * - Transaction 3: Repay flash loan
 * - Transaction 4: Pay miner bribe from profits
 * - If any step fails, ENTIRE bundle reverts - zero loss
 */

import { ethers, Wallet, providers, BigNumber } from 'ethers';
import { FlashbotsBundleProvider, FlashbotsBundleResolution, FlashbotsBundleTransaction, FlashbotsBundleRawTransaction } from '@flashbots/ethers-provider-bundle';
import logger from '../../../logger.js';
import { getCryptara } from '../../cryptara/index.js';
import { TradingViewEngine } from '../babel/tradingview-integration.js';
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { stageManager } from '../governance/stage-management.js';
import { buildFlashLoanExecutionPlanFromOpportunity } from '../execution/adapters/autonomous-route-planner.js';
import { buildFlashLoanReceiverPayloadFromPlan } from '../execution/adapters/flashloan-receiver-builder.js';
import {
  loadConfiguredZeroCapitalRoutes,
  quoteConfiguredZeroCapitalRoutesForChain,
  type ConfiguredZeroCapitalRoute,
  type QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import { EuropaZeroGasAdapter } from '../execution/adapters/europa-zero-gas-adapter.js';
import { PostgresStage4ExecutionLedger } from '../execution/adapters/stage4-execution-ledger.js';
import { PostgresStage4CapitalProvenanceStore } from '../execution/adapters/stage4-capital-provenance.js';
import { resolveEuropaExternalGasDifficulty } from '../execution/adapters/skale-pow-adapter.js';
import { buildEuropaSushiV3FlashPayload } from '../execution/adapters/europa-sushi-v3-flash-builder.js';
import { EUROPA_SUSHI } from '../execution/adapters/europa-sushi-registry.js';
import { discoverProfitableEuropaRoute } from '../execution/adapters/europa-dynamic-route-discovery.js';
import { CapitalHierarchyPlanner, type CapitalHierarchyPlan, type ChainFundingRequirement } from './capital-hierarchy.js';
import { computationalBeam } from '../../computationalBeam/index.js';
import { CrawlerStrategy, type ComputeWorkload } from '../../computationalBeam/types.js';
import type { GateEvaluation } from '../../cryptara/marketGates/types.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { calculateProgressivePositionSize, type PositionSizingDecision } from '../risk/progressive-position-sizing.js';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface ZeroCapitalOpportunity {
  id: string;
  type: 'arbitrage' | 'liquidation' | 'sandwich' | 'backrun';
  chain: SupportedChain;
  inputToken: string;
  outputToken: string;
  inputAssetSymbol: 'USDC' | 'USDT';
  inputTokenDecimals: number;
  flashLoanAmount: bigint;
  expectedProfit: bigint;
  gasEstimate: bigint;
  estimatedExecutionCostInInputToken: bigint;
  expectedSlippageBps: number;
  quoteLatencyMs: number;
  netProfitBps: number;
  route: SwapRoute[];
  confidence: number;
  timestamp: number;
  expiresAt: number;
}

export interface SwapRoute {
  protocol: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  expectedAmountOut: bigint;
  fee: number;
}

export interface ExecutionResult {
  success: boolean;
  txHash?: string;
  profit?: bigint;
  profitVerified?: boolean;
  gasUsed?: bigint;
  slippage?: number;
  error?: string;
  blockNumber?: number;
}

export interface SystemState {
  isRunning: boolean;
  totalProfit: bigint;
  totalTrades: number;
  successfulTrades: number;
  includedUnverifiedTrades: number;
  failedTrades: number;
  lastTradeTimestamp: number;
  currentOpportunities: number;
  gaslessTransactions: number;
}

export type SupportedChain = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'bsc' | 'avalanche' | 'europa';

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

// RPC Endpoints (fallback to public, should use Alchemy/Infura in production)
const RPC_ENDPOINTS: Record<SupportedChain, string> = {
  ethereum: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
  polygon: process.env.POLYGON_RPC_URL || 'https://polygon.llamarpc.com',
  arbitrum: process.env.ARBITRUM_RPC_URL || 'https://arbitrum.llamarpc.com',
  optimism: process.env.OPTIMISM_RPC_URL || 'https://optimism.llamarpc.com',
  bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
  avalanche: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
  europa: process.env.EUROPA_RPC_URL || 'https://mainnet.skalenodes.com/v1/europa',
};

const FLASH_LOAN_RECEIVER_EVENT_INTERFACE = new ethers.utils.Interface([
  'event FlashLoanExecuted(address indexed initiator, address indexed loanToken, uint256 loanAmount, uint256 profit)',
]);

// ============================================================================
// AUTONOMOUS ZERO-CAPITAL ENGINE
// ============================================================================

export class AutonomousZeroCapitalEngine {
  private providers: Map<SupportedChain, providers.JsonRpcProvider> = new Map();
  private flashbotsProvider: FlashbotsBundleProvider | null = null;
  private authSigner: Wallet | null = null;
  private executionWallets: Map<SupportedChain, Wallet> = new Map();
  private europaAdapter: EuropaZeroGasAdapter | null = null;
  private readonly capitalProvenance = new PostgresStage4CapitalProvenanceStore();
  private readonly capitalHierarchy = new CapitalHierarchyPlanner();
  private readonly capitalScope = process.env.ZERO_CAPITAL_CAPITAL_SCOPE?.trim() || 'cryptocrawler';
  private state: SystemState;
  private isScanning: boolean = false;
  private opportunityQueue: ZeroCapitalOpportunity[] = [];
  private configuredRoutes: ConfiguredZeroCapitalRoute[] = [];
  private scanInterval: NodeJS.Timeout | null = null;
  private executionInterval: NodeJS.Timeout | null = null;
  private scanDelayMs: number = Number(process.env.ZERO_CAPITAL_SCAN_MIN_MS || 2500);
  private readonly minScanDelayMs: number = Number(process.env.ZERO_CAPITAL_SCAN_MIN_MS || 2500);
  private readonly maxScanDelayMs: number = Number(process.env.ZERO_CAPITAL_SCAN_MAX_MS || 15000);
  private executionEnabled: boolean = false;
  private isExecuting: boolean = false;
  private lastLiveSignalCheckAt = 0;
  private liveSignalReady = false;
  private readonly cryptaraGateEvidence = new Map<string, GateEvaluation>();

  constructor() {
    this.state = {
      isRunning: false,
      totalProfit: BigInt(0),
      totalTrades: 0,
      successfulTrades: 0,
      includedUnverifiedTrades: 0,
      failedTrades: 0,
      lastTradeTimestamp: 0,
      currentOpportunities: 0,
      gaslessTransactions: 0,
    };

    logger.info('[ZeroCapitalEngine] Autonomous Zero-Capital Engine initialized', {
      component: 'ZeroCapitalEngine',
      philosophy: 'Capital-Free Autonomy',
      mechanism: 'Flash Loan + MEV Bundle = Zero Upfront Capital',
    });
  }

  /**
   * Initialize the engine - NO PRIVATE KEY REQUIRED FOR SCANNING
   * Private key only needed when executing (and even then, can use relayers)
   */
  async initialize(): Promise<void> {
    logger.info('[ZeroCapitalEngine] Initializing providers...', { component: 'ZeroCapitalEngine' });

    const configuredRoutes = loadConfiguredZeroCapitalRoutes();
    const nonEuropaRoutes = configuredRoutes.filter(route => route.chain !== 'europa');
    try {
      const dynamicEuropaRoute = await discoverProfitableEuropaRoute();
      this.configuredRoutes = dynamicEuropaRoute
        ? [...nonEuropaRoutes, dynamicEuropaRoute.route]
        : nonEuropaRoutes;
      if (dynamicEuropaRoute) {
        logger.info('[ZeroCapitalEngine] Dynamic profitable Europa route discovered', {
          component: 'ZeroCapitalEngine',
          route: dynamicEuropaRoute.route.id,
          netProfit: dynamicEuropaRoute.netProfit,
          quoteLatencyMs: dynamicEuropaRoute.quoteLatencyMs,
        });
      } else {
        logger.info('[ZeroCapitalEngine] No profitable Europa route discovered; configured Europa routes were discarded', {
          component: 'ZeroCapitalEngine',
        });
      }
    } catch (error) {
      this.configuredRoutes = nonEuropaRoutes;
      logger.warn('[ZeroCapitalEngine] Dynamic Europa route discovery failed; configured Europa routes were discarded', {
        component: 'ZeroCapitalEngine',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Initialize providers for each chain
    for (const [chain, rpcUrl] of Object.entries(RPC_ENDPOINTS)) {
      try {
        const provider = new providers.JsonRpcProvider(rpcUrl);
        await provider.getNetwork(); // Verify connection
        this.providers.set(chain as SupportedChain, provider);
        logger.info(`[ZeroCapitalEngine] Connected to ${chain}`, { component: 'ZeroCapitalEngine', chain });
      } catch (error) {
        logger.warn(`[ZeroCapitalEngine] Failed to connect to ${chain}`, { 
          component: 'ZeroCapitalEngine', 
          chain, 
          error: (error as Error).message 
        });
      }
    }

    const walletPrivateKey = process.env.WALLET_PRIVATE_KEY?.trim();
    if (walletPrivateKey) {
      for (const [chain, provider] of this.providers.entries()) {
        this.executionWallets.set(chain, new Wallet(walletPrivateKey, provider));
      }
      const europaWallet = this.executionWallets.get('europa');
      if (europaWallet) {
        this.europaAdapter = new EuropaZeroGasAdapter(
          europaWallet,
          new PostgresStage4ExecutionLedger(),
        );
      }
    }

    // Initialize Flashbots for Ethereum mainnet (gasless execution)
    const ethProvider = this.providers.get('ethereum');
    const flashbotsAuthKey = process.env.FLASHBOTS_AUTH_KEY?.trim() || walletPrivateKey;
    if (ethProvider && flashbotsAuthKey) {
      try {
        this.authSigner = new Wallet(flashbotsAuthKey);
        this.flashbotsProvider = await FlashbotsBundleProvider.create(
          ethProvider,
          this.authSigner,
          'https://relay.flashbots.net'
        );
        logger.info('[ZeroCapitalEngine] Flashbots provider initialized (gasless execution enabled)', {
          component: 'ZeroCapitalEngine',
        });
      } catch (error) {
        logger.warn('[ZeroCapitalEngine] Flashbots initialization failed, will use standard execution', {
          component: 'ZeroCapitalEngine',
          error: (error as Error).message,
        });
      }
    }

    logger.info('[ZeroCapitalEngine] Initialization complete', {
      component: 'ZeroCapitalEngine',
      connectedChains: this.providers.size,
      flashbotsEnabled: !!this.flashbotsProvider,
      configuredRoutes: this.configuredRoutes.length,
    });
  }

  /**
   * Start the autonomous scanning and execution loop
   * THIS IS WHERE THE MAGIC HAPPENS - ZERO CAPITAL REQUIRED
   */
  async start(): Promise<void> {
    if (this.state.isRunning) {
      logger.warn('[ZeroCapitalEngine] Engine already running', { component: 'ZeroCapitalEngine' });
      return;
    }

    if (this.providers.size === 0) {
      await this.initialize();
    }

    if (this.providers.size === 0) {
      throw new Error('No blockchain RPC providers are reachable; on-chain monitoring cannot start');
    }

    this.state.isRunning = true;
    const executionRequested = process.env.ZERO_CAPITAL_ENABLE_EXECUTION === 'true';
    const executionOptIn = executionRequested && stageManager.canExecuteTrades();
    const liveExecutionEnabled = process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true';
    const liveExecutionConfirmed = process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK';
    const zeroCapitalConfirmed = process.env.ZERO_CAPITAL_EXECUTION_CONFIRMATION === 'I_ACCEPT_ZERO_CAPITAL_EXECUTION_RISK';
    const europaRoutes = this.configuredRoutes.filter(route => route.chain === 'europa');
    const nonEuropaRoutes = this.configuredRoutes.filter(route => route.chain !== 'europa');
    let bootstrapExecutionEnabled = executionOptIn;

    if (executionRequested && !executionOptIn) {
      logger.info('[ZeroCapitalEngine] Execution request deferred because the current governance stage is monitoring-only', {
        component: 'ZeroCapitalEngine',
        stage: stageManager.getCurrentStage(),
        paused: stageManager.isPaused(),
      });
    }

    if (executionOptIn) {
      if (process.env.NO_EXECUTION === 'true') {
        throw new Error('ZERO_CAPITAL_ENABLE_EXECUTION=true conflicts with NO_EXECUTION=true');
      }
      if (!liveExecutionEnabled || !liveExecutionConfirmed || !zeroCapitalConfirmed) {
        throw new Error('Zero-capital execution requires both global live-execution confirmation and ZERO_CAPITAL_EXECUTION_CONFIRMATION');
      }
      if (!process.env.WALLET_PRIVATE_KEY?.trim()) {
        throw new Error('WALLET_PRIVATE_KEY is required for zero-capital execution');
      }
      if (this.configuredRoutes.length === 0) {
        throw new Error('No profitable Europa route was discovered from the live Sushi market; execution remains fail-closed');
      }
      if (europaRoutes.length > 0) {
        if (nonEuropaRoutes.length > 0) {
          throw new Error('Europa zero-monetary-gas bootstrap cannot be mixed with legacy externally sponsored routes in one execution configuration');
        }
        if (process.env.ZERO_CAPITAL_EUROPA_EXECUTION_CONFIRMATION !== 'I_ACCEPT_EUROPA_ZERO_GAS_EXECUTION_RISK') {
          throw new Error('Europa execution requires ZERO_CAPITAL_EUROPA_EXECUTION_CONFIRMATION=I_ACCEPT_EUROPA_ZERO_GAS_EXECUTION_RISK');
        }
        if (!this.europaAdapter) {
          throw new Error('Europa execution requires WALLET_PRIVATE_KEY and a reachable Europa RPC provider');
        }
        const europaReceiverKind = process.env.ZERO_CAPITAL_EUROPA_RECEIVER_KIND?.trim() || 'sushi-v3';
        const receiverInfrastructureReady = europaReceiverKind === 'sushi-v3'
          ? !process.env.ZERO_CAPITAL_EUROPA_SUSHI_V3_FACTORY?.trim() || process.env.ZERO_CAPITAL_EUROPA_SUSHI_V3_FACTORY.trim() === EUROPA_SUSHI.v3Factory
          : !!process.env.ZERO_CAPITAL_EUROPA_BALANCER_VAULT?.trim();
        if (!process.env.ZERO_CAPITAL_EUROPA_RECEIVER?.trim() || !process.env.ZERO_CAPITAL_EUROPA_RECEIVER_CODE_HASH?.trim() || !receiverInfrastructureReady) {
          throw new Error(europaReceiverKind === 'sushi-v3'
            ? 'Europa Sushi V3 execution requires ZERO_CAPITAL_EUROPA_RECEIVER and ZERO_CAPITAL_EUROPA_RECEIVER_CODE_HASH; the verified Sushi factory is built in'
            : 'Europa Balancer execution requires ZERO_CAPITAL_EUROPA_RECEIVER, ZERO_CAPITAL_EUROPA_RECEIVER_CODE_HASH, and ZERO_CAPITAL_EUROPA_BALANCER_VAULT');
        }
        await resolveEuropaExternalGasDifficulty(this.providers.get('europa')!);
        const capitalState = await this.capitalProvenance.getOrCreate(this.capitalScope);
        if (capitalState.lifecycle === 'ATOMIC_EXECUTION_PENDING' || capitalState.lifecycle === 'FIRST_PROFIT_VERIFIED') {
          throw new Error(`Europa bootstrap recovery is blocked while capital provenance is ${capitalState.lifecycle}; reconcile the recorded transaction before starting another execution`);
        }
        if (capitalState.lifecycle === 'SELF_FUNDED' && BigInt(capitalState.internallyGeneratedBalance) > 0n) {
          bootstrapExecutionEnabled = false;
          logger.info('[ZeroCapitalEngine] Europa bootstrap is dormant because verified internally generated capital is available', {
            component: 'ZeroCapitalEngine',
            generation: capitalState.generation,
            asset: capitalState.asset,
          });
        } else {
          if (capitalState.lifecycle === 'SELF_FUNDED') {
            if (process.env.ZERO_CAPITAL_RECOVERY_CONFIRMATION !== 'I_CONFIRM_GLOBAL_INTERNAL_CAPITAL_EXHAUSTED') {
              throw new Error('Capital provenance shows SELF_FUNDED with no recorded balance; global capital exhaustion must be explicitly reconciled before bootstrap recovery');
            }
            await this.capitalProvenance.markRecoveryRequired(this.capitalScope);
          }
          await this.capitalProvenance.markZeroGasExecutionReady(this.capitalScope);
        }
        await this.europaAdapter.checkReadiness();
        this.liveSignalReady = true;
        this.lastLiveSignalCheckAt = Date.now();
      } else {
        const receiverAddress = String(process.env.ZERO_CAPITAL_FLASHLOAN_RECEIVER || '').trim();
        if (!/^0x[a-fA-F0-9]{40}$/.test(receiverAddress)) {
          throw new Error('ZERO_CAPITAL_FLASHLOAN_RECEIVER must be a deployed EVM receiver address before execution is enabled');
        }
        if (process.env.ZERO_CAPITAL_ALLOW_LEGACY_EXTERNAL_SPONSOR !== 'true') {
          throw new Error('Non-Europa zero-capital execution is disabled by default because it depends on an external gas sponsor; configure a verified Europa route instead');
        }
        if (!this.configuredRoutes.some(route => route.chain === 'ethereum')) {
          throw new Error('Legacy external-sponsor execution requires an Ethereum Flashbots route');
        }
        if (!this.flashbotsProvider || !this.executionWallets.get('ethereum')) {
          throw new Error('Legacy external-sponsor execution requires Ethereum RPC, FLASHBOTS_AUTH_KEY or WALLET_PRIVATE_KEY, and a usable Flashbots provider');
        }
        const paymentMode = process.env.ZERO_CAPITAL_FLASHBOTS_PAYMENT_MODE?.trim();
        const sponsorAddress = process.env.ZERO_CAPITAL_FLASHBOTS_SPONSOR_ADDRESS?.trim();
        const sponsorConfirmation = process.env.ZERO_CAPITAL_FLASHBOTS_SPONSOR_CONFIRMATION?.trim();
        const executionWallet = this.executionWallets.get('ethereum')!;
        if (paymentMode !== 'external_sponsor' || !/^0x[a-fA-F0-9]{40}$/.test(sponsorAddress || '') || executionWallet.address.toLowerCase() !== sponsorAddress!.toLowerCase() || sponsorConfirmation !== 'I_CONFIRM_EXTERNAL_FLASHBOTS_GAS_SPONSOR') {
          throw new Error('Legacy external-sponsor execution requires the explicitly configured and confirmed Flashbots sponsor');
        }
        const cryptara = getCryptara();
        if (!cryptara.getStatus().isRunning) await cryptara.initialize();
        const readiness = await cryptara.validateLiveSignalReadiness({ strictLive: true });
        if (!readiness.liveSignalReady) {
          throw new Error(`Legacy execution requires live TradingView and Alchemy signals: ${readiness.tradingView.detail}; ${readiness.alchemy.detail}`);
        }
        await alchemyIntegration.start(['ethereum']);
        if (!alchemyIntegration.isReady()) throw new Error('Legacy execution requires active Alchemy mempool monitoring on Ethereum');
        this.liveSignalReady = true;
        this.lastLiveSignalCheckAt = Date.now();
      }
    }

    this.executionEnabled = bootstrapExecutionEnabled;

    logger.info('[ZeroCapitalEngine] Starting read-only on-chain monitoring...', {
      component: 'ZeroCapitalEngine',
      mode: this.executionEnabled ? 'LIVE_EXECUTION_GATED' : 'MONITORING_ONLY',
      connectedChains: this.providers.size,
      executionEnabled: this.executionEnabled,
    });

    this.startScanningLoop();

    if (this.executionEnabled) {
      logger.info('[ZeroCapitalEngine] Execution mode enabled for zero-capital arbitrage', {
        component: 'ZeroCapitalEngine',
      });
      this.startExecutionLoop();
    } else {
      logger.info('[ZeroCapitalEngine] Execution loop disabled; monitoring mode only', {
        component: 'ZeroCapitalEngine',
        reason: executionRequested && !executionOptIn
          ? 'Current governance stage does not permit trade execution'
          : executionOptIn
            ? 'Verified internally generated capital is available; zero-capital bootstrap is dormant'
            : 'Set ZERO_CAPITAL_ENABLE_EXECUTION=true only after Europa bootstrap prerequisites are verified',
      });
    }
  }

  /**
   * Scanning Loop: Continuously discover zero-capital opportunities
   */
  private startScanningLoop(): void {
    if (this.scanInterval) {
      clearTimeout(this.scanInterval);
      this.scanInterval = null;
    }

    const scheduleNext = (delayMs: number): void => {
      if (!this.state.isRunning) return;
      this.scanInterval = setTimeout(() => {
        void scanCycle();
      }, delayMs);
    };

    const computeNextDelay = (hasErrors: boolean, opportunityCount: number): number => {
      if (hasErrors) {
        return Math.min(this.maxScanDelayMs, Math.floor(this.scanDelayMs * 1.5));
      }

      if (opportunityCount > 0) {
        return this.minScanDelayMs;
      }

      return Math.min(this.maxScanDelayMs, Math.floor(this.scanDelayMs * 1.2));
    };

    const scanCycle = async () => {
      if (!this.state.isRunning) return;
      if (this.isScanning) {
        scheduleNext(this.scanDelayMs);
        return;
      }

      this.isScanning = true;
      let hasErrors = false;
      let viableCount = 0;
      
      try {
        // Scan all connected chains in parallel
        const scanPromises = Array.from(this.providers.entries()).map(
          ([chain, provider]) => this.scanChainForOpportunities(chain as SupportedChain, provider)
        );

        const results = await Promise.allSettled(scanPromises);
        
        // Collect all opportunities
        const newOpportunities: ZeroCapitalOpportunity[] = [];
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            newOpportunities.push(...result.value);
          } else if (result.status === 'rejected') {
            hasErrors = true;
          }
        }

        // Filter and sort by profit potential
        const viableOpportunities = newOpportunities
          .filter(opp => opp.expectedProfit > 0n)
          .sort((a, b) => Number(b.expectedProfit - a.expectedProfit));

        // Update queue
        this.opportunityQueue = viableOpportunities;
        this.state.currentOpportunities = viableOpportunities.length;
        viableCount = viableOpportunities.length;

        if (viableOpportunities.length > 0) {
          logger.info('[ZeroCapitalEngine] Opportunities discovered', {
            component: 'ZeroCapitalEngine',
            count: viableOpportunities.length,
            topProfit: ethers.utils.formatUnits(
              (viableOpportunities[0]?.expectedProfit || 0).toString(),
              viableOpportunities[0]?.inputTokenDecimals || 6,
            ),
          });
        }

      } catch (error) {
        hasErrors = true;
        logger.error('[ZeroCapitalEngine] Scanning error', {
          component: 'ZeroCapitalEngine',
          error: (error as Error).message,
        });
      } finally {
        this.isScanning = false;
        this.scanDelayMs = computeNextDelay(hasErrors, viableCount);
        scheduleNext(this.scanDelayMs);
      }
    };

    // Adaptive schedule prevents hammering when APIs/chains are degraded.
    void scanCycle();
  }

  private toUsdEstimate(value: bigint | undefined, decimals: number): number {
    if (!value) return 0;
    const normalized = Number(ethers.utils.formatUnits(value.toString(), decimals));
    return Number.isFinite(normalized) ? Math.max(0, normalized) : 0;
  }

  private async recordCryptaraExecutionFeedback(opportunity: ZeroCapitalOpportunity, result: ExecutionResult): Promise<void> {
    try {
      const cryptara = getCryptara();
      if (!cryptara.getStatus().isRunning) return;

      await recordCryptaraExecutionEvidence({
        source: 'zero_capital',
        opportunityId: opportunity.id,
        chain: opportunity.chain,
        symbol: `${opportunity.inputToken}/${opportunity.outputToken}`,
        strategy: opportunity.type,
        success: result.success && result.profitVerified === true,
        expectedProfitUsd: this.toUsdEstimate(opportunity.expectedProfit, opportunity.inputTokenDecimals),
        realizedProfitUsd: this.toUsdEstimate(result.profit, opportunity.inputTokenDecimals),
        feeUsd: this.toUsdEstimate(opportunity.estimatedExecutionCostInInputToken, opportunity.inputTokenDecimals),
        slippageBps: typeof result.slippage === 'number' ? Math.max(0, Math.round(result.slippage * 10000)) : 0,
        latencyMs: 0,
        usedZeroCapital: true,
        timestamp: Date.now(),
        notes: result.error,
      }, this.cryptaraGateEvidence.get(opportunity.id));
    } catch {
      // Cryptara feedback is best-effort only.
    } finally {
      this.cryptaraGateEvidence.delete(opportunity.id);
    }
  }

  /**
   * Execution Loop: Execute profitable opportunities with ZERO upfront capital
   */
  private startExecutionLoop(): void {
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
      this.executionInterval = null;
    }

    const executionCycle = async () => {
      if (!this.state.isRunning || this.isExecuting) return;

      // Get best opportunity
      const opportunity = this.opportunityQueue.shift();
      if (!opportunity) return;

      // Verify opportunity is still valid
      if (Date.now() > opportunity.expiresAt) {
        logger.debug('[ZeroCapitalEngine] Opportunity expired', {
          component: 'ZeroCapitalEngine',
          id: opportunity.id,
        });
        return;
      }

      this.isExecuting = true;
      let result: ExecutionResult;
      try {
        result = await this.executeZeroCapitalArbitrage(opportunity);
      } catch (error) {
        result = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        this.isExecuting = false;
      }

      await this.recordCryptaraExecutionFeedback(opportunity, result);

      // Update state
      this.state.totalTrades++;
      if (result.success && result.profitVerified) {
        this.state.successfulTrades++;
        if (result.profit) {
          this.state.totalProfit += result.profit;
        }
        this.state.lastTradeTimestamp = Date.now();
        
        logger.info('[ZeroCapitalEngine] ✅ PROFIT CAPTURED', {
          component: 'ZeroCapitalEngine',
          profit: result.profitVerified
            ? ethers.utils.formatUnits((result.profit || 0).toString(), opportunity.inputTokenDecimals)
            : 'unverified',
          txHash: result.txHash,
          gasUsed: result.gasUsed?.toString(),
          capitalUsed: 'ZERO',
        });
      } else if (result.success) {
        this.state.includedUnverifiedTrades++;
        getCryptocrawlGovernance().pause('system', 'zero_capital_profit_unverified');
        logger.warn('[ZeroCapitalEngine] Bundle inclusion observed but profit is not receiver-verified', {
          component: 'ZeroCapitalEngine',
          txHash: result.txHash,
          capitalUsed: 'ZERO',
        });
      } else {
        this.state.failedTrades++;
        logger.warn('[ZeroCapitalEngine] Trade failed (no loss - atomic revert)', {
          component: 'ZeroCapitalEngine',
          error: result.error,
          capitalLost: 'ZERO',
        });
      }
    };

    // Check for execution opportunities every 500ms, without overlapping submissions.
    this.executionInterval = setInterval(() => {
      void executionCycle();
    }, 500);
  }

  /**
   * Scan a specific chain for arbitrage opportunities
   */
  private async scanChainForOpportunities(
    chain: SupportedChain,
    provider: providers.JsonRpcProvider
  ): Promise<ZeroCapitalOpportunity[]> {
    const opportunities: ZeroCapitalOpportunity[] = [];

    if (this.executionEnabled && chain !== 'ethereum' && chain !== 'europa') {
      return opportunities;
    }

    try {
      if (this.executionEnabled && chain !== 'europa') {
        await this.ensureLiveSignalReadiness();
      }

      // Get current block for timestamp
      const block = await provider.getBlock('latest');
      
      const quotedRoutes = await quoteConfiguredZeroCapitalRoutesForChain(
        chain,
        provider,
        this.configuredRoutes,
      );

      for (const quotedRoute of quotedRoutes) {
        const opportunity = this.createOpportunityFromQuotedRoute(quotedRoute, block.timestamp);
        if (!this.executionEnabled || await this.isCandidateAllowedByCryptara(opportunity, provider)) {
          opportunities.push(opportunity);
        }
      }

    } catch (error) {
      logger.debug('[ZeroCapitalEngine] Chain scan error', {
        component: 'ZeroCapitalEngine',
        chain,
        error: (error as Error).message,
      });
    }

    return opportunities;
  }

  private createOpportunityFromQuotedRoute(
    quotedRoute: QuotedZeroCapitalRoute,
    blockTimestamp: number,
  ): ZeroCapitalOpportunity {
    const routeTtlMs = Math.max(1000, Number(process.env.ZERO_CAPITAL_ROUTE_TTL_MS || 3000));
    const estimatedExecutionCost =
      quotedRoute.estimatedGasCostInInputToken +
      quotedRoute.flashLoanFeeInInputToken +
      quotedRoute.relayFeeInInputToken;

    return {
      id: `${quotedRoute.id}-${blockTimestamp}-${Date.now()}`,
      type: 'arbitrage',
      chain: quotedRoute.chain,
      inputToken: quotedRoute.inputToken,
      outputToken: quotedRoute.inputToken,
      inputAssetSymbol: quotedRoute.inputAssetSymbol,
      inputTokenDecimals: quotedRoute.inputTokenDecimals,
      flashLoanAmount: quotedRoute.amountIn,
      expectedProfit: quotedRoute.netProfit,
      gasEstimate: 0n,
      estimatedExecutionCostInInputToken: estimatedExecutionCost,
      expectedSlippageBps: this.getExpectedSlippageBps(quotedRoute.route.length),
      quoteLatencyMs: quotedRoute.quoteLatencyMs,
      netProfitBps: quotedRoute.netProfitBps,
      route: quotedRoute.route.map(step => ({
        protocol: step.protocol,
        tokenIn: step.tokenIn,
        tokenOut: step.tokenOut,
        amountIn: BigInt(String(step.amountIn)),
        expectedAmountOut: BigInt(String(step.expectedAmountOut)),
        fee: step.fee,
      })),
      confidence: Math.min(0.99, 0.55 + Math.min(0.44, quotedRoute.netProfitBps / 1000)),
      timestamp: Date.now(),
      expiresAt: Date.now() + routeTtlMs,
    };
  }

  private getExpectedSlippageBps(routeLegCount: number): number {
    const minOutputBps = Math.max(
      9000,
      Math.min(10000, Number(process.env.ZERO_CAPITAL_ROUTE_MIN_OUTPUT_BPS || 9990)),
    );
    return Math.max(0, routeLegCount * (10000 - minOutputBps));
  }

  private async ensureLiveSignalReadiness(): Promise<void> {
    const recheckMs = Math.max(5000, Number(process.env.ZERO_CAPITAL_SIGNAL_RECHECK_MS || 5000));
    if (this.liveSignalReady && Date.now() - this.lastLiveSignalCheckAt < recheckMs) {
      return;
    }

    const cryptara = getCryptara();
    const readiness = await cryptara.validateLiveSignalReadiness({ strictLive: true });
    this.liveSignalReady = readiness.liveSignalReady && alchemyIntegration.isReady();
    this.lastLiveSignalCheckAt = Date.now();
    if (!this.liveSignalReady) {
      throw new Error(`Live signal stack degraded: ${readiness.tradingView.detail}; ${readiness.alchemy.detail}`);
    }
  }

  private async isCandidateAllowedByCryptara(
    opportunity: ZeroCapitalOpportunity,
    provider: providers.JsonRpcProvider,
  ): Promise<boolean> {
    const cryptara = getCryptara();
    const directive = cryptara.getAutonomousDirective();
    const isEuropa = opportunity.chain === 'europa';
    const pair = `${opportunity.inputAssetSymbol}/CYCLIC`;
    const maxSlippageBps = Math.max(
      1,
      Math.min(directive.maxSlippageBps, Number(process.env.ZERO_CAPITAL_MAX_SLIPPAGE_BPS || 20)),
    );
    const maxGasGwei = Math.max(1, Number(process.env.ZERO_CAPITAL_MAX_GAS_GWEI || 60));

    if (!directive.preferredExecutionModes.includes('zero_capital')) {
      return false;
    }
    if (directive.riskBudget === 'defensive' && !directive.preferredChains.includes(opportunity.chain)) {
      return false;
    }
    if (opportunity.expectedSlippageBps > maxSlippageBps) {
      return false;
    }
    if (this.toUsdEstimate(opportunity.expectedProfit, opportunity.inputTokenDecimals) < directive.minimumNetProfitUsd) {
      return false;
    }

    const [analysis, feeData] = await Promise.all([
      TradingViewEngine.getAnalysis(process.env.ZERO_CAPITAL_SIGNAL_SYMBOL || 'ETHUSDT', '1h'),
      provider.getFeeData(),
    ]);
    if (TradingViewEngine.getHealthStatus().mode !== 'live') {
      return false;
    }
    const gasGwei = Number(ethers.utils.formatUnits(feeData.maxFeePerGas || feeData.gasPrice || 0, 'gwei'));
    if (!Number.isFinite(gasGwei) || gasGwei <= 0 || gasGwei > maxGasGwei) {
      return false;
    }

    let mempoolActivity = 0;
    let networkCongestion = 0;
    if (isEuropa) {
      if (!this.europaAdapter) return false;
      const europaHealth = await this.europaAdapter.checkReadiness();
      if (!europaHealth.some(check => check.healthy)) return false;
    } else {
      const mempool = alchemyIntegration.getMempoolAnalysis();
      const alchemyReadiness = await alchemyIntegration.readinessCheck({ strictLive: true, network: 'ethereum' });
      if (!alchemyReadiness.ready || !alchemyIntegration.isReady()) {
        return false;
      }
      mempoolActivity = mempool.totalPending;
      networkCongestion = Math.min(1, mempool.totalPending / 8000);
    }
    const gate = cryptara.evaluateMarketGates({
      chain: opportunity.chain,
      pairOrSymbol: pair,
      venue: isEuropa ? 'europa' : 'flashbots',
      expectedProfitUsd: this.toUsdEstimate(opportunity.expectedProfit, opportunity.inputTokenDecimals),
      volatilityRegime: {
        liquidityScore: Math.max(0.1, analysis.summary.strength / 100),
        recentPriceMovement: Math.abs(TradingViewEngine.signalToScore(analysis.summary.signal)) / 100,
        gasPriceGwei: gasGwei,
        mempoolActivity,
        networkCongestion,
      },
      venueLatency: {
        p50Ms: { route_quote: opportunity.quoteLatencyMs },
        maxP50Ms: Math.max(100, Number(process.env.ZERO_CAPITAL_MAX_QUOTE_LATENCY_MS || 1000)),
      },
      feesRebates: { takerFeeBps: 0 },
      crossVenueFees: {
        buyVenue: 'route_quote',
        sellVenue: isEuropa ? 'europa' : 'flashbots',
        buyTakerFeeBps: 0,
        sellTakerFeeBps: 0,
        grossSpreadBps: opportunity.netProfitBps,
      },
      drawdownCaps: { drawdownPct: 0, maxDrawdownPct: 5 },
      profitReinvestment: {
        realizedProfitUsd: this.toUsdEstimate(this.state.totalProfit, 6),
        requestedNotionalUsd: 0,
        reinvestFraction: 1,
      },
      slippage: {
        expectedSlippageBps: opportunity.expectedSlippageBps,
        maxSlippageBps,
      },
    }, {
      blockOnUnknownCritical: true,
      criticalSignals: ['volatilityRegime', 'venueLatency', 'slippage', 'drawdownCaps', 'feesRebates', 'crossVenueFees'],
    });

    if (gate.actions.requestAutoPause) {
      getCryptocrawlGovernance().pause('system', gate.actions.autoPauseReason || 'zero_capital_cryptara_gate');
    }

    if (gate.decision === 'ALLOW') {
      this.cryptaraGateEvidence.set(opportunity.id, gate);
    }
    return gate.decision === 'ALLOW';
  }

  /**
   * Execute arbitrage with ZERO upfront capital using flash loans
   * THIS IS THE CORE ZERO-CAPITAL MECHANISM
   */
  private async executeZeroCapitalArbitrage(
    opportunity: ZeroCapitalOpportunity
  ): Promise<ExecutionResult> {
    const capitalPlan = await this.assessCapitalHierarchy(opportunity);
    const chainSnapshot = capitalPlan.chains.find(chain => chain.chain === opportunity.chain);
    const positionSizing = calculateProgressivePositionSize({
      requestedNotionalUsd: this.toUsdEstimate(opportunity.flashLoanAmount, opportunity.inputTokenDecimals),
      availableCapitalUsd: capitalPlan.source === 'wallet' && chainSnapshot
        ? this.toUsdEstimate(chainSnapshot.assetBalance, opportunity.inputTokenDecimals)
        : 0,
      expectedNetProfitUsd: this.toUsdEstimate(opportunity.expectedProfit, opportunity.inputTokenDecimals),
      expectedCostUsd: this.toUsdEstimate(opportunity.estimatedExecutionCostInInputToken, opportunity.inputTokenDecimals),
      expectedSlippageBps: opportunity.expectedSlippageBps,
      liquidityScore: opportunity.confidence,
      volatilityScore: Math.min(1, opportunity.expectedSlippageBps / 100),
      providerHealthy: this.providers.has(opportunity.chain),
      zeroCapitalAvailable: capitalPlan.source === 'europa-zero-capital' || capitalPlan.source === 'flashbots-zero-capital',
    });
    if (!positionSizing.approved) {
      return { success: false, error: `Progressive position sizing deferred execution: ${positionSizing.reasons.join('; ')}` };
    }
    const beamValidation = await this.validateCapitalPlanThroughBeam(capitalPlan, opportunity, positionSizing);
    if (!beamValidation.approved) {
      return { success: false, error: `Beam rejected capital plan: ${beamValidation.reason}` };
    }

    const governance = getCryptocrawlGovernance();
    const pair = `${opportunity.inputAssetSymbol}/CYCLIC`;
    const venue = opportunity.chain === 'europa' ? 'europa' : 'flashbots';
    governance.requireAllowed('EXECUTE_OPPORTUNITY', { chain: opportunity.chain, pair, venue });
    governance.requireAllowed('SUBMIT_TX', { chain: opportunity.chain, pair, venue });
    governance.recordExecutionAttempt();

    if (capitalPlan.source === 'wallet') {
      return {
        success: false,
        error: 'Wallet capital is sufficient, but this Zero Capital route has no verified wallet-funded execution adapter; opportunity deferred without invoking a more complex capital mechanism',
      };
    }

    if (capitalPlan.source === 'europa-zero-capital') {
      return this.executeWithEuropa(opportunity);
    }

    if (capitalPlan.source !== 'flashbots-zero-capital' || opportunity.chain !== 'ethereum') {
      return {
        success: false,
        error: `Capital hierarchy deferred ${opportunity.chain}: ${capitalPlan.reasons.join('; ')}`,
      };
    }

    if (!this.flashbotsProvider || !this.authSigner) {
      return {
        success: false,
        error: 'True zero-capital execution requires an initialized Flashbots provider and auth signer',
      };
    }

    return this.executeWithFlashbots(opportunity);
  }

  private async assessCapitalHierarchy(opportunity: ZeroCapitalOpportunity): Promise<CapitalHierarchyPlan> {
    const provider = this.providers.get(opportunity.chain);
    const gasPrice = provider
      ? (await provider.getFeeData()).maxFeePerGas || (await provider.getFeeData()).gasPrice || BigNumber.from(0)
      : BigNumber.from(0);
    const conservativeGasLimit = BigInt(Math.max(21_000, Number(process.env.ZERO_CAPITAL_WALLET_GAS_LIMIT || 500_000)));
    const gasRequirement = opportunity.gasEstimate > 0n
      ? opportunity.gasEstimate
      : BigInt(gasPrice.toString()) * conservativeGasLimit;
    const reserveBps = Math.max(0, Math.min(10_000, Number(process.env.ZERO_CAPITAL_WALLET_ASSET_RESERVE_BPS || 1_000)));
    const assetRequired = opportunity.flashLoanAmount + opportunity.estimatedExecutionCostInInputToken;
    const assetSafetyReserve = assetRequired * BigInt(reserveBps) / 10_000n;
    const requirements: ChainFundingRequirement[] = [{
      chain: opportunity.chain,
      assetToken: opportunity.inputToken,
      assetRequired,
      nativeGasRequired: gasRequirement,
      bridgeNativeRequired: 0n,
      destinationNativeRequired: 0n,
      nativeSafetyReserve: gasRequirement,
      assetSafetyReserve,
    }];
    const europaEligible = opportunity.chain === 'europa' &&
      !!this.europaAdapter &&
      !!process.env.ZERO_CAPITAL_EUROPA_RECEIVER?.trim() &&
      !!process.env.ZERO_CAPITAL_EUROPA_RECEIVER_CODE_HASH?.trim();
    const flashbotsEligible = opportunity.chain === 'ethereum' && !!this.flashbotsProvider && !!this.executionWallets.get('ethereum');

    return this.capitalHierarchy.assess({
      walletAddress: this.executionWallets.get(opportunity.chain)?.address,
      providers: this.providers,
      requirements,
      alternatives: {
        europaEligible,
        flashbotsEligible,
        europaReason: europaEligible ? undefined : 'Europa zero-capital prerequisites are unavailable for this route',
        flashbotsReason: flashbotsEligible ? undefined : 'Flashbots zero-capital prerequisites are unavailable for this route',
      },
    });
  }

  private async validateCapitalPlanThroughBeam(
    plan: CapitalHierarchyPlan,
    opportunity: ZeroCapitalOpportunity,
    positionSizing: PositionSizingDecision,
  ): Promise<{ approved: boolean; reason: string }> {
    if (!computationalBeam.isOperational()) {
      await computationalBeam.initialize();
    }
    const workload: ComputeWorkload<{ plan: CapitalHierarchyPlan; opportunityId: string; positionSizing: PositionSizingDecision }, { approved: boolean; reason: string }> = {
      id: `capital-hierarchy:${opportunity.id}`,
      type: 'CAPITAL_HIERARCHY_VALIDATION',
      input: { plan, opportunityId: opportunity.id, positionSizing },
      timeoutMs: Math.max(1_000, Number(process.env.ZERO_CAPITAL_BEAM_VALIDATION_TIMEOUT_MS || 10_000)),
      execute: ({ plan: candidatePlan, positionSizing: candidateSizing }) => {
        if (candidatePlan.source === 'defer') {
          return { approved: false, reason: candidatePlan.reasons.join('; ') || 'No complete capital path is available' };
        }
        if (candidatePlan.source === 'wallet' && !candidatePlan.walletSufficient) {
          return { approved: false, reason: 'Wallet path selected without complete lifecycle funding' };
        }
        if (!candidateSizing.approved || candidateSizing.proposedNotionalUsd <= 0) {
          return { approved: false, reason: 'Position sizing did not authorize an executable exposure' };
        }
        return { approved: true, reason: `Beam validated ${candidatePlan.source} capital path` };
      },
      validate: result => typeof result.approved === 'boolean' && typeof result.reason === 'string',
    };
    const execution = await computationalBeam.executeCrawlerTask(
      CrawlerStrategy.ARBITRAGE,
      { opportunityId: opportunity.id, capitalSource: plan.source, proposedNotionalUsd: positionSizing.proposedNotionalUsd },
      { timeout: workload.timeoutMs, workload },
    );
    return execution.result as { approved: boolean; reason: string };
  }

  private async executeWithEuropa(opportunity: ZeroCapitalOpportunity): Promise<ExecutionResult> {
    const adapter = this.europaAdapter;
    const executionWallet = this.executionWallets.get('europa');
    if (!adapter || !executionWallet) {
      return { success: false, error: 'Europa adapter is not initialized with a trusted signer' };
    }

    const receiver = process.env.ZERO_CAPITAL_EUROPA_RECEIVER?.trim() || '';
    const receiverCodeHash = process.env.ZERO_CAPITAL_EUROPA_RECEIVER_CODE_HASH?.trim() || '';
    const balancerVault = process.env.ZERO_CAPITAL_EUROPA_BALANCER_VAULT?.trim() || '';
    const configuredReceiverKind = process.env.ZERO_CAPITAL_EUROPA_RECEIVER_KIND?.trim();
    const receiverKind: 'sushi-v3' | 'balancer' = configuredReceiverKind === 'balancer' ? 'balancer' : 'sushi-v3';
    const profitRecipient = process.env.ZERO_CAPITAL_EUROPA_PROFIT_RECIPIENT?.trim() || executionWallet.address;
    if (profitRecipient.toLowerCase() !== executionWallet.address.toLowerCase()) {
      return { success: false, error: 'Europa bootstrap profit recipient must be the trusted executor wallet to preserve capital provenance' };
    }

    try {
      const capitalState = await this.capitalProvenance.getOrCreate(this.capitalScope);
      if (capitalState.lifecycle !== 'ZERO_GAS_EXECUTION_READY') {
        return { success: false, error: `Europa bootstrap is not ready in capital lifecycle state ${capitalState.lifecycle}` };
      }
      await this.capitalProvenance.markAtomicExecutionPending(this.capitalScope, `opportunity:${opportunity.id}`);
      const payload = receiverKind === 'sushi-v3'
        ? await buildEuropaSushiV3FlashPayload({
          receiver,
          flashPool: EUROPA_SUSHI.pools.usdcSkl,
          flashToken: EUROPA_SUSHI.tokens.usdc,
          flashAmount: opportunity.flashLoanAmount.toString(),
          legs: opportunity.route.map(step => ({
            tokenIn: step.tokenIn,
            tokenOut: step.tokenOut,
            amountIn: step.amountIn.toString(),
            pool: undefined,
          })),
          minProfit: opportunity.expectedProfit.toString(),
          profitRecipient,
        })
        : buildFlashLoanReceiverPayloadFromPlan(buildFlashLoanExecutionPlanFromOpportunity(opportunity, {
          receiver,
          profitRecipient,
        }));
      const configuredPowWorkers = Number(process.env.ZERO_CAPITAL_EUROPA_POW_WORKERS || '');
      const proof = await adapter.execute({
        opportunityId: opportunity.id,
        receiver,
        receiverCodeHash,
        balancerVault,
        receiverKind,
        sushiV3Factory: receiverKind === 'sushi-v3' ? EUROPA_SUSHI.v3Factory : undefined,
        inputToken: opportunity.inputToken,
        payload,
        maxExternalNativeBalanceWei: process.env.ZERO_CAPITAL_EUROPA_MAX_EXTERNAL_NATIVE_BALANCE_WEI || '0',
        maxExternalInputBalance: process.env.ZERO_CAPITAL_EUROPA_MAX_EXTERNAL_INPUT_BALANCE || '0',
        externalGasPow: {
          difficulty: (await resolveEuropaExternalGasDifficulty(this.providers.get('europa')!)).difficulty,
          maxAttempts: Math.max(1, Number(process.env.ZERO_CAPITAL_EUROPA_POW_MAX_ATTEMPTS || 250_000)),
          workerCount: Number.isInteger(configuredPowWorkers) && configuredPowWorkers > 0 ? configuredPowWorkers : undefined,
        },
      });
      if (proof.success && proof.transactionHash && proof.executionKey && proof.realizedProfit && proof.realizedProfit > 0n && proof.startingNativeBalanceWei === 0n && proof.startingInputBalance === 0n) {
        await this.capitalProvenance.markAtomicExecutionPending(this.capitalScope, proof.executionKey);
        await this.capitalProvenance.recordVerifiedBootstrapProfit({
          scope: this.capitalScope,
          executionKey: proof.executionKey,
          transactionHash: proof.transactionHash,
          chain: 'europa',
          asset: opportunity.inputToken,
          residualProfit: proof.realizedProfit.toString(),
          zeroMonetaryGasVerified: proof.zeroMonetaryGasVerified,
          zeroExternalNativeCapitalVerified: true,
          zeroExternalInputCapitalVerified: true,
        });
      } else if (!proof.transactionHash) {
        await this.capitalProvenance.markZeroGasExecutionReady(this.capitalScope);
      } else if (!proof.success) {
        await this.capitalProvenance.markRecoveryRequired(this.capitalScope);
      }
      return {
        success: proof.success,
        txHash: proof.transactionHash,
        profit: proof.realizedProfit,
        profitVerified: proof.success && proof.zeroMonetaryGasVerified,
        gasUsed: proof.gasUsed,
        error: proof.error,
        blockNumber: proof.blockNumber,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Execute using Flashbots - COMPLETELY GASLESS
   * The miner gets paid from the arbitrage profits, not from our wallet
   */
  private async executeWithFlashbots(
    opportunity: ZeroCapitalOpportunity
  ): Promise<ExecutionResult> {
    if (!this.flashbotsProvider || !this.authSigner) {
      return { success: false, error: 'Flashbots not initialized' };
    }

    const executionWallet = this.executionWallets.get('ethereum');
    if (!executionWallet) {
      return { success: false, error: 'WALLET_PRIVATE_KEY is required for zero-capital flashbots execution' };
    }

    try {
      const provider = this.providers.get('ethereum')!;
      const blockNumber = await provider.getBlockNumber();
      
      // Build the flash-loan receiver execution payload
      const executionPlan = buildFlashLoanExecutionPlanFromOpportunity(opportunity, {
        profitRecipient: process.env.CRYPTO_PROFIT_WALLET_ADDRESS || executionWallet.address,
      });
      const flashLoanPayload = buildFlashLoanReceiverPayloadFromPlan(executionPlan);
      
      // Create Flashbots bundle
      // The bundle atomically executes:
      // 1. Flash loan borrow
      // 2. Buy on DEX A
      // 3. Sell on DEX B  
      // 4. Repay flash loan + fee
      // 5. Pay miner bribe from remaining profit
      
      const bundle: (FlashbotsBundleTransaction | FlashbotsBundleRawTransaction)[] = [
        {
          signer: executionWallet,
          transaction: {
            to: flashLoanPayload.to,
            data: flashLoanPayload.data,
            value: BigNumber.from(flashLoanPayload.value),
            gasLimit: BigNumber.from(flashLoanPayload.gasLimit),
            maxFeePerGas: await this.getBoundedFlashbotsMaxFee(provider),
            maxPriorityFeePerGas: await this.getBoundedFlashbotsPriorityFee(provider),
            type: 2,
            chainId: 1,
          },
        } as FlashbotsBundleTransaction,
      ];

      // Simulate bundle first
      const simulation = await this.flashbotsProvider.simulate(bundle as any, blockNumber + 1);
      
      if ('error' in simulation) {
        return { success: false, error: `Simulation failed: ${simulation.error.message}` };
      }
      const simulatedGasUsed = BigNumber.from(simulation.totalGasUsed || 0);
      const gasLimit = BigNumber.from(flashLoanPayload.gasLimit);
      if (simulatedGasUsed.gt(gasLimit)) {
        return {
          success: false,
          error: `Flashbots simulation used ${simulatedGasUsed.toString()} gas, exceeding configured receiver gas limit ${gasLimit.toString()}`,
        };
      }

      // Submit bundle
      const bundleSubmission = await this.flashbotsProvider.sendBundle(bundle as any, blockNumber + 1);
      
      if ('error' in bundleSubmission) {
        return { success: false, error: `Bundle submission failed: ${bundleSubmission.error.message}` };
      }

      // Wait for inclusion
      const resolution = await this.waitForBundleResolution(bundleSubmission);
      
      if (resolution === FlashbotsBundleResolution.BundleIncluded) {
        const receipts = await bundleSubmission.receipts();
        const receiverReceipt = receipts.find(receipt =>
          receipt && receipt.to?.toLowerCase() === flashLoanPayload.to.toLowerCase(),
        );
        if (!receiverReceipt || receiverReceipt.status !== 1) {
          return { success: false, error: 'Flashbots reported inclusion but the receiver transaction receipt is missing or reverted' };
        }

        const realizedProfit = this.extractReceiverProfit(receiverReceipt, flashLoanPayload.to);
        if (realizedProfit === null) {
          return {
            success: false,
            txHash: receiverReceipt.transactionHash,
            error: 'Included receiver transaction did not emit FlashLoanExecuted',
          };
        }

        this.state.gaslessTransactions++;
        return {
          success: true,
          txHash: receiverReceipt.transactionHash,
          profit: realizedProfit,
          profitVerified: true,
          gasUsed: BigInt(receiverReceipt.gasUsed.toString()),
          blockNumber: receiverReceipt.blockNumber,
        };
      } else {
        return { success: false, error: `Bundle not included (resolution=${resolution})` };
      }

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  private async getBoundedFlashbotsMaxFee(provider: providers.JsonRpcProvider): Promise<BigNumber> {
    const feeData = await provider.getFeeData();
    const baseFee = feeData.maxFeePerGas || feeData.gasPrice;
    if (!baseFee || baseFee.lte(0)) {
      throw new Error('Ethereum fee data is unavailable for Flashbots bundle construction');
    }

    const feeBufferBps = Math.max(10000, Number(process.env.ZERO_CAPITAL_FLASHBOTS_FEE_BUFFER_BPS || 12000));
    const maxFeeGwei = Math.max(1, Number(process.env.ZERO_CAPITAL_FLASHBOTS_MAX_FEE_GWEI || 60));
    const buffered = baseFee.mul(feeBufferBps).div(10000);
    const cap = ethers.utils.parseUnits(String(maxFeeGwei), 'gwei');
    if (buffered.gt(cap)) {
      throw new Error(`Dynamic Flashbots max fee ${ethers.utils.formatUnits(buffered, 'gwei')} gwei exceeds ZERO_CAPITAL_FLASHBOTS_MAX_FEE_GWEI=${maxFeeGwei}`);
    }
    return buffered;
  }

  private async getBoundedFlashbotsPriorityFee(provider: providers.JsonRpcProvider): Promise<BigNumber> {
    const feeData = await provider.getFeeData();
    const configuredFallback = ethers.utils.parseUnits(
      String(Math.max(0, Number(process.env.ZERO_CAPITAL_FLASHBOTS_PRIORITY_FEE_GWEI || 1))),
      'gwei',
    );
    const priorityFee = feeData.maxPriorityFeePerGas || configuredFallback;
    const maxPriorityGwei = Math.max(0, Number(process.env.ZERO_CAPITAL_FLASHBOTS_MAX_PRIORITY_FEE_GWEI || 3));
    const cap = ethers.utils.parseUnits(String(maxPriorityGwei), 'gwei');
    return priorityFee.gt(cap) ? cap : priorityFee;
  }

  private async waitForBundleResolution(bundleSubmission: {
    wait: () => Promise<FlashbotsBundleResolution>;
  }): Promise<FlashbotsBundleResolution> {
    const timeoutMs = Math.max(1000, Number(process.env.ZERO_CAPITAL_FLASHBOTS_WAIT_TIMEOUT_MS || 45000));
    let timeout: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        bundleSubmission.wait(),
        new Promise<FlashbotsBundleResolution>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`Flashbots bundle wait timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private extractReceiverProfit(
    receipt: providers.TransactionReceipt,
    receiverAddress: string,
  ): bigint | null {
    for (const logEntry of receipt.logs) {
      if (logEntry.address.toLowerCase() !== receiverAddress.toLowerCase()) {
        continue;
      }

      try {
        const parsed = FLASH_LOAN_RECEIVER_EVENT_INTERFACE.parseLog(logEntry);
        if (parsed.name === 'FlashLoanExecuted') {
          return BigInt(parsed.args.profit.toString());
        }
      } catch {
        // Ignore unrelated receiver logs.
      }
    }

    return null;
  }

  /**
   * Stop the engine
   */
  stop(): void {
    this.state.isRunning = false;
    if (this.scanInterval) {
      clearTimeout(this.scanInterval);
      this.scanInterval = null;
    }
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
      this.executionInterval = null;
    }
    logger.info('[ZeroCapitalEngine] Engine stopped', {
      component: 'ZeroCapitalEngine',
      finalStats: {
        totalProfit: ethers.utils.formatUnits(this.state.totalProfit.toString(), 6),
        totalTrades: this.state.totalTrades,
        successRate: this.state.totalTrades > 0 
          ? (this.state.successfulTrades / this.state.totalTrades * 100).toFixed(2) + '%'
          : '0%',
        includedUnverifiedTrades: this.state.includedUnverifiedTrades,
        gaslessTransactions: this.state.gaslessTransactions,
      },
    });
  }

  /**
   * Get current system state
   */
  getState(): SystemState {
    return { ...this.state };
  }

  /**
   * Get formatted stats for API
   */
  getStats(): {
    isRunning: boolean;
    totalProfit: string;
    totalTrades: number;
    successfulTrades: number;
    includedUnverifiedTrades: number;
    failedTrades: number;
    successRate: string;
    currentOpportunities: number;
    gaslessTransactions: number;
    capitalRequired: string;
  } {
    return {
      isRunning: this.state.isRunning,
      totalProfit: ethers.utils.formatUnits(this.state.totalProfit.toString(), 6),
      totalTrades: this.state.totalTrades,
      successfulTrades: this.state.successfulTrades,
      includedUnverifiedTrades: this.state.includedUnverifiedTrades,
      failedTrades: this.state.failedTrades,
      successRate: this.state.totalTrades > 0 
        ? (this.state.successfulTrades / this.state.totalTrades * 100).toFixed(2) + '%'
        : '0%',
      currentOpportunities: this.state.currentOpportunities,
      gaslessTransactions: this.state.gaslessTransactions,
      capitalRequired: 'Explicit external Flashbots gas sponsor required for the currently supported live execution mode',
    };
  }
}

// Singleton instance
export const zeroCapitalEngine = new AutonomousZeroCapitalEngine();

// Export for use in routes
export default zeroCapitalEngine;
