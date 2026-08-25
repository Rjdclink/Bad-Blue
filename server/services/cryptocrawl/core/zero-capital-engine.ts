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

import { ethers, Wallet, providers, BigNumber, Contract } from 'ethers';
import { FlashbotsBundleProvider, FlashbotsBundleResolution, FlashbotsBundleTransaction, FlashbotsBundleRawTransaction } from '@flashbots/ethers-provider-bundle';
import logger from '../../../logger.js';
import { getCryptara, type CryptaraRouteObservation } from '../../cryptara/index.js';
import { marketDataProviders } from '../intelligence/market-data-providers.js';
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
import { multiProviderRpcManager, type SupportedChain as RpcSupportedChain } from '../api/blockchain-providers.js';
import type { NormalizedRealizedExecution } from '../execution/settlement-types.js';
import { assessInitialGasReadiness, type InitialGasReadiness } from '../initial-gas-readiness.js';
import { assertConfiguredWalletAddress, normalizePrivateKey, resolveConfiguredWalletAddress, walletFromPrivateKey } from './wallet-identity.js';
import { getOrCreateFlashbotsAuthPrivateKey } from '../execution/adapters/flashbots-auth-identity.js';

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
  grossProfit?: bigint;
  gasEstimate: bigint;
  estimatedExecutionCostInInputToken: bigint;
  estimatedGasCostInInputToken?: bigint;
  flashLoanFeeInInputToken?: bigint;
  relayFeeInInputToken?: bigint;
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
  normalized?: NormalizedRealizedExecution;
  profit?: bigint;
  profitVerified?: boolean;
  gasUsed?: bigint;
  receiptStatus?: 0 | 1;
  nativeFeeWei?: bigint;
  zeroMonetaryGasVerified?: boolean;
  realizedFeeUsd?: number;
  realizedSlippageBps?: number;
  latencyMs?: number;
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
  fundingCycleActive: boolean;
  fundingCycles: number;
  lastFundingCycleAt: number;
  lastFundingError?: string;
  walletResources: WalletResourceSnapshot[];
  bootstrapState: 'PRE_STAGE_1_BOOTSTRAP' | 'INITIAL_GAS_READY';
  initialGasReadiness: InitialGasReadiness;
  marketOperationsEnabled: boolean;
}

export interface WalletResourceSnapshot {
  chain: SupportedChain;
  walletAddress?: string;
  walletAddressSource?: 'execution_wallet' | 'bridge_wallet';
  nativeBalance: string;
  assetBalances: Record<string, string>;
  observedAt: number;
  status: 'available' | 'unavailable';
  error?: string;
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
const ERC20_BALANCE_INTERFACE = ['function balanceOf(address owner) view returns (uint256)'];

export function composeConfiguredZeroCapitalRoutes(
  configuredRoutes: ConfiguredZeroCapitalRoute[],
  dynamicEuropaRoute?: ConfiguredZeroCapitalRoute | null,
): ConfiguredZeroCapitalRoute[] {
  const nonEuropaRoutes = configuredRoutes.filter(route => route.chain !== 'europa');
  const europaRoutes = configuredRoutes.filter(route => route.chain === 'europa');
  return dynamicEuropaRoute
    ? [...nonEuropaRoutes, ...europaRoutes, dynamicEuropaRoute]
    : [...nonEuropaRoutes, ...europaRoutes];
}

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
  private configuredBaseRoutes: ConfiguredZeroCapitalRoute[] = [];
  private scanInterval: NodeJS.Timeout | null = null;
  private executionInterval: NodeJS.Timeout | null = null;
  private fundingInterval: NodeJS.Timeout | null = null;
  private scanDelayMs: number = Number(process.env.ZERO_CAPITAL_SCAN_MIN_MS || 2500);
  private readonly minScanDelayMs: number = Number(process.env.ZERO_CAPITAL_SCAN_MIN_MS || 2500);
  private readonly maxScanDelayMs: number = Number(process.env.ZERO_CAPITAL_SCAN_MAX_MS || 15000);
  private executionEnabled: boolean = false;
  private isExecuting: boolean = false;
  private isFunding: boolean = false;
  private bootstrapInterval: NodeJS.Timeout | null = null;
  private bootstrapInFlight = false;
  private executionEligible = false;
  private marketOperationsStarted = false;
  private initialGasReadyCallback: (() => Promise<void>) | undefined;
  private initialGasLostCallback: (() => Promise<void>) | undefined;
  private readonly fundingIntervalMs = Math.max(1000, Number(process.env.ZERO_CAPITAL_FUNDING_INTERVAL_MS || 15000));
  private readonly bootstrapRecheckMs = Math.max(1000, Number(process.env.ZERO_CAPITAL_INITIAL_GAS_RECHECK_MS || 15000));
  private lastLiveSignalCheckAt = 0;
  private liveSignalReady = false;
  private readonly cryptaraGateEvidence = new Map<string, GateEvaluation>();
  private routeDiscoveryStatus: 'not_attempted' | 'not_profitable' | 'discovered' | 'unavailable' = 'not_attempted';
  private routeDiscoveryLastError?: string;

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
      fundingCycleActive: false,
      fundingCycles: 0,
      lastFundingCycleAt: 0,
      walletResources: [],
      bootstrapState: 'PRE_STAGE_1_BOOTSTRAP',
      initialGasReadiness: {
        status: 'PRE_STAGE_1_BOOTSTRAP',
        initialGasReady: false,
        thresholdUsd: 20,
        usableNativeGasUsd: null,
        measurements: [],
        observedAt: 0,
        provenance: ['startup'],
      },
      marketOperationsEnabled: false,
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
    this.configuredBaseRoutes = configuredRoutes;
    this.configuredRoutes = composeConfiguredZeroCapitalRoutes(configuredRoutes);

