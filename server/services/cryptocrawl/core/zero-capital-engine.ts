/**
 * Autonomous zero-capital execution engine.
 *
 * Active production path:
 * Cryptara/Tara intelligence -> Beam -> Monte Carlo profitability ->
 * Alchemy Gas Manager (EIP-7702/ERC-4337) -> atomic flash-loan receiver ->
 * receipt/profit verification -> Cryptara execution feedback.
 *
 * Europa/SKALE bootstrap and the historical $20 native-gas readiness gate are
 * retired from this runtime path.
 */

import { BigNumber, Wallet, ethers, providers } from 'ethers';
import logger from '../../../logger.js';
import { getCryptara } from '../../cryptara/index.js';
import { computationalBeam } from '../../computationalBeam/index.js';
import { CrawlerStrategy, type ComputeWorkload } from '../../computationalBeam/types.js';
import { TradingViewEngine } from '../babel/tradingview-integration.js';
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { stageManager } from '../governance/stage-management.js';
import { buildFlashLoanExecutionPlanFromOpportunity } from '../execution/adapters/autonomous-route-planner.js';
import { buildFlashLoanReceiverPayloadFromPlan } from '../execution/adapters/flashloan-receiver-builder.js';
import {
  loadConfiguredZeroCapitalRoutes,
  quoteConfiguredZeroCapitalRoutesForChain,
  type ConfiguredZeroCapitalRoute,
  type QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import { runProfitabilityMonteCarlo, type MonteCarloProfitabilityResult } from '../execution/adapters/monte-carlo-profitability.js';
import { calculateProgressivePositionSize } from '../risk/progressive-position-sizing.js';
import { multiProviderRpcManager, type SupportedChain as RpcSupportedChain } from '../api/blockchain-providers.js';
import type { NormalizedRealizedExecution } from '../execution/settlement-types.js';
import type { InitialGasReadiness } from '../initial-gas-readiness.js';
import { assertConfiguredWalletAddress, normalizePrivateKey, resolveConfiguredWalletAddress, walletFromPrivateKey } from './wallet-identity.js';
import { getGasSponsorManager } from '../strategies/gas-sponsorship.js';

// The admin controller still reads this legacy switch before starting the engine.
// Force the retired branch off so it cannot bootstrap/deploy Europa receivers.
process.env.ZERO_CAPITAL_EUROPA_RECEIVER_KIND = 'retired';

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
  profitRecipient?: string;
  profitRecipientStartingInputBalance?: bigint;
  profitRecipientEndingInputBalance?: bigint;
  zeroMonetaryGasVerified?: boolean;
  realizedFeeUsd?: number;
  realizedSlippageBps?: number;
  latencyMs?: number;
  slippage?: number;
  error?: string;
  blockNumber?: number;
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

export type SupportedChain = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'bsc' | 'avalanche' | 'europa';
type ActiveExecutionChain = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'bsc';

const RPC_ENDPOINTS: Record<ActiveExecutionChain, string> = {
  ethereum: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
  polygon: process.env.POLYGON_RPC_URL || 'https://polygon.llamarpc.com',
  arbitrum: process.env.ARBITRUM_RPC_URL || 'https://arbitrum.llamarpc.com',
  optimism: process.env.OPTIMISM_RPC_URL || 'https://optimism.llamarpc.com',
  bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
};

const RECEIVER_EVENT = new ethers.utils.Interface([
  'event FlashLoanExecuted(address indexed initiator, address indexed loanToken, uint256 loanAmount, uint256 profit)',
]);

export function composeConfiguredZeroCapitalRoutes(
  configuredRoutes: ConfiguredZeroCapitalRoute[],
  _dynamicEuropaRoute?: ConfiguredZeroCapitalRoute | null,
): ConfiguredZeroCapitalRoute[] {
  return configuredRoutes.filter(route => route.chain !== 'europa' && route.chain !== 'avalanche');
}

function sponsorshipReadiness(ready: boolean, reason?: string): InitialGasReadiness {
  return {
    status: ready ? 'INITIAL_GAS_READY' : 'PRE_STAGE_1_BOOTSTRAP',
    initialGasReady: ready,
    thresholdUsd: 0,
    usableNativeGasUsd: 0,
    measurements: [],
    observedAt: Date.now(),
    provenance: ['alchemy_gas_manager_policy', 'eip7702_smart_wallet', 'erc4337_user_operation'],
    reason,
  };
}

export class AutonomousZeroCapitalEngine {
  private readonly gasSponsor = getGasSponsorManager();
  private readonly providers = new Map<SupportedChain, providers.JsonRpcProvider>();
  private readonly executionWallets = new Map<SupportedChain, Wallet>();
  private configuredRoutes: ConfiguredZeroCapitalRoute[] = [];
  private opportunityQueue: ZeroCapitalOpportunity[] = [];
  private state: SystemState;
  private scanTimer: NodeJS.Timeout | null = null;
  private executionTimer: NodeJS.Timeout | null = null;
  private readinessTimer: NodeJS.Timeout | null = null;
  private scanning = false;
  private executing = false;
  private executionEligible = false;
  private executionEnabled = false;
  private marketOperationsStarted = false;
  private initialGasReadyCallback: (() => Promise<void>) | undefined;
  private initialGasLostCallback: (() => Promise<void>) | undefined;
  private scanDelayMs = Math.max(500, Number(process.env.ZERO_CAPITAL_SCAN_MIN_MS || 2500));
  private readonly minScanDelayMs = Math.max(500, Number(process.env.ZERO_CAPITAL_SCAN_MIN_MS || 2500));
  private readonly maxScanDelayMs = Math.max(this.minScanDelayMs, Number(process.env.ZERO_CAPITAL_SCAN_MAX_MS || 15000));
  private readonly readinessIntervalMs = Math.max(1000, Number(process.env.ZERO_CAPITAL_FUNDING_INTERVAL_MS || 15000));

  constructor() {
    this.state = {
      isRunning: false,
      totalProfit: 0n,
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
      initialGasReadiness: sponsorshipReadiness(false, 'Alchemy Gas Manager readiness has not been checked'),
      marketOperationsEnabled: false,
    };
  }

  async initialize(): Promise<void> {
    this.configuredRoutes = composeConfiguredZeroCapitalRoutes(loadConfiguredZeroCapitalRoutes());

    const chains = Object.keys(RPC_ENDPOINTS) as ActiveExecutionChain[];
    await multiProviderRpcManager.initialize(chains as RpcSupportedChain[]);
    for (const chain of chains) {
      try {
        let managed;
        try {
          managed = await multiProviderRpcManager.getProvider(chain as RpcSupportedChain, 'json_rpc');
        } catch {
          await multiProviderRpcManager.registerProvider({
            provider: 'ZeroCapitalConfiguredRPC',
            chain: chain as RpcSupportedChain,
            httpUrl: RPC_ENDPOINTS[chain],
            priority: 1,
          });
          managed = await multiProviderRpcManager.getProvider(chain as RpcSupportedChain, 'json_rpc');
        }
        await managed.http.getNetwork();
        this.providers.set(chain, managed.http);
      } catch (error) {
        logger.warn('[ZeroCapitalEngine] RPC unavailable', {
          component: 'ZeroCapitalEngine',
          chain,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const rawPrivateKey = process.env.WALLET_PRIVATE_KEY;
    const privateKey = normalizePrivateKey(rawPrivateKey) || undefined;
    if (rawPrivateKey && !privateKey) throw new Error('WALLET_PRIVATE_KEY is not a valid 32-byte EVM private key');
    if (privateKey) {
      assertConfiguredWalletAddress(privateKey);
      for (const [chain, provider] of this.providers) {
        this.executionWallets.set(chain, walletFromPrivateKey(privateKey).connect(provider));
      }
    }

    const alchemyNetworks = (['ethereum', 'polygon', 'arbitrum', 'optimism'] as const)
      .filter(chain => this.providers.has(chain));
    if (alchemyNetworks.length > 0) await alchemyIntegration.start([...alchemyNetworks]);

    await this.refreshSponsorshipReadiness();
    await this.refreshWalletResources();
    logger.info('[ZeroCapitalEngine] Alchemy-sponsored execution initialized', {
      component: 'ZeroCapitalEngine',
      connectedChains: Array.from(this.providers.keys()),
      configuredRoutes: this.configuredRoutes.length,
      sponsorshipReady: this.state.initialGasReadiness.initialGasReady,
    });
  }

  async start(options: {
    onInitialGasReady?: () => Promise<void>;
    onInitialGasLost?: () => Promise<void>;
  } = {}): Promise<void> {
    if (this.state.isRunning) return;
    if (this.providers.size === 0) await this.initialize();
    if (this.providers.size === 0) throw new Error('No supported blockchain provider is reachable');

    this.executionEligible = process.env.ZERO_CAPITAL_ENABLE_EXECUTION === 'true';
    this.initialGasReadyCallback = options.onInitialGasReady;
    this.initialGasLostCallback = options.onInitialGasLost;

    if (this.executionEligible) {
      if (process.env.NO_EXECUTION === 'true') throw new Error('ZERO_CAPITAL_ENABLE_EXECUTION=true conflicts with NO_EXECUTION=true');
      if (
        process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION !== 'true' ||
        process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION !== 'I_ACCEPT_LIVE_ORDER_RISK' ||
        process.env.ZERO_CAPITAL_EXECUTION_CONFIRMATION !== 'I_ACCEPT_ZERO_CAPITAL_EXECUTION_RISK'
      ) {
        throw new Error('Live zero-capital execution confirmations are incomplete');
      }
      const receiver = String(process.env.ZERO_CAPITAL_FLASHLOAN_RECEIVER || '').trim();
      if (!ethers.utils.isAddress(receiver)) throw new Error('ZERO_CAPITAL_FLASHLOAN_RECEIVER must be configured');
      if (this.executionWallets.size === 0) throw new Error('WALLET_PRIVATE_KEY is required for sponsored execution');
      const sponsor = this.gasSponsor.getReadiness();
      if (!sponsor.ready) throw new Error(sponsor.reason || 'Alchemy Gas Manager is not ready');

      const cryptara = getCryptara();
      if (!cryptara.getStatus().isRunning) await cryptara.initialize();
      const signals = await cryptara.validateLiveSignalReadiness({ strictLive: true });
      if (!signals.liveSignalReady) {
        throw new Error(`Cryptara/Tara live signal stack is not ready: ${signals.tradingView.detail}; ${signals.alchemy.detail}`);
      }
    }

    this.state.isRunning = true;
    const readiness = await this.refreshSponsorshipReadiness();
    if (!readiness.initialGasReady) {
      this.state.isRunning = false;
      throw new Error(readiness.reason || 'Alchemy sponsored execution readiness is unavailable');
    }

    if (stageManager.isMarketOperationsAllowed()) await this.startMarketOperations();
    this.startReadinessLoop();
  }

  private async refreshSponsorshipReadiness(): Promise<InitialGasReadiness> {
    const sponsor = this.gasSponsor.getReadiness();
    const configuredWallet = resolveConfiguredWalletAddress();
    const walletReady = this.executionWallets.size > 0 || !!configuredWallet.address;
    const providerReady = this.providers.size > 0;
    const ready = sponsor.ready && walletReady && providerReady;
    const reason = !sponsor.ready
      ? sponsor.reason
      : !walletReady
        ? configuredWallet.reason || 'No authoritative execution wallet is configured'
        : !providerReady
          ? 'No supported execution-chain provider is reachable'
          : undefined;

    const readiness = sponsorshipReadiness(ready, reason);
    this.state.initialGasReadiness = readiness;
    this.state.bootstrapState = ready ? 'INITIAL_GAS_READY' : 'PRE_STAGE_1_BOOTSTRAP';
    stageManager.setInitialGasReadiness(readiness);
    this.state.marketOperationsEnabled = ready && stageManager.isMarketOperationsAllowed();
    return readiness;
  }

  private startReadinessLoop(): void {
    if (this.readinessTimer) clearTimeout(this.readinessTimer);
    const cycle = async (): Promise<void> => {
      if (!this.state.isRunning) return;
      this.state.fundingCycleActive = true;
      try {
        const readiness = await this.refreshSponsorshipReadiness();
        await this.refreshWalletResources();
        this.state.fundingCycles++;
        this.state.lastFundingCycleAt = Date.now();
        this.state.lastFundingError = undefined;

        if (!readiness.initialGasReady) {
          this.suspendMarketOperations(readiness.reason || 'Alchemy sponsorship readiness was lost');
        } else if (stageManager.isMarketOperationsAllowed() && !this.marketOperationsStarted) {
          await this.startMarketOperations();
        }

        const mayExecute = this.executionEligible && stageManager.canExecuteTrades();
        if (mayExecute && this.marketOperationsStarted && !this.executionEnabled) {
          this.executionEnabled = true;
          this.startExecutionLoop();
        } else if (!mayExecute && this.executionEnabled) {
          this.executionEnabled = false;
          if (this.executionTimer) clearInterval(this.executionTimer);
          this.executionTimer = null;
        }
      } catch (error) {
        this.state.lastFundingError = error instanceof Error ? error.message : String(error);
      } finally {
        this.state.fundingCycleActive = false;
        if (this.state.isRunning) this.readinessTimer = setTimeout(() => void cycle(), this.readinessIntervalMs);
      }
    };
    void cycle();
  }

  private async startMarketOperations(): Promise<void> {
    if (!this.state.isRunning || this.marketOperationsStarted || !stageManager.isMarketOperationsAllowed()) return;
    this.marketOperationsStarted = true;
    this.state.marketOperationsEnabled = true;
    this.executionEnabled = this.executionEligible && stageManager.canExecuteTrades();
    this.startScanningLoop();
    if (this.executionEnabled) this.startExecutionLoop();
    if (this.initialGasReadyCallback) await this.initialGasReadyCallback();
  }

  private suspendMarketOperations(reason: string): void {
    const wasStarted = this.marketOperationsStarted;
    this.marketOperationsStarted = false;
    this.state.marketOperationsEnabled = false;
    this.executionEnabled = false;
    this.state.lastFundingError = reason;
    if (this.scanTimer) clearTimeout(this.scanTimer);
    if (this.executionTimer) clearInterval(this.executionTimer);
    this.scanTimer = null;
    this.executionTimer = null;
    if (wasStarted && this.initialGasLostCallback) void this.initialGasLostCallback().catch(() => undefined);
  }

  private startScanningLoop(): void {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    const cycle = async (): Promise<void> => {
      if (!this.state.isRunning || !this.marketOperationsStarted || this.scanning) return;
      this.scanning = true;
      let degraded = false;
      try {
        const settled = await Promise.allSettled(
          Array.from(this.providers.entries()).map(([chain, provider]) => this.scanChain(chain, provider)),
        );
        const opportunities: ZeroCapitalOpportunity[] = [];
        for (const result of settled) {
          if (result.status === 'fulfilled') opportunities.push(...result.value);
          else degraded = true;
        }
        this.opportunityQueue = opportunities
          .filter(opportunity => opportunity.expectedProfit > 0n && Date.now() <= opportunity.expiresAt)
          .sort((left, right) => left.expectedProfit === right.expectedProfit ? 0 : left.expectedProfit > right.expectedProfit ? -1 : 1);
        this.state.currentOpportunities = this.opportunityQueue.length;
        this.scanDelayMs = degraded
          ? Math.min(this.maxScanDelayMs, Math.floor(this.scanDelayMs * 1.5))
          : this.opportunityQueue.length > 0
            ? this.minScanDelayMs
            : Math.min(this.maxScanDelayMs, Math.floor(this.scanDelayMs * 1.2));
      } finally {
        this.scanning = false;
        if (this.state.isRunning && this.marketOperationsStarted) {
          this.scanTimer = setTimeout(() => void cycle(), this.scanDelayMs);
        }
      }
    };
    void cycle();
  }

  private async scanChain(
    chain: SupportedChain,
    provider: providers.JsonRpcProvider,
  ): Promise<ZeroCapitalOpportunity[]> {
    if (chain === 'europa' || chain === 'avalanche') return [];
    const block = await provider.getBlock('latest');
    const quotes = await quoteConfiguredZeroCapitalRoutesForChain(chain, provider, this.configuredRoutes);
    const accepted: ZeroCapitalOpportunity[] = [];
    for (const quote of quotes) {
      const opportunity = this.fromQuotedRoute(quote, block.timestamp);
      if (!this.executionEnabled || await this.isAllowedByCryptara(opportunity)) accepted.push(opportunity);
    }
    return accepted;
  }

  private fromQuotedRoute(quote: QuotedZeroCapitalRoute, blockTimestamp: number): ZeroCapitalOpportunity {
    const ttlMs = Math.max(1000, Number(process.env.ZERO_CAPITAL_ROUTE_TTL_MS || 3000));
    const executionCost = quote.estimatedGasCostInInputToken + quote.flashLoanFeeInInputToken + quote.relayFeeInInputToken;
    return {
      id: `${quote.id}-${blockTimestamp}-${Date.now()}`,
      type: 'arbitrage',
      chain: quote.chain,
      inputToken: quote.inputToken,
      outputToken: quote.inputToken,
      inputAssetSymbol: quote.inputAssetSymbol,
      inputTokenDecimals: quote.inputTokenDecimals,
      flashLoanAmount: quote.amountIn,
      expectedProfit: quote.netProfit,
      grossProfit: quote.grossProfit,
      gasEstimate: 0n,
      estimatedExecutionCostInInputToken: executionCost,
      estimatedGasCostInInputToken: quote.estimatedGasCostInInputToken,
      flashLoanFeeInInputToken: quote.flashLoanFeeInInputToken,
      relayFeeInInputToken: quote.relayFeeInInputToken,
      expectedSlippageBps: this.expectedSlippageBps(quote.route.length),
      quoteLatencyMs: quote.quoteLatencyMs,
      netProfitBps: quote.netProfitBps,
      route: quote.route.map(step => ({
        protocol: step.protocol,
        tokenIn: step.tokenIn,
        tokenOut: step.tokenOut,
        amountIn: BigInt(String(step.amountIn)),
        expectedAmountOut: BigInt(String(step.expectedAmountOut)),
        fee: step.fee,
      })),
      confidence: Math.min(0.99, 0.55 + Math.min(0.44, quote.netProfitBps / 1000)),
      timestamp: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };
  }

  private expectedSlippageBps(legs: number): number {
    const minOutputBps = Math.max(9000, Math.min(10000, Number(process.env.ZERO_CAPITAL_ROUTE_MIN_OUTPUT_BPS || 9990)));
    return Math.max(0, legs * (10000 - minOutputBps));
  }

  private async isAllowedByCryptara(opportunity: ZeroCapitalOpportunity): Promise<boolean> {
    const cryptara = getCryptara();
    const directive = cryptara.getAutonomousDirective();
    const maxSlippageBps = Math.max(1, Math.min(
      directive.maxSlippageBps,
      Number(process.env.ZERO_CAPITAL_MAX_SLIPPAGE_BPS || 20),
    ));
    if (!directive.preferredExecutionModes.includes('zero_capital')) return false;
    if (directive.riskBudget === 'defensive' && !directive.preferredChains.includes(opportunity.chain)) return false;
    if (opportunity.expectedSlippageBps > maxSlippageBps) return false;
    if (this.toUsd(opportunity.expectedProfit, opportunity.inputTokenDecimals) < directive.minimumNetProfitUsd) return false;

    const readiness = await cryptara.validateLiveSignalReadiness({ strictLive: true });
    if (!readiness.liveSignalReady) return false;
    const analysis = await TradingViewEngine.getAnalysis(process.env.ZERO_CAPITAL_SIGNAL_SYMBOL || 'ETHUSDT', '1h');
    if (TradingViewEngine.getHealthStatus().mode !== 'live') return false;
    return analysis.summary.strength >= Math.max(0, Number(process.env.ZERO_CAPITAL_MIN_SIGNAL_STRENGTH || 0));
  }

  private async validateUnifiedControl(
    opportunity: ZeroCapitalOpportunity,
  ): Promise<{ approved: boolean; reason: string; monteCarlo: MonteCarloProfitabilityResult }> {
    const notionalUsd = this.toUsd(opportunity.flashLoanAmount, opportunity.inputTokenDecimals);
    const expectedNetProfitUsd = this.toUsd(opportunity.expectedProfit, opportunity.inputTokenDecimals);
    const executionCostUsd = this.toUsd(opportunity.estimatedExecutionCostInInputToken, opportunity.inputTokenDecimals);
    const monteCarlo = runProfitabilityMonteCarlo({
      seed: opportunity.id,
      notionalUsd,
      expectedNetProfitUsd,
      estimatedExecutionCostUsd: executionCostUsd,
      expectedSlippageBps: opportunity.expectedSlippageBps,
      quoteLatencyMs: opportunity.quoteLatencyMs,
      confidence: opportunity.confidence,
    });

    const sizing = calculateProgressivePositionSize({
      requestedNotionalUsd: notionalUsd,
      availableCapitalUsd: 0,
      expectedNetProfitUsd,
      expectedCostUsd: executionCostUsd,
      expectedSlippageBps: opportunity.expectedSlippageBps,
      liquidityScore: opportunity.confidence,
      volatilityScore: Math.min(1, opportunity.expectedSlippageBps / 100),
      providerHealthy: this.providers.has(opportunity.chain),
      zeroCapitalAvailable: this.gasSponsor.isEnabled(),
    });

    if (!computationalBeam.isOperational()) await computationalBeam.initialize();
    const workload: ComputeWorkload<
      { monteCarlo: MonteCarloProfitabilityResult; positionApproved: boolean; sponsorReady: boolean },
      { approved: boolean; reason: string }
    > = {
      id: `beam-tara-monte-carlo:${opportunity.id}`,
      type: 'MONTE_CARLO_EXECUTION_VALIDATION',
      input: {
        monteCarlo,
        positionApproved: sizing.approved && sizing.proposedNotionalUsd > 0,
        sponsorReady: this.gasSponsor.isEnabled(),
      },
      timeoutMs: Math.max(1000, Number(process.env.ZERO_CAPITAL_BEAM_VALIDATION_TIMEOUT_MS || 10_000)),
      execute: input => {
        if (!input.sponsorReady) return { approved: false, reason: 'Alchemy Gas Manager is not ready' };
        if (!input.positionApproved) return { approved: false, reason: 'Progressive position sizing rejected the trade' };
        if (!input.monteCarlo.approved) return { approved: false, reason: input.monteCarlo.reason };
        return { approved: true, reason: `Beam approved Tara/Monte Carlo execution: ${input.monteCarlo.reason}` };
      },
      validate: result => typeof result.approved === 'boolean' && typeof result.reason === 'string',
    };

    const beam = await computationalBeam.executeCrawlerTask(
      CrawlerStrategy.ARBITRAGE,
      {
        opportunityId: opportunity.id,
        expectedNetProfitUsd,
        expectedSlippageBps: opportunity.expectedSlippageBps,
        profitableProbability: monteCarlo.profitableProbability,
      },
      { timeout: workload.timeoutMs, workload },
    );
    return { ...(beam.result as { approved: boolean; reason: string }), monteCarlo };
  }

  private startExecutionLoop(): void {
    if (this.executionTimer) clearInterval(this.executionTimer);
    this.executionTimer = setInterval(() => void this.executeNextOpportunity(), 500);
  }

  private async executeNextOpportunity(): Promise<void> {
    if (!this.state.isRunning || !this.executionEnabled || this.executing) return;
    const opportunity = this.opportunityQueue.shift();
    if (!opportunity || Date.now() > opportunity.expiresAt) return;
    this.executing = true;
    let result: ExecutionResult;
    try {
      result = await this.executeOpportunity(opportunity);
    } catch (error) {
      result = { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.executing = false;
    }

    await this.recordExecutionFeedback(opportunity, result);
    this.state.totalTrades++;
    if (result.success && result.profitVerified) {
      this.state.successfulTrades++;
      this.state.totalProfit += result.profit || 0n;
      this.state.lastTradeTimestamp = Date.now();
    } else if (result.success) {
      this.state.includedUnverifiedTrades++;
      getCryptocrawlGovernance().pause('system', 'zero_capital_profit_unverified');
    } else {
      this.state.failedTrades++;
    }
  }

  private async executeOpportunity(opportunity: ZeroCapitalOpportunity): Promise<ExecutionResult> {
    if (!stageManager.isMarketOperationsAllowed() || !stageManager.canExecuteTrades()) {
      return { success: false, error: 'Governance does not authorize live execution' };
    }
    if (opportunity.chain === 'europa' || opportunity.chain === 'avalanche') {
      return { success: false, error: `${opportunity.chain} is not in the active Alchemy Wallet API execution set` };
    }
    if (!await this.isAllowedByCryptara(opportunity)) {
      return { success: false, error: 'Cryptara/Tara rejected the opportunity at execution time' };
    }

    const control = await this.validateUnifiedControl(opportunity);
    if (!control.approved) return { success: false, error: control.reason };

    const governance = getCryptocrawlGovernance();
    const pair = `${opportunity.inputAssetSymbol}/CYCLIC`;
    governance.requireAllowed('EXECUTE_OPPORTUNITY', { chain: opportunity.chain, pair, venue: 'alchemy-gas-manager' });
    governance.requireAllowed('SUBMIT_TX', { chain: opportunity.chain, pair, venue: 'alchemy-gas-manager' });
    governance.recordExecutionAttempt();
    return this.executeSponsored(opportunity);
  }

  private async executeSponsored(opportunity: ZeroCapitalOpportunity): Promise<ExecutionResult> {
    const provider = this.providers.get(opportunity.chain);
    const wallet = this.executionWallets.get(opportunity.chain);
    if (!provider || !wallet) return { success: false, error: `No execution wallet/provider for ${opportunity.chain}` };

    const startedAt = Date.now();
    try {
      const plan = buildFlashLoanExecutionPlanFromOpportunity(opportunity, {
        receiver: process.env.ZERO_CAPITAL_FLASHLOAN_RECEIVER,
        profitRecipient: process.env.CRYPTO_PROFIT_WALLET_ADDRESS || wallet.address,
      });
      const payload = buildFlashLoanReceiverPayloadFromPlan(plan);
      const network = await provider.getNetwork();
      const sponsored = await this.gasSponsor.execute({
        wallet,
        chainId: network.chainId,
        calls: [{ to: payload.to, data: payload.data, value: BigNumber.from(payload.value) }],
        timeoutMs: Math.max(10_000, Number(process.env.ZERO_CAPITAL_SPONSORED_TX_TIMEOUT_MS || 60_000)),
      });

      let receipt = await provider.getTransactionReceipt(sponsored.transactionHash);
      if (!receipt) receipt = await provider.waitForTransaction(sponsored.transactionHash, 1, 15_000);
      if (!receipt || receipt.status !== 1) {
        return { success: false, txHash: sponsored.transactionHash, error: 'Sponsored receiver transaction was not confirmed successfully' };
      }

      const profit = this.extractProfit(receipt, payload.to);
      if (profit === null || profit <= 0n) {
        return { success: false, txHash: sponsored.transactionHash, error: 'No positive verified FlashLoanExecuted profit was emitted' };
      }

      this.state.gaslessTransactions++;
      const result: ExecutionResult = {
        success: true,
        txHash: sponsored.transactionHash,
        profit,
        profitVerified: true,
        gasUsed: BigInt(receipt.gasUsed.toString()),
        receiptStatus: 1,
        nativeFeeWei: 0n,
        zeroMonetaryGasVerified: true,
        latencyMs: Date.now() - startedAt,
        blockNumber: receipt.blockNumber,
      };
      result.normalized = this.normalizeSettlement(opportunity, result);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  private extractProfit(receipt: providers.TransactionReceipt, receiver: string): bigint | null {
    for (const entry of receipt.logs) {
      if (entry.address.toLowerCase() !== receiver.toLowerCase()) continue;
      try {
        const parsed = RECEIVER_EVENT.parseLog(entry);
        if (parsed.name === 'FlashLoanExecuted') return BigInt(parsed.args.profit.toString());
      } catch {
        // Ignore unrelated receiver logs.
      }
    }
    return null;
  }

  private normalizeSettlement(opportunity: ZeroCapitalOpportunity, result: ExecutionResult): NormalizedRealizedExecution | undefined {
    if (!result.txHash || result.blockNumber === undefined) return undefined;
    return {
      status: result.success && result.profitVerified ? 'filled' : 'failed',
      terminal: true,
      settlementConfirmed: result.success && result.profitVerified === true,
      submittedAt: Date.now() - Math.max(0, result.latencyMs || 0),
      settledAt: Date.now(),
      venueOrRoute: opportunity.route.map(step => step.protocol).join('->') || 'alchemy-sponsored',
      chain: opportunity.chain,
      predicted: {
        profitUsd: this.toUsd(opportunity.expectedProfit, opportunity.inputTokenDecimals),
        feeUsd: this.toUsd(opportunity.estimatedExecutionCostInInputToken, opportunity.inputTokenDecimals),
        slippageBps: opportunity.expectedSlippageBps,
      },
      realized: {
        acquisitionCostUsd: null,
        proceedsUsd: null,
        exchangeFeeUsd: null,
        gasUsd: null,
        gasUsed: result.gasUsed?.toString() || null,
        effectiveGasPriceWei: null,
        slippageBps: result.realizedSlippageBps ?? null,
        netProfitUsd: result.profit !== undefined ? this.toUsd(result.profit, opportunity.inputTokenDecimals) : null,
      },
      provenance: [
        'cryptara_live_intelligence',
        'computational_beam',
        'monte_carlo_profitability',
        'alchemy_gas_manager',
        'eip7702_smart_wallet',
        'erc4337_user_operation',
        'flashloan_receiver_profit_verified',
      ],
      transactionHash: result.txHash,
      blockNumber: result.blockNumber,
      receiptStatus: result.receiptStatus,
      error: result.error,
    };
  }

  private async recordExecutionFeedback(opportunity: ZeroCapitalOpportunity, result: ExecutionResult): Promise<void> {
    try {
      const normalized = result.normalized || this.normalizeSettlement(opportunity, result);
      if (!normalized?.terminal) return;
      await recordCryptaraExecutionEvidence({
        source: 'zero_capital',
        opportunityId: opportunity.id,
        chain: opportunity.chain,
        symbol: `${opportunity.inputToken}/${opportunity.outputToken}`,
        strategy: opportunity.type,
        success: result.success,
        expectedProfitUsd: normalized.predicted.profitUsd ?? this.toUsd(opportunity.expectedProfit, opportunity.inputTokenDecimals),
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
      });
    } catch {
      // Best-effort learning feedback; the on-chain receipt remains authoritative.
    }
  }

  private async refreshWalletResources(): Promise<WalletResourceSnapshot[]> {
    const configured = resolveConfiguredWalletAddress();
    const snapshots = await Promise.all(Array.from(this.providers.entries()).map(async ([chain, provider]) => {
      const wallet = this.executionWallets.get(chain);
      const address = wallet?.address || configured.address;
      const observedAt = Date.now();
      if (!address) {
        return {
          chain,
          nativeBalance: '0',
          assetBalances: {},
          observedAt,
          status: 'unavailable' as const,
          error: configured.reason || 'No execution wallet is configured',
        };
      }
      try {
        const balance = await provider.getBalance(address);
        return {
          chain,
          walletAddress: address,
          walletAddressSource: wallet ? 'execution_wallet' as const : configured.source || undefined,
          nativeBalance: balance.toString(),
          assetBalances: {},
          observedAt,
          status: 'available' as const,
        };
      } catch (error) {
        return {
          chain,
          walletAddress: address,
          walletAddressSource: wallet ? 'execution_wallet' as const : configured.source || undefined,
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

  private toUsd(value: bigint | undefined, decimals: number): number {
    if (value === undefined) return 0;
    const amount = Number(ethers.utils.formatUnits(value.toString(), decimals));
    return Number.isFinite(amount) ? amount : 0;
  }

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
    if (this.scanTimer) clearTimeout(this.scanTimer);
    if (this.executionTimer) clearInterval(this.executionTimer);
    if (this.readinessTimer) clearTimeout(this.readinessTimer);
    this.scanTimer = null;
    this.executionTimer = null;
    this.readinessTimer = null;
  }

  getState(): SystemState {
    return {
      ...this.state,
      walletResources: this.state.walletResources.map(item => ({ ...item, assetBalances: { ...item.assetBalances } })),
      initialGasReadiness: {
        ...this.state.initialGasReadiness,
        measurements: this.state.initialGasReadiness.measurements.map(item => ({ ...item })),
        provenance: [...this.state.initialGasReadiness.provenance],
      },
    };
  }

  getStats() {
    return {
      isRunning: this.state.isRunning,
      totalProfit: ethers.utils.formatUnits(this.state.totalProfit.toString(), 6),
      totalTrades: this.state.totalTrades,
      successfulTrades: this.state.successfulTrades,
      includedUnverifiedTrades: this.state.includedUnverifiedTrades,
      failedTrades: this.state.failedTrades,
      successRate: this.state.totalTrades > 0
        ? `${((this.state.successfulTrades / this.state.totalTrades) * 100).toFixed(2)}%`
        : '0%',
      currentOpportunities: this.state.currentOpportunities,
      gaslessTransactions: this.state.gaslessTransactions,
      fundingCycleActive: this.state.fundingCycleActive,
      fundingCycles: this.state.fundingCycles,
      lastFundingCycleAt: this.state.lastFundingCycleAt,
      lastFundingError: this.state.lastFundingError,
      walletResources: this.state.walletResources,
      bootstrapState: this.state.bootstrapState,
      initialGasReadiness: this.state.initialGasReadiness,
      marketOperationsEnabled: this.state.marketOperationsEnabled,
      capitalRequired: 'No $20 native-gas bootstrap; Alchemy sponsors EIP-7702/ERC-4337 execution and Beam/Tara/Monte Carlo gate profitability before submission',
    };
  }
}

export const zeroCapitalEngine = new AutonomousZeroCapitalEngine();
export default zeroCapitalEngine;
