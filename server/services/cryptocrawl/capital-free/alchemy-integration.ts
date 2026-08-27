// Alchemy Integration Module - cost-governed blockchain data access
// Preserves token/mempool interfaces while preventing unbounded provider spend.

import logger from '../../../logger.js';
import { multiProviderRpcManager, type LogicalSubscription, type SupportedChain } from '../api/blockchain-providers.js';

const ALCHEMY_CONFIG = {
  ENDPOINTS: {
    ethereum: 'https://eth-mainnet.g.alchemy.com/v2',
    polygon: 'https://polygon-mainnet.g.alchemy.com/v2',
    arbitrum: 'https://arb-mainnet.g.alchemy.com/v2',
    optimism: 'https://opt-mainnet.g.alchemy.com/v2',
    base: 'https://base-mainnet.g.alchemy.com/v2',
  },
  MAX_REQUESTS_PER_SECOND: Math.max(1, Number(process.env.ALCHEMY_MAX_REQUESTS_PER_SECOND || 4)),
  MAX_REQUESTS_PER_MINUTE: Math.max(30, Number(process.env.ALCHEMY_MAX_REQUESTS_PER_MINUTE || 300)),
  DAILY_CU_BUDGET: Math.max(1_000, Number(process.env.ALCHEMY_DAILY_CU_BUDGET || 1_000_000)),
  MAX_RETRY_ATTEMPTS: Math.max(0, Number(process.env.ALCHEMY_MAX_RETRY_ATTEMPTS || 2)),
  BASE_BACKOFF_MS: 500,
  MAX_BACKOFF_MS: 15_000,
  REQUEST_TIMEOUT_MS: 10_000,
  TOKEN_BALANCE_CACHE_TTL_MS: Math.max(60_000, Number(process.env.ALCHEMY_TOKEN_BALANCE_CACHE_TTL_MS || 5 * 60_000)),
  TOKEN_METADATA_CACHE_TTL_MS: Math.max(5 * 60_000, Number(process.env.ALCHEMY_TOKEN_METADATA_CACHE_TTL_MS || 24 * 60 * 60_000)),
  PENDING_TX_CACHE_TTL_MS: 5 * 60_000,
  MAX_PENDING_TX_CACHE: Math.max(100, Number(process.env.ALCHEMY_MAX_PENDING_TX_CACHE || 5_000)),
  BATCH_SIZE: Math.max(1, Number(process.env.ALCHEMY_TOKEN_METADATA_BATCH_SIZE || 20)),
};

type AlchemyNetwork = keyof typeof ALCHEMY_CONFIG.ENDPOINTS;

const CU_COSTS: Record<string, number> = {
  eth_chainId: 0,
  eth_subscribe: 10,
  eth_unsubscribe: 10,
  eth_getTransactionByHash: 20,
  alchemy_getTokenBalances: 20,
  alchemy_getTokenMetadata: 10,
};

class AlchemyBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlchemyBudgetExceededError';
  }
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

class AlchemyCostGovernor {
  private minuteStartedAt = Date.now();
  private minuteRequests = 0;
  private dayStartedAt = Date.now();
  private dayRequests = 0;
  private dayEstimatedCu = 0;
  private blockedRequests = 0;

  private refreshWindows(now = Date.now()): void {
    if (now - this.minuteStartedAt >= 60_000) {
      this.minuteStartedAt = now;
      this.minuteRequests = 0;
    }
    if (now - this.dayStartedAt >= 24 * 60 * 60_000) {
      this.dayStartedAt = now;
      this.dayRequests = 0;
      this.dayEstimatedCu = 0;
    }
  }

  reserve(method: string, options: { critical?: boolean } = {}): void {
    const now = Date.now();
    this.refreshWindows(now);
    const estimatedCu = CU_COSTS[method] ?? 20;
    const minuteBlocked = this.minuteRequests + 1 > ALCHEMY_CONFIG.MAX_REQUESTS_PER_MINUTE;
    const dailyBlocked = this.dayEstimatedCu + estimatedCu > ALCHEMY_CONFIG.DAILY_CU_BUDGET;
    if ((minuteBlocked || dailyBlocked) && !options.critical) {
      this.blockedRequests += 1;
      throw new AlchemyBudgetExceededError(
        minuteBlocked
          ? `Alchemy request budget exhausted for current minute (${ALCHEMY_CONFIG.MAX_REQUESTS_PER_MINUTE})`
          : `Alchemy daily CU budget exhausted (${ALCHEMY_CONFIG.DAILY_CU_BUDGET})`,
      );
    }
    this.minuteRequests += 1;
    this.dayRequests += 1;
    this.dayEstimatedCu += estimatedCu;
  }

