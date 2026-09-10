/**
 * Legacy compatibility facade for the former Alchemy integration.
 *
 * No request in this module is sent to Alchemy and no Alchemy credential is read.
 * Existing callers are intentionally preserved while their transport is supplied by
 * the canonical free/configured RPC mesh and Alchemy-free pending-transaction mesh.
 * New code should import the provider-mesh modules directly.
 */

import { Contract } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager, type SupportedChain } from '../api/blockchain-providers.js';
import { ensureDynamicRpcProviderWiring } from '../runtime/dynamic-rpc-provider-wiring.js';
import {
  ensureProviderMeshPendingStream,
  providerMeshPendingStream,
  type ProviderMeshPendingNetwork,
} from './provider-mesh-pending-stream.js';
import {
  getProviderMeshMempoolAnalysis,
  refreshProviderMeshMempoolAnalysis,
  type MempoolAnalysis,
  type PendingTransaction,
} from './provider-mesh-mempool-analysis.js';

export type { MempoolAnalysis, PendingTransaction } from './provider-mesh-mempool-analysis.js';

type AlchemyNetwork = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'base';
const COMPATIBLE_NETWORKS: AlchemyNetwork[] = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'];
const PENDING_NETWORKS = new Set<ProviderMeshPendingNetwork>(['ethereum', 'polygon']);

const ERC20_BALANCE_ABI = ['function balanceOf(address owner) view returns (uint256)'];
const ERC20_METADATA_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

export interface TokenBalance {
  contractAddress: string;
  tokenBalance: string;
  tokenBalanceRaw: string;
}

export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
  logo: string | null;
}

export interface TokenData {
  address: string;
  balance: TokenBalance;
  metadata: TokenMetadata;
  usdValue: number | null;
}

/** @deprecated Name retained only so existing imports compile during the provider cutover. */
export interface AlchemyReadinessStatus {
  ready: boolean;
  configured: boolean;
  active: boolean;
  degraded: boolean;
  strictLive: boolean;
  detail: string;
  apiKeyMode: 'retired';
  network?: AlchemyNetwork;
  lastHealthCheckAt: number | null;
  lastHealthError?: string;
}

/** @deprecated Logical compatibility record; transport is provider-mesh owned. */
export interface AlchemySubscription {
  id: string;
  network: string;
  type: 'pendingTransactions' | 'newHeads' | 'logs';
  filters: Record<string, string[]>;
  isActive: boolean;
  createdAt: number;
}

interface AlchemyCostSnapshot {
  minuteStartedAt: number;
  minuteRequests: number;
  dayStartedAt: number;
  dayRequests: number;
  dayEstimatedCu: number;
  blockedRequests: number;
  requestLimitPerMinute: number;
  dailyCuBudget: number;
}

function retiredCostSnapshot(): AlchemyCostSnapshot {
  const now = Date.now();
  return {
    minuteStartedAt: now,
    minuteRequests: 0,
    dayStartedAt: now,
    dayRequests: 0,
    dayEstimatedCu: 0,
    blockedRequests: 0,
    requestLimitPerMinute: 0,
    dailyCuBudget: 0,
  };
}

function asSupportedChain(network: AlchemyNetwork): SupportedChain {
  return network as SupportedChain;
}

class ProviderMeshTokenAPI {
  private readonly metadataCache = new Map<string, { value: TokenMetadata | null; expiresAt: number }>();
  private readonly balanceCache = new Map<string, { value: TokenBalance[]; expiresAt: number }>();
  private readonly metadataTtlMs = Math.max(60_000, Number(process.env.CRYPTOCRAWL_TOKEN_METADATA_TTL_MS || 24 * 60 * 60_000));
  private readonly balanceTtlMs = Math.max(1_000, Number(process.env.CRYPTOCRAWL_TOKEN_BALANCE_TTL_MS || 15_000));

