/**
 * Canonical zero-capital runtime context.
 *
 * This object owns provider/wallet/runtime capability state only. It does not own
 * discovery cadence, opportunity queues, scheduling, receiver setup authority,
 * or transaction submission. ZERO_CAPITAL_ATOMIC flows through exactly one live
 * path:
 *
 * CanonicalZeroCapitalDiscovery -> measured candidate registry ->
 * CanonicalExecutionScheduler -> CanonicalZeroCapitalExecutor.
 */

import { ethers, Wallet, providers } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager, type SupportedChain as RpcSupportedChain } from '../api/blockchain-providers.js';
import {
  loadConfiguredZeroCapitalRoutes,
  quoteConfiguredZeroCapitalRoutesForChain,
  type ConfiguredZeroCapitalRoute,
  type QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import {
  getSponsoredReceiverManager,
  supportsSponsoredReceiverChain,
  type SponsoredReceiverRecord,
} from '../execution/adapters/sponsored-receiver-manager.js';
import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';
import type { NormalizedRealizedExecution } from '../execution/settlement-types.js';
import type { InitialGasReadiness } from '../initial-gas-readiness.js';
import { getGasSponsorManager } from '../strategies/gas-sponsorship.js';
import { getProfitEstimates, type ProfitEstimate } from '../intelligence/profit-estimator.js';
import { enrichConfiguredZeroCapitalGasEconomics } from '../discovery/configured-zero-capital-gas-economics.js';
import { ensureDynamicRpcProviderWiring } from '../runtime/dynamic-rpc-provider-wiring.js';
import { getProvenZeroCapitalGasFundingDecision } from '../runtime/system-owned-gas-funding-proof-wiring.js';
import { assertConfiguredWalletAddress, normalizePrivateKey, resolveConfiguredWalletAddress, walletFromPrivateKey } from './wallet-identity.js';
import { loadDynamicChainRegistry, type DynamicChainConfig } from './dynamic-chain-registry.js';

process.env.ZERO_CAPITAL_EUROPA_RECEIVER_KIND = 'retired';

export interface ZeroCapitalOpportunity {
  id: string;
  type: 'arbitrage' | 'liquidation' | 'sandwich' | 'backrun';
  chain: SupportedChain;
  inputToken: string;
  outputToken: string;
  inputAssetSymbol: 'USDC' | 'USDT';
  inputTokenDecimals: number;
  inputAssetUsdPrice?: number;
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
  effectiveGasPriceWei?: bigint;
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
  receiverRegistry: SponsoredReceiverRecord[];
  bootstrapState: 'PRE_STAGE_1_BOOTSTRAP' | 'INITIAL_GAS_READY';
  initialGasReadiness: InitialGasReadiness;
  marketOperationsEnabled: boolean;
  gasFundingDecisions: GasFundingDecision[];
  profitEstimates: ProfitEstimate[];
  activeExecutions: number;
  activeExecutionChains: SupportedChain[];
  maxConcurrentExecutions: number;
}

export type SupportedChain = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'bsc' | 'avalanche' | 'europa';
type ActiveExecutionChain = Exclude<SupportedChain, 'europa'>;

const RPC_ENDPOINTS: Record<ActiveExecutionChain, string> = {
  ethereum: process.env.ETHEREUM_RPC_URL || process.env.ETHEREM_RPC_URL || 'https://eth.llamarpc.com',
  polygon: process.env.POLYGON_RPC_URL || 'https://polygon.llamarpc.com',
  arbitrum: process.env.ARBITRUM_RPC_URL || 'https://arbitrum.llamarpc.com',
  optimism: process.env.OPTIMISM_RPC_URL || 'https://optimism.llamarpc.com',
  bsc: process.env.BSC_RPC_URL || process.env.BNB_SMART_CHAIN_RPC_URL || 'https://bsc-dataseed.binance.org',
  avalanche: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
};

const NATIVE_ASSETS: Record<ActiveExecutionChain, string> = {
  ethereum: 'ETH',
  polygon: 'POL',
  arbitrum: 'ETH',
  optimism: 'ETH',
  bsc: 'BNB',
  avalanche: 'AVAX',
};

/** Explicit route configuration is an input source, not the merged route authority. */
export function composeConfiguredZeroCapitalRoutes(
  configuredRoutes: ConfiguredZeroCapitalRoute[],
  _dynamicEuropaRoute?: ConfiguredZeroCapitalRoute | null,
): ConfiguredZeroCapitalRoute[] {
  return configuredRoutes.filter(route => route.chain !== 'europa' && supportsSponsoredReceiverChain(route.chain));
}

function executionReadiness(ready: boolean, reason?: string): InitialGasReadiness {
  return {
    status: ready ? 'INITIAL_GAS_READY' : 'PRE_STAGE_1_BOOTSTRAP',
    initialGasReady: ready,
    thresholdUsd: 0,
    usableNativeGasUsd: 0,
    measurements: [],
    observedAt: Date.now(),
    provenance: [
      'runtime_context_only',
      'gas_truth:getProvenZeroCapitalGasFundingDecision',
      'receiver_truth:canonical_zero_capital_discovery',
      'scheduler_truth:canonical_execution_scheduler',
      'execution_truth:canonical_zero_capital_executor',
    ],
    reason,
  };
}

export class AutonomousZeroCapitalEngine {
  readonly gasSponsor = getGasSponsorManager();
  readonly receiverManager = getSponsoredReceiverManager();
  readonly providers = new Map<SupportedChain, providers.JsonRpcProvider>();
  readonly executionWallets = new Map<SupportedChain, Wallet>();
  readonly dynamicChainConfigs = new Map<ActiveExecutionChain, DynamicChainConfig>();
  configuredRoutes: ConfiguredZeroCapitalRoute[] = [];

  private initialized = false;
  private walletResourceRefreshInFlight: Promise<void> | null = null;
  private state: SystemState;

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
      receiverRegistry: [],
      bootstrapState: 'PRE_STAGE_1_BOOTSTRAP',
      initialGasReadiness: executionReadiness(false, 'Canonical zero-capital resource stage has not yet proven a route'),
      marketOperationsEnabled: false,
      gasFundingDecisions: [],
      profitEstimates: [],
      activeExecutions: 0,
      activeExecutionChains: [],
      maxConcurrentExecutions: 0,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      this.scheduleWalletResourceRefresh();
      this.state.receiverRegistry = this.receiverManager.getRecords();
      this.state.isRunning = true;
      return;
    }

    const initializationStartedAt = Date.now();
    this.configuredRoutes = composeConfiguredZeroCapitalRoutes(loadConfiguredZeroCapitalRoutes());
    const configuredDynamicChains = loadDynamicChainRegistry();
    const dynamicEvmOverrides = new Map<ActiveExecutionChain, DynamicChainConfig>();
    for (const chain of configuredDynamicChains) {
      if (chain.family !== 'evm') {
        logger.info('[ZeroCapitalEngine] Non-EVM chain retained outside ethers execution context', {
          component: 'ZeroCapitalEngine',
          chain: chain.id,
          family: chain.family,
          executionAuthority: false,
        });
        continue;
      }
      if (!(chain.id in RPC_ENDPOINTS)) continue;
      dynamicEvmOverrides.set(chain.id as ActiveExecutionChain, chain);
    }

    const chains = Object.keys(RPC_ENDPOINTS) as ActiveExecutionChain[];
    for (const chain of chains) {
      const fallback: DynamicChainConfig = {
        id: chain,
        family: 'evm',
        rpcUrl: RPC_ENDPOINTS[chain],
        nativeAsset: NATIVE_ASSETS[chain],
        // Receiver support proves only that a compatible receiver may exist. It
        // never proves an external gas payer or zero operator monetary liability.
        sponsoredBootstrap: false,
        executionMode: 'native_only',
      };
      this.dynamicChainConfigs.set(chain, dynamicEvmOverrides.get(chain) || fallback);
    }

    // Register the existing free/configured provider mesh before zero-capital
    // selects any live chain provider. Alchemy is not a bootstrap, failover, or
    // paid telemetry dependency for this engine.
    await ensureDynamicRpcProviderWiring();
    await multiProviderRpcManager.initialize(chains as RpcSupportedChain[]);

    // Provider health/chain identity was already established by the canonical RPC
    // manager. Resolve chains concurrently so one slow provider remains local.
    const providerOutcomes = await Promise.allSettled(chains.map(async chain => {
      const chainConfig = this.dynamicChainConfigs.get(chain)!;
      let managed;
      try {
        managed = await multiProviderRpcManager.getProvider(chain as RpcSupportedChain, 'json_rpc');
      } catch {
        await multiProviderRpcManager.registerProvider({
          provider: 'ZeroCapitalConfiguredRPC',
          chain: chain as RpcSupportedChain,
          httpUrl: chainConfig.rpcUrl,
          priority: 1,
        });
        managed = await multiProviderRpcManager.getProvider(chain as RpcSupportedChain, 'json_rpc');
      }
      this.providers.set(chain, managed.http);
      return chain;
    }));
    providerOutcomes.forEach((outcome, index) => {
      if (outcome.status === 'rejected') {
        logger.warn('[ZeroCapitalEngine] RPC unavailable to canonical zero-capital runtime context', {
          component: 'ZeroCapitalEngine',
          chain: chains[index],
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
          executionAuthority: false,
          routeLocalFailure: true,
        });
      }
    });

    const rawPrivateKey = process.env.WALLET_PRIVATE_KEY;
    const privateKey = normalizePrivateKey(rawPrivateKey) || undefined;
    if (rawPrivateKey && !privateKey) throw new Error('WALLET_PRIVATE_KEY is not a valid 32-byte EVM private key');
    if (privateKey) {
      assertConfiguredWalletAddress(privateKey);
      for (const [chain, provider] of this.providers) {
        this.executionWallets.set(chain, walletFromPrivateKey(privateKey).connect(provider));
      }
    }

    // Operator wallet balances are redundancy/telemetry for zero-capital routes,
    // never a cold-start prerequisite. Mark the runtime ready first and refresh
    // balances asynchronously through the existing route-local provider failover.
    this.state.receiverRegistry = this.receiverManager.getRecords();
    this.state.isRunning = true;
    this.initialized = true;
    this.scheduleWalletResourceRefresh();

    logger.info('[ZeroCapitalEngine] Canonical zero-capital runtime context initialized', {
      component: 'ZeroCapitalEngine',
      connectedChains: Array.from(this.providers.keys()),
      explicitConfiguredRoutes: this.configuredRoutes.length,
      initializationDurationMs: Date.now() - initializationStartedAt,
      walletResourceTelemetryBlocksStartup: false,
      providerIdentityReprobedAfterCanonicalHealth: false,
      providerAuthority: 'multiProviderRpcManager_free_and_configured_mesh',
      alchemyOperationalAuthority: false,
      routeAuthority: 'zero_capital_route_authority',
      discoveryAuthority: 'CanonicalZeroCapitalDiscovery',
      gasFundingAuthority: 'getProvenZeroCapitalGasFundingDecision',
      receiverSetupAuthority: 'CanonicalZeroCapitalDiscovery',
      schedulingAuthority: 'CanonicalExecutionScheduler',
      executionAuthority: 'CanonicalZeroCapitalExecutor',
      independentScanLoop: false,
      independentExecutionLoop: false,
      runtimeMethodMutation: false,
      tokenUnitEqualsUsdAssumption: false,
      receiverCapabilityImpliesGasSponsorship: false,
      globalHaltAuthority: false,
    });
  }

  /**
   * Compatibility lifecycle entrypoint. It starts only the runtime context; it
   * never starts a strategy-local scanner or dispatcher.
   */
  async start(options: {
    onInitialGasReady?: () => Promise<void>;
    onInitialGasLost?: () => Promise<void>;
  } = {}): Promise<void> {
    await this.initialize();
    this.state.isRunning = true;
    if (options.onInitialGasReady) await options.onInitialGasReady();
    if (options.onInitialGasLost) {
      logger.debug('[ZeroCapitalEngine] Legacy local funding-loss callback retained but has no zero-capital shutdown authority', {
        component: 'ZeroCapitalEngine',
        callbackRegistered: true,
        callbackInvoked: false,
        globalHaltAuthority: false,
      });
    }
  }

  /** Sole compatibility funding method; delegates to the canonical proof boundary. */
  async getGasFundingDecision(chain: SupportedChain): Promise<GasFundingDecision> {
    return getProvenZeroCapitalGasFundingDecision(this, chain);
  }

  private adoptLiveProvider(chain: ActiveExecutionChain, provider: providers.JsonRpcProvider): void {
    if (this.providers.get(chain) === provider) return;
    this.providers.set(chain, provider);
    const wallet = this.executionWallets.get(chain);
    if (wallet) this.executionWallets.set(chain, wallet.connect(provider));
  }

  /**
   * Explicit-route measurement helper used only by CanonicalZeroCapitalDiscovery.
   * Atomic rescue belongs to that canonical discovery layer so configured and
   * dynamic routes enter one fairness-ordered transformation pass exactly once.
   */
  async scanChain(
    chain: SupportedChain,
    _provider: providers.JsonRpcProvider,
  ): Promise<ZeroCapitalOpportunity[]> {
    if (chain === 'europa') return [];
    const explicitRoutes = this.configuredRoutes.filter(route => route.chain === chain);
    if (explicitRoutes.length === 0) return [];
    const rpcChain = chain as RpcSupportedChain;
    const activeChain = chain as ActiveExecutionChain;

    // Keep the RPC manager's bounded timeout around one cheap health-capability
    // probe only. Multi-step gas enrichment and route quoting own their own bounded
    // work; Atomic transformation is deliberately not duplicated in this helper.
    const gasProvider = (await multiProviderRpcManager.execute(rpcChain, 'gas', async provider => {
      await provider.getFeeData();
      this.adoptLiveProvider(activeChain, provider);
      return provider;
    })).result;
    const funding = await this.getGasFundingDecision(chain);
    const gasEconomics = await enrichConfiguredZeroCapitalGasEconomics(chain, gasProvider, explicitRoutes, funding);

    const block = (await multiProviderRpcManager.execute(rpcChain, 'blocks', async provider => {
      this.adoptLiveProvider(activeChain, provider);
      return provider.getBlock('latest');
    })).result;

    const quoteProvider = (await multiProviderRpcManager.execute(rpcChain, 'contract_calls', async provider => {
      await provider.getBlockNumber();
      this.adoptLiveProvider(activeChain, provider);
      return provider;
    })).result;
    const quotes = await quoteConfiguredZeroCapitalRoutesForChain(chain, quoteProvider, gasEconomics.routes);
    const accepted = quotes.map(quote => this.fromQuotedRoute(quote, block.timestamp));
    logger.debug('[ZeroCapitalEngine] Configured-route gas economics measured before BPS admission', {
      component: 'ZeroCapitalEngine',
      chain,
      routes: gasEconomics.routes.length,
      gasCostAuthority: gasEconomics.gasCostAuthority,
      estimatedGasUnits: gasEconomics.estimatedGasUnits,
      zeroSeedPromotedToExecutableEconomics: false,
      atomicRescueAuthority: 'CanonicalZeroCapitalDiscovery',
      duplicateAtomicRescuePass: false,
    });
    return accepted;
  }

  fromQuotedRoute(quote: QuotedZeroCapitalRoute, blockTimestamp: number): ZeroCapitalOpportunity {
    const ttlMs = Math.max(1000, Number(process.env.ZERO_CAPITAL_ROUTE_TTL_MS || 3000));
    const executionCost = quote.estimatedGasCostInInputToken + quote.flashLoanFeeInInputToken + quote.relayFeeInInputToken;
    const observedAt = Date.now();
    return {
      id: `${quote.id}-${blockTimestamp}`,
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
      timestamp: observedAt,
      expiresAt: observedAt + ttlMs,
    };
  }

  private expectedSlippageBps(legs: number): number {
    const minOutputBps = Math.max(9000, Math.min(10000, Number(process.env.ZERO_CAPITAL_ROUTE_MIN_OUTPUT_BPS || 9990)));
    return Math.max(0, legs * (10000 - minOutputBps));
  }

  /** Retired compatibility hooks: canonical scheduler/executor are the only live path. */
  private async validateUnifiedControl(_opportunity: ZeroCapitalOpportunity): Promise<{ approved: boolean; reason: string }> {
    return { approved: false, reason: 'Retired local execution control; canonical scheduler owns admission and dispatch' };
  }

  private startScanningLoop(): void {
    // Intentionally empty: CanonicalZeroCapitalDiscovery is the sole scan cadence.
  }

  private startExecutionLoop(): void {
    // Intentionally empty: CanonicalExecutionScheduler is the sole parent scheduler.
  }

  private async dispatchExecutableOpportunities(): Promise<void> {
    // Intentionally empty: no strategy-local dispatch authority exists.
  }

  private async executeAndRecord(_opportunity: ZeroCapitalOpportunity): Promise<void> {
    throw new Error('Retired local execution route; use CanonicalExecutionScheduler -> CanonicalZeroCapitalExecutor');
  }

  private async executeOpportunity(_opportunity: ZeroCapitalOpportunity): Promise<ExecutionResult> {
    return { success: false, error: 'Retired local execution route; canonical executor required' };
  }

  private async executeFunded(_opportunity: ZeroCapitalOpportunity, _funding: GasFundingDecision): Promise<ExecutionResult> {
    return { success: false, error: 'Retired local funded submission route; canonical executor required' };
  }

  private async refreshGasFundingDecisions(): Promise<GasFundingDecision[]> {
    const chains = [...new Set(
      this.configuredRoutes.map(route => route.chain as SupportedChain)
        .filter(chain => chain !== 'europa'),
    )];
    const decisions = await Promise.all(chains.map(chain => this.getGasFundingDecision(chain)));
    this.state.gasFundingDecisions = decisions;
    this.state.fundingCycles += 1;
    this.state.lastFundingCycleAt = Date.now();
    return decisions;
  }

  private scheduleWalletResourceRefresh(): void {
    if (this.walletResourceRefreshInFlight) return;
    this.walletResourceRefreshInFlight = this.refreshWalletResources()
      .then(() => undefined)
      .catch(error => {
        logger.debug('[ZeroCapitalEngine] Optional wallet-resource telemetry refresh degraded', {
          component: 'ZeroCapitalEngine',
          error: error instanceof Error ? error.message : String(error),
          executionAuthority: false,
          zeroCapitalDiscoveryBlocked: false,
        });
      })
      .finally(() => {
        this.walletResourceRefreshInFlight = null;
      });
  }

  private async refreshWalletResources(): Promise<WalletResourceSnapshot[]> {
    const configured = resolveConfiguredWalletAddress();
    const snapshots = await Promise.all(Array.from(this.providers.entries()).map(async ([chain, existingProvider]) => {
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
        if (chain === 'europa') {
          const balance = await existingProvider.getBalance(address);
          return {
            chain,
            walletAddress: address,
            walletAddressSource: wallet ? 'execution_wallet' as const : configured.source || undefined,
            nativeBalance: balance.toString(),
            assetBalances: {},
            observedAt,
            status: 'available' as const,
          };
        }
        const balance = (await multiProviderRpcManager.execute(chain as RpcSupportedChain, 'json_rpc', async provider => {
          this.adoptLiveProvider(chain as ActiveExecutionChain, provider);
          return provider.getBalance(address);
        })).result;
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

  stop(): void {
    this.state.isRunning = false;
    this.state.fundingCycleActive = false;
    this.state.marketOperationsEnabled = false;
    this.state.currentOpportunities = 0;
    this.state.activeExecutions = 0;
    this.state.activeExecutionChains = [];
  }

  getState(): SystemState {
    const receivers = this.receiverManager.getRecords();
    const receiverReady = receivers.length > 0;
    this.state.receiverRegistry = receivers;
    this.state.bootstrapState = receiverReady ? 'INITIAL_GAS_READY' : 'PRE_STAGE_1_BOOTSTRAP';
    this.state.initialGasReadiness = executionReadiness(
      receiverReady,
      receiverReady
        ? undefined
        : 'Canonical zero-capital discovery has not yet proven a funded receiver route',
    );
    this.state.profitEstimates = getProfitEstimates(50);
    return {
      ...this.state,
      walletResources: this.state.walletResources.map(item => ({ ...item, assetBalances: { ...item.assetBalances } })),
      receiverRegistry: receivers.map(item => ({ ...item })),
      profitEstimates: [...this.state.profitEstimates],
      initialGasReadiness: {
        ...this.state.initialGasReadiness,
        measurements: this.state.initialGasReadiness.measurements.map(item => ({ ...item })),
        provenance: [...this.state.initialGasReadiness.provenance],
      },
    };
  }

  getStats() {
    const state = this.getState();
    return {
      isRunning: state.isRunning,
      totalProfit: ethers.utils.formatUnits(state.totalProfit.toString(), 6),
      totalTrades: state.totalTrades,
      successfulTrades: state.successfulTrades,
      includedUnverifiedTrades: state.includedUnverifiedTrades,
      failedTrades: state.failedTrades,
      successRate: state.totalTrades > 0
        ? `${((state.successfulTrades / state.totalTrades) * 100).toFixed(2)}%`
        : '0%',
      currentOpportunities: state.currentOpportunities,
      gaslessTransactions: state.gaslessTransactions,
      fundingCycleActive: state.fundingCycleActive,
      fundingCycles: state.fundingCycles,
      lastFundingCycleAt: state.lastFundingCycleAt,
      lastFundingError: state.lastFundingError,
      walletResources: state.walletResources,
      receiverRegistry: state.receiverRegistry,
      profitEstimates: state.profitEstimates,
      activeExecutionChains: state.activeExecutionChains,
      bootstrapState: state.bootstrapState,
      initialGasReadiness: state.initialGasReadiness,
      marketOperationsEnabled: state.marketOperationsEnabled,
      gasFundingDecisions: state.gasFundingDecisions,
      activeExecutions: state.activeExecutions,
      maxConcurrentExecutions: state.maxConcurrentExecutions,
      providerAuthority: 'multiProviderRpcManager_free_and_configured_mesh',
      alchemyOperationalAuthority: false,
      routeAuthority: 'zero_capital_route_authority',
      discoveryAuthority: 'CanonicalZeroCapitalDiscovery',
      gasFundingAuthority: 'getProvenZeroCapitalGasFundingDecision',
      receiverSetupAuthority: 'CanonicalZeroCapitalDiscovery',
      schedulingAuthority: 'CanonicalExecutionScheduler',
      executionAuthority: 'CanonicalZeroCapitalExecutor',
      independentScanLoop: false,
      independentExecutionLoop: false,
      runtimeMethodMutation: false,
      walletResourceTelemetryBlocksStartup: false,
      receiverCapabilityImpliesGasSponsorship: false,
      capitalRequired: 'Zero-personal-capital execution is admitted only from externally sponsored or proven system-owned resources',
      zeroCapitalSpecificExecutionFlagAuthority: false,
      tokenUnitEqualsUsdAssumption: false,
      monteCarloExecutionAuthority: false,
      zeroInitialCapitalGlobalHaltAuthority: false,
    };
  }
}

export const zeroCapitalEngine = new AutonomousZeroCapitalEngine();
export default zeroCapitalEngine;