  snapshot(): AlchemyCostSnapshot {
    this.refreshWindows();
    return {
      minuteStartedAt: this.minuteStartedAt,
      minuteRequests: this.minuteRequests,
      dayStartedAt: this.dayStartedAt,
      dayRequests: this.dayRequests,
      dayEstimatedCu: this.dayEstimatedCu,
      blockedRequests: this.blockedRequests,
      requestLimitPerMinute: ALCHEMY_CONFIG.MAX_REQUESTS_PER_MINUTE,
      dailyCuBudget: ALCHEMY_CONFIG.DAILY_CU_BUDGET,
    };
  }
}

const alchemyCostGovernor = new AlchemyCostGovernor();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return Math.floor(seconds * 1000);
  const absolute = Date.parse(header);
  return Number.isFinite(absolute) ? Math.max(0, absolute - Date.now()) : undefined;
}

function isRetryableRpcError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('429') || message.includes('rate limit') || message.includes('-32005') ||
    message.includes('timeout') || message.includes('timed out') || message.includes('network') ||
    message.includes('fetch failed') || message.includes('temporarily unavailable');
}

function calculateBackoffMs(attempt: number): number {
  const exponential = Math.min(ALCHEMY_CONFIG.MAX_BACKOFF_MS, ALCHEMY_CONFIG.BASE_BACKOFF_MS * Math.pow(2, attempt));
  return exponential + Math.floor(Math.random() * 200);
}

async function postRpcWithRetry<T>(
  baseURL: string,
  payload: Record<string, unknown>,
  options: { critical?: boolean } = {},
): Promise<T> {
  const method = typeof payload.method === 'string' ? payload.method : 'unknown';
  for (let attempt = 0; attempt <= ALCHEMY_CONFIG.MAX_RETRY_ATTEMPTS; attempt++) {
    alchemyCostGovernor.reserve(method, options);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ALCHEMY_CONFIG.REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(baseURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.status === 429 || response.status >= 500) {
        if (attempt >= ALCHEMY_CONFIG.MAX_RETRY_ATTEMPTS) throw new Error(`Alchemy RPC HTTP ${response.status}`);
        await sleep(parseRetryAfterMs(response.headers.get('retry-after')) ?? calculateBackoffMs(attempt));
        continue;
      }
      if (!response.ok) throw new Error(`Alchemy RPC HTTP ${response.status}`);
      const data = await response.json() as any;
      if (data?.error) {
        const message = String(data.error.message || data.error.code || 'Alchemy RPC error');
        if (attempt < ALCHEMY_CONFIG.MAX_RETRY_ATTEMPTS && isRetryableRpcError(new Error(message))) {
          await sleep(calculateBackoffMs(attempt));
          continue;
        }
        throw new Error(message);
      }
      return data as T;
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof AlchemyBudgetExceededError) throw error;
      if (attempt >= ALCHEMY_CONFIG.MAX_RETRY_ATTEMPTS || !isRetryableRpcError(error)) throw error;
      await sleep(calculateBackoffMs(attempt));
    }
  }
  throw new Error('Alchemy RPC retry attempts exhausted');
}

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

export interface PendingTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasPrice: string;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  input: string;
  nonce: string;
  timestamp: number;
  potentialArbitrage: boolean;
  decodedMethod: string | null;
}

export interface MempoolAnalysis {
  available: boolean;
  observedAt: number | null;
  provenance: string[];
  totalPending: number;
  swapTransactions: number;
  liquidityAdditions: number;
  largeTransfers: number;
  arbitrageOpportunities: PendingTransaction[];
  avgGasPrice: number;
  maxGasPrice: number;
}

export interface AlchemyReadinessStatus {
  ready: boolean;
  configured: boolean;
  active: boolean;
  degraded: boolean;
  strictLive: boolean;
  detail: string;
  apiKeyMode: 'demo' | 'configured';
  network?: AlchemyNetwork;
  lastHealthCheckAt: number | null;
  lastHealthError?: string;
}