  private async provider(network: AlchemyNetwork) {
    await ensureDynamicRpcProviderWiring();
    await multiProviderRpcManager.initialize([asSupportedChain(network)]);
    return multiProviderRpcManager.getProvider(asSupportedChain(network), 'contract_calls');
  }

  async getTokenBalances(network: AlchemyNetwork, ownerAddress: string, tokenAddresses?: string[]): Promise<TokenBalance[]> {
    const addresses = [...new Set((tokenAddresses || []).map(value => value.trim()).filter(Boolean))];
    if (addresses.length === 0) {
      logger.debug('[ProviderMeshTokenAPI] Standard RPC cannot enumerate arbitrary ERC-20 holdings without an indexed data service', {
        component: 'ProviderMeshTokenAPI',
        network,
        ownerAddressPresent: Boolean(ownerAddress),
        result: 'explicit_empty_not_inferred',
        alchemyFallback: false,
      });
      return [];
    }

    const cacheKey = `${network}:${ownerAddress.toLowerCase()}:${addresses.map(value => value.toLowerCase()).sort().join(',')}`;
    const cached = this.balanceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value.map(value => ({ ...value }));

    const managed = await this.provider(network);
    const balances = await Promise.all(addresses.map(async contractAddress => {
      try {
        const contract = new Contract(contractAddress, ERC20_BALANCE_ABI, managed.http);
        const balance = await contract.balanceOf(ownerAddress);
        const raw = balance.toHexString();
        return {
          contractAddress,
          tokenBalance: balance.isZero() ? '0x0' : raw,
          tokenBalanceRaw: balance.isZero() ? '0x0' : raw,
        } satisfies TokenBalance;
      } catch (error) {
        logger.debug('[ProviderMeshTokenAPI] Route-local ERC-20 balance read unavailable', {
          component: 'ProviderMeshTokenAPI',
          network,
          contractAddress,
          provider: managed.config.provider,
          error: error instanceof Error ? error.message : String(error),
          routeLocalFailure: true,
        });
        return null;
      }
    }));
    const measured = balances.filter((value): value is TokenBalance => value !== null);
    this.balanceCache.set(cacheKey, { value: measured, expiresAt: Date.now() + this.balanceTtlMs });
    return measured.map(value => ({ ...value }));
  }

  async getTokenMetadata(network: AlchemyNetwork, tokenAddress: string): Promise<TokenMetadata | null> {
    const cacheKey = `${network}:${tokenAddress.toLowerCase()}`;
    const cached = this.metadataCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value ? { ...cached.value } : null;

    let metadata: TokenMetadata | null = null;
    try {
      const managed = await this.provider(network);
      const contract = new Contract(tokenAddress, ERC20_METADATA_ABI, managed.http);
      const [name, symbol, decimals] = await Promise.all([
        contract.name().catch(() => null),
        contract.symbol().catch(() => null),
        contract.decimals().catch(() => null),
      ]);
      const parsedDecimals = Number(decimals);
      if (Number.isInteger(parsedDecimals) && parsedDecimals >= 0 && parsedDecimals <= 255) {
        metadata = {
          name: typeof name === 'string' && name ? name : 'Unknown',
          symbol: typeof symbol === 'string' && symbol ? symbol : 'UNK',
          decimals: parsedDecimals,
          logo: null,
        };
      }
    } catch (error) {
      logger.debug('[ProviderMeshTokenAPI] Route-local ERC-20 metadata read unavailable', {
        component: 'ProviderMeshTokenAPI',
        network,
        tokenAddress,
        error: error instanceof Error ? error.message : String(error),
        routeLocalFailure: true,
      });
    }
    this.metadataCache.set(cacheKey, { value: metadata, expiresAt: Date.now() + this.metadataTtlMs });
    return metadata ? { ...metadata } : null;
  }