    const ordinaryChains = Object.keys(RPC_ENDPOINTS)
      .filter((chain): chain is RpcSupportedChain => chain !== 'europa');
    await multiProviderRpcManager.initialize(ordinaryChains);

    for (const [chain, rpcUrl] of Object.entries(RPC_ENDPOINTS)) {
      try {
        if (chain === 'europa') {
          const provider = new providers.JsonRpcProvider(rpcUrl);
          await provider.getNetwork();
          this.providers.set(chain as SupportedChain, provider);
          logger.info(`[ZeroCapitalEngine] Connected to ${chain}`, { component: 'ZeroCapitalEngine', chain });
          continue;
        }

        let managedProvider;
        try {
          managedProvider = await multiProviderRpcManager.getProvider(chain as RpcSupportedChain, 'json_rpc');
        } catch (discoveryError) {
          await multiProviderRpcManager.registerProvider({
            provider: 'ZeroCapitalConfiguredRPC',
            chain: chain as RpcSupportedChain,
            httpUrl: rpcUrl,
            priority: 1,
          });
          managedProvider = await multiProviderRpcManager.getProvider(chain as RpcSupportedChain, 'json_rpc');
          logger.info('[ZeroCapitalEngine] Registered configured RPC fallback with shared manager', {
            component: 'ZeroCapitalEngine',
            chain,
            discoveryError: discoveryError instanceof Error ? discoveryError.message : String(discoveryError),
          });
        }

        this.providers.set(chain as SupportedChain, managedProvider.http);
        logger.info(`[ZeroCapitalEngine] Connected to ${chain}`, { component: 'ZeroCapitalEngine', chain });
      } catch (error) {
        logger.warn(`[ZeroCapitalEngine] Failed to connect to ${chain}`, { 
          component: 'ZeroCapitalEngine', 
          chain, 
          error: (error as Error).message 
        });
      }
    }

