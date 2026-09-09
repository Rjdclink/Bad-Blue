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
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
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
import { runZeroCapitalProfitabilityRescueV2 } from '../integration/zero-capital-profitability-rescue-v2.js';
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

function boundedPositiveMs(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  const finite = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, Math.trunc(finite)));
}

export class ZeroCapitalEngine {
  private initialized = false;
  private providers = new Map<SupportedChain, providers.JsonRpcProvider>();
  private executionWallets = new Map<SupportedChain, Wallet>();
  private configuredRoutes: ConfiguredZeroCapitalRoute[] = [];
  private dynamicChainConfigs = new Map<Exclude<SupportedChain, 'europa'>, DynamicChainConfig>();
  private receiverManager = getSponsoredReceiverManager();
  private gasSponsor = getGasSponsorManager();
  private state: SystemState = {
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
    initialGasReadiness: executionReadiness(false, 'Runtime has not completed canonical initialization'),
    marketOperationsEnabled: false,
    gasFundingDecisions: [],
    profitEstimates: [],
    activeExecutions: 0,
    activeExecutionChains: [],
    maxConcurrentExecutions: 1,
  };

  async initialize(): Promise<void> {
    if (this.initialized) {
      this.state.isRunning = true;
      return;
    }

    const configured = resolveConfiguredWalletAddress();
    if (!configured.address) throw new Error('Zero-capital runtime requires a configured execution wallet address');
    const privateKey = normalizePrivateKey(process.env.EXECUTION_WALLET_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || '');
    if (!privateKey) throw new Error('Zero-capital runtime requires an execution wallet private key');
    assertConfiguredWalletAddress(configured.address, configured.source, privateKey);

    this.dynamicChainConfigs = loadDynamicChainRegistry();
    this.configuredRoutes = composeConfiguredZeroCapitalRoutes(loadConfiguredZeroCapitalRoutes());
    this.providers.clear();
    this.executionWallets.clear();
    for (const chain of Object.keys(RPC_ENDPOINTS) as ActiveExecutionChain[]) {
      const rpcUrl = RPC_ENDPOINTS[chain];
      if (!rpcUrl) continue;
      const provider = new providers.JsonRpcProvider(rpcUrl);
      this.providers.set(chain, provider);
      this.executionWallets.set(chain, walletFromPrivateKey(privateKey, provider));
    }

    this.initialized = true;
    this.state.isRunning = true;
    this.state.marketOperationsEnabled = true;
    this.state.receiverRegistry = this.receiverManager.getRecords();
    logger.info('[ZeroCapitalEngine] Canonical zero-capital runtime context initialized', {
      component: 'ZeroCapitalEngine',
      connectedChains: [...this.providers.keys()],
      explicitConfiguredRoutes: this.configuredRoutes.length,
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
      globalHaltAuthority: false,
    });
  }

  getState(): SystemState {
    return { ...this.state, activeExecutionChains: [...this.state.activeExecutionChains], gasFundingDecisions: this.state.gasFundingDecisions.map(item => ({ ...item })), walletResources: this.state.walletResources.map(item => ({ ...item, assetBalances: { ...item.assetBalances } })), receiverRegistry: this.state.receiverRegistry.map(item => ({ ...item })), profitEstimates: this.state.profitEstimates.map(item => ({ ...item })) };
  }

  getRuntimeContext() {
    return {
      providers: this.providers,
      executionWallets: this.executionWallets,
      dynamicChainConfigs: this.dynamicChainConfigs,
      receiverManager: this.receiverManager,
      gasSponsor: this.gasSponsor,
    };
  }

  async scanChain(chain: SupportedChain, provider: providers.JsonRpcProvider): Promise<ZeroCapitalOpportunity[]> {
    if (chain === 'europa') return [];
    const explicitRoutes = this.configuredRoutes.filter(route => route.chain === chain);
    if (explicitRoutes.length === 0) return [];
    const quotes = await quoteConfiguredZeroCapitalRoutesForChain(chain, provider, explicitRoutes);
    const block = await provider.getBlock('latest');
    const accepted = quotes.map(quote => this.fromQuotedRoute(quote, block.timestamp));
    return runZeroCapitalProfitabilityRescueV2({
      chain,
      provider,
      opportunities: accepted,
      configuredRoutes: explicitRoutes,
      fromQuotedRoute: (quote, blockTimestamp) => this.fromQuotedRoute(quote, blockTimestamp),
    });
  }

  fromQuotedRoute(quote: QuotedZeroCapitalRoute, blockTimestamp: number): ZeroCapitalOpportunity {
    const ttlMs = boundedPositiveMs(process.env.ZERO_CAPITAL_ROUTE_TTL_MS, 3_000, 500, 15_000);
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
    const raw = Number(process.env.ZERO_CAPITAL_ROUTE_MIN_OUTPUT_BPS);
    const minOutputBps = Number.isFinite(raw) ? Math.max(9000, Math.min(10000, raw)) : 9990;
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
          error: 'no configured wallet address',
        };
      }
      try {
        const native = await provider.getBalance(address);
        return {
          chain,
          walletAddress: address,
          walletAddressSource: wallet ? 'execution_wallet' as const : 'bridge_wallet' as const,
          nativeBalance: native.toString(),
          assetBalances: {},
          observedAt,
          status: 'available' as const,
        };
      } catch (error) {
        return {
          chain,
          walletAddress: address,
          walletAddressSource: wallet ? 'execution_wallet' as const : 'bridge_wallet' as const,
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

  private async getGasFundingDecision(chain: SupportedChain): Promise<GasFundingDecision> {
    return getProvenZeroCapitalGasFundingDecision(this, chain);
  }
}

export const zeroCapitalEngine = new ZeroCapitalEngine();