  async getCompleteTokenData(network: AlchemyNetwork, ownerAddress: string, tokenAddress: string): Promise<TokenData | null> {
    const [balances, metadata] = await Promise.all([
      this.getTokenBalances(network, ownerAddress, [tokenAddress]),
      this.getTokenMetadata(network, tokenAddress),
    ]);
    const balance = balances[0];
    if (!balance || !metadata) return null;
    return { address: tokenAddress, balance, metadata, usdValue: null };
  }

  async batchGetTokenData(network: AlchemyNetwork, ownerAddress: string, tokenAddresses: string[]): Promise<TokenData[]> {
    const balances = await this.getTokenBalances(network, ownerAddress, tokenAddresses);
    const balanceByAddress = new Map(balances.map(balance => [balance.contractAddress.toLowerCase(), balance]));
    const metadata = await Promise.all(tokenAddresses.map(address => this.getTokenMetadata(network, address)));
    return tokenAddresses.flatMap((address, index) => {
      const balance = balanceByAddress.get(address.toLowerCase());
      const tokenMetadata = metadata[index];
      return balance && tokenMetadata
        ? [{ address, balance: { ...balance }, metadata: { ...tokenMetadata }, usdValue: null }]
        : [];
    });
  }
}

class ProviderMeshPendingTransactions {
  private readonly subscriptions = new Map<string, AlchemySubscription>();
  private analyzedTxCount = 0;

  async startMonitoring(network: AlchemyNetwork, filters?: { fromAddresses?: string[]; toAddresses?: string[] }): Promise<AlchemySubscription> {
    if (!PENDING_NETWORKS.has(network as ProviderMeshPendingNetwork)) {
      throw new Error(`Provider-mesh full-pending compatibility is not enabled for ${network}`);
    }
    ensureProviderMeshPendingStream();
    await refreshProviderMeshMempoolAnalysis();
    const existing = [...this.subscriptions.values()].find(item => item.network === network && item.isActive);
    if (existing) return { ...existing, filters: { ...existing.filters } };
    const subscription: AlchemySubscription = {
      id: `provider-mesh-pending-${network}-${Date.now()}`,
      network,
      type: 'pendingTransactions',
      filters: {
        fromAddress: filters?.fromAddresses || [],
        toAddress: filters?.toAddresses || [],
      },
      isActive: true,
      createdAt: Date.now(),
    };
    this.subscriptions.set(subscription.id, subscription);
    return { ...subscription, filters: { ...subscription.filters } };
  }

  stopMonitoring(subscriptionId?: string): void {
    if (subscriptionId) this.subscriptions.delete(subscriptionId);
    else this.subscriptions.clear();
  }

  hasAvailableEvidence(): boolean {
    return getProviderMeshMempoolAnalysis().available;
  }

  analyzeMempoolOpportunities(): MempoolAnalysis {
    const analysis = getProviderMeshMempoolAnalysis();
    this.analyzedTxCount = Math.max(this.analyzedTxCount, analysis.swapTransactions);
    return {
      ...analysis,
      provenance: [...analysis.provenance],
      arbitrageOpportunities: analysis.arbitrageOpportunities.map(transaction => ({ ...transaction })),
    };
  }

  getStatistics(): { activeSubscriptions: number; cachedTransactions: number; analyzedTransactions: number; isMonitoring: boolean } {
    const stream = providerMeshPendingStream.getStatistics();
    return {
      activeSubscriptions: stream.activeNetworks.length,
      cachedTransactions: stream.cachedTransactions,
      analyzedTransactions: this.analyzedTxCount,
      isMonitoring: stream.running,
    };
  }
}

class ProviderMeshArbitrageDetector {
  constructor(
    private readonly tokenAPI: ProviderMeshTokenAPI,
    private readonly pendingTx: ProviderMeshPendingTransactions,
  ) {}

  async start(networks: AlchemyNetwork[]): Promise<void> {
    ensureProviderMeshPendingStream();
    await refreshProviderMeshMempoolAnalysis();
    const pendingNetworks = networks.filter(network => PENDING_NETWORKS.has(network as ProviderMeshPendingNetwork));
    await Promise.all(pendingNetworks.map(network => this.pendingTx.startMonitoring(network).catch(() => undefined)));
  }