    const configuredWalletPrivateKey = process.env.WALLET_PRIVATE_KEY;
    const walletPrivateKey = normalizePrivateKey(configuredWalletPrivateKey) || undefined;
    if (configuredWalletPrivateKey && !walletPrivateKey) {
      logger.warn('[ZeroCapitalEngine] WALLET_PRIVATE_KEY is not a valid 32-byte hex private key; signing is disabled', {
        component: 'ZeroCapitalEngine',
      });
    }
    if (walletPrivateKey) {
      assertConfiguredWalletAddress(walletPrivateKey);
      for (const [chain, provider] of this.providers.entries()) {
        this.executionWallets.set(chain, walletFromPrivateKey(walletPrivateKey).connect(provider));
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
    const configuredFlashbotsAuthKey = normalizePrivateKey(process.env.FLASHBOTS_AUTH_KEY);
    if (process.env.FLASHBOTS_AUTH_KEY?.trim() && !configuredFlashbotsAuthKey) {
      logger.warn('[ZeroCapitalEngine] FLASHBOTS_AUTH_KEY is not a valid 32-byte hex private key; the persisted application-owned identity will be used', {
        component: 'ZeroCapitalEngine',
      });
    }
    if (ethProvider) {
      try {
        const flashbotsAuthPrivateKey = await getOrCreateFlashbotsAuthPrivateKey(configuredFlashbotsAuthKey);
        this.authSigner = walletFromPrivateKey(flashbotsAuthPrivateKey);
        this.flashbotsProvider = await FlashbotsBundleProvider.create(
          ethProvider,
          this.authSigner,
          'https://relay.flashbots.net'
        );
        logger.info('[ZeroCapitalEngine] Flashbots provider initialized (gasless execution enabled)', {
          component: 'ZeroCapitalEngine',
          authIdentityAddress: this.authSigner.address,
        });
      } catch (error) {
        logger.warn('[ZeroCapitalEngine] Flashbots initialization failed, will use standard execution', {
          component: 'ZeroCapitalEngine',
          error: (error as Error).message,
        });
      }
    }

    try {
      await this.refreshEuropaFundingRoute();
    } catch (error) {
      logger.warn('[ZeroCapitalEngine] Initial Europa route discovery unavailable; route refresh will retry during funding cycles', {
        component: 'ZeroCapitalEngine',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('[ZeroCapitalEngine] Initialization complete', {
      component: 'ZeroCapitalEngine',
      connectedChains: this.providers.size,
      flashbotsEnabled: !!this.flashbotsProvider,
      configuredBaseRoutes: this.configuredBaseRoutes.length,
      configuredRoutes: this.configuredRoutes.length,
      europaRouteDiscovery: this.routeDiscoveryStatus,
      europaRouteDiscoveryLastError: this.routeDiscoveryLastError,
    });
  }

  /**
   * Start the autonomous scanning and execution loop
   * THIS IS WHERE THE MAGIC HAPPENS - ZERO CAPITAL REQUIRED
   */
  async start(options: {
    onInitialGasReady?: () => Promise<void>;
    onInitialGasLost?: () => Promise<void>;
  } = {}): Promise<void> {
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
    let executionEnabledForLifecycle = executionOptIn;

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
      if (europaRoutes.length > 0 || nonEuropaRoutes.length === 0) {
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
          executionEnabledForLifecycle = false;
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

    this.executionEligible = executionEnabledForLifecycle;
    this.executionEnabled = false;
    this.initialGasReadyCallback = options.onInitialGasReady;
    this.initialGasLostCallback = options.onInitialGasLost;

    logger.info('[ZeroCapitalEngine] Starting read-only on-chain monitoring...', {
      component: 'ZeroCapitalEngine',
      mode: this.executionEnabled ? 'LIVE_EXECUTION_GATED' : 'MONITORING_ONLY',
      connectedChains: this.providers.size,
      executionEnabled: this.executionEnabled,
    });

    await this.refreshInitialGasReadiness();
    if (this.state.initialGasReadiness.initialGasReady) {
      if (stageManager.isMarketOperationsAllowed()) {
        await this.startMarketOperations();
      } else {
        this.startBootstrapReadinessLoop();
      }
    } else {
      await this.runBootstrapReadinessCycle();
      logger.warn('[ZeroCapitalEngine] Remaining in PRE_STAGE_1_BOOTSTRAP; market operations are locked until verified native-gas readiness reaches the configured threshold', {
        component: 'ZeroCapitalEngine',
        status: this.state.initialGasReadiness.status,
        thresholdUsd: this.state.initialGasReadiness.thresholdUsd,
        usableNativeGasUsd: this.state.initialGasReadiness.usableNativeGasUsd,
      });
    }

    if (this.executionEligible && this.state.initialGasReadiness.initialGasReady) {
      logger.info('[ZeroCapitalEngine] Execution mode enabled for zero-capital arbitrage', {
        component: 'ZeroCapitalEngine',
      });
    } else {
      logger.info('[ZeroCapitalEngine] Execution loop disabled; monitoring mode only', {
        component: 'ZeroCapitalEngine',
        reason: executionRequested && !executionOptIn
          ? 'Current governance stage does not permit trade execution'
          : this.state.initialGasReadiness.initialGasReady && executionOptIn
            ? 'Verified internally generated capital is available; zero-capital bootstrap is dormant'
            : 'Initial native-gas readiness has not opened Stage 1 market operations',
      });
    }
  }

  private async refreshInitialGasReadiness(): Promise<InitialGasReadiness> {
    const walletAddresses = new Map<SupportedChain, string>();
    const walletAddressSources = new Map<SupportedChain, 'execution_wallet' | 'bridge_wallet'>();
    const configuredWallet = resolveConfiguredWalletAddress();
    for (const [chain, wallet] of this.executionWallets.entries()) {
      walletAddresses.set(chain, wallet.address);
      walletAddressSources.set(chain, 'execution_wallet');
    }
    if (configuredWallet.address) {
      for (const chain of this.providers.keys()) {
        if (!walletAddresses.has(chain)) {
          walletAddresses.set(chain, configuredWallet.address);
          walletAddressSources.set(chain, 'bridge_wallet');
        }
      }
    }
    const readiness = await assessInitialGasReadiness({
      providers: this.providers,
      walletAddresses,
      walletAddressSources,
    });
    this.state.initialGasReadiness = readiness;
    this.state.bootstrapState = readiness.initialGasReady ? 'INITIAL_GAS_READY' : 'PRE_STAGE_1_BOOTSTRAP';
    this.state.marketOperationsEnabled = readiness.initialGasReady && stageManager.isMarketOperationsAllowed();
    stageManager.setInitialGasReadiness(readiness);
    this.state.marketOperationsEnabled = readiness.initialGasReady && stageManager.isMarketOperationsAllowed();
    return readiness;
  }

  private startBootstrapReadinessLoop(): void {
    if (this.bootstrapInterval) clearTimeout(this.bootstrapInterval);
    const scheduleNext = (): void => {
      if (!this.state.isRunning || this.marketOperationsStarted) return;
      this.bootstrapInterval = setTimeout(() => {
        void this.runBootstrapReadinessCycle();
      }, this.bootstrapRecheckMs);
    };
    scheduleNext();
  }

  private async runBootstrapReadinessCycle(): Promise<void> {
    if (!this.state.isRunning || this.marketOperationsStarted || this.bootstrapInFlight) return;
    this.bootstrapInFlight = true;
    try {
      await this.refreshWalletResources();
      const readiness = await this.refreshInitialGasReadiness();
      if (readiness.initialGasReady && stageManager.isMarketOperationsAllowed()) {
        if (this.bootstrapInterval) {
          clearTimeout(this.bootstrapInterval);
          this.bootstrapInterval = null;
        }
        await this.startMarketOperations();
      } else {
        this.suspendMarketOperations();
        this.state.lastFundingError = readiness.reason;
        await this.attemptInitialGasBootstrap(readiness);
        if (this.state.initialGasReadiness.initialGasReady && stageManager.isMarketOperationsAllowed()) {
          if (this.bootstrapInterval) {
            clearTimeout(this.bootstrapInterval);
            this.bootstrapInterval = null;
          }
          await this.startMarketOperations();
          return;
        }
        logger.info('[ZeroCapitalEngine] Initial gas readiness recheck remains gated', {
          component: 'ZeroCapitalEngine',
          status: readiness.status,
          thresholdUsd: readiness.thresholdUsd,
          usableNativeGasUsd: readiness.usableNativeGasUsd,
        });
        this.startBootstrapReadinessLoop();
      }
    } catch (error) {
      this.state.lastFundingError = error instanceof Error ? error.message : String(error);
      logger.warn('[ZeroCapitalEngine] Initial gas readiness recheck failed; keeping market operations locked', {
        component: 'ZeroCapitalEngine',
        error: this.state.lastFundingError,
      });
      this.startBootstrapReadinessLoop();
    } finally {
      this.bootstrapInFlight = false;
    }
  }

  private async attemptInitialGasBootstrap(readiness: InitialGasReadiness): Promise<void> {
    if (readiness.initialGasReady) return;
    if (!this.executionEligible) {
      this.state.lastFundingError = 'PRE_STAGE_1_BOOTSTRAP remains observation-only; no qualifying paid-chain native funding or zero-gas conversion path is available';
      logger.info('[ZeroCapitalEngine] Corrective bootstrap deferred by authoritative stage capability', {
        component: 'ZeroCapitalEngine',
        stage: stageManager.getCurrentStage(),
        status: readiness.status,
        reason: this.state.lastFundingError,
      });
      return;
    }

    const capitalState = await this.capitalProvenance.getOrCreate(this.capitalScope);
    if (capitalState.lifecycle === 'ATOMIC_EXECUTION_PENDING' || capitalState.lifecycle === 'FIRST_PROFIT_VERIFIED') {
      throw new Error(`Europa bootstrap is blocked while capital provenance is ${capitalState.lifecycle}; reconcile the recorded transaction before retrying`);
    }
    if (capitalState.lifecycle === 'SELF_FUNDED' && BigInt(capitalState.internallyGeneratedBalance) > 0n) {
      this.state.lastFundingError = 'Europa bootstrap produced verified input-token capital, but no qualifying paid-chain native gas; native funding or an explicitly supported conversion path is required';
      logger.info('[ZeroCapitalEngine] Europa bootstrap is dormant after verified profit because native-gas readiness remains independent', {
        component: 'ZeroCapitalEngine',
        asset: capitalState.asset,
        internallyGeneratedBalance: capitalState.internallyGeneratedBalance,
        status: readiness.status,
      });
      return;
    }

    const europaProvider = this.providers.get('europa');
    if (!europaProvider || !this.europaAdapter) {
      throw new Error('Europa bootstrap requires a reachable Europa provider and trusted execution wallet');
    }

    await this.refreshEuropaFundingRoute();
    const quotedRoutes = await quoteConfiguredZeroCapitalRoutesForChain('europa', europaProvider, this.configuredRoutes);
    const quotedRoute = quotedRoutes[0];
    if (!quotedRoute) {
      throw new Error(`Europa bootstrap has no live profitable route; discovery=${this.routeDiscoveryStatus}${this.routeDiscoveryLastError ? `: ${this.routeDiscoveryLastError}` : ''}`);
    }

    const block = await europaProvider.getBlock('latest');
    const opportunity = this.createOpportunityFromQuotedRoute(quotedRoute, block.timestamp);
    const cryptara = getCryptara();
    if (!cryptara.getStatus().isRunning) await cryptara.initialize();
    if (!await this.isCandidateAllowedByCryptara(opportunity, europaProvider)) {
      throw new Error(`Europa bootstrap candidate ${opportunity.id} was rejected by live Cryptara market gates`);
    }

    const capitalPlan = await this.assessCapitalHierarchy(opportunity);
    const chainSnapshot = capitalPlan.chains.find(chain => chain.chain === 'europa');
    const positionSizing = calculateProgressivePositionSize({
      requestedNotionalUsd: this.toUsdEstimate(opportunity.flashLoanAmount, opportunity.inputTokenDecimals),
      availableCapitalUsd: 0,
      expectedNetProfitUsd: this.toUsdEstimate(opportunity.expectedProfit, opportunity.inputTokenDecimals),
      expectedCostUsd: this.toUsdEstimate(opportunity.estimatedExecutionCostInInputToken, opportunity.inputTokenDecimals),
      expectedSlippageBps: opportunity.expectedSlippageBps,
      liquidityScore: opportunity.confidence,
      volatilityScore: Math.min(1, opportunity.expectedSlippageBps / 100),
      providerHealthy: !!chainSnapshot && this.providers.has('europa'),
      zeroCapitalAvailable: capitalPlan.source === 'europa-zero-capital',
    });
    const beamValidation = await this.validateCapitalPlanThroughBeam(capitalPlan, opportunity, positionSizing);
    if (!beamValidation.approved) {
      throw new Error(`Beam rejected Europa bootstrap capital plan: ${beamValidation.reason}`);
    }

    const governance = getCryptocrawlGovernance();
    governance.requireAllowed('EXECUTE_OPPORTUNITY', { chain: 'europa', pair: `${opportunity.inputAssetSymbol}/CYCLIC`, venue: 'europa' });
    governance.requireAllowed('SUBMIT_TX', { chain: 'europa', pair: `${opportunity.inputAssetSymbol}/CYCLIC`, venue: 'europa' });
    governance.recordExecutionAttempt();

    logger.warn('[ZeroCapitalEngine] Submitting explicitly enabled Europa corrective bootstrap candidate', {
      component: 'ZeroCapitalEngine',
      opportunityId: opportunity.id,
      expectedProfit: this.toUsdEstimate(opportunity.expectedProfit, opportunity.inputTokenDecimals),
      routeDiscovery: this.routeDiscoveryStatus,
    });
    const result = await this.executeWithEuropa(opportunity);
    await this.recordCryptaraExecutionFeedback(opportunity, result);
    const postExecutionReadiness = await this.refreshInitialGasReadiness();
    if (!result.success) {
      throw new Error(result.error || 'Europa bootstrap execution did not prove a successful result');
    }
    if (!postExecutionReadiness.initialGasReady) {
      throw new Error(await this.describeNativeGasFundingBlocker(postExecutionReadiness));
    }
  }

  private async describeNativeGasFundingBlocker(readiness: InitialGasReadiness): Promise<string> {
    const capitalState = await this.capitalProvenance.getOrCreate(this.capitalScope);
    const paidChains = Array.from(this.providers.keys()).filter(chain => chain !== 'europa');
    const destinationEvidence = paidChains.length > 0
      ? paidChains.map(chain => {
        const wallet = this.executionWallets.get(chain);
        return `${chain}:${wallet ? 'signer-configured' : 'observation-only'}`;
      }).join(', ')
      : 'none';
    return `Verified Europa ${capitalState.asset || 'input-token'} proceeds did not produce qualifying paid-chain native gas (${readiness.reason || readiness.status}). No canonical executable bridge/conversion path is available from Europa to a paid-chain native asset; existing bridge helpers are transfer/URL-only and paid-chain swap or unwrap transactions require native gas. Destination evidence: ${destinationEvidence}`;
  }

  private async startMarketOperations(): Promise<void> {
    if (this.marketOperationsStarted || !this.state.isRunning || !stageManager.isMarketOperationsAllowed()) return;
    this.marketOperationsStarted = true;
    this.state.marketOperationsEnabled = true;
    this.executionEnabled = this.executionEligible;
    this.startScanningLoop();
    this.startFundingLoop();
    if (this.executionEnabled) this.startExecutionLoop();
    if (this.initialGasReadyCallback) {
      const callback = this.initialGasReadyCallback;
      try {
        await callback();
      } catch (error) {
        this.marketOperationsStarted = false;
        this.state.marketOperationsEnabled = false;
        this.executionEnabled = false;
        this.suspendMarketOperations();
        this.startBootstrapReadinessLoop();
        throw error;
      }
    }
  }

  private suspendMarketOperations(): void {
    const wasStarted = this.marketOperationsStarted;
    this.marketOperationsStarted = false;
    this.state.marketOperationsEnabled = false;
    this.executionEnabled = false;
    if (this.scanInterval) {
      clearTimeout(this.scanInterval);
      this.scanInterval = null;
    }
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
      this.executionInterval = null;
    }
    if (this.fundingInterval) {
      clearTimeout(this.fundingInterval);
      this.fundingInterval = null;
    }
    if (wasStarted && this.initialGasLostCallback) {
      void this.initialGasLostCallback().catch(error => {
        logger.warn('[ZeroCapitalEngine] Failed to stop downstream market operations after readiness loss', {
          component: 'ZeroCapitalEngine',
          error: error instanceof Error ? error.message : String(error),
        });
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
      if (!stageManager.isMarketOperationsAllowed()) {
        scheduleNext(this.bootstrapRecheckMs);
        return;
      }
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

        await this.publishCryptaraRouteObservations(viableOpportunities);

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

  private async publishCryptaraRouteObservations(opportunities: ZeroCapitalOpportunity[]): Promise<void> {
    const cryptara = getCryptara();
    if (!cryptara.getStatus().isRunning || opportunities.length === 0) return;

    let marketUniverse = [] as Awaited<ReturnType<typeof marketDataProviders.discoverUniverse>>;
    try {
      marketUniverse = await marketDataProviders.discoverUniverse();
    } catch {
      marketUniverse = [];
    }

    let tradingView: Awaited<ReturnType<typeof TradingViewEngine.getAnalysis>> | null = null;
    try {
      tradingView = await TradingViewEngine.getAnalysis(process.env.ZERO_CAPITAL_SIGNAL_SYMBOL || 'ETHUSDT', '1h');
    } catch {
      tradingView = null;
    }

    let mempool = null;
    try {
      mempool = alchemyIntegration.getMempoolAnalysis();
    } catch {
      mempool = null;
    }

    for (const opportunity of opportunities.slice(0, 10)) {
      const finalLeg = opportunity.route[opportunity.route.length - 1];
      if (!finalLeg) continue;
      const routeObservation: CryptaraRouteObservation = {
        chain: opportunity.chain,
        inputToken: opportunity.inputToken,
        outputToken: finalLeg.tokenOut,
        inputAssetSymbol: opportunity.inputAssetSymbol,
        inputAmountBaseUnits: opportunity.flashLoanAmount.toString(),
        outputAmountBaseUnits: finalLeg.expectedAmountOut.toString(),
        inputTokenDecimals: opportunity.inputTokenDecimals,
        outputTokenDecimals: finalLeg.tokenOut.toLowerCase() === opportunity.inputToken.toLowerCase()
          ? opportunity.inputTokenDecimals
          : null,
        grossProfitBaseUnits: (opportunity.grossProfit ?? opportunity.expectedProfit).toString(),
        expectedNetProfitBaseUnits: opportunity.expectedProfit.toString(),
        estimatedGasCostBaseUnits: (opportunity.estimatedGasCostInInputToken ?? opportunity.estimatedExecutionCostInInputToken).toString(),
        flashLoanFeeBaseUnits: (opportunity.flashLoanFeeInInputToken ?? 0n).toString(),
        relayFeeBaseUnits: (opportunity.relayFeeInInputToken ?? 0n).toString(),
        quoteLatencyMs: opportunity.quoteLatencyMs,
        route: opportunity.route.map(leg => ({
          protocol: leg.protocol,
          tokenIn: leg.tokenIn,
          tokenOut: leg.tokenOut,
          amountInBaseUnits: leg.amountIn.toString(),
          expectedAmountOutBaseUnits: leg.expectedAmountOut.toString(),
          fee: leg.fee,
        })),
        observedAt: opportunity.timestamp,
        expiresAt: opportunity.expiresAt,
        executable: this.executionEnabled && (
          opportunity.chain === 'europa' ? !!this.europaAdapter : opportunity.chain === 'ethereum' && !!this.flashbotsProvider
        ),
      };
      const missingInformation = [
        ...(routeObservation.executable ? [] : ['route_execution_capability']),
      ];
      cryptara.recordOpportunityObservation({
        opportunityId: opportunity.id,
        observedAt: opportunity.timestamp,
        chain: opportunity.chain,
        symbol: opportunity.inputAssetSymbol,
        plan: null,
        tradingView,
        mempool,
        marketUniverse,
        dexObservation: null,
        routeObservation,
        missingInformation,
        provenance: ['configured_rpc_route_quote', `route:${opportunity.id}`, `chain:${opportunity.chain}`],
      });
    }
  }

  private startFundingLoop(): void {
    if (this.fundingInterval) {
      clearTimeout(this.fundingInterval);
      this.fundingInterval = null;
    }

    const scheduleNext = (): void => {
      if (!this.state.isRunning) return;
      this.fundingInterval = setTimeout(() => {
        void fundingCycle();
      }, this.fundingIntervalMs);
    };

    const fundingCycle = async (): Promise<void> => {
      if (!this.state.isRunning) return;
      if (this.isFunding) {
        scheduleNext();
        return;
      }

      this.isFunding = true;
      this.state.fundingCycleActive = true;
      try {
        const readiness = await this.refreshInitialGasReadiness();
        if (!readiness.initialGasReady || !stageManager.isMarketOperationsAllowed()) {
          this.suspendMarketOperations();
          this.state.lastFundingError = readiness.reason || 'Initial gas readiness is no longer verified';
          return;
        }
        await this.refreshWalletResources();
        await this.refreshEuropaFundingRoute();

        if (this.executionEnabled && this.providers.has('europa')) {
          const europaOpportunities = await this.scanChainForOpportunities('europa', this.providers.get('europa')!);
          if (europaOpportunities.length > 0) {
            this.opportunityQueue.push(...europaOpportunities);
            this.state.currentOpportunities = this.opportunityQueue.length;
          }
        }

        this.state.fundingCycles += 1;
        this.state.lastFundingCycleAt = Date.now();
        this.state.lastFundingError = undefined;
      } catch (error) {
        this.state.lastFundingCycleAt = Date.now();
        this.state.lastFundingError = error instanceof Error ? error.message : String(error);
        logger.warn('[ZeroCapitalEngine] Europa/Beam funding cycle degraded; trading loop remains independent', {
          component: 'ZeroCapitalEngine',
          error: this.state.lastFundingError,
        });
        this.suspendMarketOperations();
        this.startBootstrapReadinessLoop();
      } finally {
        this.isFunding = false;
        this.state.fundingCycleActive = false;
        if (this.marketOperationsStarted) scheduleNext();
      }
    };

    void fundingCycle();
  }

  private async refreshEuropaFundingRoute(): Promise<void> {
    try {
      const dynamicEuropaRoute = await discoverProfitableEuropaRoute();
      this.routeDiscoveryStatus = dynamicEuropaRoute ? 'discovered' : 'not_profitable';
      this.routeDiscoveryLastError = undefined;
      this.configuredRoutes = composeConfiguredZeroCapitalRoutes(
        this.configuredBaseRoutes,
        dynamicEuropaRoute?.route,
      );
    } catch (error) {
      this.routeDiscoveryStatus = 'unavailable';
      this.routeDiscoveryLastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private async refreshWalletResources(): Promise<WalletResourceSnapshot[]> {
    const assetsByChain = new Map<SupportedChain, Set<string>>();
    for (const route of this.configuredRoutes) {
      const assets = assetsByChain.get(route.chain) || new Set<string>();
      if (ethers.utils.isAddress(route.inputToken)) assets.add(route.inputToken);
      assetsByChain.set(route.chain, assets);
    }

    const configuredWallet = resolveConfiguredWalletAddress();
    const snapshots = await Promise.all(Array.from(this.providers.entries()).map(async ([chain, provider]) => {
      const wallet = this.executionWallets.get(chain);
      const walletAddress = wallet?.address || configuredWallet.address;
      const observedAt = Date.now();
      if (!walletAddress) {
        return {
          chain,
          nativeBalance: '0',
          assetBalances: {},
          observedAt,
          status: 'unavailable' as const,
          error: configuredWallet.reason || 'No authoritative execution or bridge wallet is configured',
        };
      }

      try {
        const nativeBalance = await provider.getBalance(walletAddress);
        const assetBalances: Record<string, string> = {};
        await Promise.all(Array.from(assetsByChain.get(chain) || []).map(async asset => {
          const balance = await new Contract(asset, ERC20_BALANCE_INTERFACE, provider).balanceOf(walletAddress) as BigNumber;
          assetBalances[asset] = balance.toString();
        }));
        return {
          chain,
          walletAddress,
          walletAddressSource: wallet ? 'execution_wallet' : configuredWallet.source || undefined,
          nativeBalance: nativeBalance.toString(),
          assetBalances,
          observedAt,
          status: 'available' as const,
        };
      } catch (error) {
        return {
          chain,
          walletAddress,
          walletAddressSource: wallet ? 'execution_wallet' : configuredWallet.source || undefined,
          nativeBalance: '0',
          assetBalances: {},
          observedAt,
          status: 'unavailable' as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));

    this.state.walletResources = snapshots;
    return snapshots;
  }

  private toUsdEstimate(value: bigint | undefined, decimals: number): number {
    if (!value) return 0;
    const normalized = Number(ethers.utils.formatUnits(value.toString(), decimals));
    return Number.isFinite(normalized) ? normalized : 0;
  }

  private normalizeZeroCapitalSettlement(opportunity: ZeroCapitalOpportunity, result: ExecutionResult): NormalizedRealizedExecution | undefined {
    if (!result.txHash || result.blockNumber === undefined) return undefined;
    const realizedProfitUsd = result.profit !== undefined
      ? this.toUsdEstimate(result.profit, opportunity.inputTokenDecimals)
      : null;
    const gasVerified = result.zeroMonetaryGasVerified === true && result.nativeFeeWei === 0n;
    const submittedAt = Date.now() - Math.max(0, result.latencyMs || 0);
    return {
      status: result.success && result.profitVerified === true ? 'filled' : 'failed',
      terminal: true,
      settlementConfirmed: result.success && result.profitVerified === true,
      submittedAt,
      settledAt: Date.now(),
      venueOrRoute: opportunity.route.map(step => step.protocol).join('->') || 'zero-capital',
      chain: opportunity.chain,
      predicted: {
        profitUsd: this.toUsdEstimate(opportunity.expectedProfit, opportunity.inputTokenDecimals),
        feeUsd: this.toUsdEstimate(opportunity.estimatedExecutionCostInInputToken, opportunity.inputTokenDecimals),
        slippageBps: opportunity.expectedSlippageBps,
      },
      realized: {
        acquisitionCostUsd: null,
        proceedsUsd: null,
        exchangeFeeUsd: null,
        gasUsd: gasVerified ? 0 : null,
        gasUsed: result.gasUsed?.toString() || null,
        effectiveGasPriceWei: null,
        slippageBps: result.realizedSlippageBps ?? null,
        netProfitUsd: gasVerified ? realizedProfitUsd : null,
      },
      provenance: [
        'zero_capital:receipt',
        ...(result.gasUsed !== undefined ? ['receipt:gas_used'] : []),
        ...(gasVerified ? ['capital_provenance:zero_monetary_gas'] : []),
        ...(realizedProfitUsd !== null ? ['capital_provenance:realized_profit'] : ['priced:realized_usd_incomplete']),
      ],
      transactionHash: result.txHash,
      blockNumber: result.blockNumber,
      receiptStatus: result.receiptStatus,
      error: result.error,
    };
  }

  private async recordCryptaraExecutionFeedback(opportunity: ZeroCapitalOpportunity, result: ExecutionResult): Promise<void> {
    try {
      const cryptara = getCryptara();
      const normalized = result.normalized || this.normalizeZeroCapitalSettlement(opportunity, result);
      if (!normalized?.terminal) {
        logger.warn('[ZeroCapitalEngine] Execution settlement is not terminal; deferring Cryptara feedback', {
          component: 'ZeroCapitalEngine',
          opportunityId: opportunity.id,
          success: result.success,
          txHash: result.txHash,
        });
        return;
      }

      await recordCryptaraExecutionEvidence({
        source: 'zero_capital',
        opportunityId: opportunity.id,
        chain: opportunity.chain,
        symbol: `${opportunity.inputToken}/${opportunity.outputToken}`,
        strategy: opportunity.type,
        success: result.success,
        expectedProfitUsd: normalized.predicted.profitUsd ?? this.toUsdEstimate(opportunity.expectedProfit, opportunity.inputTokenDecimals),
        realizedProfitUsd: normalized.realized.netProfitUsd,
        feeUsd: normalized.realized.gasUsd,
        slippageBps: normalized.realized.slippageBps,
        latencyMs: result.latencyMs || 0,
        usedZeroCapital: true,
        timestamp: Date.now(),
        notes: result.error,
        settlementStatus: normalized.status,
        settlementConfirmed: normalized.settlementConfirmed,
        provenance: normalized.provenance,
        settlement: normalized,
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
      grossProfit: quotedRoute.grossProfit,
      gasEstimate: 0n,
      estimatedExecutionCostInInputToken: estimatedExecutionCost,
      estimatedGasCostInInputToken: quotedRoute.estimatedGasCostInInputToken,
      flashLoanFeeInInputToken: quotedRoute.flashLoanFeeInInputToken,
      relayFeeInInputToken: quotedRoute.relayFeeInInputToken,
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
    const routeFeeBps = opportunity.route.reduce((total, leg) => total + leg.fee * 10000, 0);
    const firstRouteLeg = opportunity.route[0];
    const lastRouteLeg = opportunity.route[opportunity.route.length - 1];
    const grossSpreadBps = opportunity.flashLoanAmount > 0n
      ? Number((opportunity.grossProfit || opportunity.expectedProfit) * 10000n) / Number(opportunity.flashLoanAmount)
      : Number.NaN;
    const stageState = stageManager.getState();
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
      feesRebates: Number.isFinite(routeFeeBps) ? { takerFeeBps: routeFeeBps } : undefined,
      crossVenueFees: {
        buyVenue: `route:${firstRouteLeg?.protocol || 'unknown'}`,
        sellVenue: `route:${lastRouteLeg?.protocol || 'unknown'}`,
        buyTakerFeeBps: (firstRouteLeg?.fee || 0) * 10000,
        sellTakerFeeBps: (lastRouteLeg?.fee || 0) * 10000,
        grossSpreadBps,
      },
      drawdownCaps: {
        drawdownPct: stageState.currentDrawdownPercent,
        maxDrawdownPct: stageManager.getStageConfig().maxDrawdownPercent,
      },
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
    if (!stageManager.isMarketOperationsAllowed()) {
      return { success: false, error: 'Market operations are locked behind initial gas readiness or governance state' };
    }
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
    await this.refreshWalletResources();
    const provider = this.providers.get(opportunity.chain);
    const gasPrice = provider
      ? (await provider.getFeeData()).maxFeePerGas || (await provider.getFeeData()).gasPrice || BigNumber.from(0)
      : BigNumber.from(0);
    const conservativeGasLimit = BigInt(Math.max(21_000, Number(process.env.ZERO_CAPITAL_WALLET_GAS_LIMIT || 500_000)));
    const gasRequirement = opportunity.gasEstimate > 0n
      ? opportunity.gasEstimate
      : BigInt(gasPrice.toString()) * conservativeGasLimit;
    const assetRequired = opportunity.flashLoanAmount + opportunity.estimatedExecutionCostInInputToken;
    const requirements: ChainFundingRequirement[] = [{
      chain: opportunity.chain,
      assetToken: opportunity.inputToken,
      assetRequired,
      nativeGasRequired: gasRequirement,
      bridgeNativeRequired: 0n,
      destinationNativeRequired: 0n,
      nativeSafetyReserve: 0n,
      assetSafetyReserve: 0n,
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
      await this.capitalProvenance.markAtomicExecutionPending(this.capitalScope, `opportunity:${opportunity.id}`);
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
      const executionResult: ExecutionResult = {
        success: proof.success,
        txHash: proof.transactionHash,
        profit: proof.realizedProfit,
        profitVerified: proof.success && proof.zeroMonetaryGasVerified,
        gasUsed: proof.gasUsed,
        receiptStatus: proof.receiptStatus,
        nativeFeeWei: proof.nativeFeeWei,
        zeroMonetaryGasVerified: proof.zeroMonetaryGasVerified,
        error: proof.error,
        blockNumber: proof.blockNumber,
      };
      executionResult.normalized = this.normalizeZeroCapitalSettlement(opportunity, executionResult);
      return executionResult;
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
        const executionResult: ExecutionResult = {
          success: true,
          txHash: receiverReceipt.transactionHash,
          profit: realizedProfit,
          profitVerified: true,
          gasUsed: BigInt(receiverReceipt.gasUsed.toString()),
          receiptStatus: 1,
          blockNumber: receiverReceipt.blockNumber,
        };
        executionResult.normalized = this.normalizeZeroCapitalSettlement(opportunity, executionResult);
        return executionResult;
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
    this.state.fundingCycleActive = false;
    this.state.marketOperationsEnabled = false;
    this.marketOperationsStarted = false;
    this.executionEnabled = false;
    this.executionEligible = false;
    this.initialGasReadyCallback = undefined;
    this.initialGasLostCallback = undefined;
    stageManager.resetInitialGasReadiness();
    if (this.scanInterval) {
      clearTimeout(this.scanInterval);
      this.scanInterval = null;
    }
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
      this.executionInterval = null;
    }
    if (this.fundingInterval) {
      clearTimeout(this.fundingInterval);
      this.fundingInterval = null;
    }
    if (this.bootstrapInterval) {
      clearTimeout(this.bootstrapInterval);
      this.bootstrapInterval = null;
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
    fundingCycleActive: boolean;
    fundingCycles: number;
    lastFundingCycleAt: number;
    lastFundingError?: string;
    walletResources: WalletResourceSnapshot[];
    bootstrapState: 'PRE_STAGE_1_BOOTSTRAP' | 'INITIAL_GAS_READY';
    initialGasReadiness: InitialGasReadiness;
    marketOperationsEnabled: boolean;
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
      fundingCycleActive: this.state.fundingCycleActive,
      fundingCycles: this.state.fundingCycles,
      lastFundingCycleAt: this.state.lastFundingCycleAt,
      lastFundingError: this.state.lastFundingError,
      bootstrapState: this.state.bootstrapState,
      initialGasReadiness: {
        ...this.state.initialGasReadiness,
        measurements: this.state.initialGasReadiness.measurements.map(measurement => ({ ...measurement })),
        provenance: [...this.state.initialGasReadiness.provenance],
      },
      marketOperationsEnabled: this.state.marketOperationsEnabled,
      walletResources: this.state.walletResources.map(resource => ({
        ...resource,
        assetBalances: { ...resource.assetBalances },
      })),
      capitalRequired: 'Measured wallet resources first; verified Europa zero-gas/Beam path next; legacy Flashbots sponsorship only when explicitly configured',
    };
  }
}

// Singleton instance
export const zeroCapitalEngine = new AutonomousZeroCapitalEngine();

// Export for use in routes
export default zeroCapitalEngine;