export interface AlchemySubscription {
  id: string;
  network: string;
  type: 'pendingTransactions' | 'newHeads' | 'logs';
  filters: Record<string, string[]>;
  isActive: boolean;
  createdAt: number;
}

class AlchemyTokenAPI {
  private requestCount = 0;
  private lastRequestTime = 0;
  private requestTail: Promise<void> = Promise.resolve();
  private balanceCache = new Map<string, { data: TokenBalance[]; expiresAt: number }>();
  private metadataCache = new Map<string, { data: TokenMetadata | null; expiresAt: number }>();
  private inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly apiKey: string = 'demo') {
    logger.info('[AlchemyTokenAPI] Initialized', { component: 'AlchemyTokenAPI' });
  }

  private scheduleRateLimit(): Promise<void> {
    const run = this.requestTail.catch(() => undefined).then(async () => {
      const now = Date.now();
      const interval = Math.ceil(1000 / ALCHEMY_CONFIG.MAX_REQUESTS_PER_SECOND);
      const waitMs = Math.max(0, this.lastRequestTime + interval - now);
      if (waitMs > 0) await sleep(waitMs);
      this.lastRequestTime = Date.now();
    });
    this.requestTail = run.then(() => undefined, () => undefined);
    return run;
  }

  async getTokenBalances(network: AlchemyNetwork, ownerAddress: string, tokenAddresses?: string[]): Promise<TokenBalance[]> {
    const tokenKey = tokenAddresses?.length ? [...tokenAddresses].map(v => v.toLowerCase()).sort().join(',') : 'erc20';
    const cacheKey = `${network}:${ownerAddress.toLowerCase()}:${tokenKey}`;
    const cached = this.balanceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const inFlight = this.inFlight.get(cacheKey) as Promise<TokenBalance[]> | undefined;
    if (inFlight) return inFlight;

    const requestPromise = (async () => {
      await this.scheduleRateLimit();
      const data = await postRpcWithRetry<any>(`${ALCHEMY_CONFIG.ENDPOINTS[network]}/${this.apiKey}`, {
        jsonrpc: '2.0', method: 'alchemy_getTokenBalances',
        params: tokenAddresses?.length ? [ownerAddress, tokenAddresses] : [ownerAddress, 'erc20'],
        id: this.requestCount++,
      });
      const balances: TokenBalance[] = Array.isArray(data.result?.tokenBalances) ? data.result.tokenBalances : [];
      this.balanceCache.set(cacheKey, { data: balances, expiresAt: Date.now() + ALCHEMY_CONFIG.TOKEN_BALANCE_CACHE_TTL_MS });
      return balances;
    })().catch(error => {
      logger.warn('[AlchemyTokenAPI] Balance request unavailable', {
        component: 'AlchemyTokenAPI', network,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }).finally(() => this.inFlight.delete(cacheKey));

    this.inFlight.set(cacheKey, requestPromise);
    return requestPromise;
  }

  async getTokenMetadata(network: AlchemyNetwork, tokenAddress: string): Promise<TokenMetadata | null> {
    const cacheKey = `${network}:${tokenAddress.toLowerCase()}`;
    const cached = this.metadataCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const inFlight = this.inFlight.get(cacheKey) as Promise<TokenMetadata | null> | undefined;
    if (inFlight) return inFlight;

    const requestPromise = (async () => {
      await this.scheduleRateLimit();
      const data = await postRpcWithRetry<any>(`${ALCHEMY_CONFIG.ENDPOINTS[network]}/${this.apiKey}`, {
        jsonrpc: '2.0', method: 'alchemy_getTokenMetadata', params: [tokenAddress], id: this.requestCount++,
      });
      const metadata: TokenMetadata = {
        name: data.result?.name || 'Unknown',
        symbol: data.result?.symbol || 'UNK',
        decimals: Number.isFinite(Number(data.result?.decimals)) ? Number(data.result.decimals) : 18,
        logo: data.result?.logo || null,
      };
      this.metadataCache.set(cacheKey, { data: metadata, expiresAt: Date.now() + ALCHEMY_CONFIG.TOKEN_METADATA_CACHE_TTL_MS });
      return metadata;
    })().catch(error => {
      logger.warn('[AlchemyTokenAPI] Metadata request unavailable', {
        component: 'AlchemyTokenAPI', network,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }).finally(() => this.inFlight.delete(cacheKey));

    this.inFlight.set(cacheKey, requestPromise);
    return requestPromise;
  }

  async getCompleteTokenData(network: AlchemyNetwork, ownerAddress: string, tokenAddress: string): Promise<TokenData | null> {
    const [balances, metadata] = await Promise.all([
      this.getTokenBalances(network, ownerAddress, [tokenAddress]),
      this.getTokenMetadata(network, tokenAddress),
    ]);
    if (!balances.length || !metadata) return null;
    return { address: tokenAddress, balance: balances[0], metadata, usdValue: null };
  }

  async batchGetTokenData(network: AlchemyNetwork, ownerAddress: string, tokenAddresses: string[]): Promise<TokenData[]> {
    const balances = await this.getTokenBalances(network, ownerAddress, tokenAddresses);
    const metadataResults: Array<TokenMetadata | null> = [];
    for (let i = 0; i < tokenAddresses.length; i += ALCHEMY_CONFIG.BATCH_SIZE) {
      const batch = tokenAddresses.slice(i, i + ALCHEMY_CONFIG.BATCH_SIZE);
      for (const address of batch) metadataResults.push(await this.getTokenMetadata(network, address));
    }
    return tokenAddresses.flatMap((address, index) => {
      const balance = balances.find(item => item.contractAddress.toLowerCase() === address.toLowerCase());
      const metadata = metadataResults[index];
      return balance && metadata ? [{ address, balance, metadata, usdValue: null }] : [];
    });
  }
}

function configuredMempoolNetworks(): Set<AlchemyNetwork> {
  const raw = process.env.ALCHEMY_MEMPOOL_NETWORKS?.trim();
  if (!raw) return new Set();
  const supported = new Set<AlchemyNetwork>(Object.keys(ALCHEMY_CONFIG.ENDPOINTS) as AlchemyNetwork[]);
  return new Set(raw.split(',').map(v => v.trim().toLowerCase()).filter((v): v is AlchemyNetwork => supported.has(v as AlchemyNetwork)));
}

function mempoolMonitoringEnabled(): boolean {
  return process.env.ALCHEMY_MEMPOOL_MONITORING_ENABLED === 'true';
}

function unfilteredPendingExplicitlyAllowed(): boolean {
  return process.env.ALCHEMY_ALLOW_UNFILTERED_PENDING === 'true';
}

class AlchemyPendingTransactions {
  private subscriptions = new Map<string, AlchemySubscription>();
  private logicalSubscriptions = new Map<AlchemyNetwork, LogicalSubscription>();
  private pendingTxCache = new Map<string, PendingTransaction>();
  private isMonitoring = false;
  private analyzedTxCount = 0;
  private lastObservationAt: number | null = null;
  private readonly DEX_ROUTERS: Record<AlchemyNetwork, string[]> = {
    ethereum: ['0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D','0xE592427A0AEce92De3Edee1F18E0157C05861564','0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F'],
    polygon: ['0xa5E0829CaCEd8fD D4De3c43696c57F7D7A678ff'.replace(/ /g, ''),'0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506'],
    arbitrum: ['0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506','0xE592427A0AEce92De3Edee1F18E0157C05861564'],
    optimism: ['0xE592427A0AEce92De3Edee1F18E0157C05861564'],
    base: ['0x2626664c2603336E57B271c5C0b26F421741e481'],
  };
  private readonly SWAP_SIGNATURES = new Set(['0x38ed1739','0x8803dbee','0x7ff36ab5','0xfb3bdb41','0x18cbafe5','0x4a25d94a','0x5c11d795','0xb6f9de95','0x791ac947','0x414bf389','0xc04b8d59','0xdb3e2198','0xf28c0498']);

  constructor(private readonly apiKey: string = 'demo') {
    logger.info('[AlchemyPendingTx] Initialized', { component: 'AlchemyPendingTx' });
  }

  async startMonitoring(network: AlchemyNetwork, filters?: { fromAddresses?: string[]; toAddresses?: string[] }): Promise<AlchemySubscription> {
    if (!mempoolMonitoringEnabled()) throw new Error('Alchemy mempool monitoring is disabled by cost policy');
    if (!configuredMempoolNetworks().has(network)) throw new Error(`Alchemy mempool monitoring is not enabled for ${network}`);
    if (!unfilteredPendingExplicitlyAllowed()) {
      throw new Error('Unfiltered pending-transaction monitoring is disabled; use a server-side filtered adapter before enabling');
    }

    const existing = Array.from(this.subscriptions.values()).find(item => item.network === network && item.isActive);
    if (existing) return existing;
    const subscriptionId = `pending-${network}-${Date.now()}`;
    const subscription: AlchemySubscription = {
      id: subscriptionId,
      network,
      type: 'pendingTransactions',
      filters: { fromAddress: filters?.fromAddresses || [], toAddress: filters?.toAddresses || this.DEX_ROUTERS[network] },
      isActive: true,
      createdAt: Date.now(),
    };
    this.subscriptions.set(subscriptionId, subscription);
    await multiProviderRpcManager.initialize([network as SupportedChain]);
    const logicalSubscription = await multiProviderRpcManager.subscribe(
      network as SupportedChain,
      'pending_transactions',
      hash => { void this.consumePendingHash(network, String(hash)); },
    );
    this.logicalSubscriptions.set(network, logicalSubscription);
    this.isMonitoring = true;
    logger.warn('[AlchemyPendingTx] Unfiltered monitoring explicitly enabled', {
      component: 'AlchemyPendingTx', network, subscriptionId,
    });
    return subscription;
  }

  stopMonitoring(subscriptionId?: string): void {
    if (subscriptionId) {
      const sub = this.subscriptions.get(subscriptionId);
      if (sub) {
        sub.isActive = false;
        this.subscriptions.delete(subscriptionId);
        const network = sub.network as AlchemyNetwork;
        const logical = this.logicalSubscriptions.get(network);
        if (logical) void logical.unsubscribe();
        this.logicalSubscriptions.delete(network);
      }
    } else {
      for (const logical of this.logicalSubscriptions.values()) void logical.unsubscribe();
      this.logicalSubscriptions.clear();
      this.subscriptions.clear();
    }
    this.isMonitoring = this.subscriptions.size > 0;
    if (!this.isMonitoring) {
      this.pendingTxCache.clear();
      this.lastObservationAt = null;
    }
  }

  private async consumePendingHash(network: AlchemyNetwork, hash: string): Promise<void> {
    try {
      alchemyCostGovernor.reserve('eth_getTransactionByHash');
      const { result: transaction, provenance } = await multiProviderRpcManager.execute(
        network as SupportedChain,
        'transactions',
        provider => provider.getTransaction(hash),
      );
      if (!transaction?.hash) return;
      const raw: Record<string, string> = {
        hash: transaction.hash,
        from: transaction.from,
        to: transaction.to || '',
        value: transaction.value.toHexString(),
        gas: transaction.gasLimit.toHexString(),
        gasPrice: transaction.gasPrice?.toHexString() || '',
        maxFeePerGas: transaction.maxFeePerGas?.toHexString() || '',
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas?.toHexString() || '',
        input: transaction.data,
        nonce: `0x${transaction.nonce.toString(16)}`,
      };
      const matches = Array.from(this.subscriptions.values())
        .filter(item => item.isActive && item.network === network)
        .some(item => this.matchesFilters(raw, item.filters));
      if (!matches) return;
      this.lastObservationAt = Date.now();
      this.cacheTransaction(raw);
      if (provenance.provider !== 'Alchemy') {
        // Reservation is intentionally conservative even if failover avoided Alchemy spend.
      }
    } catch (error) {
      if (!(error instanceof AlchemyBudgetExceededError)) {
        logger.debug('[AlchemyPendingTx] Pending transaction detail unavailable', {
          component: 'AlchemyPendingTx', network,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private matchesFilters(transaction: Record<string, string>, filters: AlchemySubscription['filters']): boolean {
    const from = filters.fromAddress.map(v => v.toLowerCase());
    const to = filters.toAddress.map(v => v.toLowerCase());
    return (from.length === 0 || from.includes(transaction.from.toLowerCase())) &&
      (to.length === 0 || to.includes((transaction.to || '').toLowerCase()));
  }

  private cacheTransaction(tx: Record<string, string>): void {
    if (this.pendingTxCache.has(tx.hash)) return;
    const pending = this.parseTransaction(tx);
    pending.potentialArbitrage = this.isSwapTransaction(pending);
    this.pendingTxCache.set(tx.hash, pending);
    this.analyzedTxCount += 1;
    while (this.pendingTxCache.size > ALCHEMY_CONFIG.MAX_PENDING_TX_CACHE) {
      const first = this.pendingTxCache.keys().next().value;
      if (!first) break;
      this.pendingTxCache.delete(first);
    }
  }

  private parseTransaction(tx: Record<string, string>): PendingTransaction {
    return {
      hash: tx.hash, from: tx.from, to: tx.to || '', value: tx.value, gas: tx.gas,
      gasPrice: tx.gasPrice || '0', maxFeePerGas: tx.maxFeePerGas || null,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas || null, input: tx.input, nonce: tx.nonce,
      timestamp: Date.now(), potentialArbitrage: false, decodedMethod: this.decodeMethodSignature(tx.input),
    };
  }

  private isSwapTransaction(tx: PendingTransaction): boolean {
    return !!tx.input && tx.input.length >= 10 && this.SWAP_SIGNATURES.has(tx.input.slice(0, 10).toLowerCase());
  }

  private decodeMethodSignature(input: string): string | null {
    if (!input || input.length < 10) return null;
    const known: Record<string, string> = {
      '0x38ed1739':'swapExactTokensForTokens','0x8803dbee':'swapTokensForExactTokens','0x7ff36ab5':'swapExactETHForTokens',
      '0xfb3bdb41':'swapETHForExactTokens','0x18cbafe5':'swapExactTokensForETH','0x4a25d94a':'swapTokensForExactETH',
      '0x414bf389':'exactInputSingle','0xc04b8d59':'exactInput','0xdb3e2198':'exactOutputSingle','0xf28c0498':'exactOutput',
      '0xa9059cbb':'transfer','0x095ea7b3':'approve','0x23b872dd':'transferFrom',
    };
    return known[input.slice(0, 10).toLowerCase()] || null;
  }

  hasAvailableEvidence(): boolean {
    return Array.from(this.logicalSubscriptions.values()).some(item => item.state === 'healthy') &&
      this.lastObservationAt !== null && Date.now() - this.lastObservationAt <= 15_000;
  }

  analyzeMempoolOpportunities(): MempoolAnalysis {
    const now = Date.now();
    for (const [hash, tx] of this.pendingTxCache.entries()) if (now - tx.timestamp > ALCHEMY_CONFIG.PENDING_TX_CACHE_TTL_MS) this.pendingTxCache.delete(hash);
    const pending = Array.from(this.pendingTxCache.values());
    const fresh = this.lastObservationAt !== null && now - this.lastObservationAt <= 15_000;
    const healthy = Array.from(this.logicalSubscriptions.values()).filter(item => item.state === 'healthy' && item.provider);
    const swaps = pending.filter(tx => this.isSwapTransaction(tx));
    const gasPrices = pending.map(tx => parseInt(tx.gasPrice || '0', 16)).filter(value => Number.isFinite(value) && value > 0);
    return {
      available: healthy.length > 0 && fresh,
      observedAt: fresh ? this.lastObservationAt : null,
      provenance: healthy.map(item => `provider:${item.provider}`),
      totalPending: pending.length,
      swapTransactions: swaps.length,
      liquidityAdditions: 0,
      largeTransfers: pending.filter(tx => { try { return BigInt(tx.value || '0') > 1_000_000_000_000_000_000n; } catch { return false; } }).length,
      arbitrageOpportunities: pending.filter(tx => tx.potentialArbitrage).slice(0, 10),
      avgGasPrice: gasPrices.length ? gasPrices.reduce((a,b) => a + b, 0) / gasPrices.length : 0,
      maxGasPrice: gasPrices.length ? Math.max(...gasPrices) : 0,
    };
  }

  getStatistics(): { activeSubscriptions: number; cachedTransactions: number; analyzedTransactions: number; isMonitoring: boolean } {
    return { activeSubscriptions: this.subscriptions.size, cachedTransactions: this.pendingTxCache.size, analyzedTransactions: this.analyzedTxCount, isMonitoring: this.isMonitoring };
  }
}

class AlchemyArbitrageDetector {
  private detectedOpportunities: Array<{ id: string; type: 'sandwich' | 'backrun' | 'frontrun' | 'triangular'; pendingTx: PendingTransaction; estimatedProfit: number; timestamp: number }> = [];

  constructor(
    private readonly tokenAPI: AlchemyTokenAPI,
    private readonly pendingTx: AlchemyPendingTransactions,
  ) {
    logger.info('[AlchemyArbitrageDetector] Initialized', { component: 'AlchemyArbitrageDetector' });
  }

  async start(networks: AlchemyNetwork[]): Promise<void> {
    const configured = configuredMempoolNetworks();
    const requested = networks.filter(network => configured.has(network));
    if (!mempoolMonitoringEnabled() || requested.length === 0) {
      logger.info('[AlchemyArbitrageDetector] Mempool monitoring withheld by cost/capability policy', {
        component: 'AlchemyArbitrageDetector',
        mempoolMonitoringEnabled: mempoolMonitoringEnabled(),
        configuredNetworks: Array.from(configured),
      });
      return;
    }
    for (const network of requested) {
      try {
        await this.pendingTx.startMonitoring(network);
      } catch (error) {
        logger.warn('[AlchemyArbitrageDetector] Mempool network not started', {
          component: 'AlchemyArbitrageDetector', network,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  stop(): void { this.pendingTx.stopMonitoring(); }
  getMempoolAnalysis(): MempoolAnalysis { return this.pendingTx.analyzeMempoolOpportunities(); }

  async getPortfolioTokens(network: AlchemyNetwork, walletAddress: string): Promise<TokenData[]> {
    const balances = await this.tokenAPI.getTokenBalances(network, walletAddress);
    const addresses = balances.filter(item => item.tokenBalance !== '0x0').map(item => item.contractAddress);
    return this.tokenAPI.batchGetTokenData(network, walletAddress, addresses);
  }

  getStatistics(): { pendingTx: ReturnType<AlchemyPendingTransactions['getStatistics']>; detectedOpportunities: number; mempoolAnalysis: MempoolAnalysis } {
    return { pendingTx: this.pendingTx.getStatistics(), detectedOpportunities: this.detectedOpportunities.length, mempoolAnalysis: this.pendingTx.analyzeMempoolOpportunities() };
  }
}

export class AlchemyIntegration {
  public tokenAPI: AlchemyTokenAPI;
  public pendingTransactions: AlchemyPendingTransactions;
  public arbitrageDetector: AlchemyArbitrageDetector;
  private isActive = false;
  private isDegraded = false;
  private activeNetworks: AlchemyNetwork[] = [];
  private lastHealthCheckAt: number | null = null;
  private lastHealthError: string | undefined;

  constructor(private readonly apiKey: string = 'demo') {
    this.tokenAPI = new AlchemyTokenAPI(apiKey);
    this.pendingTransactions = new AlchemyPendingTransactions(apiKey);
    this.arbitrageDetector = new AlchemyArbitrageDetector(this.tokenAPI, this.pendingTransactions);
    logger.info('[AlchemyIntegration] Fully initialized', {
      component: 'AlchemyIntegration', networks: Object.keys(ALCHEMY_CONFIG.ENDPOINTS).length,
      costGovernor: true, mempoolDefault: 'disabled',
    });
  }

  private isConfiguredApiKey(): boolean {
    const normalized = this.apiKey.trim().toLowerCase();
    return normalized.length > 0 && normalized !== 'demo';
  }

  private emptyMempoolAnalysis(): MempoolAnalysis {
    return { available: false, observedAt: null, provenance: [], totalPending: 0, swapTransactions: 0, liquidityAdditions: 0, largeTransfers: 0, arbitrageOpportunities: [], avgGasPrice: 0, maxGasPrice: 0 };
  }

  private async probeNetwork(network: AlchemyNetwork): Promise<void> {
    await postRpcWithRetry<any>(`${ALCHEMY_CONFIG.ENDPOINTS[network]}/${this.apiKey}`, {
      jsonrpc: '2.0', method: 'eth_chainId', params: [], id: Date.now(),
    }, { critical: true });
  }

  async readinessCheck(options?: { strictLive?: boolean; network?: AlchemyNetwork }): Promise<AlchemyReadinessStatus> {
    const strictLive = options?.strictLive === true;
    const network = options?.network || 'ethereum';
    const configured = this.isConfiguredApiKey();
    this.lastHealthCheckAt = Date.now();
    if (!configured) {
      this.lastHealthError = 'ALCHEMY_API_KEY is not configured (demo key active)';
      return {
        ready: !strictLive, configured: false, active: this.isActive, degraded: true, strictLive,
        detail: strictLive ? 'Alchemy live mode requires a configured ALCHEMY_API_KEY' : 'Alchemy running in demo/degraded mode; paid telemetry withheld',
        apiKeyMode: 'demo', network, lastHealthCheckAt: this.lastHealthCheckAt, lastHealthError: this.lastHealthError,
      };
    }
    try {
      await this.probeNetwork(network);
      this.lastHealthError = undefined;
      return {
        ready: true, configured: true, active: this.isActive, degraded: this.isDegraded, strictLive,
        detail: `Alchemy probe succeeded on ${network}; mempool=${mempoolMonitoringEnabled() ? 'opt-in' : 'disabled_by_cost_policy'}`,
        apiKeyMode: 'configured', network, lastHealthCheckAt: this.lastHealthCheckAt,
      };
    } catch (error) {
      this.lastHealthError = error instanceof Error ? error.message : String(error);
      return {
        ready: !strictLive, configured: true, active: this.isActive, degraded: true, strictLive,
        detail: `Alchemy probe failed on ${network}: ${this.lastHealthError}`,
        apiKeyMode: 'configured', network, lastHealthCheckAt: this.lastHealthCheckAt, lastHealthError: this.lastHealthError,
      };
    }
  }

  async start(networks?: AlchemyNetwork[]): Promise<void> {
    if (this.isActive) return;
    const requested = networks || ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'];
    const strictLive = process.env.ALCHEMY_REQUIRE_LIVE === 'true';
    const readiness = await this.readinessCheck({ strictLive, network: requested[0] });
    if (!readiness.ready && strictLive) throw new Error(readiness.detail);
    this.isActive = true;
    this.isDegraded = !readiness.configured || !readiness.ready;
    this.activeNetworks = [...requested];

    if (readiness.configured) await this.arbitrageDetector.start(requested);
    logger.info('[AlchemyIntegration] Services started with provider-cost policy', {
      component: 'AlchemyIntegration', networks: requested,
      degraded: this.isDegraded,
      mempoolMonitoringEnabled: mempoolMonitoringEnabled(),
      configuredMempoolNetworks: Array.from(configuredMempoolNetworks()),
      unfilteredPendingAllowed: unfilteredPendingExplicitlyAllowed(),
      cost: alchemyCostGovernor.snapshot(),
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
    return this.isActive ? this.arbitrageDetector.getMempoolAnalysis() : this.emptyMempoolAnalysis();
  }

  isReady(): boolean { return this.isActive && !this.isDegraded; }

  getStatistics(): {
    arbitrage: ReturnType<AlchemyArbitrageDetector['getStatistics']>;
    isActive: boolean;
    apiKey: string;
    readiness: { configured: boolean; ready: boolean; degraded: boolean; activeNetworks: AlchemyNetwork[]; lastHealthCheckAt: number | null; lastHealthError?: string };
    cost: AlchemyCostSnapshot;
    mempoolPolicy: { enabled: boolean; networks: AlchemyNetwork[]; unfilteredPendingAllowed: boolean };
  } {
    return {
      arbitrage: this.arbitrageDetector.getStatistics(),
      isActive: this.isActive,
      apiKey: this.apiKey === 'demo' ? 'demo' : '***configured***',
      readiness: {
        configured: this.isConfiguredApiKey(), ready: this.isReady(), degraded: this.isDegraded,
        activeNetworks: [...this.activeNetworks], lastHealthCheckAt: this.lastHealthCheckAt, lastHealthError: this.lastHealthError,
      },
      cost: alchemyCostGovernor.snapshot(),
      mempoolPolicy: {
        enabled: mempoolMonitoringEnabled(), networks: Array.from(configuredMempoolNetworks()),
        unfilteredPendingAllowed: unfilteredPendingExplicitlyAllowed(),
      },
    };
  }
}

export const alchemyIntegration = new AlchemyIntegration(process.env.ALCHEMY_API_KEY || 'demo');