  stop(): void {
    this.pendingTx.stopMonitoring();
  }

  getMempoolAnalysis(): MempoolAnalysis {
    return this.pendingTx.analyzeMempoolOpportunities();
  }

  async getPortfolioTokens(network: AlchemyNetwork, walletAddress: string): Promise<TokenData[]> {
    // Standard JSON-RPC has no trustworthy arbitrary-token enumeration primitive.
    // The compatibility surface therefore returns no inferred portfolio instead of
    // fabricating addresses. Callers with known token addresses use batchGetTokenData.
    return this.tokenAPI.batchGetTokenData(network, walletAddress, []);
  }

  getStatistics(): {
    pendingTx: ReturnType<ProviderMeshPendingTransactions['getStatistics']>;
    detectedOpportunities: number;
    mempoolAnalysis: MempoolAnalysis;
  } {
    return {
      pendingTx: this.pendingTx.getStatistics(),
      detectedOpportunities: 0,
      mempoolAnalysis: this.pendingTx.analyzeMempoolOpportunities(),
    };
  }
}

/**
 * @deprecated Compatibility class. Its implementation is provider-mesh only.
 * The historical name remains temporarily to avoid breaking existing imports.
 */
export class AlchemyIntegration {
  public readonly tokenAPI: ProviderMeshTokenAPI;
  public readonly pendingTransactions: ProviderMeshPendingTransactions;
  public readonly arbitrageDetector: ProviderMeshArbitrageDetector;
  private isActive = false;
  private isDegraded = false;
  private activeNetworks: AlchemyNetwork[] = [];
  private lastHealthCheckAt: number | null = null;
  private lastHealthError: string | undefined;

  constructor(_retiredApiKey?: string) {
    this.tokenAPI = new ProviderMeshTokenAPI();
    this.pendingTransactions = new ProviderMeshPendingTransactions();
    this.arbitrageDetector = new ProviderMeshArbitrageDetector(this.tokenAPI, this.pendingTransactions);
    logger.info('[ProviderMeshCompatibility] Legacy Alchemy integration boundary is transport-retired', {
      component: 'ProviderMeshCompatibility',
      alchemyNetworkRequestsAllowed: false,
      alchemyCredentialRead: false,
      providerAuthority: 'multiProviderRpcManager',
      mempoolAuthority: 'providerMeshPendingStream',
    });
  }

  async readinessCheck(options?: { strictLive?: boolean; network?: AlchemyNetwork }): Promise<AlchemyReadinessStatus> {
    const strictLive = options?.strictLive === true;
    const network = options?.network || 'ethereum';
    this.lastHealthCheckAt = Date.now();
    try {
      await ensureDynamicRpcProviderWiring();
      await multiProviderRpcManager.initialize([asSupportedChain(network)]);
      const healthy = multiProviderRpcManager.getHealth(asSupportedChain(network))
        .filter(observation => observation.http.success)
        .map(observation => observation.provider);
      const ready = healthy.length > 0;
      this.lastHealthError = ready ? undefined : `No healthy provider-mesh RPC is available for ${network}`;
      this.isDegraded = !ready;
      return {
        ready: ready || !strictLive,
        configured: ready,
        active: this.isActive,
        degraded: !ready,
        strictLive,
        detail: ready
          ? `Provider-mesh RPC ready on ${network} via ${healthy.join(', ')}`
          : strictLive
            ? `Provider-mesh strict-live readiness failed on ${network}`
            : `Provider-mesh RPC degraded on ${network}; optional evidence remains local`,
        apiKeyMode: 'retired',
        network,
        lastHealthCheckAt: this.lastHealthCheckAt,
        ...(this.lastHealthError ? { lastHealthError: this.lastHealthError } : {}),
      };
    } catch (error) {
      this.lastHealthError = error instanceof Error ? error.message : String(error);
      this.isDegraded = true;
      return {
        ready: !strictLive,
        configured: false,
        active: this.isActive,
        degraded: true,
        strictLive,
        detail: `Provider-mesh readiness check failed on ${network}: ${this.lastHealthError}`,
        apiKeyMode: 'retired',
        network,
        lastHealthCheckAt: this.lastHealthCheckAt,
        lastHealthError: this.lastHealthError,
      };
    }
  }

  async start(networks?: AlchemyNetwork[]): Promise<void> {
    const requested = (networks || COMPATIBLE_NETWORKS).filter(network => COMPATIBLE_NETWORKS.includes(network));
    await ensureDynamicRpcProviderWiring();
    ensureProviderMeshPendingStream();
    await refreshProviderMeshMempoolAnalysis();
    this.isActive = true;
    this.activeNetworks = [...requested];
    const readiness = await this.readinessCheck({ strictLive: false, network: requested[0] || 'ethereum' });
    this.isDegraded = !readiness.configured;
    await this.arbitrageDetector.start(requested);
    logger.info('[ProviderMeshCompatibility] Legacy integration start delegated to provider mesh', {
      component: 'ProviderMeshCompatibility',
      requestedNetworks: requested,
      alchemyNetworkRequestsAllowed: false,
      alchemyCredentialRead: false,
      providerAuthority: 'multiProviderRpcManager',
      mempoolAuthority: 'providerMeshPendingStream',
    });
  }

  stop(): void {
    this.arbitrageDetector.stop();
    this.isActive = false;
    this.activeNetworks = [];
  }

  async getTokenBalances(network: AlchemyNetwork, walletAddress: string, tokenAddresses?: string[]): Promise<TokenBalance[]> {
    return this.tokenAPI.getTokenBalances(network, walletAddress, tokenAddresses);
  }

  async getTokenMetadata(network: AlchemyNetwork, tokenAddress: string): Promise<TokenMetadata | null> {
    return this.tokenAPI.getTokenMetadata(network, tokenAddress);
  }

  getMempoolAnalysis(): MempoolAnalysis {
    ensureProviderMeshPendingStream();
    return getProviderMeshMempoolAnalysis();
  }

  isReady(): boolean {
    return this.isActive && !this.isDegraded;
  }

  getStatistics(): {
    arbitrage: ReturnType<ProviderMeshArbitrageDetector['getStatistics']>;
    isActive: boolean;
    apiKey: string;
    readiness: {
      configured: boolean;
      ready: boolean;
      degraded: boolean;
      activeNetworks: AlchemyNetwork[];
      lastHealthCheckAt: number | null;
      lastHealthError?: string;
    };
    cost: AlchemyCostSnapshot;
    mempoolPolicy: { enabled: boolean; networks: AlchemyNetwork[]; unfilteredPendingAllowed: boolean };
  } {
    const stream = providerMeshPendingStream.getStatistics();
    const healthyNetworks = this.activeNetworks.filter(network =>
      multiProviderRpcManager.getHealth(asSupportedChain(network)).some(observation => observation.http.success),
    );
    return {
      arbitrage: this.arbitrageDetector.getStatistics(),
      isActive: this.isActive,
      apiKey: 'retired',
      readiness: {
        configured: healthyNetworks.length > 0,
        ready: this.isReady(),
        degraded: this.isDegraded,
        activeNetworks: [...this.activeNetworks],
        lastHealthCheckAt: this.lastHealthCheckAt,
        ...(this.lastHealthError ? { lastHealthError: this.lastHealthError } : {}),
      },
      cost: retiredCostSnapshot(),
      mempoolPolicy: {
        enabled: stream.running,
        networks: stream.configuredNetworks.filter((network): network is AlchemyNetwork => COMPATIBLE_NETWORKS.includes(network as AlchemyNetwork)),
        unfilteredPendingAllowed: true,
      },
    };
  }
}

export const alchemyIntegration = new AlchemyIntegration();
